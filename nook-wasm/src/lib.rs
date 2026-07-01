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
mod manager;
mod storage;
mod sync_io;
mod types;

pub use manager::NookVaultManager;
pub use types::{
    NookDecryptedEnrollmentPayload, NookEnrollmentIssueInput, NookEnrollmentProvider,
    NookJoinRequest, NookPasswordEntrySummary, NookReconcileVaultBlobsResult, NookRemoteVaultFetch,
    NookReplacementConflict, NookResolveConflictKeepLocalResult,
    NookResolveConflictKeepRemoteResult, NookSecretFormFields, NookSyncProviderTarget,
    NookVaultMember, NookVaultSyncResult,
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

#[wasm_bindgen(js_name = generateId)]
pub fn generate_id() -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::generate_id()?.to_string())
}

#[wasm_bindgen(js_name = generateSecretId)]
pub fn generate_secret_id() -> Result<String, wasm_bindgen::JsError> {
    Ok(nook_core::generate_secret_id()?.to_string())
}

#[wasm_bindgen(js_name = defaultGithubRepo)]
#[must_use]
pub fn default_github_repo() -> String {
    nook_core::DEFAULT_GITHUB_REPO_NAME.to_owned()
}

#[wasm_bindgen(js_name = defaultDriveVaultFile)]
#[must_use]
pub fn default_drive_vault_file() -> String {
    nook_core::DEFAULT_DRIVE_VAULT_FILE_NAME.to_owned()
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

#[wasm_bindgen(js_name = hasLocalVault)]
pub async fn has_local_vault() -> Result<bool, wasm_bindgen::JsError> {
    Ok(crate::storage::indexed_db::has_local_vault().await?)
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
