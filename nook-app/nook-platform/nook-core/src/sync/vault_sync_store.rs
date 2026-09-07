#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

//! In-memory vault blob stores for sync orchestration and integration tests.
//!
//! [`VaultSyncPair`] compares two stores and prepares a single action that can
//! only be committed to the same stores. [`VaultSyncFanOut`] applies that
//! transition sequentially to every remote provider.

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

    /// Advance this revision using the in-memory provider revision format.
    #[must_use]
    pub fn next(&self) -> String {
        self.as_ref().next()
    }
}

impl StoreRevisionRef<'_> {
    /// Advance this revision using the in-memory provider revision format.
    #[must_use]
    pub fn next(self) -> String {
        let current_number = match self {
            Self::Unversioned => 0,
            Self::Version(value) => value
                .strip_prefix("rev-")
                .and_then(|number| number.parse::<u64>().ok())
                .unwrap_or(0),
        };
        let n = current_number.saturating_add(1);
        format!("rev-{n}")
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
        let next = self.revision.next();
        self.revision = StoreRevision::Version(next.clone());
        Ok(RevisionGuardedWrite::Written { revision: next })
    }

    /// Resolve a conflict by replacing `remote` with this local store.
    pub fn keep_local(&self, remote: &mut Self) {
        remote.blob.clone_from(&self.blob);
        remote.revision = StoreRevision::Version(remote.revision.next());
    }

    /// Resolve a conflict by replacing this local store with `remote`.
    pub fn keep_remote(&mut self, remote: &Self) {
        self.blob.clone_from(&remote.blob);
        self.revision.clone_from(&remote.revision);
    }
}

/// Borrowed local and remote stores awaiting a synchronization decision.
pub struct VaultSyncPair<'a> {
    local: &'a mut MemoryVaultStore,
    remote: &'a mut MemoryVaultStore,
    last_common_content_hash: CommonContentHash<'a>,
}

impl<'a> VaultSyncPair<'a> {
    /// Compare stores without a remembered common content hash.
    #[must_use]
    pub fn new(local: &'a mut MemoryVaultStore, remote: &'a mut MemoryVaultStore) -> Self {
        Self::with_common(local, remote, CommonContentHash::Unknown)
    }

    /// Compare stores against a remembered common content hash.
    #[must_use]
    pub fn with_common(
        local: &'a mut MemoryVaultStore,
        remote: &'a mut MemoryVaultStore,
        last_common_content_hash: CommonContentHash<'a>,
    ) -> Self {
        Self {
            local,
            remote,
            last_common_content_hash,
        }
    }

    /// Prepare an action while retaining exclusive access to the compared stores.
    pub fn prepare(self) -> VaultSyncResult<PreparedVaultSync<'a>> {
        let action = compare_vault_sync_with_common(
            self.local.blob(),
            self.remote.blob(),
            self.last_common_content_hash,
        )?;
        Ok(PreparedVaultSync {
            local: self.local,
            remote: self.remote,
            action,
        })
    }
}

/// A non-cloneable synchronization decision tied to the stores it inspected.
pub struct PreparedVaultSync<'a> {
    local: &'a mut MemoryVaultStore,
    remote: &'a mut MemoryVaultStore,
    action: VaultSyncAction,
}

impl PreparedVaultSync<'_> {
    #[must_use]
    pub fn action(&self) -> VaultSyncAction {
        self.action
    }

    /// Commit the prepared action to its original local and remote stores.
    pub fn commit(self) -> VaultSyncAction {
        let Self {
            local,
            remote,
            action,
        } = self;
        match action {
            VaultSyncAction::Unchanged | VaultSyncAction::Conflict => {}
            VaultSyncAction::AdoptRemote => {
                local.blob.clone_from(&remote.blob);
                local.revision.clone_from(&remote.revision);
            }
            VaultSyncAction::PushLocal => {
                remote.blob.clone_from(&local.blob);
                remote.revision = StoreRevision::Version(remote.revision.next());
            }
        }
        action
    }
}

/// Borrowed canonical local store and remote providers awaiting sequential fan-out.
pub struct VaultSyncFanOut<'a> {
    local: &'a mut MemoryVaultStore,
    remotes: &'a mut HashMap<String, MemoryVaultStore>,
}

impl<'a> VaultSyncFanOut<'a> {
    #[must_use]
    pub fn new(
        local: &'a mut MemoryVaultStore,
        remotes: &'a mut HashMap<String, MemoryVaultStore>,
    ) -> Self {
        Self { local, remotes }
    }

    /// Reconcile providers in lexical order, retaining earlier effects on failure.
    #[allow(clippy::implicit_hasher)]
    pub fn run(self) -> VaultSyncResult<Vec<(String, VaultSyncAction)>> {
        let Self { local, remotes } = self;
        let mut ids: Vec<String> = remotes.keys().cloned().collect();
        ids.sort();
        let mut results = Vec::with_capacity(ids.len());
        for id in ids {
            let remote = remotes
                .get_mut(&id)
                .ok_or(VaultSyncError::ProviderDisappeared {
                    provider_id: id.clone(),
                })?;
            let action = VaultSyncPair::new(&mut *local, remote).prepare()?.commit();
            results.push((id, action));
        }
        Ok(results)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::sample_vault_yaml as sample_yaml;
    use crate::vault_sync;

    #[test]
    fn reconcile_push_local_copies_blob_and_bumps_revision() -> anyhow::Result<()> {
        let store_id = "store_AAAAAAAAAAA";
        let local_blob = sample_yaml(3, store_id, "local")?;
        let mut local = MemoryVaultStore::with_blob(local_blob);
        let mut remote = MemoryVaultStore::with_blob_and_revision("", "rev-0");

        let prepared = VaultSyncPair::new(&mut local, &mut remote).prepare()?;
        assert_eq!(prepared.action(), VaultSyncAction::PushLocal);
        assert_eq!(prepared.commit(), VaultSyncAction::PushLocal);
        assert_eq!(remote.blob(), local.blob());
        assert_eq!(remote.revision(), StoreRevisionRef::Version("rev-1"));
        Ok(())
    }

    #[test]
    fn reconcile_adopt_remote_updates_local() -> anyhow::Result<()> {
        let store_id = "store_AAAAAAAAAAA";
        let remote_blob = sample_yaml(5, store_id, "remote")?;
        let mut local = MemoryVaultStore::with_blob(sample_yaml(2, store_id, "local")?);
        let mut remote = MemoryVaultStore::with_blob_and_revision(remote_blob.clone(), "rev-9");

        let action = VaultSyncPair::new(&mut local, &mut remote)
            .prepare()?
            .commit();
        assert_eq!(action, VaultSyncAction::AdoptRemote);
        assert_eq!(local.blob(), remote_blob);
        assert_eq!(local.revision(), StoreRevisionRef::Version("rev-9"));
        Ok(())
    }

    #[test]
    fn reconcile_conflict_leaves_stores_unchanged() -> anyhow::Result<()> {
        let store_id = "store_AAAAAAAAAAA";
        let local_blob = sample_yaml(2, store_id, "a")?;
        let remote_blob = sample_yaml(2, store_id, "b")?;
        let mut local = MemoryVaultStore::with_blob(local_blob.clone());
        let mut remote = MemoryVaultStore::with_blob(remote_blob.clone());

        let action = VaultSyncPair::new(&mut local, &mut remote)
            .prepare()?
            .commit();
        assert_eq!(action, VaultSyncAction::Conflict);
        assert_eq!(local.blob(), local_blob);
        assert_eq!(remote.blob(), remote_blob);
        Ok(())
    }

    #[test]
    fn reconcile_with_common_hash_preserves_divergent_branches() -> anyhow::Result<()> {
        let store_id = "store_AAAAAAAAAAA";
        let base_blob = sample_yaml(2, store_id, "base")?;
        let local_blob = sample_yaml(4, store_id, "local")?;
        let remote_blob = sample_yaml(3, store_id, "remote")?;
        let base_hash = vault_sync::vault_content_hash(&base_blob);
        let mut local = MemoryVaultStore::with_blob(local_blob.clone());
        let mut remote = MemoryVaultStore::with_blob(remote_blob.clone());

        let action = VaultSyncPair::with_common(
            &mut local,
            &mut remote,
            CommonContentHash::Known(&base_hash),
        )
        .prepare()?
        .commit();
        assert_eq!(action, VaultSyncAction::Conflict);
        assert_eq!(local.blob(), local_blob);
        assert_eq!(remote.blob(), remote_blob);
        Ok(())
    }

    #[test]
    fn fan_out_pushes_to_multiple_remotes() -> anyhow::Result<()> {
        let store_id = "store_AAAAAAAAAAA";
        let local_blob = sample_yaml(4, store_id, "canonical")?;
        let mut local = MemoryVaultStore::with_blob(local_blob.clone());
        let mut remotes = HashMap::from([
            (
                "github-a".to_owned(),
                MemoryVaultStore::with_blob(sample_yaml(1, store_id, "stale-a")?),
            ),
            (
                "github-b".to_owned(),
                MemoryVaultStore::with_blob(String::new()),
            ),
        ]);

        let results = VaultSyncFanOut::new(&mut local, &mut remotes).run()?;
        assert_eq!(results.len(), 2);
        assert!(
            results
                .iter()
                .all(|(_, action)| *action == VaultSyncAction::PushLocal)
        );
        assert_eq!(remotes["github-a"].blob(), local_blob);
        assert_eq!(remotes["github-b"].blob(), local_blob);
        Ok(())
    }

    #[test]
    fn dropping_prepared_sync_does_not_mutate_stores() -> anyhow::Result<()> {
        let store_id = "store_AAAAAAAAAAA";
        let local_blob = sample_yaml(3, store_id, "local")?;
        let remote_blob = sample_yaml(1, store_id, "remote")?;
        let mut local = MemoryVaultStore::with_blob(local_blob.clone());
        let mut remote = MemoryVaultStore::with_blob(remote_blob.clone());

        drop(VaultSyncPair::new(&mut local, &mut remote).prepare()?);
        assert_eq!(local.blob(), local_blob);
        assert_eq!(remote.blob(), remote_blob);
        Ok(())
    }

    #[test]
    fn comparison_error_preserves_both_stores() -> anyhow::Result<()> {
        let local_blob = sample_yaml(3, "store_AAAAAAAAAAA", "local")?;
        let remote_blob = sample_yaml(4, "store_BBBBBBBBBBB", "remote")?;
        let mut local = MemoryVaultStore::with_blob(local_blob.clone());
        let mut remote = MemoryVaultStore::with_blob(remote_blob.clone());

        assert!(
            VaultSyncPair::new(&mut local, &mut remote)
                .prepare()
                .is_err()
        );
        assert_eq!(local.blob(), local_blob);
        assert_eq!(remote.blob(), remote_blob);
        Ok(())
    }

    #[test]
    fn revision_advancement_saturates_at_u64_max() {
        assert_eq!(
            StoreRevisionRef::Version("rev-18446744073709551615").next(),
            "rev-18446744073709551615"
        );
        assert_eq!(StoreRevision::Unversioned.next(), "rev-1");
    }
}
