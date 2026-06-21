#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::uninlined_format_args,
    clippy::must_use_candidate,
    clippy::new_without_default,
    clippy::collapsible_str_replace
)]

use serde::{Deserialize, Serialize};
use wasm_bindgen::JsCast;
use wasm_bindgen::JsValue;

use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen_futures::JsFuture;
use web_sys::{Request, RequestInit, RequestMode, Response};

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
}

#[wasm_bindgen]
impl NookVaultManager {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            storage_mode: String::new(),
            github_pat: String::new(),
            github_repo: String::new(),
            github_path: String::new(),
            passphrase: String::new(),
            decrypted_jsonl: String::new(),
            file_sha: None,
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

    // Connects to storage (loads, decrypts, and updates session state)
    // Returns js_sys::Array of NookSecretRecord on success
    pub async fn connect(
        &mut self,
        storage_mode: String,
        passphrase: String,
        github_pat: String,
        github_repo: String,
        github_path: String,
    ) -> Result<js_sys::Array, JsValue> {
        self.storage_mode = storage_mode;
        self.passphrase = passphrase;
        self.github_pat = github_pat;
        self.github_repo = github_repo;
        self.github_path = github_path;
        self.file_sha = None;

        let encrypted_hex = if self.storage_mode == "local" {
            match load_from_indexed_db().await {
                Ok(Some(hex)) => hex,
                Ok(None) => String::new(),
                Err(e) => return Err(JsValue::from_str(&format!("IndexedDB load error: {}", e))),
            }
        } else {
            match fetch_github_file(&self.github_pat, &self.github_repo, &self.github_path).await {
                Ok(Some((hex, sha))) => {
                    self.file_sha = Some(sha);
                    hex
                }
                Ok(None) => String::new(),
                Err(e) => return Err(JsValue::from_str(&format!("GitHub load error: {}", e))),
            }
        };

        if encrypted_hex.is_empty() {
            self.decrypted_jsonl = String::new();
        } else {
            self.decrypted_jsonl = nook_core::decrypt(&encrypted_hex, &self.passphrase)
                .map_err(|e| JsValue::from_str(&format!("Decryption failed: {}", e)))?;
        }

        self.get_records_as_array()
    }

    // Initialize an empty database
    pub async fn initialize_empty(&mut self) -> Result<js_sys::Array, JsValue> {
        self.decrypted_jsonl = String::new();
        self.save_current_db().await?;
        self.get_records_as_array()
    }

    // Add a secret
    pub async fn add_secret(
        &mut self,
        key: String,
        value: String,
    ) -> Result<js_sys::Array, JsValue> {
        let mut db = nook_core::Database::from_jsonl(&self.decrypted_jsonl)
            .map_err(|e| JsValue::from_str(&e))?;
        db.insert(key, value);
        let new_jsonl = db.to_jsonl().map_err(|e| JsValue::from_str(&e))?;
        self.decrypted_jsonl = new_jsonl;
        self.save_current_db().await?;
        self.get_records_as_array()
    }

    // Delete a secret
    pub async fn delete_secret(&mut self, key: String) -> Result<js_sys::Array, JsValue> {
        let mut db = nook_core::Database::from_jsonl(&self.decrypted_jsonl)
            .map_err(|e| JsValue::from_str(&e))?;
        db.remove(&key);
        let new_jsonl = db.to_jsonl().map_err(|e| JsValue::from_str(&e))?;
        self.decrypted_jsonl = new_jsonl;
        self.save_current_db().await?;
        self.get_records_as_array()
    }

    // Helper: list secrets as array of NookSecretRecord
    fn get_records_as_array(&self) -> Result<js_sys::Array, JsValue> {
        let db = nook_core::Database::from_jsonl(&self.decrypted_jsonl)
            .map_err(|e| JsValue::from_str(&e))?;
        let records = db.list();
        let array = js_sys::Array::new();
        for r in records {
            let wasm_record = NookSecretRecord::new(r.key, r.value);
            array.push(&JsValue::from(wasm_record));
        }
        Ok(array)
    }

    // Helper: Save current db to storage
    async fn save_current_db(&mut self) -> Result<(), JsValue> {
        let encrypted_hex = nook_core::encrypt(&self.decrypted_jsonl, &self.passphrase)
            .map_err(|e| JsValue::from_str(&format!("Encryption failed: {}", e)))?;

        if self.storage_mode == "local" {
            save_to_indexed_db(&encrypted_hex)
                .await
                .map_err(|e| JsValue::from_str(&format!("IndexedDB save error: {}", e)))?;
        } else {
            let new_sha = write_github_file(
                &self.github_pat,
                &self.github_repo,
                &self.github_path,
                &encrypted_hex,
                self.file_sha.as_deref(),
            )
            .await
            .map_err(|e| JsValue::from_str(&format!("GitHub save error: {}", e)))?;
            self.file_sha = Some(new_sha);
        }
        Ok(())
    }
}

// -------------------------------------------------------------
// IndexedDB Storage Functions (via rexie)
// -------------------------------------------------------------

async fn load_from_indexed_db() -> Result<Option<String>, String> {
    let rexie = rexie::Rexie::builder("nook_db")
        .version(1)
        .add_object_store(rexie::ObjectStore::new("vault"))
        .build()
        .await
        .map_err(|e| format!("IndexedDB build error: {:?}", e))?;

    let transaction = rexie
        .transaction(&["vault"], rexie::TransactionMode::ReadOnly)
        .map_err(|e| format!("Transaction error: {:?}", e))?;
    let store = transaction
        .store("vault")
        .map_err(|e| format!("Store error: {:?}", e))?;

    let key = serde_wasm_bindgen::to_value("encrypted_db")
        .map_err(|e| format!("Serialization error: {:?}", e))?;
    let value = store
        .get(key)
        .await
        .map_err(|e| format!("Get error: {:?}", e))?;

    transaction
        .done()
        .await
        .map_err(|e| format!("Transaction done error: {:?}", e))?;

    match value {
        None => Ok(None),
        Some(val) => {
            if val.is_undefined() || val.is_null() {
                Ok(None)
            } else {
                let hex: String = serde_wasm_bindgen::from_value(val)
                    .map_err(|e| format!("Deserialization error: {:?}", e))?;
                Ok(Some(hex))
            }
        }
    }
}

async fn save_to_indexed_db(hex: &str) -> Result<(), String> {
    let rexie = rexie::Rexie::builder("nook_db")
        .version(1)
        .add_object_store(rexie::ObjectStore::new("vault"))
        .build()
        .await
        .map_err(|e| format!("IndexedDB build error: {:?}", e))?;

    let transaction = rexie
        .transaction(&["vault"], rexie::TransactionMode::ReadWrite)
        .map_err(|e| format!("Transaction error: {:?}", e))?;
    let store = transaction
        .store("vault")
        .map_err(|e| format!("Store error: {:?}", e))?;

    let key = serde_wasm_bindgen::to_value("encrypted_db")
        .map_err(|e| format!("Serialization error: {:?}", e))?;
    let value =
        serde_wasm_bindgen::to_value(hex).map_err(|e| format!("Serialization error: {:?}", e))?;
    store
        .put(&value, Some(&key))
        .await
        .map_err(|e| format!("Put error: {:?}", e))?;

    transaction
        .done()
        .await
        .map_err(|e| format!("Transaction done error: {:?}", e))?;
    Ok(())
}

// -------------------------------------------------------------
// GitHub API Storage Functions (via web_sys Fetch)
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
) -> Result<Option<(String, String)>, String> {
    let opts = RequestInit::new();
    opts.set_method("GET");
    opts.set_mode(RequestMode::Cors);

    let url = format!("https://api.github.com/repos/{}/contents/{}", repo, path);
    let request = Request::new_with_str_and_init(&url, &opts)
        .map_err(|e| format!("Failed to create request: {:?}", e))?;

    let headers = request.headers();
    headers
        .set("Authorization", &format!("token {}", pat))
        .map_err(|e| format!("Headers error: {:?}", e))?;
    headers
        .set("Accept", "application/vnd.github.v3+json")
        .map_err(|e| format!("Headers error: {:?}", e))?;

    let window = web_sys::window().ok_or("No window found")?;
    let resp_value = JsFuture::from(window.fetch_with_request(&request))
        .await
        .map_err(|e| format!("Network request failed: {:?}", e))?;

    let resp: Response = resp_value
        .dyn_into()
        .map_err(|e| format!("Failed to cast response: {:?}", e))?;

    if resp.status() == 404 {
        return Ok(None);
    }

    if !resp.ok() {
        return Err(format!(
            "GitHub API responded with status {}",
            resp.status()
        ));
    }

    let text = JsFuture::from(resp.text().map_err(|e| format!("{:?}", e))?)
        .await
        .map_err(|e| format!("Failed to get text: {:?}", e))?
        .as_string()
        .ok_or("Response is not text")?;

    let parsed: GitHubFileResponse =
        serde_json::from_str(&text).map_err(|e| format!("Failed to parse JSON: {}", e))?;

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
) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose};

    let bin_bytes = hex::decode(content_hex).map_err(|e| format!("Invalid hex format: {}", e))?;

    let base64_content = general_purpose::STANDARD.encode(bin_bytes);

    let body = GitHubPutBody {
        message: "Update secrets store via Nook WASM".to_owned(),
        content: base64_content,
        sha: sha.map(String::from),
    };

    let body_str =
        serde_json::to_string(&body).map_err(|e| format!("Failed to serialize body: {}", e))?;

    let opts = RequestInit::new();
    opts.set_method("PUT");
    opts.set_mode(RequestMode::Cors);
    opts.set_body(&JsValue::from_str(&body_str));

    let url = format!("https://api.github.com/repos/{}/contents/{}", repo, path);
    let request = Request::new_with_str_and_init(&url, &opts)
        .map_err(|e| format!("Failed to create request: {:?}", e))?;

    let headers = request.headers();
    headers
        .set("Authorization", &format!("token {}", pat))
        .map_err(|e| format!("Headers error: {:?}", e))?;
    headers
        .set("Accept", "application/vnd.github.v3+json")
        .map_err(|e| format!("Headers error: {:?}", e))?;
    headers
        .set("Content-Type", "application/json")
        .map_err(|e| format!("Headers error: {:?}", e))?;

    let window = web_sys::window().ok_or("No window found")?;
    let resp_value = JsFuture::from(window.fetch_with_request(&request))
        .await
        .map_err(|e| format!("Network request failed: {:?}", e))?;

    let resp: Response = resp_value
        .dyn_into()
        .map_err(|e| format!("Failed to cast response: {:?}", e))?;

    if !resp.ok() {
        return Err(format!(
            "GitHub API responded with status {}",
            resp.status()
        ));
    }

    let text = JsFuture::from(resp.text().map_err(|e| format!("{:?}", e))?)
        .await
        .map_err(|e| format!("Failed to get text: {:?}", e))?
        .as_string()
        .ok_or("Response is not text")?;

    let parsed: GitHubPutResponse =
        serde_json::from_str(&text).map_err(|e| format!("Failed to parse JSON: {}", e))?;

    Ok(parsed.content.sha)
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    use base64::{Engine as _, engine::general_purpose};
    general_purpose::STANDARD
        .decode(input)
        .map_err(|e| format!("Base64 decode error: {}", e))
}
