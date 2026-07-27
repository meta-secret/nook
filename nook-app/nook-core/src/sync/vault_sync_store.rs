//! In-memory vault blob stores for sync orchestration and integration tests.
//!
//! [`MemoryVaultStore`] stands in for local `IndexedDB` or a remote sync provider.
//! [`reconcile_vault_stores`] compares blobs via [`compare_vault_sync`] and applies
//! the resulting action — the same decisions the web UI applies after I/O.

use std::collections::HashMap;

use crate::errors::VaultSyncError;
use crate::vault_sync::{CommonContentHash, VaultSyncAction, compare_vault_sync_with_common};

type VaultSyncResult<T> = Result<T, VaultSyncError>;

/// Provider revision state for stores that may not have been written remotely yet.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum StoreRevision {
    #[default]
    Unversioned,
    Version(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StoreRevisionRef<'a> {
    Unversioned,
    Version(&'a str),
}

impl StoreRevision {
    #[must_use]
    pub fn as_ref(&self) -> StoreRevisionRef<'_> {
        match self {
            Self::Unversioned => StoreRevisionRef::Unversioned,
            Self::Version(revision) => StoreRevisionRef::Version(revision),
        }
    }
}

/// A single vault blob plus its explicit provider revision state.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct MemoryVaultStore {
    blob: String,
    revision: StoreRevision,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RevisionGuardedWrite {
    Written { revision: String },
    AlreadyPresent { revision: StoreRevision },
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
            revision: StoreRevision::Unversioned,
        }
    }

    #[must_use]
    pub fn with_blob_and_revision(blob: impl Into<String>, revision: impl Into<String>) -> Self {
        Self {
            blob: blob.into(),
            revision: StoreRevision::Version(revision.into()),
        }
    }

    #[must_use]
    pub fn blob(&self) -> &str {
        &self.blob
    }

    #[must_use]
    pub fn revision(&self) -> StoreRevisionRef<'_> {
        self.revision.as_ref()
    }

    pub fn set_blob(&mut self, blob: impl Into<String>) {
        self.blob = blob.into();
    }

    pub fn set_revision(&mut self, revision: StoreRevision) {
        self.revision = revision;
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.blob.trim().is_empty()
    }

    /// Provider-style guarded write.
    ///
    /// GitHub SHA, Drive revision, and `CloudKit` change-tag writes all have the
    /// same race: the caller proposes content against a remembered revision,
    /// then the provider may reject because the remote changed first. If the
    /// fetched remote already equals the proposed content the retry is
    /// idempotent; otherwise the caller must surface a sync conflict.
    pub fn write_if_revision_matches_or_same_content(
        &mut self,
        content: impl Into<String>,
        expected_revision: StoreRevisionRef<'_>,
    ) -> VaultSyncResult<RevisionGuardedWrite> {
        let content = content.into();
        if self.blob.trim() == content.trim() {
            return Ok(RevisionGuardedWrite::AlreadyPresent {
                revision: self.revision.clone(),
            });
        }
        if self.revision.as_ref() != expected_revision {
            return Err(VaultSyncError::RemoteChangedDuringWrite);
        }
        self.blob = content;
        let next = next_revision(self.revision.as_ref());
        self.revision = StoreRevision::Version(next.clone());
        Ok(RevisionGuardedWrite::Written { revision: next })
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
) -> VaultSyncResult<VaultSyncAction> {
    reconcile_vault_stores_with_common(local, remote, CommonContentHash::Unknown)
}

/// Compare local vs remote against a remembered common content hash and apply
/// the sync action to the in-memory stores.
pub fn reconcile_vault_stores_with_common(
    local: &mut MemoryVaultStore,
    remote: &mut MemoryVaultStore,
    last_common_content_hash: CommonContentHash<'_>,
) -> VaultSyncResult<VaultSyncAction> {
    let action =
        compare_vault_sync_with_common(local.blob(), remote.blob(), last_common_content_hash)?;
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
) -> VaultSyncResult<Vec<(String, VaultSyncAction)>> {
    let mut ids: Vec<String> = remotes.keys().cloned().collect();
    ids.sort();
    let mut results = Vec::with_capacity(ids.len());
    for id in ids {
        let remote = remotes
            .get_mut(&id)
            .ok_or(VaultSyncError::ProviderDisappeared {
                provider_id: id.clone(),
            })?;
        let action = reconcile_vault_stores(local, remote)?;
        results.push((id, action));
    }
    Ok(results)
}

/// After user picks "keep local" in a conflict dialog — push local to remote.
pub fn resolve_conflict_keep_local(local: &MemoryVaultStore, remote: &mut MemoryVaultStore) {
    remote.blob.clone_from(&local.blob);
    remote.revision = StoreRevision::Version(next_revision(remote.revision.as_ref()));
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
            remote.revision = StoreRevision::Version(next_revision(remote.revision.as_ref()));
        }
    }
}

fn next_revision(current: StoreRevisionRef<'_>) -> String {
    let current_number = match current {
        StoreRevisionRef::Unversioned => 0,
        StoreRevisionRef::Version(value) => value
            .strip_prefix("rev-")
            .and_then(|number| number.parse::<u64>().ok())
            .unwrap_or(0),
    };
    let n = current_number.saturating_add(1);
    format!("rev-{n}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::sample_vault_yaml as sample_yaml;

    #[test]
    fn reconcile_push_local_copies_blob_and_bumps_revision() {
        let store_id = "store_AAAAAAAAAAA";
        let local_blob = sample_yaml(3, store_id, "local");
        let mut local = MemoryVaultStore::with_blob(local_blob);
        let mut remote = MemoryVaultStore::with_blob_and_revision("", "rev-0");

        let action = reconcile_vault_stores(&mut local, &mut remote)
            .expect("vault sync store test setup should succeed");
        assert_eq!(action, VaultSyncAction::PushLocal);
        assert_eq!(remote.blob(), local.blob());
        assert_eq!(remote.revision(), StoreRevisionRef::Version("rev-1"));
    }

    #[test]
    fn reconcile_adopt_remote_updates_local() {
        let store_id = "store_AAAAAAAAAAA";
        let remote_blob = sample_yaml(5, store_id, "remote");
        let mut local = MemoryVaultStore::with_blob(sample_yaml(2, store_id, "local"));
        let mut remote = MemoryVaultStore::with_blob_and_revision(remote_blob.clone(), "rev-9");

        let action = reconcile_vault_stores(&mut local, &mut remote)
            .expect("vault sync store test setup should succeed");
        assert_eq!(action, VaultSyncAction::AdoptRemote);
        assert_eq!(local.blob(), remote_blob);
        assert_eq!(local.revision(), StoreRevisionRef::Version("rev-9"));
    }

    #[test]
    fn reconcile_conflict_leaves_stores_unchanged() {
        let store_id = "store_AAAAAAAAAAA";
        let local_blob = sample_yaml(2, store_id, "a");
        let remote_blob = sample_yaml(2, store_id, "b");
        let mut local = MemoryVaultStore::with_blob(local_blob.clone());
        let mut remote = MemoryVaultStore::with_blob(remote_blob.clone());

        let action = reconcile_vault_stores(&mut local, &mut remote)
            .expect("vault sync store test setup should succeed");
        assert_eq!(action, VaultSyncAction::Conflict);
        assert_eq!(local.blob(), local_blob);
        assert_eq!(remote.blob(), remote_blob);
    }

    #[test]
    fn reconcile_with_common_hash_preserves_divergent_branches() {
        let store_id = "store_AAAAAAAAAAA";
        let base_blob = sample_yaml(2, store_id, "base");
        let local_blob = sample_yaml(4, store_id, "local");
        let remote_blob = sample_yaml(3, store_id, "remote");
        let base_hash = crate::vault_sync::vault_content_hash(&base_blob);
        let mut local = MemoryVaultStore::with_blob(local_blob.clone());
        let mut remote = MemoryVaultStore::with_blob(remote_blob.clone());

        let action = reconcile_vault_stores_with_common(
            &mut local,
            &mut remote,
            CommonContentHash::Known(&base_hash),
        )
        .expect("vault sync store test setup should succeed");
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

        let results = fan_out_sync(&mut local, &mut remotes)
            .expect("vault sync store test setup should succeed");
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
