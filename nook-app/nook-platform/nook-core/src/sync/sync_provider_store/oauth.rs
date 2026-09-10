#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use crate::errors::ValidationResult;
use crate::{
    GoogleDriveMode, ICloudMode, OauthFilePreset, StoredGoogleDriveFolder, StoredICloudShareTarget,
    StoredOAuthAccessCredential, StoredOAuthAccountIdentity, StoredOAuthRefreshCredential,
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
        let access_token = input.access_token;
        let expires_at = input.expires_at;
        let existing = input.existing;
        let existing = match existing {
            StoredOAuthFileConfiguration::Configured(config) => config.clone(),
            StoredOAuthFileConfiguration::NotApplicable => OAuthFileConfigData::default(),
        };
        let drive_mode = existing.resolved_google_drive_mode();
        OAuthFileConfigData {
            preset: OauthFilePreset::GoogleDrive,
            access_token: StoredOAuthAccessCredential::AccessToken(access_token.to_owned()),
            refresh_token: existing.refresh_token,
            expires_at: StoredOAuthTokenExpiry::ExpiresAt(expires_at.to_owned()),
            file_id: existing.file_id,
            file_name: existing.file_name,
            account_email: existing.account_email,
            drive_mode,
            folder_id: existing.folder_id,
            icloud_mode: ICloudMode::Private,
            icloud_share_target: StoredICloudShareTarget::Personal,
        }
    }

    /// Merge a fresh `CloudKit` web-auth token into the persisted provider shape.
    #[must_use]
    pub fn from_icloud_token(input: &ICloudOAuthTokenInput<'_>) -> Self {
        let access_token = input.access_token;
        let account_name = input.account_name;
        let existing = input.existing;
        let existing = match existing {
            StoredOAuthFileConfiguration::Configured(config) => config.clone(),
            StoredOAuthFileConfiguration::NotApplicable => OAuthFileConfigData::default(),
        };
        let icloud_mode = existing.resolved_icloud_mode();
        OAuthFileConfigData {
            preset: OauthFilePreset::ICloud,
            access_token: StoredOAuthAccessCredential::AccessToken(access_token.to_owned()),
            refresh_token: existing.refresh_token,
            expires_at: existing.expires_at,
            file_id: existing.file_id,
            file_name: existing.file_name,
            account_email: match account_name {
                StoredOAuthAccountIdentity::Email(account_name) => {
                    StoredOAuthAccountIdentity::Email(account_name.clone())
                }
                StoredOAuthAccountIdentity::Unknown => existing.account_email,
            },
            drive_mode: GoogleDriveMode::Private,
            folder_id: StoredGoogleDriveFolder::Root,
            icloud_mode,
            icloud_share_target: existing.icloud_share_target,
        }
    }

    /// Switch iCloud storage mode without carrying credentials or targets issued
    /// for the previous mode into the new connection.
    #[must_use]
    pub fn with_icloud_mode(&self, mode: ICloudMode) -> Self {
        let config = self;
        let mut switched = config.clone();
        switched.icloud_mode = mode;
        switched.access_token = StoredOAuthAccessCredential::SignedOut;
        switched.refresh_token = StoredOAuthRefreshCredential::NotIssued;
        switched.expires_at = StoredOAuthTokenExpiry::Unknown;
        switched.account_email = StoredOAuthAccountIdentity::Unknown;
        switched.file_id = StoredOAuthRemoteFileId::Unresolved;
        switched.icloud_share_target = StoredICloudShareTarget::Personal;
        switched
    }

    /// Switch Google Drive storage mode without carrying credentials or targets
    /// issued for the previous scope into the new mode.
    #[must_use]
    pub fn with_google_drive_mode(&self, mode: GoogleDriveMode) -> Self {
        let config = self;
        let mut switched = config.clone();
        switched.drive_mode = mode;
        switched.access_token = StoredOAuthAccessCredential::SignedOut;
        switched.refresh_token = StoredOAuthRefreshCredential::NotIssued;
        switched.expires_at = StoredOAuthTokenExpiry::Unknown;
        switched.account_email = StoredOAuthAccountIdentity::Unknown;
        switched.file_id = StoredOAuthRemoteFileId::Unresolved;
        switched.folder_id = StoredGoogleDriveFolder::Root;
        switched
    }

    /// Bind an authenticated Google Drive provider to a shared folder while
    /// preserving its credentials and stable event filename.
    pub fn bound_google_drive_folder(&self, folder_ref: &str) -> ValidationResult<Self> {
        let config = self;
        let folder_id = crate::GoogleDriveFolderId::parse(folder_ref)?;
        let mut bound = config.clone();
        bound.drive_mode = GoogleDriveMode::Shared;
        bound.folder_id = StoredGoogleDriveFolder::FolderId(folder_id.into_inner());
        bound.file_id = StoredOAuthRemoteFileId::Unresolved;
        Ok(bound)
    }

    /// Resolve the remote reference passed to the manager connect tuple.
    #[must_use]
    pub fn remote_storage_ref(&self) -> OAuthRemoteStorageReference {
        if self.preset == OauthFilePreset::ICloud
            && let StoredICloudShareTarget::SharedTarget(target) = &self.icloud_share_target
            && !target.trim().is_empty()
        {
            return OAuthRemoteStorageReference::Resolved(target.trim().into());
        }
        if let StoredGoogleDriveFolder::FolderId(folder) = &self.folder_id
            && !folder.trim().is_empty()
        {
            return OAuthRemoteStorageReference::Resolved(
                format!("shared:{}", folder.trim()).into(),
            );
        }
        match &self.file_id {
            StoredOAuthRemoteFileId::FileId(id) if !id.trim().is_empty() => {
                OAuthRemoteStorageReference::Resolved(id.trim().into())
            }
            StoredOAuthRemoteFileId::FileId(_) | StoredOAuthRemoteFileId::Unresolved => {
                OAuthRemoteStorageReference::Unresolved
            }
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

    use crate::{GoogleDriveMode, ICloudMode, OAuthFileConfigData, OauthFilePreset};

    use super::{
        GoogleOAuthTokenInput, ICloudOAuthTokenInput, OAuthRemoteConfigurationUpdate,
        OAuthRemoteStorageReference, StoredOAuthFileConfiguration,
    };

    #[test]
    fn google_drive_mode_switch_clears_scope_bound_credentials_and_targets() {
        let config = OAuthFileConfigData {
            preset: OauthFilePreset::GoogleDrive,
            access_token: StoredOAuthAccessCredential::AccessToken("appdata-token".to_owned()),
            refresh_token: StoredOAuthRefreshCredential::Token("refresh".to_owned()),
            expires_at: StoredOAuthTokenExpiry::ExpiresAt("2026-07-14T00:00:00Z".to_owned()),
            file_id: StoredOAuthRemoteFileId::FileId("appdata-file".to_owned()),
            file_name: StoredOAuthRemoteFileName::FileName("nook-events".to_owned()),
            account_email: StoredOAuthAccountIdentity::Email("owner@example.com".to_owned()),
            drive_mode: GoogleDriveMode::Private,
            folder_id: StoredGoogleDriveFolder::Root,
            icloud_mode: ICloudMode::Private,
            icloud_share_target: StoredICloudShareTarget::Personal,
        };
        let switched = config.with_google_drive_mode(GoogleDriveMode::Shared);
        assert_eq!(switched.drive_mode, GoogleDriveMode::Shared);
        assert_eq!(
            switched.access_token,
            StoredOAuthAccessCredential::SignedOut
        );
        assert_eq!(
            switched.refresh_token,
            StoredOAuthRefreshCredential::NotIssued
        );
        assert_eq!(switched.expires_at, StoredOAuthTokenExpiry::Unknown);
        assert_eq!(switched.account_email, StoredOAuthAccountIdentity::Unknown);
        assert_eq!(switched.file_id, StoredOAuthRemoteFileId::Unresolved);
        assert_eq!(switched.folder_id, StoredGoogleDriveFolder::Root);
        assert_eq!(
            switched.file_name,
            crate::StoredOAuthRemoteFileName::FileName(("nook-events").to_owned())
        );
    }

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
            drive_mode: GoogleDriveMode::Shared,
            folder_id: StoredGoogleDriveFolder::FolderId("folder".to_owned()),
            ..OAuthFileConfigData::default()
        };
        let google = OAuthFileConfigData::from_google_token(&GoogleOAuthTokenInput {
            access_token: "new-google-token",
            expires_at: "2026-07-20T00:00:00Z",
            existing: &StoredOAuthFileConfiguration::Configured(google_existing.clone()),
        });
        assert_eq!(
            google.access_token,
            StoredOAuthAccessCredential::AccessToken("new-google-token".to_owned())
        );
        assert_eq!(
            google.expires_at,
            crate::StoredOAuthTokenExpiry::ExpiresAt(("2026-07-20T00:00:00Z").to_owned())
        );
        assert_eq!(google.drive_mode, GoogleDriveMode::Shared);
        assert_eq!(
            google.folder_id,
            crate::StoredGoogleDriveFolder::FolderId(("folder").to_owned())
        );
        assert_eq!(google.icloud_mode, ICloudMode::Private);

        let icloud_existing = OAuthFileConfigData {
            preset: OauthFilePreset::ICloud,
            access_token: StoredOAuthAccessCredential::AccessToken("old".to_owned()),
            refresh_token: StoredOAuthRefreshCredential::Token("refresh".to_owned()),
            expires_at: StoredOAuthTokenExpiry::ExpiresAt("unchanged-expiry".to_owned()),
            file_id: StoredOAuthRemoteFileId::FileId("record".to_owned()),
            file_name: StoredOAuthRemoteFileName::FileName("events".to_owned()),
            account_email: StoredOAuthAccountIdentity::Email("old@example.com".to_owned()),
            icloud_mode: ICloudMode::Shared,
            icloud_share_target: StoredICloudShareTarget::SharedTarget(
                "icloud-share-v1:{\"role\":\"owner\"}".to_owned(),
            ),
            ..OAuthFileConfigData::default()
        };
        let icloud = OAuthFileConfigData::from_icloud_token(&ICloudOAuthTokenInput {
            access_token: "new-icloud-token",
            account_name: &StoredOAuthAccountIdentity::Email("new@example.com".to_owned()),
            existing: &StoredOAuthFileConfiguration::Configured(icloud_existing.clone()),
        });
        assert_eq!(
            icloud.access_token,
            StoredOAuthAccessCredential::AccessToken("new-icloud-token".to_owned())
        );
        assert_eq!(
            icloud.account_email,
            crate::StoredOAuthAccountIdentity::Email(("new@example.com").to_owned())
        );
        assert_eq!(icloud.icloud_mode, ICloudMode::Shared);
        assert_eq!(
            icloud.icloud_share_target,
            icloud_existing.icloud_share_target
        );
        assert_eq!(icloud.drive_mode, GoogleDriveMode::Private);
        assert_eq!(icloud.folder_id, StoredGoogleDriveFolder::Root);
    }

    #[test]
    fn shared_drive_binding_preserves_credentials_and_filename() -> anyhow::Result<()> {
        let config = OAuthFileConfigData {
            preset: OauthFilePreset::GoogleDrive,
            access_token: StoredOAuthAccessCredential::AccessToken("shared-token".to_owned()),
            refresh_token: StoredOAuthRefreshCredential::Token("refresh".to_owned()),
            file_id: StoredOAuthRemoteFileId::FileId("stale-appdata-file".to_owned()),
            file_name: StoredOAuthRemoteFileName::FileName("nook-events".to_owned()),
            ..OAuthFileConfigData::default()
        };
        let bound = config
            .bound_google_drive_folder("https://drive.google.com/drive/folders/folder-team")?;
        assert_eq!(bound.drive_mode, GoogleDriveMode::Shared);
        assert_eq!(
            bound.folder_id,
            crate::StoredGoogleDriveFolder::FolderId(("folder-team").to_owned())
        );
        assert_eq!(bound.file_id, StoredOAuthRemoteFileId::Unresolved);
        assert_eq!(
            bound.access_token,
            StoredOAuthAccessCredential::AccessToken("shared-token".to_owned())
        );
        assert_eq!(
            bound.refresh_token,
            crate::StoredOAuthRefreshCredential::Token(("refresh").to_owned())
        );
        assert_eq!(
            bound.file_name,
            crate::StoredOAuthRemoteFileName::FileName(("nook-events").to_owned())
        );
        Ok(())
    }

    #[test]
    fn oauth_remote_reference_policy_is_core_owned() -> anyhow::Result<()> {
        let mut google = OAuthFileConfigData {
            preset: OauthFilePreset::GoogleDrive,
            file_id: StoredOAuthRemoteFileId::FileId("file-id".to_owned()),
            ..OAuthFileConfigData::default()
        };
        assert_eq!(
            google.remote_storage_ref(),
            OAuthRemoteStorageReference::Resolved("file-id".into())
        );
        google.folder_id = StoredGoogleDriveFolder::FolderId(" shared-folder ".to_owned());
        assert_eq!(
            google.remote_storage_ref(),
            OAuthRemoteStorageReference::Resolved("shared:shared-folder".into())
        );

        let updated = google.with_remote_ref(" manager-ref ").updated()?;
        assert_eq!(
            updated.file_id,
            crate::StoredOAuthRemoteFileId::FileId(("manager-ref").to_owned())
        );
        assert!(matches!(
            updated.with_remote_ref("manager-ref"),
            OAuthRemoteConfigurationUpdate::Unchanged
        ));
        assert!(matches!(
            updated.with_remote_ref(" "),
            OAuthRemoteConfigurationUpdate::Unchanged
        ));

        let icloud = OAuthFileConfigData {
            preset: OauthFilePreset::ICloud,
            icloud_share_target: StoredICloudShareTarget::SharedTarget(
                "icloud-share-v1:{}".to_owned(),
            ),
            folder_id: StoredGoogleDriveFolder::FolderId("not-selected".to_owned()),
            ..OAuthFileConfigData::default()
        };
        assert_eq!(
            icloud.remote_storage_ref(),
            OAuthRemoteStorageReference::Resolved("icloud-share-v1:{}".into())
        );
        Ok(())
    }

    #[test]
    fn icloud_mode_change_preserves_unrelated_configuration() {
        let original = OAuthFileConfigData {
            preset: OauthFilePreset::ICloud,
            access_token: StoredOAuthAccessCredential::AccessToken("token".to_owned()),
            refresh_token: StoredOAuthRefreshCredential::Token("refresh".to_owned()),
            expires_at: StoredOAuthTokenExpiry::ExpiresAt("expiry".to_owned()),
            account_email: StoredOAuthAccountIdentity::Email("owner".to_owned()),
            file_id: StoredOAuthRemoteFileId::FileId("record".to_owned()),
            file_name: StoredOAuthRemoteFileName::FileName(" events ".to_owned()),
            folder_id: StoredGoogleDriveFolder::FolderId("folder".to_owned()),
            drive_mode: GoogleDriveMode::Shared,
            icloud_share_target: StoredICloudShareTarget::SharedTarget("target".to_owned()),
            ..OAuthFileConfigData::default()
        };
        let before = original.clone();
        let changed = original.with_icloud_mode(ICloudMode::Shared);
        assert_eq!(original, before);
        assert_eq!(changed.access_token, StoredOAuthAccessCredential::SignedOut);
        assert_eq!(
            changed.refresh_token,
            StoredOAuthRefreshCredential::NotIssued
        );
        assert_eq!(changed.expires_at, StoredOAuthTokenExpiry::Unknown);
        assert_eq!(changed.account_email, StoredOAuthAccountIdentity::Unknown);
        assert_eq!(changed.file_id, StoredOAuthRemoteFileId::Unresolved);
        assert_eq!(
            changed.icloud_share_target,
            StoredICloudShareTarget::Personal
        );
        assert_eq!(changed.icloud_mode, ICloudMode::Shared);
        assert_eq!(changed.file_name, original.file_name);
        assert_eq!(changed.folder_id, original.folder_id);
        assert_eq!(changed.drive_mode, original.drive_mode);
        assert_eq!(changed.preset, original.preset);
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
                existing: &StoredOAuthFileConfiguration::Configured(existing.clone()),
            });
            assert_eq!(
                projected.access_token,
                crate::StoredOAuthAccessCredential::AccessToken((" token ").to_owned())
            );
            assert_eq!(
                projected.account_email,
                crate::StoredOAuthAccountIdentity::Email((expected).to_owned())
            );
        }
        let google = OAuthFileConfigData::from_google_token(&GoogleOAuthTokenInput {
            access_token: " token ",
            expires_at: " expiry ",
            existing: &StoredOAuthFileConfiguration::NotApplicable,
        });
        assert_eq!(
            google.access_token,
            crate::StoredOAuthAccessCredential::AccessToken((" token ").to_owned())
        );
        assert_eq!(
            google.expires_at,
            crate::StoredOAuthTokenExpiry::ExpiresAt((" expiry ").to_owned())
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

    #[test]
    fn remote_reference_blank_precedence_and_raw_equality_are_preserved() -> anyhow::Result<()> {
        let mut config = OAuthFileConfigData {
            preset: OauthFilePreset::ICloud,
            icloud_share_target: StoredICloudShareTarget::SharedTarget("  ".to_owned()),
            folder_id: StoredGoogleDriveFolder::FolderId(" folder ".to_owned()),
            file_id: StoredOAuthRemoteFileId::FileId(" file ".to_owned()),
            ..OAuthFileConfigData::default()
        };
        assert_eq!(
            config.remote_storage_ref(),
            OAuthRemoteStorageReference::Resolved("shared:folder".into())
        );
        config.folder_id = StoredGoogleDriveFolder::FolderId("\t".to_owned());
        assert_eq!(
            config.remote_storage_ref(),
            OAuthRemoteStorageReference::Resolved("file".into())
        );
        let updated = config.with_remote_ref(" file ");
        assert_eq!(
            updated.updated()?.file_id,
            StoredOAuthRemoteFileId::FileId("file".to_owned())
        );
        config.file_id = StoredOAuthRemoteFileId::FileId("file".to_owned());
        assert!(matches!(
            config.with_remote_ref(" file "),
            OAuthRemoteConfigurationUpdate::Unchanged
        ));
        Ok(())
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
