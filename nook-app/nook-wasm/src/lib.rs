#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::uninlined_format_args,
    clippy::must_use_candidate,
    clippy::new_without_default,
    clippy::collapsible_str_replace,
    clippy::assigning_clones,
    clippy::fn_params_excessive_bools,
    clippy::unnecessary_wraps,
    clippy::items_after_statements
)]

mod application;
mod conversion;
mod error_mapping;
mod logger;
mod manager;
mod passkey_browser;
mod storage;
mod sync_io;
mod types;

#[doc(hidden)]
#[doc(hidden)]
pub use wasm_bindgen_futures as __wasm_bindgen_futures;

pub use manager::NookVaultManager;
pub use storage::local_folder::NookLocalFolderConfig;
pub use types::{
    NookBrowserLocale, NookClientRunMode, NookClientRunModeUtil, NookDecryptedEnrollmentPayload,
    NookEnrollmentIssueInput, NookEnrollmentProvider, NookGoogleDriveFolder, NookJoinRequest,
    NookPasskeySetup, NookPasskeyUnlockOptions, NookPasswordEntrySummary, NookPendingSyncConflict,
    NookReplacementConflict, NookRuntimeConfig, NookSecretFormFields, NookSecurityConflict,
    NookStorageConnectArgs, NookStorageProviderKind, NookStorageProviderTypeUtil,
    NookVaultAccessReport, NookVaultMember, NookVaultSyncResult,
};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(thiserror::Error, Debug)]
pub enum NookError {
    #[error("IndexedDB error: {0}")]
    IndexedDb(String),

    #[error("GitHub error: {0}")]
    GitHub(String),

    #[error("Drive error: {0}")]
    Drive(String),

    #[error("iCloud error: {0}")]
    ICloud(String),

    #[error("Decryption failed: {0}")]
    Decryption(String),

    #[error("Encryption failed: {0}")]
    Encryption(String),

    #[error("Database error: {0}")]
    Database(String),

    #[error("Channel error: {0}")]
    Channel(String),

    #[error("Network request failed: {0}")]
    Network(#[from] reqwest::Error),

    #[error("Serialization error: {0}")]
    Serialization(String),
}

#[wasm_bindgen(js_name = translate)]
#[must_use]
pub fn translate_key(locale: &str, key: &str) -> String {
    nook_core::translate(locale, key)
}

#[wasm_bindgen(js_name = parseAppLocale)]
#[allow(clippy::needless_pass_by_value)]
#[must_use]
pub fn parse_app_locale(value: Option<String>) -> Option<String> {
    nook_core::parse_app_locale(value.as_deref()?).map(str::to_owned)
}

#[wasm_bindgen(js_name = resolveAppLocaleFromTag)]
#[must_use]
pub fn resolve_app_locale_from_tag(tag: &str) -> Option<String> {
    nook_core::resolve_app_locale_from_tag(tag).map(str::to_owned)
}

#[wasm_bindgen(js_name = resolveAppLocaleFromTags)]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn resolve_app_locale_from_tags(tags: Vec<String>) -> String {
    nook_core::resolve_app_locale_from_tags(tags.iter().map(String::as_str)).to_owned()
}

#[wasm_bindgen]
#[must_use]
pub fn get_translation_catalog(locale: &str) -> String {
    nook_core::get_translation_catalog(locale).to_owned()
}

#[wasm_bindgen(js_name = lookupTranslation)]
#[must_use]
pub fn lookup_translation(catalog_json: &str, key: &str) -> Option<String> {
    nook_core::lookup_translation(catalog_json, key)
}

#[wasm_bindgen(js_name = translateFromCatalog)]
#[must_use]
pub fn translate_from_catalog(catalog_json: &str, locale: &str, key: &str) -> String {
    nook_core::translate_from_catalog(catalog_json, locale, key)
}

#[wasm_bindgen(js_name = mergeTranslationCatalogs)]
pub fn merge_translation_catalogs(
    base_json: &str,
    overlay_json: &str,
) -> Result<String, wasm_bindgen::JsError> {
    nook_core::merge_translation_catalogs(base_json, overlay_json).map_err(Into::into)
}

#[wasm_bindgen(js_name = resolveTranslationCatalog)]
#[must_use]
pub fn resolve_translation_catalog(locale: &str, wasm_catalog_json: Option<String>) -> String {
    match wasm_catalog_json {
        Some(wasm_catalog) => nook_core::resolve_translation_catalog(locale, Some(&wasm_catalog)),
        None => nook_core::resolve_translation_catalog(locale, None),
    }
}

#[wasm_bindgen(js_name = isVaultSessionLocked)]
#[must_use]
pub fn is_vault_session_locked() -> bool {
    storage::session::is_vault_session_locked()
}

#[wasm_bindgen(js_name = setVaultSessionLocked)]
pub fn set_vault_session_locked(locked: bool) {
    storage::session::set_vault_session_locked(locked);
}

#[wasm_bindgen(js_name = isLocalFolderBackupSupported)]
#[must_use]
pub fn is_local_folder_backup_supported() -> bool {
    storage::local_folder::is_local_folder_backup_supported()
}

#[wasm_bindgen(js_name = chooseLocalFolderBackupDirectory)]
pub async fn choose_local_folder_backup_directory()
-> Result<NookLocalFolderConfig, wasm_bindgen::JsError> {
    storage::local_folder::choose_local_folder_backup_directory()
        .await
        .map_err(Into::into)
}

#[wasm_bindgen(js_name = removeLocalFolderHandle)]
pub async fn remove_local_folder_handle(
    handle_id: Option<String>,
) -> Result<(), wasm_bindgen::JsError> {
    storage::local_folder::remove_local_folder_handle(handle_id)
        .await
        .map_err(Into::into)
}

#[wasm_bindgen(js_name = validateBip39Mnemonic)]
#[must_use]
pub fn validate_bip39_mnemonic(mnemonic: &str) -> bool {
    nook_core::validate_bip39_mnemonic(mnemonic).is_ok()
}

#[wasm_bindgen(js_name = getBip39EnglishWordlist)]
pub fn get_bip39_english_wordlist() -> Vec<String> {
    nook_core::bip39_english_wordlist()
        .into_iter()
        .map(str::to_owned)
        .collect()
}

#[wasm_bindgen(js_name = isKnownBip39Word)]
#[must_use]
pub fn is_known_bip39_word(word: &str) -> bool {
    nook_core::is_known_bip39_word(word)
}

#[wasm_bindgen(js_name = suggestBip39Words)]
pub fn suggest_bip39_words(prefix: &str, limit: u32) -> Vec<String> {
    nook_core::suggest_bip39_words(prefix, limit as usize)
        .into_iter()
        .map(str::to_owned)
        .collect()
}

#[wasm_bindgen(js_name = isBip39WordSequenceValid)]
#[must_use]
pub fn is_bip39_word_sequence_valid(text: &str, expected_word_count: u32) -> bool {
    nook_core::is_bip39_word_sequence_valid(text, expected_word_count as usize)
}

#[wasm_bindgen(js_name = parseBip39Words)]
pub fn parse_bip39_words(text: &str) -> Vec<String> {
    nook_core::parse_bip39_words(text)
}

#[wasm_bindgen(js_name = joinBip39Words)]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn join_bip39_words(words: Vec<String>) -> String {
    nook_core::join_bip39_words(&words)
}

#[wasm_bindgen(js_name = inferBip39MnemonicLength)]
#[must_use]
pub fn infer_bip39_mnemonic_length(text: &str) -> Option<u32> {
    nook_core::infer_bip39_mnemonic_length(text)
}

#[wasm_bindgen(js_name = generateId)]
pub fn generate_id() -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::generate_id()?.to_string())
}

#[wasm_bindgen(js_name = buildPasskeyPrfRequestOptions)]
#[allow(clippy::needless_pass_by_value)]
pub fn build_passkey_prf_request_options(
    rp_id: &str,
    credential_id: Vec<u8>,
    prf_input: Vec<u8>,
) -> Result<JsValue, wasm_bindgen::JsError> {
    passkey_browser::request_options(rp_id, &credential_id, &prf_input)
}

#[wasm_bindgen(js_name = buildPasskeyRecoveryRequestOptions)]
pub fn build_passkey_recovery_request_options(
    rp_id: &str,
) -> Result<JsValue, wasm_bindgen::JsError> {
    passkey_browser::recovery_options(rp_id)
}

#[wasm_bindgen(js_name = generateSecretId)]
pub fn generate_secret_id() -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::generate_secret_id()?.to_string())
}

/// Cryptographically secure password generation — free function so the UI can
/// call it while the vault manager is borrowed by an in-flight `&mut self` op.
#[wasm_bindgen(js_name = generatePassword)]
pub fn generate_password(
    length: u32,
    lowercase: bool,
    uppercase: bool,
    numbers: bool,
    symbols: bool,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::generate_password(&nook_core::PasswordOptions {
        length: length as usize,
        lowercase,
        uppercase,
        numbers,
        symbols,
    })?)
}

#[wasm_bindgen(js_name = vaultPasswordMinLength)]
#[must_use]
pub fn vault_password_min_length() -> u32 {
    u32::try_from(nook_core::vault_password_min_length()).expect("password minimum fits in u32")
}

#[wasm_bindgen(js_name = vaultPasswordRecommendedMinLength)]
#[must_use]
pub fn vault_password_recommended_min_length() -> u32 {
    u32::try_from(nook_core::vault_password_recommended_min_length())
        .expect("password recommended minimum fits in u32")
}

#[wasm_bindgen(js_name = isVaultPasswordLongEnough)]
#[must_use]
pub fn is_vault_password_long_enough(password: &str) -> bool {
    nook_core::is_vault_password_long_enough(password)
}

#[wasm_bindgen(js_name = isVaultPasswordRecommendedLength)]
#[must_use]
pub fn is_vault_password_recommended_length(password: &str) -> bool {
    nook_core::is_vault_password_recommended_length(password)
}

#[wasm_bindgen(js_name = defaultGithubRepo)]
#[must_use]
pub fn default_github_repo() -> String {
    nook_core::DEFAULT_GITHUB_REPO_NAME.to_owned()
}

#[wasm_bindgen(js_name = defaultDriveBackupName)]
#[must_use]
pub fn default_drive_backup_name() -> String {
    nook_core::DEFAULT_DRIVE_BACKUP_NAME.to_owned()
}

#[wasm_bindgen(js_name = formatDriveStorageRef)]
pub fn format_drive_storage_ref(file_id: Option<String>, file_name: &str) -> String {
    nook_core::format_drive_storage_ref_raw(file_id.unwrap_or_default().as_str(), file_name)
}

#[wasm_bindgen(js_name = wasmStorageModeForProvider)]
#[allow(clippy::needless_pass_by_value)]
pub fn wasm_storage_mode_for_provider(
    provider_type: &str,
    oauth_preset: Option<String>,
) -> Result<String, wasm_bindgen::JsError> {
    let provider_type = nook_core::StorageProviderType::parse(provider_type)?;
    let oauth_preset = oauth_preset
        .as_deref()
        .map(nook_core::OauthFilePreset::parse)
        .transpose()?;
    Ok(
        nook_core::storage_mode_for_provider(provider_type, oauth_preset)
            .as_str()
            .to_owned(),
    )
}

#[wasm_bindgen(js_name = providerDefaultLabel)]
#[allow(clippy::needless_pass_by_value)]
pub fn provider_default_label(
    provider_type: &str,
    detail: Option<String>,
    oauth_preset: Option<String>,
) -> Result<String, wasm_bindgen::JsError> {
    let provider_type = nook_core::StorageProviderType::parse(provider_type)?;
    let oauth_preset = oauth_preset
        .as_deref()
        .map(nook_core::OauthFilePreset::parse)
        .transpose()?;
    Ok(nook_core::sync_provider_default_label(
        provider_type,
        detail.as_deref(),
        oauth_preset,
    ))
}

#[wasm_bindgen(js_name = stagedProviderLabel)]
#[allow(clippy::needless_pass_by_value)]
pub fn staged_provider_label(
    provider_type: &str,
    github_repo: Option<String>,
    oauth_file_name: Option<String>,
    oauth_file_preset: Option<String>,
    oauth_setup_preset: Option<String>,
) -> Result<String, wasm_bindgen::JsError> {
    let provider_type = nook_core::StorageProviderType::parse(provider_type)?;
    let oauth_file_preset = oauth_file_preset
        .as_deref()
        .map(nook_core::OauthFilePreset::parse)
        .transpose()?;
    let oauth_setup_preset = oauth_setup_preset
        .as_deref()
        .map(nook_core::OauthFilePreset::parse)
        .transpose()?;
    Ok(nook_core::staged_provider_default_label(
        provider_type,
        github_repo.as_deref(),
        oauth_file_name.as_deref(),
        oauth_file_preset,
        oauth_setup_preset,
    ))
}

#[wasm_bindgen(js_name = hasRemoteCredentials)]
#[allow(clippy::needless_pass_by_value)]
pub fn has_remote_credentials(
    provider_type: &str,
    github_pat: Option<String>,
    oauth_access_token: Option<String>,
    local_folder_handle_id: Option<String>,
) -> Result<bool, wasm_bindgen::JsError> {
    let provider_type = nook_core::StorageProviderType::parse(provider_type)?;
    Ok(nook_core::has_provider_credentials(
        provider_type,
        github_pat.as_deref(),
        oauth_access_token.as_deref(),
        local_folder_handle_id.as_deref(),
    ))
}

#[wasm_bindgen(js_name = providerStorageDetail)]
#[allow(clippy::too_many_arguments, clippy::needless_pass_by_value)]
pub fn provider_storage_detail(
    provider: JsValue,
    this_device_desc: String,
    no_token_saved: String,
    google_signed_in: String,
    icloud_signed_in: String,
    google_not_signed_in: String,
    icloud_not_signed_in: String,
    local_folder_needs_reconnect: String,
) -> Result<String, wasm_bindgen::JsError> {
    let provider: nook_core::StorageProviderData = serde_wasm_bindgen::from_value(provider)?;
    let labels = nook_core::ProviderStorageDetailLabels {
        this_device_desc,
        no_token_saved,
        google_signed_in,
        icloud_signed_in,
        google_not_signed_in,
        icloud_not_signed_in,
        local_folder_needs_reconnect,
    };
    Ok(nook_core::provider_storage_detail(&provider, &labels)?)
}

#[wasm_bindgen(js_name = localizeProviderLabel)]
#[allow(clippy::needless_pass_by_value)]
pub fn localize_provider_label(
    label: &str,
    this_device: String,
    github: String,
    local_folder: String,
    google_drive: String,
    icloud: String,
) -> String {
    let labels = nook_core::ProviderLabelLabels {
        this_device,
        github,
        local_folder,
        google_drive,
        icloud,
    };
    nook_core::localize_provider_label(label, &labels)
}

#[wasm_bindgen(js_name = providerWasmArgs)]
pub fn provider_wasm_args(
    provider: JsValue,
) -> Result<NookStorageConnectArgs, wasm_bindgen::JsError> {
    let provider: nook_core::StorageProviderData = serde_wasm_bindgen::from_value(provider)?;
    Ok(nook_core::storage_args_for_provider(&provider)?.into())
}

#[wasm_bindgen(js_name = setGoogleDriveProviderMode)]
pub fn set_google_drive_provider_mode(
    config: JsValue,
    mode: &str,
) -> Result<JsValue, wasm_bindgen::JsError> {
    let config: nook_core::OAuthFileConfigData = serde_wasm_bindgen::from_value(config)?;
    let mode = nook_core::GoogleDriveMode::parse(mode)?;
    Ok(to_js_value(&nook_core::set_google_drive_provider_mode(
        &config, mode,
    ))?)
}

#[wasm_bindgen(js_name = bindGoogleDriveSharedFolder)]
pub fn bind_google_drive_shared_folder(
    config: JsValue,
    folder_ref: &str,
) -> Result<JsValue, wasm_bindgen::JsError> {
    let config: nook_core::OAuthFileConfigData = serde_wasm_bindgen::from_value(config)?;
    Ok(to_js_value(&nook_core::bind_google_drive_shared_folder(
        &config, folder_ref,
    )?)?)
}

#[wasm_bindgen(js_name = defaultVaultArchitecture)]
pub fn default_vault_architecture() -> Result<JsValue, wasm_bindgen::JsError> {
    Ok(to_js_value(&nook_core::VaultArchitecture::default())?)
}

#[wasm_bindgen(js_name = validateVaultArchitecture)]
pub fn validate_vault_architecture(
    architecture: JsValue,
) -> Result<JsValue, wasm_bindgen::JsError> {
    let architecture: nook_core::VaultArchitecture = serde_wasm_bindgen::from_value(architecture)?;
    architecture.validate()?;
    Ok(to_js_value(&architecture)?)
}

#[wasm_bindgen(js_name = vaultArchitectureOnboardingType)]
pub fn vault_architecture_onboarding_type(
    architecture: JsValue,
) -> Result<String, wasm_bindgen::JsError> {
    let architecture: nook_core::VaultArchitecture = serde_wasm_bindgen::from_value(architecture)?;
    architecture.validate()?;
    Ok(architecture.onboarding_type().as_str().to_owned())
}

#[wasm_bindgen(js_name = vaultArchitectureCanCreateSecret)]
pub fn vault_architecture_can_create_secret(
    architecture: JsValue,
) -> Result<bool, wasm_bindgen::JsError> {
    let architecture: nook_core::VaultArchitecture = serde_wasm_bindgen::from_value(architecture)?;
    architecture.validate()?;
    Ok(architecture.can_create_secret())
}

#[wasm_bindgen(js_name = providerReplicationCapability)]
pub fn provider_replication_capability(
    provider: JsValue,
) -> Result<JsValue, wasm_bindgen::JsError> {
    let provider: nook_core::StorageProviderData = serde_wasm_bindgen::from_value(provider)?;
    Ok(to_js_value(
        &nook_core::provider_replication_capability_for_row(&provider)?,
    )?)
}

#[wasm_bindgen(js_name = validateProviderReplication)]
pub fn validate_provider_replication(
    provider: JsValue,
    replication_type: &str,
) -> Result<JsValue, wasm_bindgen::JsError> {
    let provider: nook_core::StorageProviderData = serde_wasm_bindgen::from_value(provider)?;
    let replication_type = nook_core::ReplicationType::parse(replication_type)?;
    Ok(to_js_value(&nook_core::validate_provider_row_replication(
        &provider,
        replication_type,
    )?)?)
}

#[wasm_bindgen(js_name = enrollmentProviderForArchitecture)]
#[allow(clippy::needless_pass_by_value)]
pub fn enrollment_provider_for_architecture(
    provider: JsValue,
    architecture: JsValue,
    shared_joiner_identity: Option<String>,
    shared_storage_target_id: Option<String>,
) -> Result<NookEnrollmentProvider, wasm_bindgen::JsError> {
    let provider: nook_core::StorageProviderData = serde_wasm_bindgen::from_value(provider)?;
    let architecture: nook_core::VaultArchitecture = serde_wasm_bindgen::from_value(architecture)?;
    Ok(NookEnrollmentProvider::from_core(
        nook_core::enrollment_provider_for_architecture_with_storage_target(
            &provider,
            &architecture,
            shared_joiner_identity.as_deref(),
            shared_storage_target_id.as_deref(),
        )?,
    ))
}

/// Validate a shared-grant request, then (for Google Drive) create a My Drive
/// folder and share it with the joiner. Falls back to `ManualGrantRequired` when
/// the Drive API fails or no owner access token is supplied.
#[wasm_bindgen(js_name = prepareSharedStorageGrant)]
pub async fn prepare_shared_storage_grant(
    request: JsValue,
) -> Result<JsValue, wasm_bindgen::JsError> {
    let request: nook_core::SharedStorageGrantRequest = serde_wasm_bindgen::from_value(request)?;
    let validated = nook_core::prepare_shared_storage_grant(&request)?;
    let outcome = match validated {
        nook_core::SharedStorageGrantOutcome::ManualGrantRequired {
            instructions_key,
            joiner_identity,
            storage_target_id,
            storage_target_name,
        } => {
            let token = request
                .access_token
                .as_deref()
                .map(str::trim)
                .filter(|token| !token.is_empty());
            let is_gdrive = request.provider_type.trim() == "oauth-file"
                && request
                    .oauth_preset
                    .as_deref()
                    .unwrap_or("google-drive")
                    .trim()
                    == "google-drive";
            match (token, is_gdrive) {
                (Some(access_token), true) => {
                    let folder_name = request
                        .storage_target_hint
                        .as_deref()
                        .map(str::trim)
                        .filter(|name| !name.is_empty())
                        .unwrap_or("Nook shared vault");
                    match storage::drive_shared::create_shared_vault_folder(
                        access_token,
                        folder_name,
                    )
                    .await
                    {
                        Ok((folder_id, created_name)) => {
                            match storage::drive_shared::share_folder_with_email(
                                access_token,
                                &folder_id,
                                &joiner_identity,
                            )
                            .await
                            {
                                Ok(()) => nook_core::SharedStorageGrantOutcome::Granted {
                                    note: "architecture_modes.shared_grant_success".to_owned(),
                                    storage_target_id: folder_id,
                                    storage_target_name: Some(created_name),
                                },
                                Err(error) => {
                                    tracing::warn!(
                                        scope = "shared-storage-grant",
                                        stage = "share-folder",
                                        error = %error,
                                        "automatic shared storage grant failed; manual grant required"
                                    );
                                    nook_core::SharedStorageGrantOutcome::ManualGrantRequired {
                                        instructions_key,
                                        joiner_identity,
                                        storage_target_id: Some(folder_id),
                                        storage_target_name: Some(created_name),
                                    }
                                }
                            }
                        }
                        Err(error) => {
                            tracing::warn!(
                                scope = "shared-storage-grant",
                                stage = "create-folder",
                                error = %error,
                                "automatic shared storage grant failed; manual grant required"
                            );
                            nook_core::SharedStorageGrantOutcome::ManualGrantRequired {
                                instructions_key,
                                joiner_identity,
                                storage_target_id,
                                storage_target_name,
                            }
                        }
                    }
                }
                _ => nook_core::SharedStorageGrantOutcome::ManualGrantRequired {
                    instructions_key,
                    joiner_identity,
                    storage_target_id,
                    storage_target_name,
                },
            }
        }
        other => other,
    };
    Ok(to_js_value(&outcome)?)
}

/// Resolve a shared Drive folder id/URL and verify write access for the current
/// account before persisting the provider row.
#[wasm_bindgen(js_name = verifySharedGoogleDriveFolder)]
pub async fn verify_shared_google_drive_folder(
    access_token: &str,
    folder_ref: &str,
) -> Result<NookGoogleDriveFolder, wasm_bindgen::JsError> {
    let (id, name) =
        storage::drive_shared::verify_shared_vault_folder(access_token, folder_ref).await?;
    Ok(NookGoogleDriveFolder::new(id, name))
}

#[wasm_bindgen(js_name = wasmStorageArgs)]
#[allow(clippy::too_many_arguments, clippy::needless_pass_by_value)]
pub fn wasm_storage_args(
    local_vault_present: bool,
    is_authenticated: bool,
    sync_provider: JsValue,
    provider_type: &str,
    github_pat: Option<String>,
    github_repo: Option<String>,
    oauth_preset: Option<String>,
    oauth_access_token: Option<String>,
    oauth_file_id: Option<String>,
    oauth_file_name: Option<String>,
) -> Result<NookStorageConnectArgs, wasm_bindgen::JsError> {
    let sync_provider = if sync_provider.is_undefined() || sync_provider.is_null() {
        None
    } else {
        Some(serde_wasm_bindgen::from_value::<
            nook_core::StorageProviderData,
        >(sync_provider)?)
    };
    let provider_type = nook_core::StorageProviderType::parse(provider_type)?;
    let oauth_preset = oauth_preset
        .as_deref()
        .map(nook_core::OauthFilePreset::parse)
        .transpose()?;
    Ok(nook_core::vault_storage_args(
        local_vault_present,
        is_authenticated,
        sync_provider.as_ref(),
        provider_type,
        github_pat.as_deref(),
        github_repo.as_deref(),
        oauth_preset,
        oauth_access_token.as_deref(),
        oauth_file_id.as_deref(),
        oauth_file_name.as_deref(),
    )?
    .into())
}

/// Masked GitHub PAT hint for provider lists. `None` means no token is saved;
/// the JS layer supplies the localized "no token" copy. `Some` is a truncated
/// hint that never contains the full secret.
#[wasm_bindgen(js_name = maskGithubPatHint)]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn mask_github_pat_hint(pat: Option<String>) -> Option<String> {
    match nook_core::mask_github_pat(pat.as_deref().unwrap_or_default()) {
        nook_core::GithubPatMask::NoToken => None,
        nook_core::GithubPatMask::Hint(hint) => Some(hint),
    }
}

#[wasm_bindgen(js_name = encryptEnrollmentPayload)]
pub fn encrypt_enrollment_payload(
    input: &NookEnrollmentIssueInput,
    password: &str,
    entry_label: Option<String>,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::encrypt_enrollment_payload(
        &input.to_core()?,
        password,
        entry_label.unwrap_or_default().as_str(),
    )?)
}

#[wasm_bindgen(js_name = decryptEnrollmentPayload)]
pub fn decrypt_enrollment_payload(
    code: &str,
    password: &str,
) -> Result<NookDecryptedEnrollmentPayload, wasm_bindgen::JsError> {
    let code = nook_core::normalize_enrollment_code(code);
    Ok(NookDecryptedEnrollmentPayload::from_core(
        nook_core::decrypt_enrollment_payload(&code, password)?,
    ))
}

#[wasm_bindgen(js_name = buildEnrollmentLink)]
#[must_use]
pub fn build_enrollment_link(code: &str, base_url: &str) -> String {
    nook_core::build_enrollment_link(code, base_url)
}

#[wasm_bindgen(js_name = buildSentinelGenesisRequestLink)]
pub fn build_sentinel_genesis_request_link(
    request_json: &str,
    base_url: &str,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::build_sentinel_genesis_request_link(
        request_json,
        base_url,
    )?)
}

#[wasm_bindgen(js_name = normalizeSentinelGenesisRequest)]
pub fn normalize_sentinel_genesis_request(input: &str) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::normalize_sentinel_genesis_request(input)?)
}

#[wasm_bindgen(js_name = buildSentinelGenesisParticipantResponseLink)]
pub fn build_sentinel_genesis_participant_response_link(
    response_json: &str,
    base_url: &str,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::build_sentinel_genesis_participant_response_link(
        response_json,
        base_url,
    )?)
}

#[wasm_bindgen(js_name = normalizeSentinelGenesisParticipantPayload)]
pub fn normalize_sentinel_genesis_participant_payload(
    input: &str,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::normalize_sentinel_genesis_participant_payload(
        input,
    )?)
}

#[wasm_bindgen(js_name = normalizeEnrollmentCode)]
#[must_use]
pub fn normalize_enrollment_code(code: &str) -> String {
    nook_core::normalize_enrollment_code(code)
}

#[wasm_bindgen(js_name = peekEnrollmentEntryId)]
#[must_use]
pub fn peek_enrollment_entry_id(code: &str) -> Option<String> {
    let code = nook_core::normalize_enrollment_code(code);
    nook_core::peek_enrollment_entry_id(&code)
}

#[wasm_bindgen(js_name = peekEnrollmentEntryLabel)]
#[must_use]
pub fn peek_enrollment_entry_label(code: &str) -> Option<String> {
    let code = nook_core::normalize_enrollment_code(code);
    nook_core::peek_enrollment_entry_label(&code)
}

#[wasm_bindgen(js_name = peekEnrollmentIssuedAt)]
#[must_use]
pub fn peek_enrollment_issued_at(code: &str) -> Option<String> {
    let code = nook_core::normalize_enrollment_code(code);
    nook_core::peek_enrollment_issued_at(&code)
}

/// Load the persisted sync-provider snapshot from the `nook_auth` `IndexedDB`
/// database, running the full non-network pipeline in Rust: normalize, unseal
/// credential fields with the device key, seed from legacy `localStorage`,
/// backfill provider fields, and re-persist (sealed) when anything changed.
///
/// Returns `{ snapshot, changed }`; `snapshot` carries decrypted credentials
/// for in-memory sync use.
fn to_js_value<T: serde::Serialize>(value: &T) -> Result<JsValue, serde_wasm_bindgen::Error> {
    serde_wasm_bindgen::to_value(value)
}

#[wasm_bindgen(js_name = loadAuthProviders)]
pub async fn load_auth_providers(
    manager: &NookVaultManager,
) -> Result<JsValue, wasm_bindgen::JsError> {
    let identity = manager.device_identity()?;
    let normalized = crate::storage::auth_providers::load_auth_providers(&identity).await?;
    Ok(to_js_value(&normalized)?)
}

/// Seal credential fields with the device key and persist the snapshot to the
/// `nook_auth` `IndexedDB` database.
#[wasm_bindgen(js_name = saveAuthProviders)]
pub async fn save_auth_providers(
    manager: &NookVaultManager,
    snapshot: JsValue,
) -> Result<(), wasm_bindgen::JsError> {
    let identity = manager.device_identity()?;
    let snapshot: nook_core::AuthProvidersSnapshotData = serde_wasm_bindgen::from_value(snapshot)?;
    crate::storage::auth_providers::save_auth_providers(&identity, &snapshot).await?;
    Ok(())
}

/// Seal credential fields in a snapshot for another device's public key without
/// persisting. Used by extension pairing before handing granted provider rows
/// to the extension's own storage.
#[wasm_bindgen(js_name = sealAuthProvidersForDevicePublicKey)]
pub fn seal_auth_providers_for_device_public_key(
    device_public_key: &str,
    snapshot: JsValue,
) -> Result<JsValue, wasm_bindgen::JsError> {
    let public_key = nook_core::DevicePublicKey::parse(device_public_key)?;
    let mut snapshot: nook_core::AuthProvidersSnapshotData =
        serde_wasm_bindgen::from_value(snapshot)?;
    nook_core::seal_provider_credentials_for_public_key(&public_key, &mut snapshot)?;
    Ok(to_js_value(&snapshot)?)
}

/// Delete the `nook_auth` `IndexedDB` database (used on full sign-out / reset).
#[wasm_bindgen(js_name = deleteAuthProvidersDb)]
pub async fn delete_auth_providers_db() -> Result<(), wasm_bindgen::JsError> {
    crate::storage::auth_providers::delete_auth_providers_db().await?;
    Ok(())
}

/// Parse a raw persisted provider snapshot.
#[wasm_bindgen(js_name = normalizeAuthSnapshot)]
pub fn normalize_auth_snapshot(raw: JsValue) -> Result<JsValue, wasm_bindgen::JsError> {
    let value: serde_json::Value = if raw.is_undefined() || raw.is_null() {
        serde_json::Value::Null
    } else {
        serde_wasm_bindgen::from_value(raw)?
    };
    let normalized = nook_core::normalize_auth_snapshot(&value);
    Ok(to_js_value(&normalized)?)
}

/// Find an existing provider whose sync target matches `candidate`, optionally
/// excluding one provider id. Returns the matching provider or `undefined`.
#[wasm_bindgen(js_name = findDuplicateSyncProvider)]
#[allow(clippy::needless_pass_by_value)]
pub fn find_duplicate_sync_provider(
    providers: JsValue,
    candidate: JsValue,
    exclude_id: Option<String>,
) -> Result<JsValue, wasm_bindgen::JsError> {
    let providers: Vec<nook_core::StorageProviderData> = serde_wasm_bindgen::from_value(providers)?;
    let candidate: nook_core::StorageProviderData = serde_wasm_bindgen::from_value(candidate)?;
    match nook_core::find_duplicate_sync_provider(&providers, &candidate, exclude_id.as_deref()) {
        Some(provider) => Ok(serde_wasm_bindgen::to_value(&provider)?),
        None => Ok(JsValue::UNDEFINED),
    }
}

/// Ensure a `local` provider row exists for the active vault, prepending one
/// (with a fresh id/timestamp) when missing. Returns the updated snapshot.
#[wasm_bindgen(js_name = ensureLocalProviderRow)]
#[allow(clippy::needless_pass_by_value)]
pub fn ensure_local_provider_row(
    snapshot: JsValue,
    active_store_id: Option<String>,
) -> Result<JsValue, wasm_bindgen::JsError> {
    let snapshot: nook_core::AuthProvidersSnapshotData = serde_wasm_bindgen::from_value(snapshot)?;
    let new_id = nook_core::generate_id()?.to_string();
    let created_at: String = js_sys::Date::new_0().to_iso_string().into();
    let (next, _changed) = nook_core::ensure_local_provider_row(
        &snapshot,
        active_store_id.as_deref(),
        &new_id,
        &created_at,
    );
    Ok(serde_wasm_bindgen::to_value(&next)?)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalAuthProviderSnapshot {
    snapshot: nook_core::AuthProvidersSnapshotData,
    migrated: bool,
}

fn validate_configured_application_for_content(content: &str) -> Result<(), NookError> {
    let architecture = nook_core::read_vault_architecture(content)?;
    application::configured_vault_application().validate_session_access(architecture.vault_type)?;
    Ok(())
}

/// Configure the immutable application capability for this browser realm.
#[wasm_bindgen(js_name = configureVaultApplication)]
pub fn configure_vault_application_name(
    application_name: &str,
) -> Result<(), wasm_bindgen::JsError> {
    let application = nook_core::VaultApplication::parse(application_name)?;
    application::configure_vault_application(application);
    Ok(())
}

/// Return the immutable capability configured by the current web app.
#[wasm_bindgen(js_name = configuredVaultApplication)]
pub fn configured_vault_application_name() -> String {
    application::configured_vault_application()
        .as_str()
        .to_owned()
}

/// Fail before persistence/session creation when encrypted vault content does
/// not belong to this artifact's compile-time application capability.
#[wasm_bindgen(js_name = validateVaultContentForApplication)]
pub fn validate_vault_content_for_application(content: &str) -> Result<(), wasm_bindgen::JsError> {
    validate_configured_application_for_content(content).map_err(Into::into)
}

/// Approve an extension join through a manager whose Rust-owned application
/// capability permits extension approval.
#[wasm_bindgen(js_name = approveExtensionDevice)]
pub async fn approve_extension_device(
    manager: &mut NookVaultManager,
    join_device_id: String,
    join_public_key: String,
    join_signing_public_key: String,
    label: String,
) -> Result<Vec<NookSecretRecord>, wasm_bindgen::JsError> {
    manager
        .approve_extension_device(
            join_device_id,
            join_public_key,
            join_signing_public_key,
            label,
        )
        .await
}

/// Validate extension pairing metadata through the Rust capability matrix.
#[wasm_bindgen(js_name = validateExtensionPairingVaultType)]
pub fn validate_extension_pairing_vault_type(
    vault_type: &str,
) -> Result<(), wasm_bindgen::JsError> {
    let vault_type = nook_core::VaultType::parse(vault_type)?;
    let application = application::configured_vault_application();
    if application == nook_core::VaultApplication::Extension {
        application.validate_session_access(vault_type)?;
    } else {
        application.validate_extension_approval(vault_type)?;
    }
    Ok(())
}

async fn local_vault_matches_compiled_application(store_id: &str) -> Result<bool, NookError> {
    let Some(content) = crate::storage::indexed_db::load_vault_blob(store_id).await? else {
        return Ok(false);
    };
    let architecture = nook_core::read_vault_architecture(&content)?;
    Ok(application::configured_vault_application().permits_vault_type(architecture.vault_type))
}

/// Ensure auth snapshots always keep a local provider row when this browser has
/// a local vault. Returns the updated snapshot plus whether a row was added.
#[wasm_bindgen(js_name = ensureLocalAuthProviderSnapshot)]
#[allow(clippy::needless_pass_by_value)]
pub async fn ensure_local_auth_provider_snapshot(
    snapshot: JsValue,
) -> Result<JsValue, wasm_bindgen::JsError> {
    let snapshot: nook_core::AuthProvidersSnapshotData = serde_wasm_bindgen::from_value(snapshot)?;
    if !has_local_vault().await? {
        return Ok(to_js_value(&LocalAuthProviderSnapshot {
            snapshot,
            migrated: false,
        })?);
    }
    let new_id = nook_core::generate_id()?.to_string();
    let created_at: String = js_sys::Date::new_0().to_iso_string().into();
    let (snapshot, migrated) =
        nook_core::ensure_local_provider_row(&snapshot, None, &new_id, &created_at);
    Ok(to_js_value(&LocalAuthProviderSnapshot {
        snapshot,
        migrated,
    })?)
}

#[wasm_bindgen(js_name = hasLocalVault)]
pub async fn has_local_vault() -> Result<bool, wasm_bindgen::JsError> {
    for entry in crate::storage::indexed_db::list_vault_registry_entries().await? {
        if local_vault_matches_compiled_application(&entry.store_id).await? {
            return Ok(true);
        }
    }
    Ok(false)
}

#[wasm_bindgen(js_name = hasActiveLocalVault)]
pub async fn has_active_local_vault() -> Result<bool, wasm_bindgen::JsError> {
    let Some(store_id) = crate::storage::indexed_db::get_active_vault_id().await? else {
        return Ok(false);
    };
    Ok(local_vault_matches_compiled_application(&store_id).await?)
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookLocalVaultEntry {
    store_id: String,
    label: String,
    last_unlocked_at: Option<nook_core::IsoTimestamp>,
}

#[wasm_bindgen]
impl NookLocalVaultEntry {
    #[wasm_bindgen(getter, js_name = storeId)]
    pub fn store_id(&self) -> String {
        self.store_id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn label(&self) -> String {
        self.label.clone()
    }

    #[wasm_bindgen(js_name = displayLabel)]
    pub fn display_label(&self, fallback_label: &str) -> String {
        let label = self.label.trim();
        if label.is_empty() {
            fallback_label.to_owned()
        } else {
            label.to_owned()
        }
    }

    #[wasm_bindgen(getter, js_name = lastUnlockedAt)]
    pub fn last_unlocked_at(&self) -> Option<String> {
        self.last_unlocked_at
            .as_ref()
            .map(nook_core::IsoTimestamp::to_string)
    }
}

#[wasm_bindgen(js_name = listLocalVaults)]
pub async fn list_local_vaults() -> Result<Vec<NookLocalVaultEntry>, wasm_bindgen::JsError> {
    let mut matching = Vec::new();
    for entry in crate::storage::indexed_db::list_vault_registry_entries().await? {
        if local_vault_matches_compiled_application(&entry.store_id).await? {
            matching.push(NookLocalVaultEntry {
                store_id: entry.store_id,
                label: entry.label,
                last_unlocked_at: entry.last_unlocked_at,
            });
        }
    }
    Ok(matching)
}

#[wasm_bindgen(js_name = getActiveVaultId)]
pub async fn get_active_vault_id() -> Result<Option<String>, wasm_bindgen::JsError> {
    let Some(store_id) = crate::storage::indexed_db::get_active_vault_id().await? else {
        return Ok(None);
    };
    if local_vault_matches_compiled_application(&store_id).await? {
        Ok(Some(store_id))
    } else {
        Ok(None)
    }
}

#[wasm_bindgen(js_name = setActiveVault)]
pub async fn set_active_vault(store_id: String) -> Result<(), wasm_bindgen::JsError> {
    let content = crate::storage::indexed_db::load_vault_blob(&store_id)
        .await?
        .ok_or_else(|| NookError::Database("Local vault was not found.".to_owned()))?;
    validate_configured_application_for_content(&content)?;
    crate::storage::indexed_db::switch_active_vault(&store_id)
        .await
        .map_err(Into::into)
}

#[wasm_bindgen(js_name = setLocalVaultLabel)]
pub async fn set_local_vault_label(
    store_id: String,
    label: String,
) -> Result<(), wasm_bindgen::JsError> {
    crate::storage::indexed_db::set_local_vault_label(&store_id, &label)
        .await
        .map_err(Into::into)
}

#[wasm_bindgen(js_name = prepareNewLocalVaultSlot)]
pub async fn prepare_new_local_vault_slot() -> Result<(), wasm_bindgen::JsError> {
    crate::storage::indexed_db::prepare_new_local_vault_slot()
        .await
        .map_err(Into::into)
}

#[wasm_bindgen(js_name = importLocalVaultBlob)]
pub async fn import_local_vault_blob(
    content: String,
    label: Option<String>,
) -> Result<String, wasm_bindgen::JsError> {
    validate_configured_application_for_content(&content)?;
    crate::storage::indexed_db::import_vault_blob(&content, label.as_deref())
        .await
        .map_err(Into::into)
}

/// Compare local vs remote vault YAML and return a sync action label:
/// `unchanged`, `adopt_remote`, `push_local`, or `conflict`.
#[wasm_bindgen(js_name = compareVaultSync)]
pub fn compare_vault_sync(local: &str, remote: &str) -> Result<String, wasm_bindgen::JsError> {
    match nook_core::compare_vault_sync(local, remote) {
        Ok(action) => Ok(match action {
            nook_core::VaultSyncAction::Unchanged => "unchanged".to_owned(),
            nook_core::VaultSyncAction::AdoptRemote => "adopt_remote".to_owned(),
            nook_core::VaultSyncAction::PushLocal => "push_local".to_owned(),
            nook_core::VaultSyncAction::Conflict => "conflict".to_owned(),
        }),
        Err(e) => Err(wasm_bindgen::JsError::new(&e.to_string())),
    }
}

#[wasm_bindgen(js_name = readVaultVersion)]
#[must_use]
pub fn read_vault_version(yaml: &str) -> u64 {
    nook_core::read_vault_version(yaml).unwrap_or(0)
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookSecretRecord {
    record: nook_core::SecretRecord,
}

#[wasm_bindgen]
impl NookSecretRecord {
    pub(crate) fn from_record(record: nook_core::SecretRecord) -> Self {
        Self { record }
    }

    #[wasm_bindgen(getter)]
    pub fn id(&self) -> String {
        self.record.id.to_string()
    }

    #[wasm_bindgen(getter, js_name = "type")]
    pub fn secret_type(&self) -> String {
        self.record.secret_type.as_str().to_owned()
    }

    #[wasm_bindgen(getter, js_name = displayTitle)]
    pub fn display_title(&self) -> String {
        self.record.display_title()
    }

    #[wasm_bindgen(getter, js_name = groupKey)]
    pub fn group_key(&self) -> String {
        self.record.group_key()
    }

    #[wasm_bindgen(getter, js_name = summary)]
    pub fn summary(&self) -> String {
        self.record.summary()
    }

    #[wasm_bindgen(js_name = matchesSearch)]
    pub fn matches_search(&self, query: &str) -> bool {
        self.record.matches_search(query)
    }

    #[wasm_bindgen(getter, js_name = primaryCredential)]
    pub fn primary_credential(&self) -> String {
        self.record.primary_credential().to_owned()
    }

    #[wasm_bindgen(getter, js_name = websiteUrl)]
    pub fn website_url(&self) -> String {
        match &self.record.data {
            nook_core::SecretValue::Login(value) => value.website_url.clone(),
            nook_core::SecretValue::ApiKey(value) => value.website_url.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn username(&self) -> String {
        match &self.record.data {
            nook_core::SecretValue::Login(value) => value.username.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn password(&self) -> String {
        match &self.record.data {
            nook_core::SecretValue::Login(value) => value.password.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn notes(&self) -> String {
        match &self.record.data {
            nook_core::SecretValue::Login(value) => value.notes.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = key)]
    pub fn api_key(&self) -> String {
        match &self.record.data {
            nook_core::SecretValue::ApiKey(value) => value.key.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = expiresAt)]
    pub fn expires_at(&self) -> String {
        match &self.record.data {
            nook_core::SecretValue::ApiKey(value) => value.expires_at.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn name(&self) -> String {
        match &self.record.data {
            nook_core::SecretValue::SeedPhrase(value) => value.name.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn seed(&self) -> String {
        match &self.record.data {
            nook_core::SecretValue::SeedPhrase(value) => value.seed.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn title(&self) -> String {
        match &self.record.data {
            nook_core::SecretValue::SecureNote(value) => value.title.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn note(&self) -> String {
        match &self.record.data {
            nook_core::SecretValue::SecureNote(value) => value.note.clone(),
            _ => String::new(),
        }
    }
}

/// Serialize validated form fields into the YAML payload expected by `add_secret`.
fn build_secret_yaml_inner(
    secret_type: &str,
    fields: &NookSecretFormFields,
) -> Result<String, NookError> {
    let parsed = nook_core::SecretType::parse(secret_type)?;
    Ok(
        nook_core::build_secret_yaml(parsed, &fields.to_json_value())?
            .as_str()
            .to_owned(),
    )
}

#[wasm_bindgen(js_name = buildSecretYaml)]
pub fn build_secret_yaml(
    secret_type: &str,
    fields: &NookSecretFormFields,
) -> Result<String, wasm_bindgen::JsError> {
    build_secret_yaml_inner(secret_type, fields).map_err(Into::into)
}

#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn provider_storage_modes_round_trip_in_wasm() {
        assert_eq!(
            wasm_storage_mode_for_provider("oauth-file", Some("google-drive".to_owned()))
                .expect("google-drive storage mode"),
            "google-drive"
        );
        assert_eq!(
            wasm_storage_mode_for_provider("oauth-file", Some("icloud".to_owned()))
                .expect("icloud storage mode"),
            "icloud"
        );
        assert_eq!(
            NookStorageProviderTypeUtil::value(NookStorageProviderKind::LocalFolder),
            "local-folder"
        );
    }
}
