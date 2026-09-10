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
use crate::vault_sync::{CommonContentHash, VaultSyncAction, VaultSyncComparison};

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

    pub fn set_blob(mut self, blob: impl Into<String>) -> Self {
        self.blob = blob.into();
        self
    }

    pub fn set_revision(mut self, revision: StoreRevision) -> Self {
        self.revision = revision;
        self
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
        mut self,
        content: impl Into<String>,
        expected_revision: StoreRevisionRef<'_>,
    ) -> Result<GuardedVaultWrite, RejectedVaultWrite> {
        let content = content.into();
        if self.blob.trim() == content.trim() {
            return Ok(GuardedVaultWrite {
                outcome: RevisionGuardedWrite::AlreadyPresent {
                    revision: self.revision.clone(),
                },
                store: self,
            });
        }
        if self.revision.as_ref() != expected_revision {
            return Err(RejectedVaultWrite {
                store: self,
                cause: VaultSyncError::RemoteChangedDuringWrite,
            });
        }
        self.blob = content;
        let next = self.revision.next();
        self.revision = StoreRevision::Version(next.clone());
        Ok(GuardedVaultWrite {
            store: self,
            outcome: RevisionGuardedWrite::Written { revision: next },
        })
    }

    /// Resolve a conflict by replacing `remote` with this local store.
    pub fn keep_local(&self, mut remote: Self) -> Self {
        remote.blob.clone_from(&self.blob);
        remote.revision = StoreRevision::Version(remote.revision.next());
        remote
    }

    /// Resolve a conflict by replacing this local store with `remote`.
    pub fn keep_remote(mut self, remote: &Self) -> Self {
        self.blob.clone_from(&remote.blob);
        self.revision.clone_from(&remote.revision);
        self
    }
}

/// Owned stores remain available after success or rejection.
#[derive(Debug)]
pub struct SyncedVaultStores {
    pub local: MemoryVaultStore,
    pub remote: MemoryVaultStore,
    pub action: VaultSyncAction,
}
#[derive(Debug)]
pub struct RejectedVaultSync {
    pub local: MemoryVaultStore,
    pub remote: MemoryVaultStore,
    pub cause: VaultSyncError,
}
impl std::fmt::Display for RejectedVaultSync {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.cause.fmt(f)
    }
}
impl std::error::Error for RejectedVaultSync {}
#[derive(Debug)]
pub struct GuardedVaultWrite {
    pub store: MemoryVaultStore,
    pub outcome: RevisionGuardedWrite,
}
#[derive(Debug)]
pub struct RejectedVaultWrite {
    pub store: MemoryVaultStore,
    pub cause: VaultSyncError,
}
impl std::fmt::Display for RejectedVaultWrite {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.cause.fmt(f)
    }
}
impl std::error::Error for RejectedVaultWrite {}

pub struct VaultSyncPair<'a> {
    local: MemoryVaultStore,
    remote: MemoryVaultStore,
    last_common_content_hash: CommonContentHash<'a>,
}
impl<'a> VaultSyncPair<'a> {
    pub fn new(local: MemoryVaultStore, remote: MemoryVaultStore) -> Self {
        Self::with_common(local, remote, CommonContentHash::Unknown)
    }
    pub fn with_common(
        local: MemoryVaultStore,
        remote: MemoryVaultStore,
        last_common_content_hash: CommonContentHash<'a>,
    ) -> Self {
        Self {
            local,
            remote,
            last_common_content_hash,
        }
    }
    pub fn prepare(self) -> Result<PreparedVaultSync, RejectedVaultSync> {
        let action = VaultSyncComparison::with_common(
            self.local.blob(),
            self.remote.blob(),
            self.last_common_content_hash,
        )
        .decide();
        match action {
            Ok(action) => Ok(PreparedVaultSync {
                local: self.local,
                remote: self.remote,
                action,
            }),
            Err(cause) => Err(RejectedVaultSync {
                local: self.local,
                remote: self.remote,
                cause,
            }),
        }
    }
}
#[derive(Debug)]
pub struct PreparedVaultSync {
    local: MemoryVaultStore,
    remote: MemoryVaultStore,
    action: VaultSyncAction,
}
impl PreparedVaultSync {
    pub fn action(&self) -> VaultSyncAction {
        self.action
    }
    /// Return inspected stores without committing their prepared transition.
    pub fn cancel(self) -> SyncedVaultStores {
        SyncedVaultStores {
            local: self.local,
            remote: self.remote,
            action: self.action,
        }
    }
    pub fn commit(self) -> SyncedVaultStores {
        let Self {
            mut local,
            mut remote,
            action,
        } = self;
        match action {
            VaultSyncAction::Unchanged | VaultSyncAction::Conflict => {}
            VaultSyncAction::AdoptRemote => {
                local = local.keep_remote(&remote);
            }
            VaultSyncAction::PushLocal => {
                remote = local.keep_local(remote);
            }
        }
        SyncedVaultStores {
            local,
            remote,
            action,
        }
    }
}
#[derive(Debug)]
pub struct VaultSyncFanOut {
    pub local: MemoryVaultStore,
    pub remotes: HashMap<String, MemoryVaultStore>,
}
#[derive(Debug)]
pub struct CompletedVaultFanOut {
    pub stores: VaultSyncFanOut,
    pub actions: Vec<(String, VaultSyncAction)>,
}
#[derive(Debug)]
pub struct RejectedVaultFanOut {
    pub stores: VaultSyncFanOut,
    pub cause: VaultSyncError,
}
impl std::fmt::Display for RejectedVaultFanOut {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.cause.fmt(f)
    }
}
impl std::error::Error for RejectedVaultFanOut {}
impl VaultSyncFanOut {
    pub fn new(local: MemoryVaultStore, remotes: HashMap<String, MemoryVaultStore>) -> Self {
        Self { local, remotes }
    }
    pub fn run(self) -> Result<CompletedVaultFanOut, RejectedVaultFanOut> {
        let Self { mut local, remotes } = self;
        let mut pending = remotes
            .into_iter()
            .collect::<std::collections::BTreeMap<_, _>>();
        let mut completed = HashMap::new();
        let mut actions = Vec::new();
        while let Some((id, remote)) = pending.pop_first() {
            match VaultSyncPair::new(local, remote).prepare() {
                Ok(prepared) => {
                    let next = prepared.commit();
                    local = next.local;
                    completed.insert(id.clone(), next.remote);
                    actions.push((id, next.action));
                }
                Err(rejected) => {
                    completed.insert(id, rejected.remote);
                    completed.extend(pending);
                    return Err(RejectedVaultFanOut {
                        stores: Self {
                            local: rejected.local,
                            remotes: completed,
                        },
                        cause: rejected.cause,
                    });
                }
            }
        }
        Ok(CompletedVaultFanOut {
            stores: Self {
                local,
                remotes: completed,
            },
            actions,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::sample_vault_yaml as sample_yaml;
    use crate::vault_sync::VaultRevision;

    #[test]
    fn reconcile_push_local_copies_blob_and_bumps_revision() -> anyhow::Result<()> {
        let store_id = "store_AAAAAAAAAAA";
        let local_blob = sample_yaml(3, store_id, "local")?;
        let local = MemoryVaultStore::with_blob(local_blob);
        let remote = MemoryVaultStore::with_blob_and_revision("", "rev-0");

        let prepared = VaultSyncPair::new(local, remote).prepare()?;
        assert_eq!(prepared.action(), VaultSyncAction::PushLocal);
        let next = prepared.commit();
        let (local, remote) = (next.local, next.remote);
        assert_eq!(next.action, VaultSyncAction::PushLocal);
        assert_eq!(remote.blob(), local.blob());
        assert_eq!(remote.revision(), StoreRevisionRef::Version("rev-1"));
        Ok(())
    }

    #[test]
    fn reconcile_adopt_remote_updates_local() -> anyhow::Result<()> {
        let store_id = "store_AAAAAAAAAAA";
        let remote_blob = sample_yaml(5, store_id, "remote")?;
        let local = MemoryVaultStore::with_blob(sample_yaml(2, store_id, "local")?);
        let remote = MemoryVaultStore::with_blob_and_revision(remote_blob.clone(), "rev-9");

        let next = VaultSyncPair::new(local, remote).prepare()?.commit();
        let (local, action) = (next.local, next.action);
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
        let local = MemoryVaultStore::with_blob(local_blob.clone());
        let remote = MemoryVaultStore::with_blob(remote_blob.clone());

        let next = VaultSyncPair::new(local, remote).prepare()?.commit();
        let (local, remote, action) = (next.local, next.remote, next.action);
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
        let base_hash = VaultRevision::content_hash(&base_blob);
        let local = MemoryVaultStore::with_blob(local_blob.clone());
        let remote = MemoryVaultStore::with_blob(remote_blob.clone());

        let next = VaultSyncPair::with_common(local, remote, CommonContentHash::Known(&base_hash))
            .prepare()?
            .commit();
        let (local, remote, action) = (next.local, next.remote, next.action);
        assert_eq!(action, VaultSyncAction::Conflict);
        assert_eq!(local.blob(), local_blob);
        assert_eq!(remote.blob(), remote_blob);
        Ok(())
    }

    #[test]
    fn fan_out_pushes_to_multiple_remotes() -> anyhow::Result<()> {
        let store_id = "store_AAAAAAAAAAA";
        let local_blob = sample_yaml(4, store_id, "canonical")?;
        let local = MemoryVaultStore::with_blob(local_blob.clone());
        let remotes = HashMap::from([
            (
                "github-a".to_owned(),
                MemoryVaultStore::with_blob(sample_yaml(1, store_id, "stale-a")?),
            ),
            (
                "github-b".to_owned(),
                MemoryVaultStore::with_blob(String::new()),
            ),
        ]);

        let completed = VaultSyncFanOut::new(local, remotes).run()?;
        let (remotes, results) = (completed.stores.remotes, completed.actions);
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
        let local = MemoryVaultStore::with_blob(local_blob.clone());
        let remote = MemoryVaultStore::with_blob(remote_blob.clone());

        let next = VaultSyncPair::new(local, remote).prepare()?.cancel();
        let (local, remote) = (next.local, next.remote);
        assert_eq!(local.blob(), local_blob);
        assert_eq!(remote.blob(), remote_blob);
        Ok(())
    }

    #[test]
    fn comparison_error_preserves_both_stores() -> anyhow::Result<()> {
        let local_blob = sample_yaml(3, "store_AAAAAAAAAAA", "local")?;
        let remote_blob = sample_yaml(4, "store_BBBBBBBBBBB", "remote")?;
        let local = MemoryVaultStore::with_blob(local_blob.clone());
        let remote = MemoryVaultStore::with_blob(remote_blob.clone());

        let rejected = VaultSyncPair::new(local, remote)
            .prepare()
            .expect_err("different stores reject");
        let (local, remote) = (rejected.local, rejected.remote);
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
