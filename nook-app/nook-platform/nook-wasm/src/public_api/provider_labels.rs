use super::wasm_bindgen;

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
        nook_core::StorageProviderType::Github,
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
        nook_core::StorageProviderType::OauthFile,
        Some(oauth_file_name),
        Some(oauth_preset),
    ))
}

#[wasm_bindgen]
pub fn staged_unconfigured_oauth_provider_label() -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::sync_provider_default_label(
        nook_core::StorageProviderType::OauthFile,
        None,
        None,
    ))
}
