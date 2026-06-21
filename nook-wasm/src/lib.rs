#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::uninlined_format_args,
    clippy::must_use_candidate,
    clippy::new_without_default,
    clippy::collapsible_str_replace
)]

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};

#[derive(thiserror::Error, Debug)]
pub enum NookError {
    #[error("IndexedDB error: {0}")]
    IndexedDb(String),

    #[error("GitHub error: {0}")]
    GitHub(String),

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

#[wasm_bindgen]
pub struct NookSecretRecord {
    key: String,
    value: String,
}

#[wasm_bindgen]
impl NookSecretRecord {
    #[wasm_bindgen(constructor)]
    pub fn new(key: String, value: String) -> Self {
        Self { key, value }
    }

    #[wasm_bindgen(getter)]
    pub fn key(&self) -> String {
        self.key.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn value(&self) -> String {
        self.value.clone()
    }
}

#[wasm_bindgen]
pub struct WasmWorkspaceProject {
    name: String,
    purpose: String,
    language: String,
}

#[wasm_bindgen]
impl WasmWorkspaceProject {
    #[wasm_bindgen(getter)]
    pub fn name(&self) -> String {
        self.name.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn purpose(&self) -> String {
        self.purpose.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn language(&self) -> String {
        self.language.clone()
    }
}

#[wasm_bindgen(js_name = projectSummary)]
#[must_use]
pub fn project_summary() -> String {
    nook_core::project_summary()
}

#[wasm_bindgen(js_name = workspaceProjects)]
#[must_use]
pub fn workspace_projects() -> js_sys::Array {
    let list = nook_core::workspace_projects();
    let array = js_sys::Array::new();
    for p in list {
        let wasm_proj = WasmWorkspaceProject {
            name: p.name.to_owned(),
            purpose: p.purpose.to_owned(),
            language: p.language.to_owned(),
        };
        array.push(&JsValue::from(wasm_proj));
    }
    array
}

// Session state of our secret vault
#[wasm_bindgen]
pub struct NookVaultManager {
    storage_mode: String,
    github_pat: String,
    github_repo: String,
    github_path: String,
    passphrase: String,
    decrypted_jsonl: String,
    file_sha: Option<String>,
    status_tx: flume::Sender<String>,
    status_rx: flume::Receiver<String>,
}

#[wasm_bindgen]
impl NookVaultManager {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        let (status_tx, status_rx) = flume::unbounded();
        Self {
            storage_mode: String::new(),
            github_pat: String::new(),
            github_repo: String::new(),
            github_path: String::new(),
            passphrase: String::new(),
            decrypted_jsonl: String::new(),
            file_sha: None,
            status_tx,
            status_rx,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn storage_mode(&self) -> String {
        self.storage_mode.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn decrypted_jsonl(&self) -> String {
        self.decrypted_jsonl.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn file_sha(&self) -> Option<String> {
        self.file_sha.clone()
    }

    // Expose status channel stream to Svelte client
    pub async fn next_status(&self) -> Result<String, JsError> {
        let msg = self
            .status_rx
            .recv_async()
            .await
            .map_err(|e| NookError::Channel(format!("Receive error: {}", e)))?;
        Ok(msg)
    }

    // Connects to storage (loads, decrypts, and updates session state)
    // Returns js_sys::Array of NookSecretRecord on success
    pub async fn connect(
        &mut self,
        storage_mode: String,
        passphrase: String,
        github_pat: String,
        github_repo: String,
        github_path: String,
    ) -> Result<js_sys::Array, JsError> {
        let _ = self.status_tx.send("CONNECT_START".to_owned());
        self.storage_mode = storage_mode;
        self.passphrase = passphrase;
        self.github_pat = github_pat;
        self.github_repo = github_repo;
        self.github_path = github_path;
        self.file_sha = None;

        let encrypted_hex = if self.storage_mode == "local" {
            let _ = self.status_tx.send("IDB_LOAD_START".to_owned());
            let hex = load_from_indexed_db().await?;
            let _ = self.status_tx.send("IDB_LOAD_SUCCESS".to_owned());
            hex.unwrap_or_default()
        } else {
            let _ = self.status_tx.send("GITHUB_FETCH_START".to_owned());
            let res =
                fetch_github_file(&self.github_pat, &self.github_repo, &self.github_path).await?;
            let _ = self.status_tx.send("GITHUB_FETCH_SUCCESS".to_owned());
            match res {
                Some((hex, sha)) => {
                    self.file_sha = Some(sha);
                    hex
                }
                None => String::new(),
            }
        };

        if encrypted_hex.is_empty() {
            self.decrypted_jsonl = String::new();
        } else {
            let _ = self.status_tx.send("DECRYPT_START".to_owned());
            self.decrypted_jsonl = nook_core::decrypt(&encrypted_hex, &self.passphrase)
                .map_err(NookError::Decryption)?;
            let _ = self.status_tx.send("DECRYPT_SUCCESS".to_owned());
        }

        let _ = self.status_tx.send("READY".to_owned());
        Ok(self.get_records_as_array()?)
    }

    // Initialize an empty database
    pub async fn initialize_empty(&mut self) -> Result<js_sys::Array, JsError> {
        let _ = self.status_tx.send("INITIALIZE_START".to_owned());
        self.decrypted_jsonl = String::new();
        self.save_current_db().await?;
        let _ = self.status_tx.send("READY".to_owned());
        Ok(self.get_records_as_array()?)
    }

    // Add a secret
    pub async fn add_secret(
        &mut self,
        key: String,
        value: String,
    ) -> Result<js_sys::Array, JsError> {
        let _ = self.status_tx.send("ADD_SECRET_START".to_owned());
        let mut db =
            nook_core::Database::from_jsonl(&self.decrypted_jsonl).map_err(NookError::Database)?;
        db.insert(key, value);
        let new_jsonl = db.to_jsonl().map_err(NookError::Database)?;
        self.decrypted_jsonl = new_jsonl;
        self.save_current_db().await?;
        let _ = self.status_tx.send("READY".to_owned());
        Ok(self.get_records_as_array()?)
    }

    // Delete a secret
    pub async fn delete_secret(&mut self, key: String) -> Result<js_sys::Array, JsError> {
        let _ = self.status_tx.send("DELETE_SECRET_START".to_owned());
        let mut db =
            nook_core::Database::from_jsonl(&self.decrypted_jsonl).map_err(NookError::Database)?;
        db.remove(&key);
        let new_jsonl = db.to_jsonl().map_err(NookError::Database)?;
        self.decrypted_jsonl = new_jsonl;
        self.save_current_db().await?;
        let _ = self.status_tx.send("READY".to_owned());
        Ok(self.get_records_as_array()?)
    }

    // Helper: list secrets as array of NookSecretRecord
    fn get_records_as_array(&self) -> Result<js_sys::Array, NookError> {
        let db =
            nook_core::Database::from_jsonl(&self.decrypted_jsonl).map_err(NookError::Database)?;
        let records = db.list();
        let array = js_sys::Array::new();
        for r in records {
            let wasm_record = NookSecretRecord::new(r.key, r.value);
            array.push(&JsValue::from(wasm_record));
        }
        Ok(array)
    }

    // Helper: Save current db to storage
    async fn save_current_db(&mut self) -> Result<(), NookError> {
        let _ = self.status_tx.send("SAVE_START".to_owned());
        let encrypted_hex = nook_core::encrypt(&self.decrypted_jsonl, &self.passphrase)
            .map_err(NookError::Encryption)?;

        if self.storage_mode == "local" {
            let _ = self.status_tx.send("IDB_SAVE_START".to_owned());
            save_to_indexed_db(&encrypted_hex).await?;
            let _ = self.status_tx.send("IDB_SAVE_SUCCESS".to_owned());
        } else {
            let _ = self.status_tx.send("GITHUB_SAVE_START".to_owned());
            let new_sha = write_github_file(
                &self.github_pat,
                &self.github_repo,
                &self.github_path,
                &encrypted_hex,
                self.file_sha.as_deref(),
            )
            .await?;
            self.file_sha = Some(new_sha);
            let _ = self.status_tx.send("GITHUB_SAVE_SUCCESS".to_owned());
        }
        Ok(())
    }
}

// -------------------------------------------------------------
// IndexedDB Storage Functions (via rexie)
// -------------------------------------------------------------

async fn load_from_indexed_db() -> Result<Option<String>, NookError> {
    let rexie = rexie::Rexie::builder("nook_db")
        .version(1)
        .add_object_store(rexie::ObjectStore::new("vault"))
        .build()
        .await
        .map_err(|e| NookError::IndexedDb(format!("IndexedDB build error: {:?}", e)))?;

    let transaction = rexie
        .transaction(&["vault"], rexie::TransactionMode::ReadOnly)
        .map_err(|e| NookError::IndexedDb(format!("Transaction error: {:?}", e)))?;
    let store = transaction
        .store("vault")
        .map_err(|e| NookError::IndexedDb(format!("Store error: {:?}", e)))?;

    let key = serde_wasm_bindgen::to_value("encrypted_db")
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {:?}", e)))?;
    let value = store
        .get(key)
        .await
        .map_err(|e| NookError::IndexedDb(format!("Get error: {:?}", e)))?;

    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Transaction done error: {:?}", e)))?;

    match value {
        None => Ok(None),
        Some(val) => {
            if val.is_undefined() || val.is_null() {
                Ok(None)
            } else {
                let hex: String = serde_wasm_bindgen::from_value(val)
                    .map_err(|e| NookError::IndexedDb(format!("Deserialization error: {:?}", e)))?;
                Ok(Some(hex))
            }
        }
    }
}

async fn save_to_indexed_db(hex: &str) -> Result<(), NookError> {
    let rexie = rexie::Rexie::builder("nook_db")
        .version(1)
        .add_object_store(rexie::ObjectStore::new("vault"))
        .build()
        .await
        .map_err(|e| NookError::IndexedDb(format!("IndexedDB build error: {:?}", e)))?;

    let transaction = rexie
        .transaction(&["vault"], rexie::TransactionMode::ReadWrite)
        .map_err(|e| NookError::IndexedDb(format!("Transaction error: {:?}", e)))?;
    let store = transaction
        .store("vault")
        .map_err(|e| NookError::IndexedDb(format!("Store error: {:?}", e)))?;

    let key = serde_wasm_bindgen::to_value("encrypted_db")
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {:?}", e)))?;
    let value = serde_wasm_bindgen::to_value(hex)
        .map_err(|e| NookError::IndexedDb(format!("Serialization error: {:?}", e)))?;
    store
        .put(&value, Some(&key))
        .await
        .map_err(|e| NookError::IndexedDb(format!("Put error: {:?}", e)))?;

    transaction
        .done()
        .await
        .map_err(|e| NookError::IndexedDb(format!("Transaction done error: {:?}", e)))?;
    Ok(())
}

// -------------------------------------------------------------
// GitHub API Storage Functions (via reqwest Client)
// -------------------------------------------------------------

#[derive(Deserialize)]
struct GitHubFileResponse {
    content: String,
    sha: String,
}

#[derive(Serialize)]
struct GitHubPutBody {
    message: String,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    sha: Option<String>,
}

#[derive(Deserialize)]
struct GitHubPutResponse {
    content: GitHubPutResponseContent,
}

#[derive(Deserialize)]
struct GitHubPutResponseContent {
    sha: String,
}

async fn fetch_github_file(
    pat: &str,
    repo: &str,
    path: &str,
) -> Result<Option<(String, String)>, NookError> {
    let url = format!("https://api.github.com/repos/{}/contents/{}", repo, path);
    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("Authorization", &format!("token {}", pat))
        .header("Accept", "application/vnd.github.v3+json")
        .header("User-Agent", "nook-wasm")
        .send()
        .await?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }

    if !response.status().is_success() {
        return Err(NookError::GitHub(format!(
            "GitHub API responded with status {}",
            response.status()
        )));
    }

    let text = response.text().await?;

    let parsed: GitHubFileResponse = serde_json::from_str(&text)
        .map_err(|e| NookError::Serialization(format!("Failed to parse JSON: {}", e)))?;

    let cleaned_content = parsed
        .content
        .replace('\n', "")
        .replace('\r', "")
        .replace(' ', "");
    let decoded_bytes = base64_decode(&cleaned_content)?;
    let hex_content = hex::encode(decoded_bytes);

    Ok(Some((hex_content, parsed.sha)))
}

async fn write_github_file(
    pat: &str,
    repo: &str,
    path: &str,
    content_hex: &str,
    sha: Option<&str>,
) -> Result<String, NookError> {
    use base64::{Engine as _, engine::general_purpose};

    let bin_bytes = hex::decode(content_hex)
        .map_err(|e| NookError::Serialization(format!("Invalid hex format: {}", e)))?;

    let base64_content = general_purpose::STANDARD.encode(bin_bytes);

    let body = GitHubPutBody {
        message: "Update secrets store via Nook WASM".to_owned(),
        content: base64_content,
        sha: sha.map(String::from),
    };

    let body_str = serde_json::to_string(&body)
        .map_err(|e| NookError::Serialization(format!("Failed to serialize body: {}", e)))?;

    let url = format!("https://api.github.com/repos/{}/contents/{}", repo, path);
    let client = reqwest::Client::new();
    let response = client
        .put(&url)
        .header("Authorization", &format!("token {}", pat))
        .header("Accept", "application/vnd.github.v3+json")
        .header("User-Agent", "nook-wasm")
        .header("Content-Type", "application/json")
        .body(body_str)
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(NookError::GitHub(format!(
            "GitHub API responded with status {}",
            response.status()
        )));
    }

    let text = response.text().await?;

    let parsed: GitHubPutResponse = serde_json::from_str(&text)
        .map_err(|e| NookError::Serialization(format!("Failed to parse JSON: {}", e)))?;

    Ok(parsed.content.sha)
}

fn base64_decode(input: &str) -> Result<Vec<u8>, NookError> {
    use base64::{Engine as _, engine::general_purpose};
    general_purpose::STANDARD
        .decode(input)
        .map_err(|e| NookError::Serialization(format!("Base64 decode error: {}", e)))
}
