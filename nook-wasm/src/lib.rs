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

mod conversion;
mod error_mapping;
mod logger;
mod manager;
mod storage;
mod sync_io;
mod types;

pub use manager::NookVaultManager;
pub use types::{
    NookDecryptedEnrollmentPayload, NookEnrollmentIssueInput, NookEnrollmentProvider,
    NookJoinRequest, NookPasskeySetup, NookPasskeyUnlockOptions, NookPasswordEntrySummary,
    NookReplacementConflict, NookSecretFormFields, NookSecurityConflict, NookSyncProviderTarget,
    NookVaultMember, NookVaultSyncResult,
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

#[wasm_bindgen]
#[must_use]
pub fn get_translation_catalog(locale: &str) -> String {
    nook_core::get_translation_catalog(locale).to_owned()
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

#[wasm_bindgen(js_name = syncProviderTargetKey)]
#[must_use]
pub fn sync_provider_target_key(target: &NookSyncProviderTarget) -> Option<String> {
    nook_core::sync_provider_target_key(target.as_core())
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
    Ok(NookDecryptedEnrollmentPayload::from_core(
        nook_core::decrypt_enrollment_payload(code, password)?,
    ))
}

#[wasm_bindgen(js_name = peekEnrollmentEntryId)]
#[must_use]
pub fn peek_enrollment_entry_id(code: &str) -> Option<String> {
    nook_core::peek_enrollment_entry_id(code)
}

#[wasm_bindgen(js_name = peekEnrollmentEntryLabel)]
#[must_use]
pub fn peek_enrollment_entry_label(code: &str) -> Option<String> {
    nook_core::peek_enrollment_entry_label(code)
}

#[wasm_bindgen(js_name = peekEnrollmentIssuedAt)]
#[must_use]
pub fn peek_enrollment_issued_at(code: &str) -> Option<String> {
    nook_core::peek_enrollment_issued_at(code)
}

/// Load the persisted sync-provider snapshot from the `nook_auth` `IndexedDB`
/// database, running the full non-network pipeline in Rust: normalize, unseal
/// credential fields with the device key, seed from legacy `localStorage`,
/// backfill provider fields, and re-persist (sealed) when anything changed.
///
/// Returns `{ snapshot, legacyActiveProviderId, changed }`; `snapshot` carries
/// decrypted credentials for in-memory sync use, and `legacyActiveProviderId`
/// drives the one-time remote-vault copy that still lives in the web layer.
/// Serialize with `None` mapped to JS `null` (not `undefined`) so optional
/// fields without `skip_serializing_if` (e.g. `legacyActiveProviderId`) keep the
/// nullable contract the web layer expects.
fn to_js_nullable<T: serde::Serialize>(value: &T) -> Result<JsValue, serde_wasm_bindgen::Error> {
    value.serialize(&serde_wasm_bindgen::Serializer::new().serialize_missing_as_null(true))
}

#[wasm_bindgen(js_name = loadAuthProviders)]
pub async fn load_auth_providers(
    manager: &NookVaultManager,
) -> Result<JsValue, wasm_bindgen::JsError> {
    let identity = manager.device_identity()?;
    let normalized = crate::storage::auth_providers::load_auth_providers(&identity).await?;
    Ok(to_js_nullable(&normalized)?)
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

/// Delete the `nook_auth` `IndexedDB` database (used on full sign-out / reset).
#[wasm_bindgen(js_name = deleteAuthProvidersDb)]
pub async fn delete_auth_providers_db() -> Result<(), wasm_bindgen::JsError> {
    crate::storage::auth_providers::delete_auth_providers_db().await?;
    Ok(())
}

/// Strip the deprecated `activeProviderId` field from a raw persisted snapshot,
/// returning `{ snapshot, legacyActiveProviderId, changed }`.
#[wasm_bindgen(js_name = normalizeAuthSnapshot)]
pub fn normalize_auth_snapshot(raw: JsValue) -> Result<JsValue, wasm_bindgen::JsError> {
    let value: serde_json::Value = if raw.is_undefined() || raw.is_null() {
        serde_json::Value::Null
    } else {
        serde_wasm_bindgen::from_value(raw)?
    };
    let normalized = nook_core::normalize_auth_snapshot(&value);
    Ok(to_js_nullable(&normalized)?)
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

#[wasm_bindgen(js_name = hasLocalVault)]
pub async fn has_local_vault() -> Result<bool, wasm_bindgen::JsError> {
    Ok(crate::storage::indexed_db::has_local_vault().await?)
}

#[wasm_bindgen(js_name = hasActiveLocalVault)]
pub async fn has_active_local_vault() -> Result<bool, wasm_bindgen::JsError> {
    Ok(crate::storage::indexed_db::has_active_local_vault().await?)
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

    #[wasm_bindgen(getter, js_name = lastUnlockedAt)]
    pub fn last_unlocked_at(&self) -> Option<String> {
        self.last_unlocked_at
            .as_ref()
            .map(nook_core::IsoTimestamp::to_string)
    }
}

#[wasm_bindgen(js_name = listLocalVaults)]
pub async fn list_local_vaults() -> Result<Vec<NookLocalVaultEntry>, wasm_bindgen::JsError> {
    Ok(crate::storage::indexed_db::list_vault_registry_entries()
        .await?
        .into_iter()
        .map(|entry| NookLocalVaultEntry {
            store_id: entry.store_id,
            label: entry.label,
            last_unlocked_at: entry.last_unlocked_at,
        })
        .collect())
}

#[wasm_bindgen(js_name = getActiveVaultId)]
pub async fn get_active_vault_id() -> Result<Option<String>, wasm_bindgen::JsError> {
    Ok(crate::storage::indexed_db::get_active_vault_id().await?)
}

#[wasm_bindgen(js_name = setActiveVault)]
pub async fn set_active_vault(store_id: String) -> Result<(), wasm_bindgen::JsError> {
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
