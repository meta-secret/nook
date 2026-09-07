//! Enrollment payload selection for persisted sync-provider rows.
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use crate::{
    OAuthAccessTokenRef, OAuthAccountIdentity, OAuthRefreshCredential, OAuthRemoteFile,
    OAuthTokenExpiry,
};

use super::StorageProviderData;
use crate::errors::{ValidationError, ValidationResult};
use crate::{
    EnrollmentProvider, GoogleDriveMode, ICloudMode, OauthFilePreset, OnboardingType,
    PersonalEnrollmentProvider, ReplicationType, SharedEnrollmentProvider,
    SharedStorageTargetSelection, StorageProviderType, VaultArchitecture, validate_github_pat,
    validate_github_repo_name, validate_oauth_access_token,
};

/// Borrowed configuration for one enrollment payload construction.
/// Admission selects the existing personal or shared payload boundary, not provider authorization.
///
/// Payload construction consumes the request:
/// ```compile_fail
/// use nook_core::ProviderEnrollmentRequest;
/// fn twice(request: ProviderEnrollmentRequest<'_>) {
///     let _ = request.build();
///     let _ = request.build();
/// }
/// ```
/// The intermediate selection is private:
/// ```compile_fail
/// use nook_core::ProviderEnrollmentRequest;
/// fn bypass(request: ProviderEnrollmentRequest<'_>) {
///     let _ = request.admit();
/// }
/// ```
/// Requests do not clone the construction continuation:
/// ```compile_fail
/// use nook_core::ProviderEnrollmentRequest;
/// fn duplicate(request: ProviderEnrollmentRequest<'_>) {
///     let _ = request.clone();
/// }
/// ```
pub struct ProviderEnrollmentRequest<'a> {
    pub provider: &'a StorageProviderData,
    pub architecture: &'a VaultArchitecture,
    pub shared_joiner_identity: Option<&'a str>,
    pub shared_storage_target_id: Option<&'a str>,
}

struct CheckedProviderEnrollment<'a> {
    request: ProviderEnrollmentRequest<'a>,
    onboarding: OnboardingType,
}

impl<'a> ProviderEnrollmentRequest<'a> {
    pub fn build(self) -> ValidationResult<EnrollmentProvider> {
        self.admit()?.build()
    }

    fn admit(self) -> ValidationResult<CheckedProviderEnrollment<'a>> {
        let onboarding = self.provider.onboarding_type(self.architecture)?;
        Ok(CheckedProviderEnrollment {
            request: self,
            onboarding,
        })
    }
}

impl CheckedProviderEnrollment<'_> {
    fn build(self) -> ValidationResult<EnrollmentProvider> {
        match self.onboarding {
            OnboardingType::PersonalCredentialTransfer => {
                self.personal().map(EnrollmentProvider::personal)
            }
            OnboardingType::SharedProviderGrant => self.shared().map(EnrollmentProvider::shared),
        }
    }
}

/// Ordered provider observations for an exact shared-target credential selection.
pub struct SharedGrantProviderSelection<'a> {
    pub providers: &'a [StorageProviderData],
    pub preset: OauthFilePreset,
    pub target: &'a SharedStorageTargetSelection,
}

/// Select a saved OAuth provider that can authorize a shared enrollment
/// target. A bound target may reuse only the credential persisted for that
/// exact Drive folder or iCloud share.
impl SharedGrantProviderSelection<'_> {
    #[must_use]
    pub fn select(self) -> Option<String> {
        let Self {
            providers,
            preset,
            target,
        } = self;

        providers.iter().find_map(|provider| {
            if provider.provider_type != StorageProviderType::OauthFile {
                return None;
            }
            let oauth = provider.oauth_file.as_ref()?;
            if oauth.preset != preset
                || !matches!(
                    oauth.usable_access_token(),
                    OAuthAccessTokenRef::Available(_)
                )
            {
                return None;
            }
            let target_matches = match target {
                SharedStorageTargetSelection::Create => true,
                SharedStorageTargetSelection::Existing(target_id) => {
                    oauth.folder_id.as_deref() == Some(target_id.as_str())
                        || oauth.icloud_share_target.as_deref() == Some(target_id.as_str())
                }
            };
            target_matches.then(|| provider.id.clone())
        })
    }
}

/// Resolve the enrollment handoff from both vault policy and the concrete
/// provider target. A shared Google Drive folder always uses a target-only
/// grant, even when the vault's default replication policy is personal;
/// the owner's OAuth credential must never be transferred for a shared target.
impl StorageProviderData {
    pub fn onboarding_type(
        &self,
        architecture: &VaultArchitecture,
    ) -> ValidationResult<OnboardingType> {
        let provider = self;

        architecture.validate()?;
        let provider_type = provider.provider_type;
        let provider_uses_shared_target = if provider_type == StorageProviderType::OauthFile {
            provider
                .oauth_file
                .as_ref()
                .is_some_and(|oauth| match oauth.preset {
                    OauthFilePreset::GoogleDrive => {
                        oauth.resolved_google_drive_mode() == GoogleDriveMode::Shared
                    }
                    OauthFilePreset::ICloud => oauth.resolved_icloud_mode() == ICloudMode::Shared,
                })
        } else {
            false
        };
        let effective_replication = if provider_uses_shared_target {
            ReplicationType::Shared
        } else {
            architecture.replication_type
        };
        provider.validate_replication(effective_replication)?;
        Ok(match effective_replication {
            ReplicationType::Personal => OnboardingType::PersonalCredentialTransfer,
            ReplicationType::Shared => OnboardingType::SharedProviderGrant,
        })
    }
}

/// Resolve the onboarding ceremony encoded by an enrollment provider payload.
///
/// Credential-bearing provider variants are restricted to trusted-device
/// onboarding. Shared-target variants contain no provider credential fields and
/// always require the joining device to authenticate independently.
impl OnboardingType {
    #[must_use]
    pub const fn from_enrollment(provider: &EnrollmentProvider) -> Self {
        match provider {
            EnrollmentProvider::PersonalCredentialTransfer(_) => {
                OnboardingType::PersonalCredentialTransfer
            }
            EnrollmentProvider::SharedProviderGrant(_) => OnboardingType::SharedProviderGrant,
        }
    }
}

/// Build only the credential-bearing enrollment typestate. Its return value
/// cannot be wrapped as a shared-provider payload.
impl CheckedProviderEnrollment<'_> {
    fn personal(self) -> ValidationResult<PersonalEnrollmentProvider> {
        let provider = self.request.provider;

        provider.validate_replication(ReplicationType::Personal)?;
        let provider_type = provider.provider_type;
        match provider_type {
            StorageProviderType::Local | StorageProviderType::LocalFolder => {
                Ok(PersonalEnrollmentProvider::local())
            }
            StorageProviderType::Github => Ok(PersonalEnrollmentProvider::github(
                validate_github_pat(provider.github_pat.as_deref().unwrap_or_default())?
                    .as_str()
                    .to_owned(),
                validate_github_repo_name(provider.github_repo.as_deref().unwrap_or_default())?
                    .as_str()
                    .to_owned(),
            )),
            StorageProviderType::OauthFile => {
                let oauth = provider
                    .oauth_file
                    .as_ref()
                    .ok_or(ValidationError::OauthAccessTokenEmpty)?;
                let preset = oauth.preset;
                Ok(PersonalEnrollmentProvider::oauth_file(
                    preset.as_str().to_owned(),
                    validate_oauth_access_token(oauth.access_token.as_deref().unwrap_or_default())?
                        .as_str()
                        .to_owned(),
                    match oauth.refresh_token.as_deref() {
                        Some(value) => OAuthRefreshCredential::Token(value.to_owned()),
                        None => OAuthRefreshCredential::NotIssued,
                    },
                    match oauth.expires_at.as_deref() {
                        Some(value) => OAuthTokenExpiry::ExpiresAt(value.to_owned()),
                        None => OAuthTokenExpiry::Unknown,
                    },
                    match (oauth.file_id.as_deref(), oauth.file_name.as_deref()) {
                        (Some(file_id), Some(file_name)) => OAuthRemoteFile::Identified {
                            file_id: file_id.to_owned(),
                            file_name: file_name.to_owned(),
                        },
                        (Some(file_id), None) => OAuthRemoteFile::FileId {
                            file_id: file_id.to_owned(),
                        },
                        (None, Some(file_name)) => OAuthRemoteFile::FileName {
                            file_name: file_name.to_owned(),
                        },
                        (None, None) => OAuthRemoteFile::Unresolved,
                    },
                    match oauth.account_email.as_deref() {
                        Some(value) => OAuthAccountIdentity::Email(value.to_owned()),
                        None => OAuthAccountIdentity::Unknown,
                    },
                ))
            }
        }
    }
}

/// Build only the credential-free shared-provider typestate. Even though the
/// saved row contains this browser's credential for grant preparation, this
/// return type has no credential fields or credential-bearing constructors.
impl CheckedProviderEnrollment<'_> {
    fn shared(self) -> ValidationResult<SharedEnrollmentProvider> {
        let ProviderEnrollmentRequest {
            provider,
            shared_joiner_identity,
            shared_storage_target_id,
            ..
        } = self.request;

        provider.validate_replication(ReplicationType::Shared)?;
        let oauth = provider.oauth_file.as_ref();
        let preset = oauth.map(|config| config.preset);
        let storage_target_id = shared_storage_target_id
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(str::to_owned)
            .or_else(|| match preset {
                Some(OauthFilePreset::GoogleDrive) => oauth
                    .and_then(|config| config.folder_id.as_deref().map(str::to_owned))
                    .filter(|id| !id.trim().is_empty()),
                Some(OauthFilePreset::ICloud) => oauth
                    .and_then(|config| config.icloud_share_target.as_deref().map(str::to_owned))
                    .filter(|id| !id.trim().is_empty()),
                None => None,
            })
            .ok_or(ValidationError::SharedStorageTargetRequired)?;
        match preset {
            Some(OauthFilePreset::ICloud) => {
                Ok(SharedEnrollmentProvider::icloud(storage_target_id))
            }
            _ => Ok(SharedEnrollmentProvider::google_drive(
                shared_joiner_identity
                    .map(str::trim)
                    .filter(|identity| !identity.is_empty())
                    .ok_or(ValidationError::SharedJoinerIdentityRequired)?
                    .to_owned(),
                storage_target_id,
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        ProviderVaultScope, StoredGithubPat, StoredGithubRepository, StoredGoogleDriveFolder,
        StoredLocalFolderConfiguration, StoredOAuthAccessCredential, StoredOAuthFileConfiguration,
        StoredOAuthRemoteFileId, StoredOAuthRemoteFileName,
    };

    use std::io;

    use super::{
        CheckedProviderEnrollment, ProviderEnrollmentRequest, SharedGrantProviderSelection,
    };
    use crate::errors::ValidationError;
    use crate::{
        EnrollmentProvider, GoogleDriveMode, OauthFilePreset, OnboardingType, ReplicationType,
        SharedEnrollmentProvider, SharedStorageTargetSelection, StorageProviderData,
        StorageProviderType, VaultArchitecture,
    };
    struct ProviderEnrollmentFixture {
        provider: StorageProviderData,
    }
    use crate::{
        EnrollmentProviderDataRef, OAuthFileConfigData, ProviderSyncCheckpoint,
        SharedEnrollmentProviderData,
    };

    impl ProviderEnrollmentFixture {
        fn github(id: &str, repo: &str, pat: &str) -> Self {
            Self {
                provider: StorageProviderData {
                    id: id.to_owned(),
                    provider_type: StorageProviderType::Github,
                    label: "GitHub".to_owned(),
                    github_pat: StoredGithubPat::Token(pat.to_owned()),
                    github_repo: StoredGithubRepository::Repository(repo.to_owned()),
                    oauth_file: StoredOAuthFileConfiguration::NotApplicable,
                    local_folder: StoredLocalFolderConfiguration::NotApplicable,
                    store_id: ProviderVaultScope::Unscoped,
                    sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
                    created_at: "2026-06-24T00:00:00.000Z".to_owned(),
                },
            }
        }
    }

    impl ProviderEnrollmentFixture {
        fn oauth(
            id: &str,
            preset: OauthFilePreset,
            file_id: Option<&str>,
            file_name: &str,
        ) -> Self {
            Self {
                provider: StorageProviderData {
                    id: id.to_owned(),
                    provider_type: StorageProviderType::OauthFile,
                    label: "Google Drive".to_owned(),
                    github_pat: StoredGithubPat::Missing,
                    github_repo: StoredGithubRepository::DefaultRepository,
                    oauth_file: StoredOAuthFileConfiguration::configured(OAuthFileConfigData {
                        preset,
                        access_token: StoredOAuthAccessCredential::AccessToken(
                            " token ".to_owned(),
                        ),
                        file_id: StoredOAuthRemoteFileId::from_option(file_id.map(str::to_owned)),
                        file_name: StoredOAuthRemoteFileName::FileName(file_name.to_owned()),
                        ..OAuthFileConfigData::default()
                    }),
                    local_folder: StoredLocalFolderConfiguration::NotApplicable,
                    store_id: ProviderVaultScope::Unscoped,
                    sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
                    created_at: "2026-06-24T00:00:00.000Z".to_owned(),
                },
            }
        }
    }

    #[test]
    fn builder_enforces_replication_before_payload_creation() -> anyhow::Result<()> {
        let shared = VaultArchitecture {
            replication_type: ReplicationType::Shared,
            ..VaultArchitecture::default()
        };
        let github = ProviderEnrollmentFixture::github("gh", "nook", "github_pat_123").provider;
        assert!(
            ProviderEnrollmentRequest {
                provider: &github,
                architecture: &shared,
                shared_joiner_identity: Some("a@b.com"),
                shared_storage_target_id: None
            }
            .build()
            .is_err()
        );

        let drive = ProviderEnrollmentFixture::oauth(
            "drive",
            OauthFilePreset::GoogleDrive,
            Some("file-123"),
            "nook.yaml",
        )
        .provider;
        assert_eq!(
            ProviderEnrollmentRequest {
                provider: &drive,
                architecture: &shared,
                shared_joiner_identity: Some("joiner@example.com"),
                shared_storage_target_id: None
            }
            .build(),
            Err(ValidationError::SharedStorageTargetRequired)
        );
        assert_eq!(
            ProviderEnrollmentRequest {
                provider: &drive,
                architecture: &shared,
                shared_joiner_identity: Some("joiner@example.com"),
                shared_storage_target_id: Some("shared-folder-xyz")
            }
            .build()?,
            EnrollmentProvider::shared(SharedEnrollmentProvider::google_drive(
                "joiner@example.com".to_owned(),
                "shared-folder-xyz".to_owned(),
            ))
        );

        let personal = ProviderEnrollmentRequest {
            provider: &drive,
            architecture: &VaultArchitecture::default(),
            shared_joiner_identity: None,
            shared_storage_target_id: None,
        }
        .build()?;
        assert_eq!(
            OnboardingType::from_enrollment(&personal),
            OnboardingType::PersonalCredentialTransfer
        );

        let mut shared_drive = drive;
        let oauth = shared_drive
            .oauth_file
            .as_mut()
            .ok_or_else(|| io::Error::other("OAuth config must exist"))?;
        oauth.drive_mode = GoogleDriveMode::Shared;
        oauth.folder_id = StoredGoogleDriveFolder::FolderId("persisted-shared-folder".to_owned());
        assert_eq!(
            shared_drive.onboarding_type(&VaultArchitecture::default()),
            Ok(OnboardingType::SharedProviderGrant)
        );
        assert_eq!(
            ProviderEnrollmentRequest {
                provider: &shared_drive,
                architecture: &VaultArchitecture::default(),
                shared_joiner_identity: Some("joiner@example.com"),
                shared_storage_target_id: None
            }
            .build()?,
            EnrollmentProvider::shared(SharedEnrollmentProvider::google_drive(
                "joiner@example.com".to_owned(),
                "persisted-shared-folder".to_owned(),
            ))
        );
        Ok(())
    }

    #[test]
    fn shared_payload_roundtrips_without_owner_credentials() -> anyhow::Result<()> {
        let shared = EnrollmentProvider::shared(SharedEnrollmentProvider::google_drive(
            "joiner@example.com".to_owned(),
            "shared-folder".to_owned(),
        ));
        let encoded = serde_json::to_vec(&shared)?;
        let decoded: EnrollmentProvider = serde_json::from_slice(&encoded)?;
        assert_eq!(
            OnboardingType::from_enrollment(&decoded),
            OnboardingType::SharedProviderGrant
        );
        match decoded.data() {
            EnrollmentProviderDataRef::Shared(SharedEnrollmentProviderData::GoogleDrive {
                storage_target_id,
                ..
            }) => assert_eq!(storage_target_id, "shared-folder"),
            other => anyhow::bail!("expected shared Google Drive grant, got {other:?}"),
        }

        let serialized = String::from_utf8(encoded)?;
        assert!(!serialized.contains("access_token"));
        assert!(!serialized.contains("refresh_token"));
        assert!(!serialized.contains("pat"));
        Ok(())
    }

    #[test]
    fn shared_grant_provider_selection_is_target_and_credential_scoped() -> anyhow::Result<()> {
        let private = ProviderEnrollmentFixture::oauth(
            "private",
            OauthFilePreset::GoogleDrive,
            Some("private-file"),
            "nook.yaml",
        )
        .provider;
        let mut other = ProviderEnrollmentFixture::oauth(
            "other",
            OauthFilePreset::GoogleDrive,
            Some("other-file"),
            "nook.yaml",
        )
        .provider;
        other
            .oauth_file
            .as_mut()
            .ok_or_else(|| io::Error::other("configured provider required"))?
            .folder_id = StoredGoogleDriveFolder::FolderId("folder-other".to_owned());
        let mut matching = ProviderEnrollmentFixture::oauth(
            "matching",
            OauthFilePreset::GoogleDrive,
            Some("matching-file"),
            "nook.yaml",
        )
        .provider;
        matching
            .oauth_file
            .as_mut()
            .ok_or_else(|| io::Error::other("configured provider required"))?
            .folder_id = StoredGoogleDriveFolder::FolderId("folder-required".to_owned());
        let providers = vec![private, other, matching];

        assert_eq!(
            SharedGrantProviderSelection {
                providers: &providers,
                preset: OauthFilePreset::GoogleDrive,
                target: &SharedStorageTargetSelection::Existing("folder-required".to_owned())
            }
            .select(),
            Some("matching".to_owned())
        );
        assert_eq!(
            SharedGrantProviderSelection {
                providers: &providers,
                preset: OauthFilePreset::GoogleDrive,
                target: &SharedStorageTargetSelection::Existing("missing".to_owned())
            }
            .select(),
            None
        );
        assert_eq!(
            SharedGrantProviderSelection {
                providers: &providers,
                preset: OauthFilePreset::GoogleDrive,
                target: &SharedStorageTargetSelection::Create
            }
            .select(),
            Some("private".to_owned())
        );
        Ok(())
    }

    #[test]
    fn admitted_selection_retains_original_request_until_consuming_construction()
    -> anyhow::Result<()> {
        use std::ptr;
        let fixture =
            ProviderEnrollmentFixture::oauth("drive", OauthFilePreset::GoogleDrive, None, "events");
        let architecture = VaultArchitecture {
            replication_type: ReplicationType::Shared,
            ..VaultArchitecture::default()
        };
        let checked: CheckedProviderEnrollment<'_> = ProviderEnrollmentRequest {
            provider: &fixture.provider,
            architecture: &architecture,
            shared_joiner_identity: Some(" joiner@example.com "),
            shared_storage_target_id: Some(" folder "),
        }
        .admit()?;
        assert!(ptr::eq(
            checked.request.provider,
            &raw const fixture.provider
        ));
        assert!(ptr::eq(
            checked.request.architecture,
            &raw const architecture
        ));
        assert_eq!(checked.onboarding, OnboardingType::SharedProviderGrant);
        let payload = checked.build()?;
        assert_eq!(
            payload,
            EnrollmentProvider::shared(SharedEnrollmentProvider::google_drive(
                "joiner@example.com".to_owned(),
                "folder".to_owned(),
            ))
        );
        let encoded = serde_json::to_string(&payload)?;
        assert!(!encoded.contains("access_token"));
        assert!(!encoded.contains("refresh_token"));
        Ok(())
    }

    #[test]
    fn architecture_rejection_precedes_invalid_personal_credentials() {
        use crate::VaultType;
        let provider = ProviderEnrollmentFixture::github("gh", "", "").provider;
        let invalid = VaultArchitecture {
            vault_type: VaultType::Sentinel,
            ..VaultArchitecture::default()
        };
        assert_eq!(
            ProviderEnrollmentRequest {
                provider: &provider,
                architecture: &invalid,
                shared_joiner_identity: None,
                shared_storage_target_id: None,
            }
            .build(),
            Err(ValidationError::InvalidSentinelPolicy)
        );
        assert_eq!(
            ProviderEnrollmentRequest {
                provider: &provider,
                architecture: &VaultArchitecture::default(),
                shared_joiner_identity: None,
                shared_storage_target_id: None,
            }
            .build(),
            Err(ValidationError::GithubPatEmpty)
        );
    }

    #[test]
    fn explicit_and_persisted_targets_keep_distinct_whitespace_rules() -> anyhow::Result<()> {
        let mut provider =
            ProviderEnrollmentFixture::oauth("drive", OauthFilePreset::GoogleDrive, None, "events")
                .provider;
        provider
            .oauth_file
            .as_mut()
            .ok_or_else(|| io::Error::other("OAuth fixture"))?
            .folder_id = StoredGoogleDriveFolder::FolderId(" persisted ".to_owned());
        let architecture = VaultArchitecture {
            replication_type: ReplicationType::Shared,
            ..VaultArchitecture::default()
        };
        let before = provider.clone();
        for (target, expected) in [
            (None, " persisted "),
            (Some("  "), " persisted "),
            (Some(" explicit "), "explicit"),
        ] {
            let payload = ProviderEnrollmentRequest {
                provider: &provider,
                architecture: &architecture,
                shared_joiner_identity: Some(" joiner "),
                shared_storage_target_id: target,
            }
            .build()?;
            assert_eq!(
                payload,
                EnrollmentProvider::shared(SharedEnrollmentProvider::google_drive(
                    "joiner".to_owned(),
                    expected.to_owned(),
                ))
            );
        }
        assert_eq!(provider, before);
        provider
            .oauth_file
            .as_mut()
            .ok_or_else(|| io::Error::other("OAuth fixture"))?
            .folder_id = StoredGoogleDriveFolder::Root;
        for (target, expected) in [
            (None, ValidationError::SharedStorageTargetRequired),
            (
                Some("folder"),
                ValidationError::SharedJoinerIdentityRequired,
            ),
        ] {
            assert_eq!(
                ProviderEnrollmentRequest {
                    provider: &provider,
                    architecture: &architecture,
                    shared_joiner_identity: None,
                    shared_storage_target_id: target,
                }
                .build(),
                Err(expected)
            );
        }
        Ok(())
    }

    #[test]
    fn grant_selection_skips_unusable_credentials_and_compares_exact_targets() -> anyhow::Result<()>
    {
        let mut first =
            ProviderEnrollmentFixture::oauth("first", OauthFilePreset::GoogleDrive, None, "events")
                .provider;
        let config = first
            .oauth_file
            .as_mut()
            .ok_or_else(|| io::Error::other("OAuth fixture"))?;
        config.folder_id = StoredGoogleDriveFolder::FolderId("folder".to_owned());
        let second = StorageProviderData {
            id: "second".to_owned(),
            ..first.clone()
        };
        first
            .oauth_file
            .as_mut()
            .ok_or_else(|| io::Error::other("OAuth fixture"))?
            .access_token = StoredOAuthAccessCredential::AccessToken(" ".to_owned());
        let providers = [first, second];
        for (preset, target, expected) in [
            (OauthFilePreset::GoogleDrive, "folder", Some("second")),
            (OauthFilePreset::GoogleDrive, " folder ", None),
            (OauthFilePreset::ICloud, "folder", None),
        ] {
            assert_eq!(
                SharedGrantProviderSelection {
                    providers: &providers,
                    preset,
                    target: &SharedStorageTargetSelection::Existing(target.to_owned()),
                }
                .select()
                .as_deref(),
                expected
            );
        }
        Ok(())
    }
}
