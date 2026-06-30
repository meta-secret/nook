//! Session-independent vault blob read/write for multi-provider sync.
//!
//! These helpers fetch or write the encrypted vault YAML without mutating
//! `NookVaultManager` session state — the web layer uses them together with
//! `compare_vault_sync` to reconcile local vs remote copies, and
//! `reconcile_vault_stores` to apply the chosen action in memory before I/O.

use crate::NookError;
use crate::storage::drive::{
    ensure_drive_vault_file, fetch_drive_vault, verify_drive_access, write_drive_vault_with_retry,
};
use crate::storage::github::{
    ensure_github_repo_exists, fetch_github_username, fetch_github_vault,
    write_github_text_file_with_retry,
};
use crate::storage::icloud::{
    ensure_icloud_vault_record, fetch_icloud_vault, verify_icloud_access,
    write_icloud_vault_with_retry,
};
use crate::storage::indexed_db::{load_from_indexed_db, save_to_indexed_db};
use crate::{
    NookReconcileVaultBlobsResult, NookRemoteVaultFetch, NookResolveConflictKeepLocalResult,
    NookResolveConflictKeepRemoteResult,
};
use nook_core::{
    MemoryVaultStore, reconcile_vault_stores, resolve_conflict_keep_local,
    resolve_conflict_keep_remote,
};
use wasm_bindgen::prelude::*;

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

async fn fetch_remote_vault_yaml_inner(
    storage_mode: String,
    github_pat: String,
    github_repo: String,
) -> Result<NookRemoteVaultFetch, NookError> {
    let mode = nook_core::StorageMode::parse(&storage_mode)?;
    let mut github_root_empty = false;

    let (content, revision, missing) = match mode {
        nook_core::StorageMode::Local => {
            let local = load_from_indexed_db().await?.unwrap_or_default();
            (local, None, false)
        }
        nook_core::StorageMode::Github => {
            let pat = nook_core::validate_github_pat(&github_pat)?;
            let repo_name = nook_core::validate_github_repo_name(&github_repo)?;
            let username = fetch_github_username(pat.as_ref()).await?;
            let repo = format!("{username}/{repo_name}");
            ensure_github_repo_exists(pat.as_ref(), &repo).await?;
            let path = "nook-vault.yaml".to_owned();
            match fetch_github_vault(pat.as_ref(), &repo, &path, Some(&mut github_root_empty))
                .await?
            {
                Some(file) => (file.content, Some(file.sha), false),
                None => (String::new(), None, true),
            }
        }
        nook_core::StorageMode::GoogleDrive => {
            let token = nook_core::validate_oauth_access_token(&github_pat)?;
            verify_drive_access(token.as_ref()).await?;
            let (known_file_id, file_name) = nook_core::parse_drive_storage_ref(&github_repo)?;
            let file_id =
                ensure_drive_vault_file(token.as_ref(), &known_file_id, file_name.as_ref()).await?;
            match fetch_drive_vault(token.as_ref(), &file_id, file_name.as_ref()).await? {
                Some(file) => (file.content, Some(file.revision), false),
                None => (String::new(), None, true),
            }
        }
        nook_core::StorageMode::ICloud => {
            let token = nook_core::validate_oauth_access_token(&github_pat)?;
            verify_icloud_access(token.as_ref()).await?;
            let (_known_revision, file_name) = nook_core::parse_drive_storage_ref(&github_repo)?;
            let record_name =
                ensure_icloud_vault_record(token.as_ref(), file_name.as_ref()).await?;
            match fetch_icloud_vault(token.as_ref(), &record_name).await? {
                Some(file) => (file.content, Some(file.revision), false),
                None => (String::new(), None, true),
            }
        }
    };

    Ok(NookRemoteVaultFetch::new(content, revision, missing))
}

#[wasm_bindgen(js_name = fetchRemoteVaultYaml)]
pub async fn fetch_remote_vault_yaml(
    storage_mode: String,
    github_pat: String,
    github_repo: String,
) -> Result<NookRemoteVaultFetch, JsError> {
    fetch_remote_vault_yaml_inner(storage_mode, github_pat, github_repo)
        .await
        .map_err(Into::into)
}

async fn write_remote_vault_yaml_inner(
    storage_mode: String,
    github_pat: String,
    github_repo: String,
    content: String,
    revision: Option<String>,
) -> Result<String, NookError> {
    let mode = nook_core::StorageMode::parse(&storage_mode)?;

    match mode {
        nook_core::StorageMode::Local => {
            save_to_indexed_db(&content).await?;
            Ok(String::new())
        }
        nook_core::StorageMode::Github => {
            let pat = nook_core::validate_github_pat(&github_pat)?;
            let repo_name = nook_core::validate_github_repo_name(&github_repo)?;
            let username = fetch_github_username(pat.as_ref()).await?;
            let repo = format!("{username}/{repo_name}");
            ensure_github_repo_exists(pat.as_ref(), &repo).await?;
            let path = "nook-vault.yaml".to_owned();
            let sha =
                write_github_text_file_with_retry(pat.as_ref(), &repo, &path, &content, revision)
                    .await?;
            Ok(sha)
        }
        nook_core::StorageMode::GoogleDrive => {
            let token = nook_core::validate_oauth_access_token(&github_pat)?;
            verify_drive_access(token.as_ref()).await?;
            let (known_file_id, file_name) = nook_core::parse_drive_storage_ref(&github_repo)?;
            let file_id =
                ensure_drive_vault_file(token.as_ref(), &known_file_id, file_name.as_ref()).await?;
            let (new_file_id, new_revision) = write_drive_vault_with_retry(
                token.as_ref(),
                &file_id,
                file_name.as_ref(),
                &content,
                revision,
            )
            .await?;
            let _ = new_file_id;
            Ok(new_revision)
        }
        nook_core::StorageMode::ICloud => {
            let token = nook_core::validate_oauth_access_token(&github_pat)?;
            verify_icloud_access(token.as_ref()).await?;
            let (_known_revision, file_name) = nook_core::parse_drive_storage_ref(&github_repo)?;
            let record_name =
                ensure_icloud_vault_record(token.as_ref(), file_name.as_ref()).await?;
            let (_resolved_name, new_revision) =
                write_icloud_vault_with_retry(token.as_ref(), &record_name, &content, revision)
                    .await?;
            Ok(new_revision)
        }
    }
}

#[wasm_bindgen(js_name = writeRemoteVaultYaml)]
pub async fn write_remote_vault_yaml(
    storage_mode: String,
    github_pat: String,
    github_repo: String,
    content: String,
    revision: Option<String>,
) -> Result<String, JsError> {
    write_remote_vault_yaml_inner(storage_mode, github_pat, github_repo, content, revision)
        .await
        .map_err(Into::into)
}

fn remote_memory_store(yaml: String, revision: Option<String>) -> MemoryVaultStore {
    let mut store = MemoryVaultStore::with_blob(yaml);
    store.set_revision(revision);
    store
}

/// Compare local vs remote YAML, apply the sync action in memory, return post-reconcile blobs.
#[wasm_bindgen(js_name = reconcileVaultBlobs)]
pub fn reconcile_vault_blobs(
    local_yaml: String,
    remote_yaml: String,
    remote_revision: Option<String>,
) -> Result<NookReconcileVaultBlobsResult, JsError> {
    let mut local = MemoryVaultStore::with_blob(local_yaml);
    let mut remote = remote_memory_store(remote_yaml, remote_revision);
    let action = reconcile_vault_stores(&mut local, &mut remote)
        .map_err(|e| JsError::new(&e.to_string()))?;
    Ok(NookReconcileVaultBlobsResult::new(
        action.label().to_owned(),
        local.blob().to_owned(),
        remote.blob().to_owned(),
        remote.revision().map(str::to_owned),
    ))
}

/// User chose "keep local" — return the remote blob content to write to storage.
#[wasm_bindgen(js_name = resolveVaultConflictKeepLocal)]
pub fn resolve_vault_conflict_keep_local(
    local_yaml: String,
    remote_yaml: String,
    remote_revision: Option<String>,
) -> Result<NookResolveConflictKeepLocalResult, JsError> {
    let local = MemoryVaultStore::with_blob(local_yaml);
    let mut remote = remote_memory_store(remote_yaml, remote_revision);
    resolve_conflict_keep_local(&local, &mut remote);
    Ok(NookResolveConflictKeepLocalResult::new(
        remote.blob().to_owned(),
    ))
}

/// User chose "keep remote" — return the local blob content to write to `IndexedDB`.
#[wasm_bindgen(js_name = resolveVaultConflictKeepRemote)]
pub fn resolve_vault_conflict_keep_remote(
    local_yaml: String,
    remote_yaml: String,
    remote_revision: Option<String>,
) -> Result<NookResolveConflictKeepRemoteResult, JsError> {
    let mut local = MemoryVaultStore::with_blob(local_yaml);
    let remote = remote_memory_store(remote_yaml, remote_revision);
    resolve_conflict_keep_remote(&mut local, &remote);
    Ok(NookResolveConflictKeepRemoteResult::new(
        local.blob().to_owned(),
    ))
}
