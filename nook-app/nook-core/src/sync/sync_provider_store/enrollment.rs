//! Enrollment payload selection for persisted sync-provider rows.

use super::{StorageProviderData, validate_provider_row_replication};
use crate::errors::{ValidationError, ValidationResult};
use crate::{
    EnrollmentProvider, GoogleDriveMode, ICloudMode, OauthFilePreset, OnboardingType,
    PersonalEnrollmentProvider, ReplicationType, SharedEnrollmentProvider, StorageProviderType,
    VaultArchitecture, validate_github_pat, validate_github_repo_name, validate_oauth_access_token,
};

/// Resolve the enrollment handoff from both vault policy and the concrete
/// provider target. A shared Google Drive folder always uses a target-only
/// grant, even when the vault's default replication policy is personal;
/// the owner's OAuth credential must never be transferred for a shared target.
pub fn provider_onboarding_type(
    provider: &StorageProviderData,
    architecture: &VaultArchitecture,
) -> ValidationResult<OnboardingType> {
    architecture.validate()?;
    let provider_type = StorageProviderType::parse(&provider.provider_type)?;
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
    validate_provider_row_replication(provider, effective_replication)?;
    Ok(match effective_replication {
        ReplicationType::Personal => OnboardingType::PersonalCredentialTransfer,
        ReplicationType::Shared => OnboardingType::SharedProviderGrant,
    })
}

/// Resolve the onboarding ceremony encoded by an enrollment provider payload.
///
/// Credential-bearing provider variants are restricted to trusted-device
/// onboarding. Shared-target variants contain no provider credential fields and
/// always require the joining device to authenticate independently.
#[must_use]
pub const fn enrollment_provider_onboarding_type(provider: &EnrollmentProvider) -> OnboardingType {
    match provider {
        EnrollmentProvider::PersonalCredentialTransfer(_) => {
            OnboardingType::PersonalCredentialTransfer
        }
        EnrollmentProvider::SharedProviderGrant(_) => OnboardingType::SharedProviderGrant,
    }
}

pub fn enrollment_provider_for_architecture(
    provider: &StorageProviderData,
    architecture: &VaultArchitecture,
    shared_joiner_identity: Option<&str>,
) -> ValidationResult<EnrollmentProvider> {
    enrollment_provider_for_architecture_with_storage_target(
        provider,
        architecture,
        shared_joiner_identity,
        None,
    )
}

pub fn enrollment_provider_for_architecture_with_storage_target(
    provider: &StorageProviderData,
    architecture: &VaultArchitecture,
    shared_joiner_identity: Option<&str>,
    shared_storage_target_id: Option<&str>,
) -> ValidationResult<EnrollmentProvider> {
    match provider_onboarding_type(provider, architecture)? {
        OnboardingType::PersonalCredentialTransfer => {
            personal_enrollment_provider(provider).map(EnrollmentProvider::personal)
        }
        OnboardingType::SharedProviderGrant => {
            shared_enrollment_provider(provider, shared_joiner_identity, shared_storage_target_id)
                .map(EnrollmentProvider::shared)
        }
    }
}

/// Build only the credential-bearing enrollment typestate. Its return value
/// cannot be wrapped as a shared-provider payload.
fn personal_enrollment_provider(
    provider: &StorageProviderData,
) -> ValidationResult<PersonalEnrollmentProvider> {
    validate_provider_row_replication(provider, ReplicationType::Personal)?;
    let provider_type = StorageProviderType::parse(&provider.provider_type)?;
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
                validate_oauth_access_token(&oauth.access_token)?
                    .as_str()
                    .to_owned(),
                match &oauth.refresh_token {
                    Some(value) => crate::OAuthRefreshCredential::Token(value.clone()),
                    None => crate::OAuthRefreshCredential::NotIssued,
                },
                match &oauth.expires_at {
                    Some(value) => crate::OAuthTokenExpiry::ExpiresAt(value.clone()),
                    None => crate::OAuthTokenExpiry::Unknown,
                },
                match (&oauth.file_id, &oauth.file_name) {
                    (Some(file_id), Some(file_name)) => crate::OAuthRemoteFile::Identified {
                        file_id: file_id.clone(),
                        file_name: file_name.clone(),
                    },
                    (Some(file_id), None) => crate::OAuthRemoteFile::FileId {
                        file_id: file_id.clone(),
                    },
                    (None, Some(file_name)) => crate::OAuthRemoteFile::FileName {
                        file_name: file_name.clone(),
                    },
                    (None, None) => crate::OAuthRemoteFile::Unresolved,
                },
                match &oauth.account_email {
                    Some(value) => crate::OAuthAccountIdentity::Email(value.clone()),
                    None => crate::OAuthAccountIdentity::Unknown,
                },
            ))
        }
    }
}

/// Build only the credential-free shared-provider typestate. Even though the
/// saved row contains this browser's credential for grant preparation, this
/// return type has no credential fields or credential-bearing constructors.
fn shared_enrollment_provider(
    provider: &StorageProviderData,
    shared_joiner_identity: Option<&str>,
    shared_storage_target_id: Option<&str>,
) -> ValidationResult<SharedEnrollmentProvider> {
    validate_provider_row_replication(provider, ReplicationType::Shared)?;
    let oauth = provider.oauth_file.as_ref();
    let preset = oauth.map(|config| config.preset);
    let storage_target_id = shared_storage_target_id
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
        .or_else(|| match preset {
            Some(OauthFilePreset::GoogleDrive) => oauth
                .and_then(|config| config.folder_id.clone())
                .filter(|id| !id.trim().is_empty()),
            Some(OauthFilePreset::ICloud) => oauth
                .and_then(|config| config.icloud_share_target.clone())
                .filter(|id| !id.trim().is_empty()),
            None => None,
        })
        .ok_or(ValidationError::SharedStorageTargetRequired)?;
    match preset {
        Some(OauthFilePreset::ICloud) => Ok(SharedEnrollmentProvider::icloud(storage_target_id)),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        EnrollmentProviderDataRef, OAuthFileConfigData, ProviderSyncCheckpoint,
        SharedEnrollmentProviderData,
    };

    fn github_provider(id: &str, repo: &str, pat: &str) -> StorageProviderData {
        StorageProviderData {
            id: id.to_owned(),
            provider_type: "github".to_owned(),
            label: "GitHub".to_owned(),
            github_pat: Some(pat.to_owned()),
            github_repo: Some(repo.to_owned()),
            oauth_file: None,
            local_folder: None,
            store_id: None,
            sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
            created_at: "2026-06-24T00:00:00.000Z".to_owned(),
        }
    }

    fn oauth_provider(
        id: &str,
        preset: OauthFilePreset,
        file_id: Option<&str>,
        file_name: &str,
    ) -> StorageProviderData {
        StorageProviderData {
            id: id.to_owned(),
            provider_type: "oauth-file".to_owned(),
            label: "Google Drive".to_owned(),
            github_pat: None,
            github_repo: None,
            oauth_file: Some(OAuthFileConfigData {
                preset,
                access_token: " token ".to_owned(),
                file_id: file_id.map(str::to_owned),
                file_name: Some(file_name.to_owned()),
                ..OAuthFileConfigData::default()
            }),
            local_folder: None,
            store_id: None,
            sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
            created_at: "2026-06-24T00:00:00.000Z".to_owned(),
        }
    }

    #[test]
    fn builder_enforces_replication_before_payload_creation() -> anyhow::Result<()> {
        let shared = VaultArchitecture {
            replication_type: ReplicationType::Shared,
            ..VaultArchitecture::default()
        };
        let github = github_provider("gh", "nook", "github_pat_123");
        assert!(enrollment_provider_for_architecture(&github, &shared, Some("a@b.com")).is_err());

        let drive = oauth_provider(
            "drive",
            OauthFilePreset::GoogleDrive,
            Some("file-123"),
            "nook.yaml",
        );
        assert_eq!(
            enrollment_provider_for_architecture(&drive, &shared, Some("joiner@example.com")),
            Err(ValidationError::SharedStorageTargetRequired)
        );
        assert_eq!(
            enrollment_provider_for_architecture_with_storage_target(
                &drive,
                &shared,
                Some("joiner@example.com"),
                Some("shared-folder-xyz"),
            )?,
            EnrollmentProvider::shared(SharedEnrollmentProvider::google_drive(
                "joiner@example.com".to_owned(),
                "shared-folder-xyz".to_owned(),
            ))
        );

        let personal =
            enrollment_provider_for_architecture(&drive, &VaultArchitecture::default(), None)?;
        assert_eq!(
            enrollment_provider_onboarding_type(&personal),
            OnboardingType::PersonalCredentialTransfer
        );

        let mut shared_drive = drive;
        let oauth = shared_drive
            .oauth_file
            .as_mut()
            .ok_or_else(|| std::io::Error::other("OAuth config must exist"))?;
        oauth.drive_mode = GoogleDriveMode::Shared;
        oauth.folder_id = Some("persisted-shared-folder".to_owned());
        assert_eq!(
            provider_onboarding_type(&shared_drive, &VaultArchitecture::default()),
            Ok(OnboardingType::SharedProviderGrant)
        );
        assert_eq!(
            enrollment_provider_for_architecture(
                &shared_drive,
                &VaultArchitecture::default(),
                Some("joiner@example.com"),
            )?,
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
            enrollment_provider_onboarding_type(&decoded),
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
}
