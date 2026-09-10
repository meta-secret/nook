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

use super::{
    SharedGrantProviderOutcome, StorageProviderData, StoredGithubPat, StoredGithubRepository,
    StoredGoogleDriveFolder, StoredICloudShareTarget, StoredOAuthAccessCredential,
    StoredOAuthAccountIdentity, StoredOAuthFileConfiguration, StoredOAuthRefreshCredential,
    StoredOAuthRemoteFileId, StoredOAuthRemoteFileName, StoredOAuthTokenExpiry,
};
use crate::errors::{ValidationError, ValidationResult};
use crate::{
    EnrollmentProvider, GithubPat, GithubRepoName, GoogleDriveMode, ICloudMode, OauthAccessToken,
    OauthFilePreset, OnboardingType, PersonalEnrollmentProvider, ReplicationType,
    SharedEnrollmentProvider, SharedStorageTargetSelection, StorageProviderType, VaultArchitecture,
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
pub enum EnrollmentAudience<'a> {
    Personal,
    SharedGoogle(SharedGoogleEnrollmentAudience<'a>),
    SharedICloud(SharedStorageTargetSelection),
}
pub struct SharedGoogleEnrollmentAudience<'a> {
    pub joiner_identity: &'a str,
    pub target: SharedStorageTargetSelection,
}
pub struct ProviderEnrollmentRequest<'a> {
    pub provider: &'a StorageProviderData,
    pub architecture: &'a VaultArchitecture,
    pub audience: EnrollmentAudience<'a>,
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
    pub fn resolve(self) -> SharedGrantProviderOutcome {
        let Self {
            providers,
            preset,
            target,
        } = self;
        match providers.iter().find(|provider| {
            if provider.provider_type != StorageProviderType::OauthFile { return false; }
            let StoredOAuthFileConfiguration::Configured(oauth) = &provider.oauth_file else { return false; };
            if oauth.preset != preset || !matches!(oauth.usable_access_token(), OAuthAccessTokenRef::Available(_)) { return false; }
            match target {
                SharedStorageTargetSelection::Create => true,
                SharedStorageTargetSelection::Existing(target_id) => {
                    matches!(&oauth.folder_id, StoredGoogleDriveFolder::FolderId(id) if id == target_id)
                        || matches!(&oauth.icloud_share_target, StoredICloudShareTarget::SharedTarget(id) if id == target_id)
                }
            }
        }) {
            Some(provider) => SharedGrantProviderOutcome::Existing { provider: provider.clone() },
            None => SharedGrantProviderOutcome::AuthorizationRequired,
        }
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
        let provider_uses_shared_target = provider_type == StorageProviderType::OauthFile
            && match &provider.oauth_file {
                StoredOAuthFileConfiguration::Configured(oauth) => match oauth.preset {
                    OauthFilePreset::GoogleDrive => {
                        oauth.resolved_google_drive_mode() == GoogleDriveMode::Shared
                    }
                    OauthFilePreset::ICloud => oauth.resolved_icloud_mode() == ICloudMode::Shared,
                },
                StoredOAuthFileConfiguration::NotApplicable => false,
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
                GithubPat::parse(match &provider.github_pat {
                    StoredGithubPat::Token(token) => token,
                    StoredGithubPat::Missing => return Err(ValidationError::GithubPatEmpty),
                })?
                .as_str()
                .to_owned(),
                GithubRepoName::parse(match &provider.github_repo {
                    StoredGithubRepository::Repository(repo) => repo,
                    StoredGithubRepository::DefaultRepository => "",
                })?
                .as_str()
                .to_owned(),
            )),
            StorageProviderType::OauthFile => {
                let StoredOAuthFileConfiguration::Configured(oauth) = &provider.oauth_file else {
                    return Err(ValidationError::OauthAccessTokenEmpty);
                };
                let preset = oauth.preset;
                Ok(PersonalEnrollmentProvider::oauth_file(
                    preset.as_str().to_owned(),
                    OauthAccessToken::parse(match &oauth.access_token {
                        StoredOAuthAccessCredential::AccessToken(token) => token,
                        StoredOAuthAccessCredential::SignedOut => {
                            return Err(ValidationError::OauthAccessTokenEmpty);
                        }
                    })?
                    .as_str()
                    .to_owned(),
                    match &oauth.refresh_token {
                        StoredOAuthRefreshCredential::Token(value) => {
                            OAuthRefreshCredential::Token(value.clone())
                        }
                        StoredOAuthRefreshCredential::NotIssued => {
                            OAuthRefreshCredential::NotIssued
                        }
                    },
                    match &oauth.expires_at {
                        StoredOAuthTokenExpiry::ExpiresAt(value) => {
                            OAuthTokenExpiry::ExpiresAt(value.clone())
                        }
                        StoredOAuthTokenExpiry::Unknown => OAuthTokenExpiry::Unknown,
                    },
                    match (&oauth.file_id, &oauth.file_name) {
                        (
                            StoredOAuthRemoteFileId::FileId(file_id),
                            StoredOAuthRemoteFileName::FileName(file_name),
                        ) => OAuthRemoteFile::Identified {
                            file_id: file_id.to_owned(),
                            file_name: file_name.to_owned(),
                        },
                        (
                            StoredOAuthRemoteFileId::FileId(file_id),
                            StoredOAuthRemoteFileName::Unresolved,
                        ) => OAuthRemoteFile::FileId {
                            file_id: file_id.to_owned(),
                        },
                        (
                            StoredOAuthRemoteFileId::Unresolved,
                            StoredOAuthRemoteFileName::FileName(file_name),
                        ) => OAuthRemoteFile::FileName {
                            file_name: file_name.to_owned(),
                        },
                        (
                            StoredOAuthRemoteFileId::Unresolved,
                            StoredOAuthRemoteFileName::Unresolved,
                        ) => OAuthRemoteFile::Unresolved,
                    },
                    match &oauth.account_email {
                        StoredOAuthAccountIdentity::Email(value) => {
                            OAuthAccountIdentity::Email(value.clone())
                        }
                        StoredOAuthAccountIdentity::Unknown => OAuthAccountIdentity::Unknown,
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
            provider, audience, ..
        } = self.request;
        provider.validate_replication(ReplicationType::Shared)?;
        let StoredOAuthFileConfiguration::Configured(oauth) = &provider.oauth_file else {
            return Err(ValidationError::SharedStorageTargetRequired);
        };
        let target = match &audience {
            EnrollmentAudience::Personal => &SharedStorageTargetSelection::Create,
            EnrollmentAudience::SharedGoogle(google) => &google.target,
            EnrollmentAudience::SharedICloud(target) => target,
        };
        let storage_target_id = match target {
            SharedStorageTargetSelection::Existing(id) if !id.trim().is_empty() => {
                id.trim().to_owned()
            }
            SharedStorageTargetSelection::Existing(_) | SharedStorageTargetSelection::Create => {
                match oauth.preset {
                    OauthFilePreset::GoogleDrive => match &oauth.folder_id {
                        StoredGoogleDriveFolder::FolderId(id) if !id.trim().is_empty() => {
                            id.clone()
                        }
                        StoredGoogleDriveFolder::FolderId(_) | StoredGoogleDriveFolder::Root => {
                            return Err(ValidationError::SharedStorageTargetRequired);
                        }
                    },
                    OauthFilePreset::ICloud => match &oauth.icloud_share_target {
                        StoredICloudShareTarget::SharedTarget(id) if !id.trim().is_empty() => {
                            id.clone()
                        }
                        StoredICloudShareTarget::SharedTarget(_)
                        | StoredICloudShareTarget::Personal => {
                            return Err(ValidationError::SharedStorageTargetRequired);
                        }
                    },
                }
            }
        };
        match oauth.preset {
            OauthFilePreset::ICloud => Ok(SharedEnrollmentProvider::icloud(storage_target_id)),
            OauthFilePreset::GoogleDrive => {
                let EnrollmentAudience::SharedGoogle(google) = audience else {
                    return Err(ValidationError::SharedJoinerIdentityRequired);
                };
                let identity = google.joiner_identity.trim();
                if identity.is_empty() {
                    return Err(ValidationError::SharedJoinerIdentityRequired);
                }
                Ok(SharedEnrollmentProvider::google_drive(
                    identity.to_owned(),
                    storage_target_id,
                ))
            }
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
        CheckedProviderEnrollment, EnrollmentAudience, ProviderEnrollmentRequest,
        SharedGoogleEnrollmentAudience, SharedGrantProviderOutcome, SharedGrantProviderSelection,
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
            file_id: StoredOAuthRemoteFileId,
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
                        file_id,
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
                audience: EnrollmentAudience::SharedGoogle(SharedGoogleEnrollmentAudience {
                    joiner_identity: "a@b.com",
                    target: SharedStorageTargetSelection::Create
                })
            }
            .build()
            .is_err()
        );

        let drive = ProviderEnrollmentFixture::oauth(
            "drive",
            OauthFilePreset::GoogleDrive,
            StoredOAuthRemoteFileId::FileId("file-123".to_owned()),
            "nook.yaml",
        )
        .provider;
        assert_eq!(
            ProviderEnrollmentRequest {
                provider: &drive,
                architecture: &shared,
                audience: EnrollmentAudience::SharedGoogle(SharedGoogleEnrollmentAudience {
                    joiner_identity: "joiner@example.com",
                    target: SharedStorageTargetSelection::Create
                })
            }
            .build(),
            Err(ValidationError::SharedStorageTargetRequired)
        );
        assert_eq!(
            ProviderEnrollmentRequest {
                provider: &drive,
                architecture: &shared,
                audience: EnrollmentAudience::SharedGoogle(SharedGoogleEnrollmentAudience {
                    joiner_identity: "joiner@example.com",
                    target: SharedStorageTargetSelection::Existing(
                        ("shared-folder-xyz").to_owned()
                    )
                })
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
            audience: EnrollmentAudience::Personal,
        }
        .build()?;
        assert_eq!(
            OnboardingType::from_enrollment(&personal),
            OnboardingType::PersonalCredentialTransfer
        );

        let mut shared_drive = drive;
        let oauth = (match &mut shared_drive.oauth_file {
            StoredOAuthFileConfiguration::Configured(config) => Ok(config),
            StoredOAuthFileConfiguration::NotApplicable => {
                Err(io::Error::other("OAuth config must exist"))
            }
        })?;
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
                audience: EnrollmentAudience::SharedGoogle(SharedGoogleEnrollmentAudience {
                    joiner_identity: "joiner@example.com",
                    target: SharedStorageTargetSelection::Create
                })
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
            StoredOAuthRemoteFileId::FileId("private-file".to_owned()),
            "nook.yaml",
        )
        .provider;
        let mut other = ProviderEnrollmentFixture::oauth(
            "other",
            OauthFilePreset::GoogleDrive,
            StoredOAuthRemoteFileId::FileId("other-file".to_owned()),
            "nook.yaml",
        )
        .provider;
        (match &mut other.oauth_file {
            StoredOAuthFileConfiguration::Configured(config) => Ok(config),
            StoredOAuthFileConfiguration::NotApplicable => {
                Err(io::Error::other("configured provider required"))
            }
        })?
        .folder_id = StoredGoogleDriveFolder::FolderId("folder-other".to_owned());
        let mut matching = ProviderEnrollmentFixture::oauth(
            "matching",
            OauthFilePreset::GoogleDrive,
            StoredOAuthRemoteFileId::FileId("matching-file".to_owned()),
            "nook.yaml",
        )
        .provider;
        (match &mut matching.oauth_file {
            StoredOAuthFileConfiguration::Configured(config) => Ok(config),
            StoredOAuthFileConfiguration::NotApplicable => {
                Err(io::Error::other("configured provider required"))
            }
        })?
        .folder_id = StoredGoogleDriveFolder::FolderId("folder-required".to_owned());
        let providers = vec![private, other, matching];

        assert!(matches!(SharedGrantProviderSelection {
            providers: &providers,
            preset: OauthFilePreset::GoogleDrive,
            target: &SharedStorageTargetSelection::Existing("folder-required".to_owned()),
        }.resolve(), SharedGrantProviderOutcome::Existing { provider } if provider.id == "matching"));
        assert!(matches!(
            SharedGrantProviderSelection {
                providers: &providers,
                preset: OauthFilePreset::GoogleDrive,
                target: &SharedStorageTargetSelection::Existing("missing".to_owned()),
            }
            .resolve(),
            SharedGrantProviderOutcome::AuthorizationRequired
        ));
        assert!(matches!(SharedGrantProviderSelection {
            providers: &providers,
            preset: OauthFilePreset::GoogleDrive,
            target: &SharedStorageTargetSelection::Create,
        }.resolve(), SharedGrantProviderOutcome::Existing { provider } if provider.id == "private"));
        Ok(())
    }

    #[test]
    fn admitted_selection_retains_original_request_until_consuming_construction()
    -> anyhow::Result<()> {
        use std::ptr;
        let fixture = ProviderEnrollmentFixture::oauth(
            "drive",
            OauthFilePreset::GoogleDrive,
            StoredOAuthRemoteFileId::Unresolved,
            "events",
        );
        let architecture = VaultArchitecture {
            replication_type: ReplicationType::Shared,
            ..VaultArchitecture::default()
        };
        let checked: CheckedProviderEnrollment<'_> = ProviderEnrollmentRequest {
            provider: &fixture.provider,
            architecture: &architecture,
            audience: EnrollmentAudience::SharedGoogle(SharedGoogleEnrollmentAudience {
                joiner_identity: " joiner@example.com ",
                target: SharedStorageTargetSelection::Existing((" folder ").to_owned()),
            }),
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
                audience: EnrollmentAudience::Personal,
            }
            .build(),
            Err(ValidationError::InvalidSentinelPolicy)
        );
        assert_eq!(
            ProviderEnrollmentRequest {
                provider: &provider,
                architecture: &VaultArchitecture::default(),
                audience: EnrollmentAudience::Personal,
            }
            .build(),
            Err(ValidationError::GithubPatEmpty)
        );
    }

    #[test]
    fn explicit_and_persisted_targets_keep_distinct_whitespace_rules() -> anyhow::Result<()> {
        let mut provider = ProviderEnrollmentFixture::oauth(
            "drive",
            OauthFilePreset::GoogleDrive,
            StoredOAuthRemoteFileId::Unresolved,
            "events",
        )
        .provider;
        (match &mut provider.oauth_file {
            StoredOAuthFileConfiguration::Configured(config) => Ok(config),
            StoredOAuthFileConfiguration::NotApplicable => Err(io::Error::other("OAuth fixture")),
        })?
        .folder_id = StoredGoogleDriveFolder::FolderId(" persisted ".to_owned());
        let architecture = VaultArchitecture {
            replication_type: ReplicationType::Shared,
            ..VaultArchitecture::default()
        };
        let before = provider.clone();
        for (target, expected) in [
            (SharedStorageTargetSelection::Create, " persisted "),
            (
                SharedStorageTargetSelection::Existing("  ".into()),
                " persisted ",
            ),
            (
                SharedStorageTargetSelection::Existing(" explicit ".into()),
                "explicit",
            ),
        ] {
            let payload = ProviderEnrollmentRequest {
                provider: &provider,
                architecture: &architecture,
                audience: EnrollmentAudience::SharedGoogle(SharedGoogleEnrollmentAudience {
                    joiner_identity: " joiner ",
                    target,
                }),
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
        (match &mut provider.oauth_file {
            StoredOAuthFileConfiguration::Configured(config) => Ok(config),
            StoredOAuthFileConfiguration::NotApplicable => Err(io::Error::other("OAuth fixture")),
        })?
        .folder_id = StoredGoogleDriveFolder::Root;
        for (target, expected) in [
            (
                SharedStorageTargetSelection::Create,
                ValidationError::SharedStorageTargetRequired,
            ),
            (
                SharedStorageTargetSelection::Existing("folder".into()),
                ValidationError::SharedJoinerIdentityRequired,
            ),
        ] {
            assert_eq!(
                ProviderEnrollmentRequest {
                    provider: &provider,
                    architecture: &architecture,
                    audience: EnrollmentAudience::SharedGoogle(SharedGoogleEnrollmentAudience {
                        joiner_identity: "",
                        target
                    }),
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
        let mut first = ProviderEnrollmentFixture::oauth(
            "first",
            OauthFilePreset::GoogleDrive,
            StoredOAuthRemoteFileId::Unresolved,
            "events",
        )
        .provider;
        let config = (match &mut first.oauth_file {
            StoredOAuthFileConfiguration::Configured(config) => Ok(config),
            StoredOAuthFileConfiguration::NotApplicable => Err(io::Error::other("OAuth fixture")),
        })?;
        config.folder_id = StoredGoogleDriveFolder::FolderId("folder".to_owned());
        let second = StorageProviderData {
            id: "second".to_owned(),
            ..first.clone()
        };
        (match &mut first.oauth_file {
            StoredOAuthFileConfiguration::Configured(config) => Ok(config),
            StoredOAuthFileConfiguration::NotApplicable => Err(io::Error::other("OAuth fixture")),
        })?
        .access_token = StoredOAuthAccessCredential::AccessToken(" ".to_owned());
        let providers = [first, second];
        for (preset, target, expected) in [
            (OauthFilePreset::GoogleDrive, "folder", true),
            (OauthFilePreset::GoogleDrive, " folder ", false),
            (OauthFilePreset::ICloud, "folder", false),
        ] {
            assert_eq!(
                matches!(SharedGrantProviderSelection {
                    providers: &providers,
                    preset,
                    target: &SharedStorageTargetSelection::Existing(target.to_owned()),
                }.resolve(), SharedGrantProviderOutcome::Existing { provider } if provider.id == "second"),
                expected
            );
        }
        Ok(())
    }
}
