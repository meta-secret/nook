//! In-memory vault blob stores for sync orchestration and integration tests.
//!
//! [`MemoryVaultStore`] stands in for local `IndexedDB` or a remote sync provider.
//! [`reconcile_vault_stores`] compares blobs via [`compare_vault_sync`] and applies
//! the resulting action — the same decisions the web UI applies after I/O.

use std::collections::HashMap;

use crate::vault_sync::{VaultSyncAction, compare_vault_sync};

/// A single vault blob plus an optional provider revision token (e.g. GitHub sha).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct MemoryVaultStore {
    blob: String,
    revision: Option<String>,
}

impl MemoryVaultStore {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    #[must_use]
    pub fn with_blob(blob: impl Into<String>) -> Self {
        Self {
            blob: blob.into(),
            revision: None,
        }
    }

    #[must_use]
    pub fn with_blob_and_revision(blob: impl Into<String>, revision: impl Into<String>) -> Self {
        Self {
            blob: blob.into(),
            revision: Some(revision.into()),
        }
    }

    #[must_use]
    pub fn blob(&self) -> &str {
        &self.blob
    }

    #[must_use]
    pub fn revision(&self) -> Option<&str> {
        self.revision.as_deref()
    }

    pub fn set_blob(&mut self, blob: impl Into<String>) {
        self.blob = blob.into();
    }

    pub fn set_revision(&mut self, revision: Option<String>) {
        self.revision = revision;
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.blob.trim().is_empty()
    }
}

/// Compare local vs remote and apply the sync action to the in-memory stores.
///
/// - [`VaultSyncAction::AdoptRemote`] copies remote → local.
/// - [`VaultSyncAction::PushLocal`] copies local → remote and bumps remote revision.
/// - [`VaultSyncAction::Conflict`] leaves both blobs unchanged.
pub fn reconcile_vault_stores(
    local: &mut MemoryVaultStore,
    remote: &mut MemoryVaultStore,
) -> Result<VaultSyncAction, String> {
    let action = compare_vault_sync(local.blob(), remote.blob())?;
    apply_vault_sync_action(action, local, remote);
    Ok(action)
}

/// Sync the canonical local store to every entry in `remotes` (fan-out).
///
/// Providers are reconciled in iteration order; an [`VaultSyncAction::AdoptRemote`]
/// on an earlier provider updates `local` before the next provider runs — matching
/// sequential `syncProviderById` in the web layer.
#[allow(clippy::implicit_hasher)]
pub fn fan_out_sync(
    local: &mut MemoryVaultStore,
    remotes: &mut HashMap<String, MemoryVaultStore>,
) -> Result<Vec<(String, VaultSyncAction)>, String> {
    let mut ids: Vec<String> = remotes.keys().cloned().collect();
    ids.sort();
    let mut results = Vec::with_capacity(ids.len());
    for id in ids {
        let remote = remotes
            .get_mut(&id)
            .ok_or_else(|| format!("sync provider {id} disappeared during fan-out"))?;
        let action = reconcile_vault_stores(local, remote)?;
        results.push((id, action));
    }
    Ok(results)
}

/// After user picks "keep local" in a conflict dialog — push local to remote.
pub fn resolve_conflict_keep_local(local: &MemoryVaultStore, remote: &mut MemoryVaultStore) {
    remote.blob.clone_from(&local.blob);
    remote.revision = Some(next_revision(remote.revision.as_deref()));
}

/// After user picks "keep remote" — adopt remote into local.
pub fn resolve_conflict_keep_remote(local: &mut MemoryVaultStore, remote: &MemoryVaultStore) {
    local.blob.clone_from(&remote.blob);
    local.revision.clone_from(&remote.revision);
}

fn apply_vault_sync_action(
    action: VaultSyncAction,
    local: &mut MemoryVaultStore,
    remote: &mut MemoryVaultStore,
) {
    match action {
        VaultSyncAction::Unchanged | VaultSyncAction::Conflict => {}
        VaultSyncAction::AdoptRemote => {
            local.blob.clone_from(&remote.blob);
            local.revision.clone_from(&remote.revision);
        }
        VaultSyncAction::PushLocal => {
            remote.blob.clone_from(&local.blob);
            remote.revision = Some(next_revision(remote.revision.as_deref()));
        }
    }
}

fn next_revision(current: Option<&str>) -> String {
    let n = current
        .and_then(|s| s.strip_prefix("rev-"))
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0)
        .saturating_add(1);
    format!("rev-{n}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{VaultUnlock, serialize_stored_yaml_with_unlock};

    fn sample_yaml(version: u64, store_id: &str, armor_line: &str) -> String {
        serialize_stored_yaml_with_unlock(
            &[crate::StoredSecretRecord {
                key: "secret_SMypl8K0w9Y".to_owned(),
                secret_type: None,
                value: format!(
                    "-----BEGIN AGE ENCRYPTED FILE-----\n{armor_line}\n-----END AGE ENCRYPTED FILE-----"
                ),
            }],
            &VaultUnlock::Keys,
            &[],
            Some(store_id),
            Some(version),
        )
        .unwrap()
    }

    #[test]
    fn reconcile_push_local_copies_blob_and_bumps_revision() {
        let store_id = "store_AAAAAAAAAAA";
        let local_blob = sample_yaml(3, store_id, "local");
        let mut local = MemoryVaultStore::with_blob(local_blob);
        let mut remote = MemoryVaultStore::with_blob_and_revision("", "rev-0");

        let action = reconcile_vault_stores(&mut local, &mut remote).unwrap();
        assert_eq!(action, VaultSyncAction::PushLocal);
        assert_eq!(remote.blob(), local.blob());
        assert_eq!(remote.revision(), Some("rev-1"));
    }

    #[test]
    fn reconcile_adopt_remote_updates_local() {
        let store_id = "store_AAAAAAAAAAA";
        let remote_blob = sample_yaml(5, store_id, "remote");
        let mut local = MemoryVaultStore::with_blob(sample_yaml(2, store_id, "local"));
        let mut remote = MemoryVaultStore::with_blob_and_revision(remote_blob.clone(), "rev-9");

        let action = reconcile_vault_stores(&mut local, &mut remote).unwrap();
        assert_eq!(action, VaultSyncAction::AdoptRemote);
        assert_eq!(local.blob(), remote_blob);
        assert_eq!(local.revision(), Some("rev-9"));
    }

    #[test]
    fn reconcile_conflict_leaves_stores_unchanged() {
        let store_id = "store_AAAAAAAAAAA";
        let local_blob = sample_yaml(2, store_id, "a");
        let remote_blob = sample_yaml(2, store_id, "b");
        let mut local = MemoryVaultStore::with_blob(local_blob.clone());
        let mut remote = MemoryVaultStore::with_blob(remote_blob.clone());

        let action = reconcile_vault_stores(&mut local, &mut remote).unwrap();
        assert_eq!(action, VaultSyncAction::Conflict);
        assert_eq!(local.blob(), local_blob);
        assert_eq!(remote.blob(), remote_blob);
    }

    #[test]
    fn fan_out_pushes_to_multiple_remotes() {
        let store_id = "store_AAAAAAAAAAA";
        let local_blob = sample_yaml(4, store_id, "canonical");
        let mut local = MemoryVaultStore::with_blob(local_blob.clone());
        let mut remotes = HashMap::from([
            (
                "github-a".to_owned(),
                MemoryVaultStore::with_blob(sample_yaml(1, store_id, "stale-a")),
            ),
            (
                "github-b".to_owned(),
                MemoryVaultStore::with_blob(String::new()),
            ),
        ]);

        let results = fan_out_sync(&mut local, &mut remotes).unwrap();
        assert_eq!(results.len(), 2);
        assert!(
            results
                .iter()
                .all(|(_, action)| *action == VaultSyncAction::PushLocal)
        );
        assert_eq!(remotes["github-a"].blob(), local_blob);
        assert_eq!(remotes["github-b"].blob(), local_blob);
    }
}
