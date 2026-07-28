use crate::errors::ValidationResult;
use crate::{GoogleDriveMode, ICloudMode, OauthFilePreset};

use super::OAuthFileConfigData;

/// Merge a fresh Google OAuth access token into the persisted provider shape.
#[must_use]
pub fn google_oauth_tokens_to_config(
    access_token: &str,
    expires_at: &str,
    existing: Option<&OAuthFileConfigData>,
) -> OAuthFileConfigData {
    let existing = existing.cloned().unwrap_or_default();
    let drive_mode = existing.resolved_google_drive_mode();
    OAuthFileConfigData {
        preset: OauthFilePreset::GoogleDrive,
        access_token: access_token.to_owned(),
        refresh_token: existing.refresh_token,
        expires_at: Some(expires_at.to_owned()),
        file_id: existing.file_id,
        file_name: existing.file_name,
        account_email: existing.account_email,
        drive_mode,
        folder_id: existing.folder_id,
        icloud_mode: ICloudMode::Private,
        icloud_share_target: None,
    }
}

/// Merge a fresh `CloudKit` web-auth token into the persisted provider shape.
#[must_use]
pub fn icloud_oauth_tokens_to_config(
    access_token: &str,
    account_name: Option<&str>,
    existing: Option<&OAuthFileConfigData>,
) -> OAuthFileConfigData {
    let existing = existing.cloned().unwrap_or_default();
    let icloud_mode = existing.resolved_icloud_mode();
    OAuthFileConfigData {
        preset: OauthFilePreset::ICloud,
        access_token: access_token.to_owned(),
        refresh_token: existing.refresh_token,
        expires_at: existing.expires_at,
        file_id: existing.file_id,
        file_name: existing.file_name,
        account_email: account_name.map(str::to_owned).or(existing.account_email),
        drive_mode: GoogleDriveMode::Private,
        folder_id: None,
        icloud_mode,
        icloud_share_target: existing.icloud_share_target,
    }
}

/// Switch iCloud storage mode without carrying credentials or targets issued
/// for the previous mode into the new connection.
#[must_use]
pub fn set_icloud_provider_mode(
    config: &OAuthFileConfigData,
    mode: ICloudMode,
) -> OAuthFileConfigData {
    let mut switched = config.clone();
    switched.icloud_mode = mode;
    switched.access_token.clear();
    switched.refresh_token = None;
    switched.expires_at = None;
    switched.account_email = None;
    switched.file_id = None;
    switched.icloud_share_target = None;
    switched
}

/// Switch Google Drive storage mode without carrying credentials or targets
/// issued for the previous scope into the new mode.
#[must_use]
pub fn set_google_drive_provider_mode(
    config: &OAuthFileConfigData,
    mode: GoogleDriveMode,
) -> OAuthFileConfigData {
    let mut switched = config.clone();
    switched.drive_mode = mode;
    switched.access_token.clear();
    switched.refresh_token = None;
    switched.expires_at = None;
    switched.account_email = None;
    switched.file_id = None;
    switched.folder_id = None;
    switched
}

/// Bind an authenticated Google Drive provider to a shared folder while
/// preserving its credentials and stable event filename.
pub fn bind_google_drive_shared_folder(
    config: &OAuthFileConfigData,
    folder_ref: &str,
) -> ValidationResult<OAuthFileConfigData> {
    let folder_id = crate::normalize_google_drive_folder_ref(folder_ref)?;
    let mut bound = config.clone();
    bound.drive_mode = GoogleDriveMode::Shared;
    bound.folder_id = Some(folder_id.into_inner());
    bound.file_id = None;
    Ok(bound)
}

/// Resolve the remote reference passed to the manager connect tuple.
#[must_use]
pub fn oauth_remote_storage_ref(config: &OAuthFileConfigData) -> Option<String> {
    if config.preset == OauthFilePreset::ICloud
        && let Some(target) = non_empty(config.icloud_share_target.as_deref())
    {
        return Some(target);
    }
    if let Some(folder_id) = non_empty(config.folder_id.as_deref()) {
        return Some(format!("shared:{folder_id}"));
    }
    non_empty(config.file_id.as_deref())
}

/// Merge the manager-reported remote reference back into OAuth config.
#[must_use]
pub fn update_oauth_remote_ref(
    config: &OAuthFileConfigData,
    remote_ref: &str,
) -> Option<OAuthFileConfigData> {
    let remote_ref = remote_ref.trim();
    if remote_ref.is_empty() || config.file_id.as_deref() == Some(remote_ref) {
        return None;
    }
    Some(OAuthFileConfigData {
        file_id: Some(remote_ref.to_owned()),
        ..config.clone()
    })
}

fn non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use crate::{GoogleDriveMode, ICloudMode, OAuthFileConfigData, OauthFilePreset};

    use super::{
        bind_google_drive_shared_folder, google_oauth_tokens_to_config,
        icloud_oauth_tokens_to_config, oauth_remote_storage_ref, set_google_drive_provider_mode,
        update_oauth_remote_ref,
    };

    #[test]
    fn google_drive_mode_switch_clears_scope_bound_credentials_and_targets() {
        let config = OAuthFileConfigData {
            preset: OauthFilePreset::GoogleDrive,
            access_token: "appdata-token".to_owned(),
            refresh_token: Some("refresh".to_owned()),
            expires_at: Some("2026-07-14T00:00:00Z".to_owned()),
            file_id: Some("appdata-file".to_owned()),
            file_name: Some("nook-events".to_owned()),
            account_email: Some("owner@example.com".to_owned()),
            drive_mode: GoogleDriveMode::Private,
            folder_id: None,
            icloud_mode: ICloudMode::Private,
            icloud_share_target: None,
        };
        let switched = set_google_drive_provider_mode(&config, GoogleDriveMode::Shared);
        assert_eq!(switched.drive_mode, GoogleDriveMode::Shared);
        assert!(switched.access_token.is_empty());
        assert_eq!(switched.refresh_token, None);
        assert_eq!(switched.expires_at, None);
        assert_eq!(switched.account_email, None);
        assert_eq!(switched.file_id, None);
        assert_eq!(switched.folder_id, None);
        assert_eq!(switched.file_name.as_deref(), Some("nook-events"));
    }

    #[test]
    fn oauth_token_merges_preserve_only_same_provider_targets() {
        let google_existing = OAuthFileConfigData {
            preset: OauthFilePreset::GoogleDrive,
            access_token: "old".to_owned(),
            refresh_token: Some("refresh".to_owned()),
            expires_at: Some("old-expiry".to_owned()),
            file_id: Some("file".to_owned()),
            file_name: Some("events".to_owned()),
            account_email: Some("alex@example.com".to_owned()),
            drive_mode: GoogleDriveMode::Shared,
            folder_id: Some("folder".to_owned()),
            ..OAuthFileConfigData::default()
        };
        let google = google_oauth_tokens_to_config(
            "new-google-token",
            "2026-07-20T00:00:00Z",
            Some(&google_existing),
        );
        assert_eq!(google.access_token, "new-google-token");
        assert_eq!(google.expires_at.as_deref(), Some("2026-07-20T00:00:00Z"));
        assert_eq!(google.drive_mode, GoogleDriveMode::Shared);
        assert_eq!(google.folder_id.as_deref(), Some("folder"));
        assert_eq!(google.icloud_mode, ICloudMode::Private);

        let icloud_existing = OAuthFileConfigData {
            preset: OauthFilePreset::ICloud,
            access_token: "old".to_owned(),
            refresh_token: Some("refresh".to_owned()),
            expires_at: Some("unchanged-expiry".to_owned()),
            file_id: Some("record".to_owned()),
            file_name: Some("events".to_owned()),
            account_email: Some("old@example.com".to_owned()),
            icloud_mode: ICloudMode::Shared,
            icloud_share_target: Some("icloud-share-v1:{\"role\":\"owner\"}".to_owned()),
            ..OAuthFileConfigData::default()
        };
        let icloud = icloud_oauth_tokens_to_config(
            "new-icloud-token",
            Some("new@example.com"),
            Some(&icloud_existing),
        );
        assert_eq!(icloud.access_token, "new-icloud-token");
        assert_eq!(icloud.account_email.as_deref(), Some("new@example.com"));
        assert_eq!(icloud.icloud_mode, ICloudMode::Shared);
        assert_eq!(
            icloud.icloud_share_target,
            icloud_existing.icloud_share_target
        );
        assert_eq!(icloud.drive_mode, GoogleDriveMode::Private);
        assert!(icloud.folder_id.is_none());
    }

    #[test]
    fn shared_drive_binding_preserves_credentials_and_filename() -> anyhow::Result<()> {
        let config = OAuthFileConfigData {
            preset: OauthFilePreset::GoogleDrive,
            access_token: "shared-token".to_owned(),
            refresh_token: Some("refresh".to_owned()),
            file_id: Some("stale-appdata-file".to_owned()),
            file_name: Some("nook-events".to_owned()),
            ..OAuthFileConfigData::default()
        };
        let bound = bind_google_drive_shared_folder(
            &config,
            "https://drive.google.com/drive/folders/folder-team",
        )?;
        assert_eq!(bound.drive_mode, GoogleDriveMode::Shared);
        assert_eq!(bound.folder_id.as_deref(), Some("folder-team"));
        assert_eq!(bound.file_id, None);
        assert_eq!(bound.access_token, "shared-token");
        assert_eq!(bound.refresh_token.as_deref(), Some("refresh"));
        assert_eq!(bound.file_name.as_deref(), Some("nook-events"));
        Ok(())
    }

    #[test]
    fn oauth_remote_reference_policy_is_core_owned() -> anyhow::Result<()> {
        let mut google = OAuthFileConfigData {
            preset: OauthFilePreset::GoogleDrive,
            file_id: Some("file-id".to_owned()),
            ..OAuthFileConfigData::default()
        };
        assert_eq!(
            oauth_remote_storage_ref(&google).as_deref(),
            Some("file-id")
        );
        google.folder_id = Some(" shared-folder ".to_owned());
        assert_eq!(
            oauth_remote_storage_ref(&google).as_deref(),
            Some("shared:shared-folder")
        );

        let updated = update_oauth_remote_ref(&google, " manager-ref ")
            .ok_or_else(|| std::io::Error::other("remote reference update must exist"))?;
        assert_eq!(updated.file_id.as_deref(), Some("manager-ref"));
        assert!(update_oauth_remote_ref(&updated, "manager-ref").is_none());
        assert!(update_oauth_remote_ref(&updated, " ").is_none());

        let icloud = OAuthFileConfigData {
            preset: OauthFilePreset::ICloud,
            icloud_share_target: Some("icloud-share-v1:{}".to_owned()),
            folder_id: Some("not-selected".to_owned()),
            ..OAuthFileConfigData::default()
        };
        assert_eq!(
            oauth_remote_storage_ref(&icloud).as_deref(),
            Some("icloud-share-v1:{}")
        );
        Ok(())
    }
}
