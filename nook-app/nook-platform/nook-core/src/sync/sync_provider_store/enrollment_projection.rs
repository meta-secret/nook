//! Enrollment-to-provider configuration projection retains canonical OAuth state ownership.
use crate::errors::ValidationResult;
use crate::{
    DRIVE_SHARED_FOLDER_REF_PREFIX, EnrollmentProvider, EnrollmentProviderDataRef,
    OAuthAccountIdentity, OAuthFileConfigData, OAuthRefreshCredential, OAuthRemoteFile,
    OAuthTokenExpiry, OauthFilePreset, PersonalEnrollmentProviderData, S3Connection,
    StoredGoogleDriveFolder, StoredICloudShareTarget, StoredOAuthAccessCredential,
    StoredOAuthAccountIdentity, StoredOAuthRefreshCredential, StoredOAuthRemoteFileId,
    StoredOAuthRemoteFileName, StoredOAuthTokenExpiry, ValidationError,
};

/// The joiner's side of an S3 invite: the inviter's connection, validated
/// again as the setup form validates it, for the S3 block of the joiner's new
/// provider row. Saving that row seals its secret. A provider that carries no
/// personal S3 connection has none to give.
impl TryFrom<&EnrollmentProvider> for S3Connection {
    type Error = ValidationError;
    fn try_from(provider: &EnrollmentProvider) -> ValidationResult<Self> {
        let EnrollmentProviderDataRef::Personal(PersonalEnrollmentProviderData::S3(connection)) =
            provider.data()
        else {
            return Err(ValidationError::S3StorageTargetInvalid);
        };
        Self::try_from(connection)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum EnrollmentOAuthConfigurationError {
    #[error("Enrollment provider does not carry personal OAuth configuration.")]
    NotPersonalOAuth,
    #[error(transparent)]
    InvalidPreset(#[from] ValidationError),
}
pub struct EnrollmentOAuthConfigurationRequest<'a> {
    pub provider: &'a EnrollmentProvider,
    pub defaults: OAuthFileConfigData,
}
impl EnrollmentOAuthConfigurationRequest<'_> {
    pub fn project(self) -> Result<OAuthFileConfigData, EnrollmentOAuthConfigurationError> {
        let EnrollmentProviderDataRef::Personal(PersonalEnrollmentProviderData::OauthFile {
            preset,
            access_token,
            refresh,
            expiry,
            remote_file,
            account,
        }) = self.provider.data()
        else {
            return Err(EnrollmentOAuthConfigurationError::NotPersonalOAuth);
        };
        let mut config = self.defaults;
        config.preset = OauthFilePreset::parse(preset)?;
        config.access_token = StoredOAuthAccessCredential::AccessToken(access_token.clone());
        config.refresh_token = match refresh {
            OAuthRefreshCredential::NotIssued => StoredOAuthRefreshCredential::NotIssued,
            OAuthRefreshCredential::Token(token) => {
                StoredOAuthRefreshCredential::Token(token.clone())
            }
        };
        config.expires_at = match expiry {
            OAuthTokenExpiry::Unknown => StoredOAuthTokenExpiry::Unknown,
            OAuthTokenExpiry::ExpiresAt(value) => StoredOAuthTokenExpiry::ExpiresAt(value.clone()),
        };
        let (target, file_name) = match remote_file {
            OAuthRemoteFile::Unresolved => (None, StoredOAuthRemoteFileName::Unresolved),
            OAuthRemoteFile::FileId { file_id } => {
                (Some(file_id), StoredOAuthRemoteFileName::Unresolved)
            }
            OAuthRemoteFile::FileName { file_name } => {
                (None, StoredOAuthRemoteFileName::FileName(file_name.clone()))
            }
            OAuthRemoteFile::Identified { file_id, file_name } => (
                Some(file_id),
                StoredOAuthRemoteFileName::FileName(file_name.clone()),
            ),
        };
        // A companion code carries the provider's shared target in the file
        // slot; it is a connect target, not a file.
        let target = target.map(|target| target.trim()).unwrap_or_default();
        match config.preset {
            OauthFilePreset::GoogleDrive => {
                config.folder_id = target
                    .strip_prefix(DRIVE_SHARED_FOLDER_REF_PREFIX)
                    .map(str::trim)
                    .filter(|folder_id| !folder_id.is_empty())
                    .map_or(StoredGoogleDriveFolder::Root, |folder_id| {
                        StoredGoogleDriveFolder::FolderId(folder_id.to_owned())
                    });
            }
            OauthFilePreset::ICloud => {
                config.icloud_share_target = if target.is_empty() {
                    StoredICloudShareTarget::Unbound
                } else {
                    StoredICloudShareTarget::SharedTarget(target.to_owned())
                };
            }
        }
        config.file_id = StoredOAuthRemoteFileId::Unresolved;
        config.file_name = file_name;
        config.account_email = match account {
            OAuthAccountIdentity::Unknown => StoredOAuthAccountIdentity::Unknown,
            OAuthAccountIdentity::Email(email) => StoredOAuthAccountIdentity::Email(email.clone()),
        };
        Ok(config)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        CheckedEnrollmentEnvelope, EnrollmentAudience, EnrollmentIdentityTarget, EnrollmentInvite,
        EnrollmentIssuance, EnrollmentIssueInput, IdentityId, IdentityInviteId, InviteSigningSeed,
        OnboardingType, PersonalEnrollmentProvider, ProviderEnrollmentRequest, ProviderSecretText,
        ReplicationType, S3EnrollmentConnection, S3KeyPrefix, SharedEnrollmentAudience,
        StorageProviderData, StorageProviderType, StoredGithubPat, StoredS3Configuration,
        VaultArchitecture,
    };

    const S3_SECRET: &str = "TEST-ONLY-device-a-secret-not-real";

    fn s3_row(config: S3Connection) -> StorageProviderData {
        let mut row = StorageProviderData::github("s3", "S3 · nook-dev", "", "", "now");
        row.provider_type = StorageProviderType::S3;
        row.github_pat = StoredGithubPat::Missing;
        row.s3 = StoredS3Configuration::Configured(config);
        row
    }

    fn issue(provider: EnrollmentProvider) -> anyhow::Result<String> {
        let input = EnrollmentIssueInput {
            provider,
            identity: EnrollmentIdentityTarget {
                identity_id: IdentityId::generate()?,
                label: "Team keyring".to_owned(),
            },
            invite: EnrollmentInvite {
                invite_id: IdentityInviteId::parse("inv_abcdefghijk")?,
                signing_seed: InviteSigningSeed::generate()?,
                vaults: Vec::new(),
            },
            entry_id: "entry-s3".to_owned(),
            issued_at: "2026-10-31T12:00:00Z".to_owned(),
        };
        Ok(EnrollmentIssuance {
            input: &input,
            password: "invite passphrase",
            entry_label: "Laptop",
        }
        .check()?
        .issue()?)
    }

    #[test]
    fn an_s3_invite_hands_the_joiner_the_inviters_connection_and_key() -> anyhow::Result<()> {
        let config = S3Connection::fixture()?;
        let row = s3_row(config.clone());
        let provider = ProviderEnrollmentRequest {
            provider: &row,
            architecture: &VaultArchitecture::default(),
            audience: EnrollmentAudience::Personal,
        }
        .build()?;
        assert_eq!(
            OnboardingType::from_enrollment(&provider),
            OnboardingType::PersonalCredentialTransfer
        );

        let code = issue(provider)?;
        assert!(!code.contains(S3_SECRET));
        let decrypted = CheckedEnrollmentEnvelope::parse(&code)?.decrypt("invite passphrase")?;
        let joined = S3Connection::try_from(&decrypted.provider)?;
        assert_eq!(joined, config);
        Ok(())
    }

    #[test]
    fn s3_invites_need_a_personal_vault_and_a_valid_connection() -> anyhow::Result<()> {
        let config = S3Connection::fixture()?;
        let shared = VaultArchitecture {
            replication_type: ReplicationType::Shared,
            ..VaultArchitecture::default()
        };
        assert!(matches!(
            ProviderEnrollmentRequest {
                provider: &s3_row(config),
                architecture: &shared,
                audience: EnrollmentAudience::Shared(SharedEnrollmentAudience {
                    joiner_identity: "joiner@example.com",
                }),
            }
            .build(),
            Err(ValidationError::UnsupportedProviderReplication { .. })
        ));
        // A decrypted code whose connection fails validation adds no provider.
        let tampered =
            EnrollmentProvider::personal(PersonalEnrollmentProvider::s3(S3EnrollmentConnection {
                endpoint: "http://s3.example.com".to_owned(),
                region: "us-east-1".to_owned(),
                bucket: "nook-dev".to_owned(),
                key_prefix: S3KeyPrefix::BucketRoot,
                access_key_id: "device-a".to_owned(),
                secret_access_key: ProviderSecretText::try_from(S3_SECRET.to_owned())?,
            }));
        assert_eq!(
            S3Connection::try_from(&tampered),
            Err(ValidationError::S3EndpointInsecure)
        );
        assert_eq!(
            S3Connection::try_from(&EnrollmentProvider::personal(
                PersonalEnrollmentProvider::local()
            )),
            Err(ValidationError::S3StorageTargetInvalid)
        );
        Ok(())
    }

    fn project(
        preset: &str,
        remote_file: OAuthRemoteFile,
    ) -> Result<OAuthFileConfigData, EnrollmentOAuthConfigurationError> {
        EnrollmentOAuthConfigurationRequest {
            provider: &EnrollmentProvider::personal(PersonalEnrollmentProvider::oauth_file(
                preset.into(),
                "access".into(),
                OAuthRefreshCredential::NotIssued,
                OAuthTokenExpiry::Unknown,
                remote_file,
                OAuthAccountIdentity::Unknown,
            )),
            defaults: OAuthFileConfigData::default(),
        }
        .project()
    }

    #[test]
    fn local_provider_cannot_be_reinterpreted_as_oauth() {
        let provider = EnrollmentProvider::personal(PersonalEnrollmentProvider::local());
        assert!(matches!(
            EnrollmentOAuthConfigurationRequest {
                provider: &provider,
                defaults: OAuthFileConfigData::default()
            }
            .project(),
            Err(EnrollmentOAuthConfigurationError::NotPersonalOAuth)
        ));
    }

    #[test]
    fn companion_codes_restore_the_shared_drive_folder() -> anyhow::Result<()> {
        let folder = project(
            "google-drive",
            OAuthRemoteFile::Identified {
                file_id: "shared:folder-abc".into(),
                file_name: "nook-events".into(),
            },
        )?;
        assert_eq!(
            folder.folder_id,
            StoredGoogleDriveFolder::FolderId("folder-abc".into())
        );
        assert_eq!(folder.file_id, StoredOAuthRemoteFileId::Unresolved);
        assert_eq!(
            folder.file_name,
            StoredOAuthRemoteFileName::FileName("nook-events".into())
        );
        // A reference that names no folder leaves the provider unbound, so
        // connecting fails visibly instead of guessing a folder.
        let unbound = project(
            "google-drive",
            OAuthRemoteFile::FileId {
                file_id: "file-id".into(),
            },
        )?;
        assert_eq!(unbound.folder_id, StoredGoogleDriveFolder::Root);
        Ok(())
    }

    #[test]
    fn companion_codes_restore_the_icloud_share() -> anyhow::Result<()> {
        let shared = project(
            "icloud",
            OAuthRemoteFile::FileId {
                file_id: " icloud-share-v1:{} ".into(),
            },
        )?;
        assert_eq!(
            shared.icloud_share_target,
            StoredICloudShareTarget::SharedTarget("icloud-share-v1:{}".into())
        );
        assert_eq!(shared.folder_id, StoredGoogleDriveFolder::Root);
        let unbound = project("icloud", OAuthRemoteFile::Unresolved)?;
        assert_eq!(
            unbound.icloud_share_target,
            StoredICloudShareTarget::Unbound
        );
        assert_eq!(
            unbound.refresh_token,
            StoredOAuthRefreshCredential::NotIssued
        );
        Ok(())
    }
}
