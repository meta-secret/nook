//! Session-independent vault blob read/write for multi-provider sync.
//!
//! These helpers fetch or write the encrypted vault YAML without mutating
//! `NookVaultManager` session state — the web layer uses them together with
//! `compare_vault_sync` to reconcile local vs remote copies.

use crate::NookError;
use crate::storage::drive::{
    ensure_drive_vault_file, fetch_drive_vault, verify_drive_access, write_drive_vault_with_retry,
};
use crate::storage::github::{
    ensure_github_repo_exists, fetch_github_username, fetch_github_vault,
    write_github_text_file_with_retry,
};
use crate::storage::indexed_db::{load_from_indexed_db, save_to_indexed_db};
use serde::Serialize;
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
struct RemoteVaultFetchResult {
    content: String,
    revision: Option<String>,
    missing: bool,
}

#[wasm_bindgen(js_name = readLocalVaultYaml)]
pub async fn read_local_vault_yaml() -> Result<String, JsError> {
    Ok(load_from_indexed_db()
        .await
        .map_err(|e| JsError::new(&e.to_string()))?
        .unwrap_or_default())
}

#[wasm_bindgen(js_name = writeLocalVaultYaml)]
pub async fn write_local_vault_yaml(content: String) -> Result<(), JsError> {
    save_to_indexed_db(&content)
        .await
        .map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen(js_name = fetchRemoteVaultYaml)]
pub async fn fetch_remote_vault_yaml(
    storage_mode: String,
    github_pat: String,
    github_repo: String,
) -> Result<JsValue, JsError> {
    let mode = nook_core::StorageMode::parse(&storage_mode).map_err(NookError::Database)?;
    let mut github_root_empty = false;

    let (content, revision, missing) = match mode {
        nook_core::StorageMode::Local => {
            let local = load_from_indexed_db().await?.unwrap_or_default();
            (local, None, false)
        }
        nook_core::StorageMode::Github => {
            let pat = nook_core::validate_github_pat(&github_pat).map_err(NookError::GitHub)?;
            let repo_name =
                nook_core::validate_github_repo_name(&github_repo).map_err(NookError::Database)?;
            let username = fetch_github_username(&pat).await?;
            let repo = format!("{username}/{repo_name}");
            ensure_github_repo_exists(&pat, &repo).await?;
            let path = "nook-vault.yaml".to_owned();
            match fetch_github_vault(&pat, &repo, &path, Some(&mut github_root_empty)).await? {
                Some(file) => (file.content, Some(file.sha), false),
                None => (String::new(), None, true),
            }
        }
        nook_core::StorageMode::GoogleDrive => {
            let token =
                nook_core::validate_oauth_access_token(&github_pat).map_err(NookError::Drive)?;
            verify_drive_access(&token).await?;
            let (known_file_id, raw_file_name) = nook_core::parse_drive_storage_ref(&github_repo);
            let file_name = nook_core::validate_drive_vault_file_name(&raw_file_name)
                .map_err(NookError::Database)?;
            let file_id = ensure_drive_vault_file(&token, &known_file_id, &file_name).await?;
            match fetch_drive_vault(&token, &file_id, &file_name).await? {
                Some(file) => (file.content, Some(file.revision), false),
                None => (String::new(), None, true),
            }
        }
    };

    serde_wasm_bindgen::to_value(&RemoteVaultFetchResult {
        content,
        revision,
        missing,
    })
    .map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen(js_name = writeRemoteVaultYaml)]
pub async fn write_remote_vault_yaml(
    storage_mode: String,
    github_pat: String,
    github_repo: String,
    content: String,
    revision: Option<String>,
) -> Result<String, JsError> {
    let mode = nook_core::StorageMode::parse(&storage_mode).map_err(NookError::Database)?;

    match mode {
        nook_core::StorageMode::Local => {
            save_to_indexed_db(&content).await?;
            Ok(String::new())
        }
        nook_core::StorageMode::Github => {
            let pat = nook_core::validate_github_pat(&github_pat).map_err(NookError::GitHub)?;
            let repo_name =
                nook_core::validate_github_repo_name(&github_repo).map_err(NookError::Database)?;
            let username = fetch_github_username(&pat).await?;
            let repo = format!("{username}/{repo_name}");
            ensure_github_repo_exists(&pat, &repo).await?;
            let path = "nook-vault.yaml".to_owned();
            let sha =
                write_github_text_file_with_retry(&pat, &repo, &path, &content, revision).await?;
            Ok(sha)
        }
        nook_core::StorageMode::GoogleDrive => {
            let token =
                nook_core::validate_oauth_access_token(&github_pat).map_err(NookError::Drive)?;
            verify_drive_access(&token).await?;
            let (known_file_id, raw_file_name) = nook_core::parse_drive_storage_ref(&github_repo);
            let file_name = nook_core::validate_drive_vault_file_name(&raw_file_name)
                .map_err(NookError::Database)?;
            let file_id = ensure_drive_vault_file(&token, &known_file_id, &file_name).await?;
            let (new_file_id, new_revision) =
                write_drive_vault_with_retry(&token, &file_id, &file_name, &content, revision)
                    .await?;
            let _ = new_file_id;
            Ok(new_revision)
        }
    }
    .map_err(|e: NookError| JsError::new(&e.to_string()))
}
