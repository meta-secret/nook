use super::wasm_bindgen;
use nook_core::StorageProviderType;

#[wasm_bindgen]
#[must_use]
pub fn default_github_repo() -> String {
    nook_core::DEFAULT_GITHUB_REPO_NAME.to_owned()
}

#[wasm_bindgen]
#[must_use]
pub fn default_drive_backup_name() -> String {
    nook_core::DEFAULT_DRIVE_BACKUP_NAME.to_owned()
}

#[wasm_bindgen]
pub fn format_drive_storage_ref(file_id: &str, file_name: &str) -> String {
    nook_core::format_drive_storage_ref_raw(file_id, file_name)
}

#[wasm_bindgen]
pub fn format_new_drive_storage_ref(file_name: &str) -> String {
    nook_core::format_drive_storage_ref_raw("", file_name)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn wasm_storage_mode_for_provider(
    provider_type: nook_core::StorageProviderType,
    oauth_preset: nook_core::OauthFilePreset,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(
        nook_core::storage_mode_for_provider(provider_type, Some(oauth_preset))
            .as_str()
            .to_owned(),
    )
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn provider_default_label(
    provider_type: nook_core::StorageProviderType,
    detail: &str,
    oauth_preset: nook_core::OauthFilePreset,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::sync_provider_default_label(
        provider_type,
        Some(detail),
        Some(oauth_preset),
    ))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn provider_default_label_without_detail(
    provider_type: nook_core::StorageProviderType,
    oauth_preset: nook_core::OauthFilePreset,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::sync_provider_default_label(
        provider_type,
        None,
        Some(oauth_preset),
    ))
}

#[wasm_bindgen]
pub fn staged_local_provider_label(
    provider_type: nook_core::StorageProviderType,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::sync_provider_default_label(
        provider_type,
        None,
        None,
    ))
}

#[wasm_bindgen]
pub fn staged_github_provider_label(github_repo: &str) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::sync_provider_default_label(
        StorageProviderType::Github,
        Some(github_repo),
        None,
    ))
}

#[wasm_bindgen]
pub fn staged_configured_oauth_provider_label(
    oauth_file_name: &str,
    oauth_preset: nook_core::OauthFilePreset,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::sync_provider_default_label(
        StorageProviderType::OauthFile,
        Some(oauth_file_name),
        Some(oauth_preset),
    ))
}

#[wasm_bindgen]
pub fn staged_unconfigured_oauth_provider_label() -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::sync_provider_default_label(
        StorageProviderType::OauthFile,
        None,
        None,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_core::OauthFilePreset;

    #[test]
    fn provider_label_exports_cover_defaults_and_details() {
        assert_eq!(default_github_repo(), "nook");
        assert_eq!(default_drive_backup_name(), "nook-events");
        assert_eq!(
            format_drive_storage_ref(" file-id ", " events.json "),
            "file-id\tevents.json"
        );
        assert_eq!(format_new_drive_storage_ref(""), "nook-events");

        assert_eq!(
            wasm_storage_mode_for_provider(StorageProviderType::Local, OauthFilePreset::ICloud)
                .unwrap(),
            "local"
        );
        assert_eq!(
            wasm_storage_mode_for_provider(
                StorageProviderType::Github,
                OauthFilePreset::GoogleDrive
            )
            .unwrap(),
            "github"
        );
        assert_eq!(
            wasm_storage_mode_for_provider(
                StorageProviderType::OauthFile,
                OauthFilePreset::GoogleDrive
            )
            .unwrap(),
            "google-drive"
        );
        assert_eq!(
            wasm_storage_mode_for_provider(StorageProviderType::OauthFile, OauthFilePreset::ICloud)
                .unwrap(),
            "icloud"
        );

        assert_eq!(
            provider_default_label(
                StorageProviderType::Local,
                "ignored",
                OauthFilePreset::GoogleDrive
            )
            .unwrap(),
            "This device"
        );
        assert_eq!(
            provider_default_label(
                StorageProviderType::LocalFolder,
                " backups ",
                OauthFilePreset::GoogleDrive
            )
            .unwrap(),
            "Local backup · backups"
        );
        assert_eq!(
            provider_default_label(
                StorageProviderType::Github,
                " repo ",
                OauthFilePreset::GoogleDrive
            )
            .unwrap(),
            "GitHub · repo"
        );
        assert_eq!(
            provider_default_label(
                StorageProviderType::OauthFile,
                " vault.json ",
                OauthFilePreset::ICloud
            )
            .unwrap(),
            "iCloud · vault.json"
        );
        assert_eq!(
            provider_default_label_without_detail(
                StorageProviderType::OauthFile,
                OauthFilePreset::GoogleDrive
            )
            .unwrap(),
            "Google Drive"
        );
    }

    #[test]
    fn staged_provider_labels_use_their_provider_specific_defaults() {
        assert_eq!(
            staged_local_provider_label(StorageProviderType::Local).unwrap(),
            "This device"
        );
        assert_eq!(
            staged_local_provider_label(StorageProviderType::LocalFolder).unwrap(),
            "Local backup"
        );
        assert_eq!(staged_github_provider_label(" nook ").unwrap(), "GitHub");
        assert_eq!(
            staged_github_provider_label("team-vault").unwrap(),
            "GitHub · team-vault"
        );
        assert_eq!(
            staged_configured_oauth_provider_label("events.json", OauthFilePreset::GoogleDrive)
                .unwrap(),
            "Google Drive · events.json"
        );
        assert_eq!(
            staged_unconfigured_oauth_provider_label().unwrap(),
            "Google Drive"
        );
    }
}
