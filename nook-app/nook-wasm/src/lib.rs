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
pub use wasm_bindgen_futures as __wasm_bindgen_futures;

pub use logger::NookLogEntries;
pub use manager::{
    NookEventLogRecords, NookEventLogStorageRecord, NookExtensionEventLogImportStatus,
    NookExternalEventLogRecords, NookVaultManager,
};
pub use storage::local_folder::NookLocalFolderConfig;
pub use types::{
    NookAuthenticationOutcomeObservation, NookAuthenticationOutcomeVerdict,
    NookAuthenticationPageObservation, NookAuthenticationPageObservations,
    NookAuthenticationWorkflowSnapshot, NookBrowserLocale, NookClientRunMode,
    NookClientRunModeUtil, NookDecryptedEnrollmentPayload, NookEnrollmentIssueInput,
    NookEnrollmentProvider, NookEventLogSyncIssue, NookGoogleDriveFolder, NookImportResult,
    NookJoinRequest, NookLoginAccount, NookLoginFillCredential, NookOtpauthPreview,
    NookPasskeyAccount, NookPasskeyAssertion, NookPasskeyRegistration, NookPasskeySetup,
    NookPasskeyUnlockOptions, NookPasswordEntrySummary, NookPendingSyncConflict,
    NookProviderReplicationCapability, NookReplacementCandidate, NookReplacementConflict,
    NookRuntimeConfig, NookSecretFormFields, NookSecretPage, NookSecurityConflict,
    NookSentinelGenesisDelivery, NookSentinelGenesisFinalizeResult,
    NookSentinelGenesisParticipantStatus, NookSentinelGenesisStatus,
    NookSentinelStoredDeliverySummary, NookSentinelUnlockSessionStatus, NookStorageConnectArgs,
    NookTotpCode, NookVaultAccessReport, NookVaultArchitecture, NookVaultClientPolicy,
    NookVaultEpochHistoryDiagnostic, NookVaultEventAccessDiagnostic, NookVaultMember,
    NookVaultSecretAccessDiagnostic, NookVaultSecurityRecommendations, NookVaultSyncResult,
    NookWebsiteLoginSavePlan,
};
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

#[wasm_bindgen(js_name = classifyVaultRecoveryError)]
#[must_use]
pub fn classify_vault_recovery_error(message: &str) -> nook_core::VaultRecoveryErrorKind {
    nook_core::classify_vault_recovery_error(message)
}

#[wasm_bindgen(js_name = assessVaultSecurity)]
#[must_use]
pub fn assess_vault_security(
    sync_provider_count: u32,
    enrolled_device_count: u32,
) -> NookVaultSecurityRecommendations {
    NookVaultSecurityRecommendations::from_core(nook_core::assess_vault_security(
        sync_provider_count as usize,
        enrolled_device_count as usize,
    ))
}

#[wasm_bindgen(js_name = authenticationWorkflowSnapshot)]
#[must_use]
pub fn authentication_workflow_snapshot(
    observations: &NookAuthenticationPageObservations,
) -> Option<NookAuthenticationWorkflowSnapshot> {
    nook_core::classify_authentication_workflow_candidates(observations.as_core())
        .map(NookAuthenticationWorkflowSnapshot::from_core)
}

#[wasm_bindgen(js_name = classifyAuthenticationOutcome)]
#[must_use]
pub fn classify_authentication_outcome(
    observation: &NookAuthenticationOutcomeObservation,
    timeout_ms: Option<u32>,
) -> NookAuthenticationOutcomeVerdict {
    let timeout = timeout_ms.unwrap_or(nook_core::DEFAULT_OUTCOME_EVIDENCE_TIMEOUT_MS);
    NookAuthenticationOutcomeVerdict::from_core(nook_core::classify_authentication_outcome(
        observation.to_core(),
        timeout,
    ))
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
) -> Result<web_sys::CredentialRequestOptions, wasm_bindgen::JsError> {
    passkey_browser::request_options(rp_id, &credential_id, &prf_input)
}

#[wasm_bindgen(js_name = buildPasskeyCreationOptions)]
#[allow(clippy::needless_pass_by_value)]
pub fn build_passkey_creation_options(
    rp_id: &str,
    rp_name: &str,
    passkey_label: &str,
    user_handle: Vec<u8>,
    prf_input: Vec<u8>,
) -> Result<web_sys::CredentialCreationOptions, wasm_bindgen::JsError> {
    passkey_browser::creation_options(rp_id, rp_name, passkey_label, &user_handle, &prf_input)
}

#[wasm_bindgen(js_name = buildPasskeyRecoveryRequestOptions)]
pub fn build_passkey_recovery_request_options(
    rp_id: &str,
) -> Result<web_sys::CredentialRequestOptions, wasm_bindgen::JsError> {
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

/// Generate an RFC 6238 TOTP code from a base32 secret via `nook-core`.
#[wasm_bindgen(js_name = generateTotpCode)]
pub fn generate_totp_code(
    secret: &str,
    unix_seconds: u64,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(authenticator_from_secret(secret)?
        .current_code(unix_seconds)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?
        .code)
}

/// Verify a TOTP code against a base32 secret with a ±1-step window.
#[wasm_bindgen(js_name = verifyTotpCode)]
pub fn verify_totp_code(
    secret: &str,
    code: &str,
    unix_seconds: u64,
) -> Result<bool, wasm_bindgen::JsError> {
    let authenticator = authenticator_from_secret(secret)?;
    let trimmed = code.trim();
    if trimmed.len() < 6 || trimmed.len() > 8 || !trimmed.bytes().all(|b| b.is_ascii_digit()) {
        return Ok(false);
    }
    let period = authenticator.period.get();
    for step_offset in [-1_i64, 0, 1] {
        let Some(shifted) =
            unix_seconds.checked_add_signed(step_offset * i64::try_from(period).unwrap_or(30))
        else {
            continue;
        };
        let candidate = authenticator
            .current_code(shifted)
            .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?;
        if candidate.code == trimmed {
            return Ok(true);
        }
    }
    Ok(false)
}

fn authenticator_from_secret(
    secret: &str,
) -> Result<nook_core::AuthenticatorSecret, wasm_bindgen::JsError> {
    Ok(nook_core::AuthenticatorSecret {
        issuer: "Nook".to_owned(),
        account: String::new(),
        website_url: String::new(),
        secret: nook_core::TotpSecret::parse(secret)
            .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?,
        algorithm: nook_core::TotpAlgorithm::Sha1,
        digits: nook_core::TotpDigits::default(),
        period: nook_core::TotpPeriod::default(),
        backup_codes: Vec::new(),
    })
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
    provider_type: nook_core::StorageProviderType,
    oauth_preset: Option<nook_core::OauthFilePreset>,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(
        nook_core::storage_mode_for_provider(provider_type, oauth_preset)
            .as_str()
            .to_owned(),
    )
}

#[wasm_bindgen(js_name = providerDefaultLabel)]
#[allow(clippy::needless_pass_by_value)]
pub fn provider_default_label(
    provider_type: nook_core::StorageProviderType,
    detail: Option<String>,
    oauth_preset: Option<nook_core::OauthFilePreset>,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::sync_provider_default_label(
        provider_type,
        detail.as_deref(),
        oauth_preset,
    ))
}

#[wasm_bindgen(js_name = stagedProviderLabel)]
#[allow(clippy::needless_pass_by_value)]
pub fn staged_provider_label(
    provider_type: nook_core::StorageProviderType,
    github_repo: Option<String>,
    oauth_file_name: Option<String>,
    oauth_file_preset: Option<nook_core::OauthFilePreset>,
    oauth_setup_preset: Option<nook_core::OauthFilePreset>,
) -> Result<String, wasm_bindgen::JsError> {
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
    provider_type: nook_core::StorageProviderType,
    github_pat: Option<String>,
    oauth_access_token: Option<String>,
    local_folder_handle_id: Option<String>,
) -> Result<bool, wasm_bindgen::JsError> {
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
    provider: nook_core::StorageProviderData,
    this_device_desc: String,
    no_token_saved: String,
    google_signed_in: String,
    icloud_signed_in: String,
    google_not_signed_in: String,
    icloud_not_signed_in: String,
    local_folder_needs_reconnect: String,
) -> Result<String, wasm_bindgen::JsError> {
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
#[allow(clippy::needless_pass_by_value)]
pub fn provider_wasm_args(
    provider: nook_core::StorageProviderData,
) -> Result<NookStorageConnectArgs, wasm_bindgen::JsError> {
    Ok(nook_core::storage_args_for_provider(&provider)?.into())
}

#[wasm_bindgen(js_name = activeVaultProviders)]
#[allow(clippy::needless_pass_by_value)]
pub fn active_vault_providers(
    mut snapshot: nook_core::AuthProvidersSnapshotData,
    active_store_id: Option<String>,
) -> Result<nook_core::AuthProvidersSnapshotData, wasm_bindgen::JsError> {
    snapshot.providers =
        nook_core::active_vault_providers(&snapshot.providers, active_store_id.as_deref());
    Ok(snapshot)
}

#[wasm_bindgen(js_name = syncProvidersForActiveVault)]
#[allow(clippy::needless_pass_by_value)]
pub fn sync_providers_for_active_vault(
    mut snapshot: nook_core::AuthProvidersSnapshotData,
    active_store_id: Option<String>,
) -> Result<nook_core::AuthProvidersSnapshotData, wasm_bindgen::JsError> {
    snapshot.providers = nook_core::sync_providers_for_active_vault(
        &snapshot.providers,
        active_store_id.as_deref(),
    )?;
    Ok(snapshot)
}

#[wasm_bindgen(js_name = localProviderIdForActiveVault)]
#[allow(clippy::needless_pass_by_value)]
pub fn local_provider_id_for_active_vault(
    snapshot: nook_core::AuthProvidersSnapshotData,
    active_store_id: Option<String>,
) -> Result<Option<String>, wasm_bindgen::JsError> {
    Ok(
        nook_core::local_provider_for_active_vault(
            &snapshot.providers,
            active_store_id.as_deref(),
        )?
        .map(|provider| provider.id),
    )
}

#[wasm_bindgen(js_name = providerLabelById)]
#[allow(clippy::needless_pass_by_value)]
pub fn provider_label_by_id(
    snapshot: nook_core::AuthProvidersSnapshotData,
    provider_id: &str,
) -> Result<Option<String>, wasm_bindgen::JsError> {
    Ok(nook_core::provider_label_by_id(
        &snapshot.providers,
        provider_id,
    ))
}

#[wasm_bindgen(js_name = providersVisibleWhileDeviceLocked)]
#[allow(clippy::needless_pass_by_value)]
pub fn providers_visible_while_device_locked(
    mut snapshot: nook_core::AuthProvidersSnapshotData,
) -> nook_core::AuthProvidersSnapshotData {
    snapshot.providers = nook_core::providers_visible_while_device_locked(&snapshot.providers);
    snapshot
}

#[wasm_bindgen(js_name = oauthRemoteStorageRef)]
#[allow(clippy::needless_pass_by_value)]
pub fn oauth_remote_storage_ref(config: nook_core::OAuthFileConfigData) -> Option<String> {
    nook_core::oauth_remote_storage_ref(&config)
}

#[wasm_bindgen(js_name = updateOauthRemoteRef)]
#[allow(clippy::needless_pass_by_value)]
pub fn update_oauth_remote_ref(
    config: nook_core::OAuthFileConfigData,
    remote_ref: &str,
) -> Option<nook_core::OAuthFileConfigData> {
    nook_core::update_oauth_remote_ref(&config, remote_ref)
}

#[wasm_bindgen(js_name = stagedRemoteStorageArgs)]
#[allow(clippy::needless_pass_by_value)]
pub fn staged_remote_storage_args(
    provider_type: nook_core::StorageProviderType,
    github_pat: Option<String>,
    github_repo: Option<String>,
    oauth_file: Option<nook_core::OAuthFileConfigData>,
) -> Result<Option<NookStorageConnectArgs>, wasm_bindgen::JsError> {
    Ok(nook_core::staged_remote_storage_args(
        provider_type,
        github_pat.as_deref(),
        github_repo.as_deref(),
        oauth_file.as_ref(),
    )?
    .map(Into::into))
}

#[wasm_bindgen(js_name = updateProviderSyncMetadata)]
#[allow(clippy::needless_pass_by_value)]
pub fn update_provider_sync_metadata(
    mut snapshot: nook_core::AuthProvidersSnapshotData,
    provider_id: &str,
    vault_yaml: &str,
    revision: Option<String>,
    manager_store_id: Option<String>,
    synced_at: &str,
) -> Result<nook_core::AuthProvidersSnapshotData, wasm_bindgen::JsError> {
    snapshot.providers = nook_core::update_provider_sync_metadata(
        &snapshot.providers,
        provider_id,
        vault_yaml,
        revision.as_deref(),
        manager_store_id.as_deref(),
        synced_at,
    );
    Ok(snapshot)
}

#[wasm_bindgen(js_name = setGoogleDriveProviderMode)]
#[allow(clippy::needless_pass_by_value)]
pub fn set_google_drive_provider_mode(
    config: nook_core::OAuthFileConfigData,
    mode: nook_core::GoogleDriveMode,
) -> Result<nook_core::OAuthFileConfigData, wasm_bindgen::JsError> {
    Ok(nook_core::set_google_drive_provider_mode(&config, mode))
}

#[wasm_bindgen(js_name = setICloudProviderMode)]
#[allow(clippy::needless_pass_by_value)]
pub fn set_icloud_provider_mode(
    config: nook_core::OAuthFileConfigData,
    mode: nook_core::ICloudMode,
) -> Result<nook_core::OAuthFileConfigData, wasm_bindgen::JsError> {
    Ok(nook_core::set_icloud_provider_mode(&config, mode))
}

#[wasm_bindgen(js_name = createICloudSharedStorageTarget)]
pub fn create_icloud_shared_storage_target(
    role: &str,
    zone_name: &str,
    owner_record_name: &str,
    root_record_name: &str,
    short_guid: &str,
) -> Result<String, wasm_bindgen::JsError> {
    let role = match role.trim() {
        "owner" => nook_core::ICloudShareRole::Owner,
        "participant" => nook_core::ICloudShareRole::Participant,
        other => {
            return Err(wasm_bindgen::JsError::new(&format!(
                "Unknown iCloud share role: {other}"
            )));
        }
    };
    Ok(nook_core::ICloudSharedTarget::new(
        role,
        zone_name,
        owner_record_name,
        root_record_name,
        short_guid,
    )?
    .to_storage_id()?)
}

#[wasm_bindgen(js_name = parseICloudSharedStorageTarget)]
pub fn parse_icloud_shared_storage_target(
    storage_target_id: &str,
) -> Result<nook_core::ICloudSharedTarget, wasm_bindgen::JsError> {
    Ok(nook_core::ICloudSharedTarget::from_storage_id(
        storage_target_id,
    )?)
}

#[wasm_bindgen(js_name = bindGoogleDriveSharedFolder)]
#[allow(clippy::needless_pass_by_value)]
pub fn bind_google_drive_shared_folder(
    config: nook_core::OAuthFileConfigData,
    folder_ref: &str,
) -> Result<nook_core::OAuthFileConfigData, wasm_bindgen::JsError> {
    Ok(nook_core::bind_google_drive_shared_folder(
        &config, folder_ref,
    )?)
}

#[wasm_bindgen(js_name = googleOAuthTokensToConfig)]
#[allow(clippy::needless_pass_by_value)]
pub fn google_oauth_tokens_to_config(
    access_token: &str,
    expires_at: &str,
    existing: Option<nook_core::OAuthFileConfigData>,
) -> Result<nook_core::OAuthFileConfigData, wasm_bindgen::JsError> {
    Ok(nook_core::google_oauth_tokens_to_config(
        access_token,
        expires_at,
        existing.as_ref(),
    ))
}

#[wasm_bindgen(js_name = iCloudOAuthTokensToConfig)]
#[allow(clippy::needless_pass_by_value)]
pub fn icloud_oauth_tokens_to_config(
    access_token: &str,
    account_name: Option<String>,
    existing: Option<nook_core::OAuthFileConfigData>,
) -> Result<nook_core::OAuthFileConfigData, wasm_bindgen::JsError> {
    Ok(nook_core::icloud_oauth_tokens_to_config(
        access_token,
        account_name.as_deref(),
        existing.as_ref(),
    ))
}

#[wasm_bindgen(js_name = defaultVaultArchitecture)]
pub fn default_vault_architecture() -> NookVaultArchitecture {
    NookVaultArchitecture::from_core(nook_core::VaultArchitecture::default())
}

#[wasm_bindgen(js_name = validateVaultArchitecture)]
pub fn validate_vault_architecture(
    architecture: &NookVaultArchitecture,
) -> Result<NookVaultArchitecture, wasm_bindgen::JsError> {
    let architecture = architecture.to_core();
    architecture.validate()?;
    Ok(NookVaultArchitecture::from_core(architecture))
}

#[wasm_bindgen(js_name = vaultArchitectureOnboardingType)]
pub fn vault_architecture_onboarding_type(
    architecture: &NookVaultArchitecture,
) -> Result<String, wasm_bindgen::JsError> {
    let architecture = architecture.to_core();
    architecture.validate()?;
    Ok(architecture.onboarding_type().as_str().to_owned())
}

#[wasm_bindgen(js_name = providerOnboardingType)]
#[allow(clippy::needless_pass_by_value)]
pub fn provider_onboarding_type(
    provider: nook_core::StorageProviderData,
    architecture: &NookVaultArchitecture,
) -> Result<String, wasm_bindgen::JsError> {
    let architecture = architecture.to_core();
    Ok(
        nook_core::provider_onboarding_type(&provider, &architecture)?
            .as_str()
            .to_owned(),
    )
}

#[wasm_bindgen(js_name = vaultArchitectureCanCreateSecret)]
pub fn vault_architecture_can_create_secret(
    architecture: &NookVaultArchitecture,
) -> Result<bool, wasm_bindgen::JsError> {
    let architecture = architecture.to_core();
    architecture.validate()?;
    Ok(architecture.can_create_secret())
}

#[wasm_bindgen(js_name = providerReplicationCapability)]
#[allow(clippy::needless_pass_by_value)]
pub fn provider_replication_capability(
    provider: nook_core::StorageProviderData,
) -> Result<NookProviderReplicationCapability, wasm_bindgen::JsError> {
    Ok(NookProviderReplicationCapability::from_core(
        nook_core::provider_replication_capability_for_row(&provider)?,
    ))
}

#[wasm_bindgen(js_name = validateProviderReplication)]
#[allow(clippy::needless_pass_by_value)]
pub fn validate_provider_replication(
    provider: nook_core::StorageProviderData,
    replication_type: &str,
) -> Result<NookProviderReplicationCapability, wasm_bindgen::JsError> {
    let replication_type = nook_core::ReplicationType::parse(replication_type)?;
    Ok(NookProviderReplicationCapability::from_core(
        nook_core::validate_provider_row_replication(&provider, replication_type)?,
    ))
}

#[wasm_bindgen(js_name = providerSupportsReplication)]
#[allow(clippy::needless_pass_by_value)]
pub fn provider_supports_replication(
    provider: nook_core::StorageProviderData,
    replication_type: &str,
) -> Result<bool, wasm_bindgen::JsError> {
    let replication_type = nook_core::ReplicationType::parse(replication_type)?;
    Ok(nook_core::provider_supports_replication(
        &provider,
        replication_type,
    ))
}

#[wasm_bindgen(js_name = firstCompatibleProviderId)]
#[allow(clippy::needless_pass_by_value)]
pub fn first_compatible_provider_id(
    snapshot: nook_core::AuthProvidersSnapshotData,
    replication_type: &str,
    preferred_id: Option<String>,
) -> Result<Option<String>, wasm_bindgen::JsError> {
    let replication_type = nook_core::ReplicationType::parse(replication_type)?;
    Ok(nook_core::first_compatible_provider_id(
        &snapshot.providers,
        replication_type,
        preferred_id.as_deref(),
    ))
}

#[wasm_bindgen(js_name = enrollmentProviderForArchitecture)]
#[allow(clippy::needless_pass_by_value)]
pub fn enrollment_provider_for_architecture(
    provider: nook_core::StorageProviderData,
    architecture: &NookVaultArchitecture,
    shared_joiner_identity: Option<String>,
    shared_storage_target_id: Option<String>,
) -> Result<NookEnrollmentProvider, wasm_bindgen::JsError> {
    let architecture = architecture.to_core();
    Ok(NookEnrollmentProvider::from_core(
        nook_core::enrollment_provider_for_architecture_with_storage_target(
            &provider,
            &architecture,
            shared_joiner_identity.as_deref(),
            shared_storage_target_id.as_deref(),
        )?,
    ))
}

async fn grant_existing_drive_folder(
    access_token: &str,
    folder_id: String,
    instructions_key: String,
    joiner_identity: String,
    storage_target_name: Option<String>,
) -> nook_core::SharedStorageGrantOutcome {
    match storage::drive_shared::share_folder_with_email(access_token, &folder_id, &joiner_identity)
        .await
    {
        Ok(()) => nook_core::SharedStorageGrantOutcome::Granted {
            note: "architecture_modes.shared_grant_success".to_owned(),
            storage_target_id: folder_id,
            storage_target_name,
        },
        Err(error) => {
            tracing::warn!(
                scope = "shared-storage-grant",
                stage = "share-existing-folder",
                error = %error,
                "automatic shared storage grant failed; manual grant required"
            );
            nook_core::SharedStorageGrantOutcome::ManualGrantRequired {
                instructions_key,
                joiner_identity,
                storage_target_id: Some(folder_id),
                storage_target_name,
            }
        }
    }
}

async fn create_and_grant_drive_folder(
    access_token: &str,
    folder_name: &str,
    instructions_key: String,
    joiner_identity: String,
) -> nook_core::SharedStorageGrantOutcome {
    let Ok((folder_id, created_name)) =
        storage::drive_shared::create_shared_vault_folder(access_token, folder_name)
            .await
            .inspect_err(|error| {
                tracing::warn!(
                    scope = "shared-storage-grant",
                    stage = "create-folder",
                    error = %error,
                    "automatic shared storage grant failed; manual grant required"
                );
            })
    else {
        return nook_core::SharedStorageGrantOutcome::ManualGrantRequired {
            instructions_key,
            joiner_identity,
            storage_target_id: None,
            storage_target_name: None,
        };
    };
    match storage::drive_shared::share_folder_with_email(access_token, &folder_id, &joiner_identity)
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

/// Validate a shared-grant request, then (for Google Drive) grant the persisted
/// folder or create one when no target exists. Falls back to
/// `ManualGrantRequired` when the Drive API fails or no owner token is supplied.
fn is_google_drive_shared_grant_request(provider_type: &str, oauth_preset: Option<&str>) -> bool {
    let oauth_preset = oauth_preset.unwrap_or_default().trim();
    provider_type.trim() == "oauth-file"
        && (oauth_preset.is_empty() || oauth_preset == "google-drive")
}

#[wasm_bindgen(js_name = prepareSharedStorageGrant)]
pub async fn prepare_shared_storage_grant(
    request: nook_core::SharedStorageGrantRequest,
) -> Result<nook_core::SharedStorageGrantOutcome, wasm_bindgen::JsError> {
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
            let is_gdrive = is_google_drive_shared_grant_request(
                &request.provider_type,
                request.oauth_preset.as_deref(),
            );
            match (token, is_gdrive) {
                (Some(access_token), true) => {
                    if let Some(folder_id) = storage_target_id
                        .as_deref()
                        .map(str::trim)
                        .filter(|target| !target.is_empty())
                    {
                        grant_existing_drive_folder(
                            access_token,
                            folder_id.to_owned(),
                            instructions_key,
                            joiner_identity,
                            storage_target_name,
                        )
                        .await
                    } else {
                        let folder_name = request
                            .storage_target_hint
                            .as_deref()
                            .map(str::trim)
                            .filter(|name| !name.is_empty())
                            .unwrap_or("Nook shared vault");
                        create_and_grant_drive_folder(
                            access_token,
                            folder_name,
                            instructions_key,
                            joiner_identity,
                        )
                        .await
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
    Ok(outcome)
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
    sync_provider: Option<nook_core::StorageProviderData>,
    provider_type: nook_core::StorageProviderType,
    github_pat: Option<String>,
    github_repo: Option<String>,
    oauth_preset: Option<nook_core::OauthFilePreset>,
    oauth_access_token: Option<String>,
    oauth_file_id: Option<String>,
    oauth_file_name: Option<String>,
) -> Result<NookStorageConnectArgs, wasm_bindgen::JsError> {
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

#[wasm_bindgen(js_name = sentinelGenesisParticipantFingerprint)]
pub fn sentinel_genesis_participant_fingerprint(
    input: &str,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::sentinel_genesis_participant_fingerprint(input)?)
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

#[wasm_bindgen]
impl NookVaultManager {
    /// Load the persisted sync-provider snapshot from `nook_auth`, including
    /// normalization, legacy migration, and device-key credential unsealing.
    /// Migration bookkeeping stays inside Rust; callers receive only the
    /// snapshot they actually use.
    #[wasm_bindgen(js_name = loadAuthProviders)]
    pub async fn load_auth_providers_snapshot(
        &self,
    ) -> Result<nook_core::AuthProvidersSnapshotData, wasm_bindgen::JsError> {
        let identity = self.device_identity()?;
        let loaded = crate::storage::auth_providers::load_auth_providers(&identity).await?;
        Ok(loaded.snapshot)
    }

    /// Load providers and ensure this browser's local vault has a provider row.
    /// The read-modify-save lifecycle is one Rust operation rather than a web
    /// DTO round trip.
    #[wasm_bindgen(js_name = loadAuthProvidersWithLocalRow)]
    pub async fn load_auth_providers_with_local_row(
        &self,
    ) -> Result<nook_core::AuthProvidersSnapshotData, wasm_bindgen::JsError> {
        let identity = self.device_identity()?;
        let loaded = crate::storage::auth_providers::load_auth_providers(&identity).await?;
        let snapshot = loaded.snapshot;
        if !has_local_vault().await? {
            return Ok(snapshot);
        }
        let new_id = nook_core::generate_id()?.to_string();
        let created_at: String = js_sys::Date::new_0().to_iso_string().into();
        let (snapshot, changed) =
            nook_core::ensure_local_provider_row(&snapshot, None, &new_id, &created_at);
        if changed {
            crate::storage::auth_providers::save_auth_providers(&identity, &snapshot).await?;
        }
        Ok(snapshot)
    }

    /// Ensure a caller's current provider snapshot contains this browser's
    /// local-vault row and persist it when Rust adds the row.
    #[wasm_bindgen(js_name = ensureLocalAuthProviderSnapshot)]
    pub async fn ensure_local_auth_provider_snapshot(
        &self,
        snapshot: nook_core::AuthProvidersSnapshotData,
    ) -> Result<nook_core::AuthProvidersSnapshotData, wasm_bindgen::JsError> {
        if !has_local_vault().await? {
            return Ok(snapshot);
        }
        let identity = self.device_identity()?;
        let new_id = nook_core::generate_id()?.to_string();
        let created_at: String = js_sys::Date::new_0().to_iso_string().into();
        let (snapshot, changed) =
            nook_core::ensure_local_provider_row(&snapshot, None, &new_id, &created_at);
        if changed {
            crate::storage::auth_providers::save_auth_providers(&identity, &snapshot).await?;
        }
        Ok(snapshot)
    }

    /// Seal credential fields with the device key and persist the snapshot to
    /// the `nook_auth` `IndexedDB` database.
    #[wasm_bindgen(js_name = saveAuthProviders)]
    pub async fn save_auth_providers_snapshot(
        &self,
        snapshot: nook_core::AuthProvidersSnapshotData,
    ) -> Result<(), wasm_bindgen::JsError> {
        let identity = self.device_identity()?;
        crate::storage::auth_providers::save_auth_providers(&identity, &snapshot).await?;
        Ok(())
    }
}

/// Seal credential fields in a snapshot for another device's public key without
/// persisting. Used by extension pairing before handing granted provider rows
/// to the extension's own storage.
#[wasm_bindgen(js_name = sealAuthProvidersForDevicePublicKey)]
pub fn seal_auth_providers_for_device_public_key(
    device_public_key: &str,
    mut snapshot: nook_core::AuthProvidersSnapshotData,
) -> Result<nook_core::AuthProvidersSnapshotData, wasm_bindgen::JsError> {
    let public_key = nook_core::DevicePublicKey::parse(device_public_key)?;
    nook_core::seal_provider_credentials_for_public_key(&public_key, &mut snapshot)?;
    Ok(snapshot)
}

/// Delete the `nook_auth` `IndexedDB` database (used on full sign-out / reset).
#[wasm_bindgen(js_name = deleteAuthProvidersDb)]
pub async fn delete_auth_providers_db() -> Result<(), wasm_bindgen::JsError> {
    crate::storage::auth_providers::delete_auth_providers_db().await?;
    Ok(())
}

/// Find an existing provider whose sync target matches `candidate`, optionally
/// excluding one provider id. Returns the matching provider or `undefined`.
#[wasm_bindgen(js_name = findDuplicateSyncProvider)]
#[allow(clippy::needless_pass_by_value)]
pub fn find_duplicate_sync_provider(
    snapshot: nook_core::AuthProvidersSnapshotData,
    candidate: nook_core::StorageProviderData,
    exclude_id: Option<String>,
) -> Result<Option<nook_core::StorageProviderData>, wasm_bindgen::JsError> {
    Ok(nook_core::find_duplicate_sync_provider(
        &snapshot.providers,
        &candidate,
        exclude_id.as_deref(),
    ))
}

/// Ensure a `local` provider row exists for the active vault, prepending one
/// (with a fresh id/timestamp) when missing. Returns the updated snapshot.
#[wasm_bindgen(js_name = ensureLocalProviderRow)]
#[allow(clippy::needless_pass_by_value)]
pub fn ensure_local_provider_row(
    snapshot: nook_core::AuthProvidersSnapshotData,
    active_store_id: Option<String>,
) -> Result<nook_core::AuthProvidersSnapshotData, wasm_bindgen::JsError> {
    let new_id = nook_core::generate_id()?.to_string();
    let created_at: String = js_sys::Date::new_0().to_iso_string().into();
    let (next, _changed) = nook_core::ensure_local_provider_row(
        &snapshot,
        active_store_id.as_deref(),
        &new_id,
        &created_at,
    );
    Ok(next)
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

/// Return the Rust-owned empty-provider policy for a first-connect intent.
#[wasm_bindgen(js_name = vaultConnectIntentPermitsEmptyRemoteGenesis)]
pub fn vault_connect_intent_permits_empty_remote_genesis(
    intent_name: &str,
) -> Result<bool, wasm_bindgen::JsError> {
    let intent = nook_core::VaultConnectIntent::parse(intent_name)
        .ok_or_else(|| wasm_bindgen::JsError::new("Unknown vault connect intent"))?;
    Ok(intent.permits_empty_remote_genesis())
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
pub struct NookSecretListItem {
    item: nook_core::SecretListItem,
    /// Entity-resolved clustering key for vault list cards.
    group_key: String,
}

#[wasm_bindgen]
impl NookSecretListItem {
    pub(crate) fn from_core(item: nook_core::SecretListItem, group_key: String) -> Self {
        Self { item, group_key }
    }

    #[wasm_bindgen(getter)]
    pub fn id(&self) -> String {
        self.item.id.to_string()
    }

    #[wasm_bindgen(getter, js_name = "type")]
    pub fn secret_type(&self) -> String {
        self.item.secret_type().as_str().to_owned()
    }

    #[wasm_bindgen(getter, js_name = displayTitle)]
    pub fn display_title(&self) -> String {
        self.item.display_title()
    }

    #[wasm_bindgen(getter, js_name = groupKey)]
    pub fn group_key(&self) -> String {
        self.group_key.clone()
    }

    #[wasm_bindgen(getter, js_name = summary)]
    pub fn summary(&self) -> String {
        self.item.summary()
    }

    #[wasm_bindgen(getter, js_name = websiteUrl)]
    pub fn website_url(&self) -> String {
        match &self.item.data {
            nook_core::SecretListItemData::Login { website_url, .. }
            | nook_core::SecretListItemData::ApiKey { website_url, .. }
            | nook_core::SecretListItemData::Authenticator { website_url, .. } => {
                website_url.clone()
            }
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = websiteHost)]
    pub fn website_host(&self) -> String {
        self.item.website_host()
    }

    #[wasm_bindgen(getter)]
    pub fn username(&self) -> String {
        match &self.item.data {
            nook_core::SecretListItemData::Login { username, .. } => username.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = expiresAt)]
    pub fn expires_at(&self) -> String {
        match &self.item.data {
            nook_core::SecretListItemData::ApiKey { expires_at, .. } => expires_at.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn name(&self) -> String {
        match &self.item.data {
            nook_core::SecretListItemData::SeedPhrase { name, .. } => name.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = seedWordCount)]
    pub fn seed_word_count(&self) -> u32 {
        match self.item.data {
            nook_core::SecretListItemData::SeedPhrase { word_count, .. } => {
                u32::try_from(word_count).unwrap_or(u32::MAX)
            }
            _ => 0,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn title(&self) -> String {
        match &self.item.data {
            nook_core::SecretListItemData::SecureNote { title }
            | nook_core::SecretListItemData::CreditCard { title, .. } => title.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = cardholderName)]
    pub fn cardholder_name(&self) -> String {
        match &self.item.data {
            nook_core::SecretListItemData::CreditCard {
                cardholder_name, ..
            } => cardholder_name.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn last4(&self) -> String {
        match &self.item.data {
            nook_core::SecretListItemData::CreditCard { last4, .. } => last4.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = expirationMonth)]
    pub fn expiration_month(&self) -> String {
        match &self.item.data {
            nook_core::SecretListItemData::CreditCard {
                expiration_month, ..
            } => expiration_month.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = expirationYear)]
    pub fn expiration_year(&self) -> String {
        match &self.item.data {
            nook_core::SecretListItemData::CreditCard {
                expiration_year, ..
            } => expiration_year.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = rpId)]
    pub fn rp_id(&self) -> String {
        match &self.item.data {
            nook_core::SecretListItemData::Passkey { rp_id, .. } => rp_id.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn issuer(&self) -> String {
        match &self.item.data {
            nook_core::SecretListItemData::Authenticator { issuer, .. } => issuer.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = passkeyUserName)]
    pub fn passkey_user_name(&self) -> String {
        match &self.item.data {
            nook_core::SecretListItemData::Passkey { user_name, .. } => user_name.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn account(&self) -> String {
        match &self.item.data {
            nook_core::SecretListItemData::Authenticator { account, .. } => account.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = passkeyUserDisplayName)]
    pub fn passkey_user_display_name(&self) -> String {
        match &self.item.data {
            nook_core::SecretListItemData::Passkey {
                user_display_name, ..
            } => user_display_name.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = backupCodeCount)]
    pub fn backup_code_count(&self) -> u32 {
        match self.item.data {
            nook_core::SecretListItemData::Authenticator {
                backup_code_count, ..
            } => u32::try_from(backup_code_count).unwrap_or(u32::MAX),
            _ => 0,
        }
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookSecretRecord {
    record: nook_core::SecretRecord,
}

impl Drop for NookSecretRecord {
    fn drop(&mut self) {
        self.record.zeroize_plaintext();
    }
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
            nook_core::SecretValue::Authenticator(value) => value.website_url.clone(),
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
            nook_core::SecretValue::CreditCard(value) => value.notes.clone(),
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
    #[allow(clippy::match_same_arms)]
    pub fn title(&self) -> String {
        match &self.record.data {
            nook_core::SecretValue::SecureNote(value) => value.title.clone(),
            nook_core::SecretValue::CreditCard(value) => value.title.clone(),
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

    #[wasm_bindgen(getter, js_name = cardholderName)]
    pub fn cardholder_name(&self) -> String {
        match &self.record.data {
            nook_core::SecretValue::CreditCard(value) => value.cardholder_name.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = cardNumber)]
    pub fn card_number(&self) -> String {
        match &self.record.data {
            nook_core::SecretValue::CreditCard(value) => value.number.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn last4(&self) -> String {
        match &self.record.data {
            nook_core::SecretValue::CreditCard(value) => value.last4(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = expirationMonth)]
    pub fn expiration_month(&self) -> String {
        match &self.record.data {
            nook_core::SecretValue::CreditCard(value) => value.expiration_month.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = expirationYear)]
    pub fn expiration_year(&self) -> String {
        match &self.record.data {
            nook_core::SecretValue::CreditCard(value) => value.expiration_year.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn cvv(&self) -> String {
        match &self.record.data {
            nook_core::SecretValue::CreditCard(value) => value.cvv.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = rpId)]
    pub fn rp_id(&self) -> String {
        match &self.record.data {
            nook_core::SecretValue::Passkey(value) => value.rp_id.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn issuer(&self) -> String {
        match &self.record.data {
            nook_core::SecretValue::Authenticator(value) => value.issuer.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = passkeyUserName)]
    pub fn passkey_user_name(&self) -> String {
        match &self.record.data {
            nook_core::SecretValue::Passkey(value) => value.user_name.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn account(&self) -> String {
        match &self.record.data {
            nook_core::SecretValue::Authenticator(value) => value.account.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = passkeyUserDisplayName)]
    pub fn passkey_user_display_name(&self) -> String {
        match &self.record.data {
            nook_core::SecretValue::Passkey(value) => value.user_display_name.clone(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = totpSecret)]
    pub fn totp_secret(&self) -> String {
        match &self.record.data {
            nook_core::SecretValue::Authenticator(value) => value.secret.as_str().to_owned(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn algorithm(&self) -> String {
        match &self.record.data {
            nook_core::SecretValue::Authenticator(value) => value.algorithm.as_str().to_owned(),
            _ => String::new(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn digits(&self) -> u32 {
        match &self.record.data {
            nook_core::SecretValue::Authenticator(value) => value.digits.get(),
            _ => 0,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn period(&self) -> u32 {
        match &self.record.data {
            nook_core::SecretValue::Authenticator(value) => {
                u32::try_from(value.period.get()).unwrap_or(u32::MAX)
            }
            _ => 0,
        }
    }

    #[wasm_bindgen(getter, js_name = backupCodes)]
    pub fn backup_codes(&self) -> Vec<String> {
        match &self.record.data {
            nook_core::SecretValue::Authenticator(value) => value.backup_codes.clone(),
            _ => Vec::new(),
        }
    }
}

/// Serialize validated form fields into the YAML payload expected by `add_secret`.
fn build_secret_yaml_inner(fields: &NookSecretFormFields) -> Result<String, NookError> {
    Ok(nook_core::build_secret_yaml_from_form(&fields.inner)?
        .as_str()
        .to_owned())
}

#[wasm_bindgen(js_name = buildSecretYaml)]
pub fn build_secret_yaml(fields: &NookSecretFormFields) -> Result<String, wasm_bindgen::JsError> {
    build_secret_yaml_inner(fields).map_err(Into::into)
}

#[wasm_bindgen(js_name = authenticatorSetupKeyChanged)]
pub fn authenticator_setup_key_changed(
    stored_key: &str,
    candidate_key: &str,
) -> Result<bool, wasm_bindgen::JsError> {
    nook_core::authenticator_setup_key_changed(stored_key, candidate_key)
        .map_err(NookError::from)
        .map_err(Into::into)
}

#[wasm_bindgen(js_name = previewOtpauthUri)]
pub fn preview_otpauth_uri(uri: &str) -> Result<types::NookOtpauthPreview, wasm_bindgen::JsError> {
    nook_core::AuthenticatorSecret::preview_otpauth_uri(uri)
        .map(types::NookOtpauthPreview::from_core)
        .map_err(NookError::from)
        .map_err(Into::into)
}

#[wasm_bindgen(js_name = normalizeBackupCodes)]
#[allow(clippy::needless_pass_by_value)]
pub fn normalize_backup_codes(codes: Vec<String>) -> Result<Vec<String>, wasm_bindgen::JsError> {
    // Owned `Vec<String>` is required by the wasm-bindgen JS array boundary.
    nook_core::normalize_backup_codes(&codes)
        .map_err(NookError::from)
        .map_err(Into::into)
}

#[wasm_bindgen(js_name = applyBackupCodes)]
#[allow(clippy::needless_pass_by_value)]
pub fn apply_backup_codes(
    existing: Vec<String>,
    incoming: Vec<String>,
    mode: &str,
) -> Result<Vec<String>, wasm_bindgen::JsError> {
    // Owned `Vec<String>` is required by the wasm-bindgen JS array boundary.
    let mode = nook_core::BackupCodeAttachMode::parse(mode).map_err(NookError::from)?;
    nook_core::apply_backup_codes(&existing, &incoming, mode)
        .map_err(NookError::from)
        .map_err(Into::into)
}

#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn provider_storage_modes_round_trip_in_wasm() {
        assert_eq!(
            wasm_storage_mode_for_provider(
                nook_core::StorageProviderType::OauthFile,
                Some(nook_core::OauthFilePreset::GoogleDrive),
            )
            .expect("google-drive storage mode"),
            "google-drive"
        );
        assert_eq!(
            wasm_storage_mode_for_provider(
                nook_core::StorageProviderType::OauthFile,
                Some(nook_core::OauthFilePreset::ICloud),
            )
            .expect("icloud storage mode"),
            "icloud"
        );
    }

    #[wasm_bindgen_test]
    fn totp_helpers_match_core_authenticator_for_fixture_seed() {
        let secret = "JBSWY3DPEHPK3PXP";
        let unix_seconds = 1_721_520_000_u64;
        let code = generate_totp_code(secret, unix_seconds).expect("totp code");
        assert_eq!(code.len(), 6);
        assert!(code.bytes().all(|b| b.is_ascii_digit()));
        assert!(verify_totp_code(secret, &code, unix_seconds).expect("verify"));
        assert!(!verify_totp_code(secret, "000000", unix_seconds).expect("reject"));
    }

    #[wasm_bindgen_test]
    fn authentication_workflow_snapshot_preserves_core_policy() {
        let observation = NookAuthenticationPageObservation::new(1, 1, 0, 0, 0);
        let mut observations = NookAuthenticationPageObservations::new();
        observations.add(&observation);
        let snapshot = authentication_workflow_snapshot(&observations).expect("login workflow");

        assert_eq!(snapshot.kind_name(), "login");
        assert_eq!(snapshot.stage_name(), "credentials");
        assert_eq!(snapshot.action_name(), "continue-with-nook");
        assert_eq!(snapshot.current_step(), 1);
        assert_eq!(snapshot.total_steps(), 3);
        assert!(snapshot.requires_human_approval());
        assert_eq!(snapshot.observation_index(), 0);
    }

    #[wasm_bindgen_test]
    fn classify_authentication_outcome_preserves_core_policy() {
        let navigation_only =
            NookAuthenticationOutcomeObservation::new(true, false, false, false, false, false, 500);
        let navigation = classify_authentication_outcome(&navigation_only, None);
        assert_eq!(navigation.name(), "insufficient");
        assert!(!navigation.allows_credential_commit());

        let success =
            NookAuthenticationOutcomeObservation::new(true, false, true, false, false, false, 300);
        let sufficient = classify_authentication_outcome(&success, None);
        assert_eq!(sufficient.name(), "sufficient");
        assert!(sufficient.allows_credential_commit());

        let conflict =
            NookAuthenticationOutcomeObservation::new(false, true, true, true, false, false, 100);
        assert_eq!(
            classify_authentication_outcome(&conflict, None).name(),
            "conflicting"
        );
    }

    #[wasm_bindgen_test]
    fn list_item_exports_metadata_without_secret_accessors() {
        let item = NookSecretListItem::from_core(
            nook_core::SecretListItem {
                id: nook_core::SecretId::from_vault_record("secret_login"),
                data: nook_core::SecretListItemData::Login {
                    website_url: "https://example.com".to_owned(),
                    username: "alice".to_owned(),
                },
            },
            "example.com".to_owned(),
        );

        assert_eq!(item.id(), "secret_login");
        assert_eq!(item.secret_type(), "login");
        assert_eq!(item.website_url(), "https://example.com");
        assert_eq!(item.website_host(), "example.com");
        assert_eq!(item.username(), "alice");
        assert_eq!(item.summary(), "alice");
    }

    #[wasm_bindgen_test]
    fn passkey_list_item_exports_only_rp_and_account_metadata() {
        let item = NookSecretListItem::from_core(
            nook_core::SecretListItem {
                id: nook_core::SecretId::from_vault_record("secret_passkey"),
                data: nook_core::SecretListItemData::Passkey {
                    rp_id: "login.example.com".to_owned(),
                    user_name: "alice@example.com".to_owned(),
                    user_display_name: "Alice".to_owned(),
                },
            },
            "login.example.com".to_owned(),
        );

        assert_eq!(item.secret_type(), "passkey");
        assert_eq!(item.rp_id(), "login.example.com");
        assert_eq!(item.passkey_user_name(), "alice@example.com");
        assert_eq!(item.passkey_user_display_name(), "Alice");
    }

    #[wasm_bindgen_test]
    fn issuer_host_map_loads_under_wasm() {
        assert_eq!(
            nook_core::mapped_host_for_issuer("OpenAI"),
            Some("openai.com")
        );
        assert_eq!(
            nook_core::resolve_authenticator_website_host("", "GitHub"),
            Some("github.com".to_owned())
        );
        assert_eq!(
            nook_core::authenticator_group_key("", "Namecheap"),
            "namecheap.com"
        );
    }

    #[wasm_bindgen_test]
    fn page_resolves_brand_authenticator_onto_site_host() {
        let mut page = NookSecretPage::from_core(nook_core::SecretPage {
            records: vec![
                nook_core::SecretListItem {
                    id: nook_core::SecretId::from_vault_record("secret_login"),
                    data: nook_core::SecretListItemData::Login {
                        website_url: "https://namecheap.com".to_owned(),
                        username: "bynull".to_owned(),
                    },
                },
                nook_core::SecretListItem {
                    id: nook_core::SecretId::from_vault_record("secret_totp"),
                    data: nook_core::SecretListItemData::Authenticator {
                        issuer: "Namecheap".to_owned(),
                        account: "bynull".to_owned(),
                        website_url: String::new(),
                        backup_code_count: 0,
                    },
                },
            ],
            total: 2,
            offset: 0,
            limit: 50,
        })
        .expect("metadata page");

        let items = page.take_items();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].group_key(), "namecheap.com");
        assert_eq!(items[1].group_key(), "namecheap.com");
    }

    #[wasm_bindgen_test]
    fn page_transfers_metadata_items_only_once() {
        let mut page = NookSecretPage::from_core(nook_core::SecretPage {
            records: vec![nook_core::SecretListItem {
                id: nook_core::SecretId::from_vault_record("secret_note"),
                data: nook_core::SecretListItemData::SecureNote {
                    title: "Recovery".to_owned(),
                },
            }],
            total: 1,
            offset: 0,
            limit: 50,
        })
        .expect("metadata page");

        let items = page.take_items();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title(), "Recovery");
        assert!(page.take_items().is_empty());
    }
}

#[cfg(test)]
mod tests {
    use super::is_google_drive_shared_grant_request;

    #[test]
    fn legacy_empty_oauth_preset_is_a_google_drive_grant() {
        assert!(is_google_drive_shared_grant_request("oauth-file", None));
        assert!(is_google_drive_shared_grant_request("oauth-file", Some("")));
        assert!(is_google_drive_shared_grant_request(
            "oauth-file",
            Some("google-drive")
        ));
        assert!(!is_google_drive_shared_grant_request(
            "oauth-file",
            Some("icloud")
        ));
    }
}
