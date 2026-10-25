#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use crate::errors::ValidationResult;
use crate::{
    DRIVE_SHARED_FOLDER_REF_PREFIX, OauthFilePreset, StoredGoogleDriveFolder,
    StoredICloudShareTarget, StoredOAuthAccessCredential, StoredOAuthAccountIdentity,
    StoredOAuthRemoteFileId, StoredOAuthTokenExpiry,
};

use super::{OAuthFileConfigData, StoredOAuthFileConfiguration};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OAuthStorageReference(String);
impl From<String> for OAuthStorageReference {
    fn from(value: String) -> Self {
        Self(value)
    }
}
impl From<&str> for OAuthStorageReference {
    fn from(value: &str) -> Self {
        Self(value.to_owned())
    }
}
impl OAuthStorageReference {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OAuthRemoteStorageReference {
    Unresolved,
    Resolved(OAuthStorageReference),
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OAuthRemoteConfigurationUpdate {
    Unchanged,
    Updated(Box<OAuthFileConfigData>),
}

/// Borrowed fields used to project a Google access token into stored configuration.
pub struct GoogleOAuthTokenInput<'a> {
    pub access_token: &'a str,
    pub expires_at: &'a str,
    pub existing: &'a StoredOAuthFileConfiguration,
}

/// Borrowed fields used to project a `CloudKit` token into stored configuration.
pub struct ICloudOAuthTokenInput<'a> {
    pub access_token: &'a str,
    pub account_name: &'a StoredOAuthAccountIdentity,
    pub existing: &'a StoredOAuthFileConfiguration,
}

impl OAuthFileConfigData {
    /// Merge a fresh Google OAuth access token into the persisted provider shape.
    #[must_use]
    pub fn from_google_token(input: &GoogleOAuthTokenInput<'_>) -> Self {
        let existing = match input.existing {
            StoredOAuthFileConfiguration::Configured(config) => config.as_ref().clone(),
            StoredOAuthFileConfiguration::NotApplicable => OAuthFileConfigData::default(),
        };
        OAuthFileConfigData {
            preset: OauthFilePreset::GoogleDrive,
            access_token: StoredOAuthAccessCredential::AccessToken(input.access_token.to_owned()),
            refresh_token: existing.refresh_token,
            expires_at: StoredOAuthTokenExpiry::ExpiresAt(input.expires_at.to_owned()),
            file_id: existing.file_id,
            file_name: existing.file_name,
            account_email: existing.account_email,
            folder_id: existing.folder_id,
            icloud_share_target: StoredICloudShareTarget::Unbound,
        }
    }

    /// Merge a fresh `CloudKit` web-auth token into the persisted provider shape.
    #[must_use]
    pub fn from_icloud_token(input: &ICloudOAuthTokenInput<'_>) -> Self {
        let existing = match input.existing {
            StoredOAuthFileConfiguration::Configured(config) => config.as_ref().clone(),
            StoredOAuthFileConfiguration::NotApplicable => OAuthFileConfigData::default(),
        };
        OAuthFileConfigData {
            preset: OauthFilePreset::ICloud,
            access_token: StoredOAuthAccessCredential::AccessToken(input.access_token.to_owned()),
            refresh_token: existing.refresh_token,
            expires_at: existing.expires_at,
            file_id: existing.file_id,
            file_name: existing.file_name,
            account_email: match input.account_name {
                StoredOAuthAccountIdentity::Email(account_name) => {
                    StoredOAuthAccountIdentity::Email(account_name.clone())
                }
                StoredOAuthAccountIdentity::Unknown => existing.account_email,
            },
            folder_id: StoredGoogleDriveFolder::Root,
            icloud_share_target: existing.icloud_share_target,
        }
    }

    /// Bind an authenticated Google Drive provider to its vault folder while
    /// preserving its credentials and stable event filename.
    pub fn bound_google_drive_folder(&self, folder_ref: &str) -> ValidationResult<Self> {
        let folder_id = crate::GoogleDriveFolderId::parse(folder_ref)?;
        let mut bound = self.clone();
        bound.folder_id = StoredGoogleDriveFolder::FolderId(folder_id.into_inner());
        bound.file_id = StoredOAuthRemoteFileId::Unresolved;
        Ok(bound)
    }

    /// Resolve the remote reference passed to the manager connect tuple.
    #[must_use]
    pub fn remote_storage_ref(&self) -> OAuthRemoteStorageReference {
        match self.preset {
            OauthFilePreset::ICloud => match &self.icloud_share_target {
                StoredICloudShareTarget::SharedTarget(target) if !target.trim().is_empty() => {
                    OAuthRemoteStorageReference::Resolved(target.trim().into())
                }
                StoredICloudShareTarget::SharedTarget(_) | StoredICloudShareTarget::Unbound => {
                    OAuthRemoteStorageReference::Unresolved
                }
            },
            OauthFilePreset::GoogleDrive => match &self.folder_id {
                StoredGoogleDriveFolder::FolderId(folder) if !folder.trim().is_empty() => {
                    OAuthRemoteStorageReference::Resolved(
                        format!("{DRIVE_SHARED_FOLDER_REF_PREFIX}{}", folder.trim()).into(),
                    )
                }
                StoredGoogleDriveFolder::FolderId(_) | StoredGoogleDriveFolder::Root => {
                    OAuthRemoteStorageReference::Unresolved
                }
            },
        }
    }

    /// Merge the manager-reported remote reference back into OAuth config.
    #[must_use]
    pub fn with_remote_ref(&self, remote_ref: &str) -> OAuthRemoteConfigurationUpdate {
        let remote_ref = remote_ref.trim();
        if remote_ref.is_empty()
            || matches!(&self.file_id, StoredOAuthRemoteFileId::FileId(id) if id == remote_ref)
        {
            return OAuthRemoteConfigurationUpdate::Unchanged;
        }
        OAuthRemoteConfigurationUpdate::Updated(Box::new(OAuthFileConfigData {
            file_id: StoredOAuthRemoteFileId::FileId(remote_ref.to_owned()),
            ..self.clone()
        }))
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        StoredGoogleDriveFolder, StoredICloudShareTarget, StoredOAuthAccessCredential,
        StoredOAuthAccountIdentity, StoredOAuthRefreshCredential, StoredOAuthRemoteFileId,
        StoredOAuthRemoteFileName, StoredOAuthTokenExpiry,
    };

    use crate::{OAuthFileConfigData, OauthFilePreset};

    use super::{
        GoogleOAuthTokenInput, ICloudOAuthTokenInput, OAuthRemoteConfigurationUpdate,
        OAuthRemoteStorageReference, StoredOAuthFileConfiguration,
    };

    #[test]
    fn oauth_token_merges_preserve_only_same_provider_targets() {
        let google_existing = OAuthFileConfigData {
            preset: OauthFilePreset::GoogleDrive,
            access_token: StoredOAuthAccessCredential::AccessToken("old".to_owned()),
            refresh_token: StoredOAuthRefreshCredential::Token("refresh".to_owned()),
            expires_at: StoredOAuthTokenExpiry::ExpiresAt("old-expiry".to_owned()),
            file_id: StoredOAuthRemoteFileId::FileId("file".to_owned()),
            file_name: StoredOAuthRemoteFileName::FileName("events".to_owned()),
            account_email: StoredOAuthAccountIdentity::Email("alex@example.com".to_owned()),
            folder_id: StoredGoogleDriveFolder::FolderId("folder".to_owned()),
            icloud_share_target: StoredICloudShareTarget::SharedTarget("stale".to_owned()),
        };
        let google = OAuthFileConfigData::from_google_token(&GoogleOAuthTokenInput {
            access_token: "new-google-token",
            expires_at: "2026-07-20T00:00:00Z",
            existing: &StoredOAuthFileConfiguration::configured(google_existing),
        });
        assert_eq!(
            google.access_token,
            StoredOAuthAccessCredential::AccessToken("new-google-token".to_owned())
        );
        assert_eq!(
            google.expires_at,
            StoredOAuthTokenExpiry::ExpiresAt("2026-07-20T00:00:00Z".to_owned())
        );
        assert_eq!(
            google.folder_id,
            StoredGoogleDriveFolder::FolderId("folder".to_owned())
        );
        assert_eq!(google.icloud_share_target, StoredICloudShareTarget::Unbound);

        let icloud_existing = OAuthFileConfigData {
            preset: OauthFilePreset::ICloud,
            access_token: StoredOAuthAccessCredential::AccessToken("old".to_owned()),
            refresh_token: StoredOAuthRefreshCredential::Token("refresh".to_owned()),
            expires_at: StoredOAuthTokenExpiry::ExpiresAt("unchanged-expiry".to_owned()),
            file_id: StoredOAuthRemoteFileId::FileId("record".to_owned()),
            file_name: StoredOAuthRemoteFileName::FileName("events".to_owned()),
            account_email: StoredOAuthAccountIdentity::Email("old@example.com".to_owned()),
            folder_id: StoredGoogleDriveFolder::FolderId("stale".to_owned()),
            icloud_share_target: StoredICloudShareTarget::SharedTarget(
                "icloud-share-v1:{\"role\":\"owner\"}".to_owned(),
            ),
        };
        let icloud = OAuthFileConfigData::from_icloud_token(&ICloudOAuthTokenInput {
            access_token: "new-icloud-token",
            account_name: &StoredOAuthAccountIdentity::Email("new@example.com".to_owned()),
            existing: &StoredOAuthFileConfiguration::configured(icloud_existing.clone()),
        });
        assert_eq!(
            icloud.access_token,
            StoredOAuthAccessCredential::AccessToken("new-icloud-token".to_owned())
        );
        assert_eq!(
            icloud.account_email,
            StoredOAuthAccountIdentity::Email("new@example.com".to_owned())
        );
        assert_eq!(
            icloud.icloud_share_target,
            icloud_existing.icloud_share_target
        );
        assert_eq!(icloud.folder_id, StoredGoogleDriveFolder::Root);
    }

    #[test]
    fn drive_folder_binding_preserves_credentials_and_filename() -> anyhow::Result<()> {
        let config = OAuthFileConfigData {
            preset: OauthFilePreset::GoogleDrive,
            access_token: StoredOAuthAccessCredential::AccessToken("drive-token".to_owned()),
            refresh_token: StoredOAuthRefreshCredential::Token("refresh".to_owned()),
            file_id: StoredOAuthRemoteFileId::FileId("stale-file".to_owned()),
            file_name: StoredOAuthRemoteFileName::FileName("nook-events".to_owned()),
            ..OAuthFileConfigData::default()
        };
        let bound = config
            .bound_google_drive_folder("https://drive.google.com/drive/folders/folder-team")?;
        assert_eq!(
            bound.folder_id,
            StoredGoogleDriveFolder::FolderId("folder-team".to_owned())
        );
        assert_eq!(bound.file_id, StoredOAuthRemoteFileId::Unresolved);
        assert_eq!(bound.access_token, config.access_token);
        assert_eq!(bound.refresh_token, config.refresh_token);
        assert_eq!(bound.file_name, config.file_name);
        Ok(())
    }

    #[test]
    fn every_oauth_provider_routes_only_through_its_shared_target() -> anyhow::Result<()> {
        let mut google = OAuthFileConfigData {
            preset: OauthFilePreset::GoogleDrive,
            file_id: StoredOAuthRemoteFileId::FileId("file-id".to_owned()),
            ..OAuthFileConfigData::default()
        };
        // A Drive provider without a vault folder is not connectable; its
        // file id never substitutes for the folder.
        assert_eq!(
            google.remote_storage_ref(),
            OAuthRemoteStorageReference::Unresolved
        );
        google.folder_id = StoredGoogleDriveFolder::FolderId(" shared-folder ".to_owned());
        assert_eq!(
            google.remote_storage_ref(),
            OAuthRemoteStorageReference::Resolved("shared:shared-folder".into())
        );
        google.folder_id = StoredGoogleDriveFolder::FolderId("\t".to_owned());
        assert_eq!(
            google.remote_storage_ref(),
            OAuthRemoteStorageReference::Unresolved
        );

        let mut icloud = OAuthFileConfigData {
            preset: OauthFilePreset::ICloud,
            file_id: StoredOAuthRemoteFileId::FileId("record".to_owned()),
            folder_id: StoredGoogleDriveFolder::FolderId("not-selected".to_owned()),
            ..OAuthFileConfigData::default()
        };
        assert_eq!(
            icloud.remote_storage_ref(),
            OAuthRemoteStorageReference::Unresolved
        );
        icloud.icloud_share_target =
            StoredICloudShareTarget::SharedTarget(" icloud-share-v1:{} ".to_owned());
        assert_eq!(
            icloud.remote_storage_ref(),
            OAuthRemoteStorageReference::Resolved("icloud-share-v1:{}".into())
        );
        Ok(())
    }

    #[test]
    fn manager_remote_reference_updates_the_file_id_once() -> anyhow::Result<()> {
        let config = OAuthFileConfigData {
            preset: OauthFilePreset::GoogleDrive,
            file_id: StoredOAuthRemoteFileId::FileId("file-id".to_owned()),
            ..OAuthFileConfigData::default()
        };
        let updated = config.with_remote_ref(" manager-ref ").updated()?;
        assert_eq!(
            updated.file_id,
            StoredOAuthRemoteFileId::FileId("manager-ref".to_owned())
        );
        assert!(matches!(
            updated.with_remote_ref("manager-ref"),
            OAuthRemoteConfigurationUpdate::Unchanged
        ));
        assert!(matches!(
            updated.with_remote_ref(" "),
            OAuthRemoteConfigurationUpdate::Unchanged
        ));
        Ok(())
    }

    #[test]
    fn token_projection_preserves_raw_fields_and_explicit_empty_identity() {
        let existing = OAuthFileConfigData {
            account_email: StoredOAuthAccountIdentity::Email("retained".to_owned()),
            ..OAuthFileConfigData::default()
        };
        for (account_name, expected) in [
            (StoredOAuthAccountIdentity::Unknown, "retained"),
            (StoredOAuthAccountIdentity::Email(String::new()), ""),
        ] {
            let projected = OAuthFileConfigData::from_icloud_token(&ICloudOAuthTokenInput {
                access_token: " token ",
                account_name: &account_name,
                existing: &StoredOAuthFileConfiguration::configured(existing.clone()),
            });
            assert_eq!(
                projected.access_token,
                StoredOAuthAccessCredential::AccessToken(" token ".to_owned())
            );
            assert_eq!(
                projected.account_email,
                StoredOAuthAccountIdentity::Email(expected.to_owned())
            );
        }
        let google = OAuthFileConfigData::from_google_token(&GoogleOAuthTokenInput {
            access_token: " token ",
            expires_at: " expiry ",
            existing: &StoredOAuthFileConfiguration::NotApplicable,
        });
        assert_eq!(
            google.access_token,
            StoredOAuthAccessCredential::AccessToken(" token ".to_owned())
        );
        assert_eq!(
            google.expires_at,
            StoredOAuthTokenExpiry::ExpiresAt(" expiry ".to_owned())
        );
    }

    #[test]
    fn rejected_folder_binding_does_not_mutate_configuration() {
        let original = OAuthFileConfigData {
            access_token: StoredOAuthAccessCredential::AccessToken("token".to_owned()),
            ..OAuthFileConfigData::default()
        };
        let before = original.clone();
        assert!(original.bound_google_drive_folder("   ").is_err());
        assert_eq!(original, before);
    }

    impl OAuthRemoteConfigurationUpdate {
        fn updated(self) -> anyhow::Result<OAuthFileConfigData> {
            match self {
                Self::Updated(config) => Ok(*config),
                Self::Unchanged => anyhow::bail!("expected an updated OAuth configuration"),
            }
        }
    }
}
