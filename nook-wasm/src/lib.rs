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
mod manager;
mod storage;
mod sync_io;

pub use manager::NookVaultManager;
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(thiserror::Error, Debug)]
pub enum NookError {
    #[error("IndexedDB error: {0}")]
    IndexedDb(String),

    #[error("GitHub error: {0}")]
    GitHub(String),

    #[error("Drive error: {0}")]
    Drive(String),

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
        Err(message) => Err(wasm_bindgen::JsError::new(&message)),
    }
}

#[wasm_bindgen(js_name = readVaultVersion)]
#[must_use]
pub fn read_vault_version(yaml: &str) -> u64 {
    nook_core::read_vault_version(yaml).unwrap_or(0)
}

#[wasm_bindgen]
pub struct NookSecretRecord {
    id: String,
    secret_type: String,
    data: String,
}

#[wasm_bindgen]
impl NookSecretRecord {
    #[wasm_bindgen(constructor)]
    pub fn new(id: String, secret_type: String, data: String) -> Self {
        Self {
            id,
            secret_type,
            data,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn id(&self) -> String {
        self.id.clone()
    }

    #[wasm_bindgen(getter, js_name = "type")]
    pub fn secret_type(&self) -> String {
        self.secret_type.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn data(&self) -> String {
        self.data.clone()
    }
}
