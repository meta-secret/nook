//! Version-based reconciliation between local and remote vault copies.
//!
//! Each vault YAML carries a monotonic `vault_version` counter incremented on
//! every save. When syncing across storage providers the higher version wins;
//! equal version with different content is a conflict that requires explicit
//! user choice (never auto-merged).

use crate::errors::VaultSyncError;
use crate::read_vault_store_id;

type VaultSyncResult<T> = Result<T, VaultSyncError>;

/// Outcome of comparing a local vault blob against a remote one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultSyncAction {
    /// Both sides are empty or byte-identical at the same version.
    Unchanged,
    /// Remote is strictly newer — local should adopt remote content.
    AdoptRemote,
    /// Local is strictly newer — remote should be overwritten with local.
    PushLocal,
    /// Same version but different content — user must pick a side.
    Conflict,
}

/// Causal ancestry known for a provider during vault reconciliation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommonContentHash<'a> {
    Unknown,
    Known(&'a str),
}

impl VaultSyncAction {
    /// Stable tag returned to the web layer after blob reconciliation.
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::Unchanged => "unchanged",
            Self::AdoptRemote => "adopt_remote",
            Self::PushLocal => "push_local",
            Self::Conflict => "conflict",
        }
    }
}

/// Parsed revision metadata from an on-disk vault blob.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultRevision {
    pub version: u64,
    /// SHA-256 hex digest of trimmed UTF-8 content (for conflict detection).
    pub content_hash: String,
    pub store: VaultRevisionStore,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VaultRevisionStore {
    EmptyVault,
    Identified(String),
}

/// Read revision metadata without decrypting secret values.
pub fn read_vault_revision(stored: &str) -> VaultSyncResult<VaultRevision> {
    let trimmed = stored.trim();
    if trimmed.is_empty() {
        return Ok(VaultRevision {
            version: 0,
            content_hash: content_hash(trimmed),
            store: VaultRevisionStore::EmptyVault,
        });
    }
    let store_id = match read_vault_store_id(trimmed)? {
        crate::VaultStoreIdentity::Assigned(store_id) => store_id,
        crate::VaultStoreIdentity::Unassigned => return Err(VaultSyncError::MissingStoreId),
    };
    Ok(VaultRevision {
        version: crate::read_vault_version(trimmed)?,
        content_hash: content_hash(trimmed),
        store: VaultRevisionStore::Identified(store_id),
    })
}

/// Decide how to reconcile local vs remote vault blobs.
///
/// Rules (in order):
/// 1. Byte-identical content → [`VaultSyncAction::Unchanged`].
/// 2. One side empty → adopt the non-empty side.
/// 3. `store_id` mismatch (both present) → error (different logical vaults).
/// 4. Higher `vault_version` wins → [`AdoptRemote`] or [`PushLocal`].
/// 5. Equal version, different content → [`VaultSyncAction::Conflict`].
pub fn compare_vault_sync(local: &str, remote: &str) -> VaultSyncResult<VaultSyncAction> {
    compare_vault_sync_with_common(local, remote, CommonContentHash::Unknown)
}

/// Decide how to reconcile local vs remote vault blobs, using the last
/// byte-content hash successfully shared with this provider as a causal base.
///
/// The old scalar `vault_version` is still useful when one side is a direct
/// successor of the remembered common blob. If neither side matches that base,
/// the blobs are divergent branches and must be surfaced as a conflict even
/// when one version counter is larger.
pub fn compare_vault_sync_with_common(
    local: &str,
    remote: &str,
    last_common_content_hash: CommonContentHash<'_>,
) -> VaultSyncResult<VaultSyncAction> {
    let local_trim = local.trim();
    let remote_trim = remote.trim();

    if local_trim == remote_trim {
        return Ok(VaultSyncAction::Unchanged);
    }

    if local_trim.is_empty() && remote_trim.is_empty() {
        return Ok(VaultSyncAction::Unchanged);
    }
    if local_trim.is_empty() {
        return Ok(VaultSyncAction::AdoptRemote);
    }
    if remote_trim.is_empty() {
        return Ok(VaultSyncAction::PushLocal);
    }

    let local_rev = read_vault_revision(local_trim)?;
    let remote_rev = read_vault_revision(remote_trim)?;

    if let (
        VaultRevisionStore::Identified(local_store),
        VaultRevisionStore::Identified(remote_store),
    ) = (&local_rev.store, &remote_rev.store)
        && local_store != remote_store
    {
        tracing::warn!(
            scope = "vault-sync",
            local_store = local_store.as_str(),
            remote_store = remote_store.as_str(),
            "vault store_id mismatch; refusing to reconcile different vaults"
        );
        return Err(VaultSyncError::StoreIdMismatch {
            local_store: local_store.clone(),
            remote_store: remote_store.clone(),
        });
    }

    if let CommonContentHash::Known(base_hash) = last_common_content_hash
        && !base_hash.trim().is_empty()
        && local_rev.content_hash != remote_rev.content_hash
    {
        let base_hash = base_hash.trim();
        let local_matches_base = local_rev.content_hash == base_hash;
        let remote_matches_base = remote_rev.content_hash == base_hash;
        if local_matches_base && !remote_matches_base {
            return Ok(VaultSyncAction::AdoptRemote);
        }
        if remote_matches_base && !local_matches_base {
            return Ok(VaultSyncAction::PushLocal);
        }
        if !local_matches_base && !remote_matches_base {
            tracing::warn!(
                scope = "vault-sync",
                local_version = local_rev.version,
                remote_version = remote_rev.version,
                "vault blobs diverged from last common content hash; refusing scalar-version winner"
            );
            return Ok(VaultSyncAction::Conflict);
        }
    }

    let action = if local_rev.version < remote_rev.version {
        VaultSyncAction::AdoptRemote
    } else if local_rev.version > remote_rev.version {
        VaultSyncAction::PushLocal
    } else if local_rev.content_hash != remote_rev.content_hash {
        VaultSyncAction::Conflict
    } else {
        VaultSyncAction::Unchanged
    };

    tracing::debug!(
        scope = "vault-sync",
        local_version = local_rev.version,
        remote_version = remote_rev.version,
        action = action.label(),
        "reconciled vault versions"
    );
    Ok(action)
}

#[must_use]
pub fn vault_content_hash(content: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(content.trim().as_bytes());
    hex::encode(digest)
}

fn content_hash(content: &str) -> String {
    vault_content_hash(content)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::sample_vault_yaml as sample_yaml;

    #[test]
    fn identical_content_is_unchanged() -> anyhow::Result<()> {
        let yaml = sample_yaml(1, "store_AAAAAAAAAAA", "test")?;
        assert_eq!(
            compare_vault_sync(&yaml, &yaml)?,
            VaultSyncAction::Unchanged
        );
        Ok(())
    }

    #[test]
    fn empty_local_adopts_remote() -> anyhow::Result<()> {
        let remote = sample_yaml(1, "store_AAAAAAAAAAA", "test")?;
        assert_eq!(
            compare_vault_sync("", &remote)?,
            VaultSyncAction::AdoptRemote
        );
        Ok(())
    }

    #[test]
    fn empty_remote_pushes_local() -> anyhow::Result<()> {
        let local = sample_yaml(1, "store_AAAAAAAAAAA", "test")?;
        assert_eq!(compare_vault_sync(&local, "")?, VaultSyncAction::PushLocal);
        Ok(())
    }

    #[test]
    fn higher_remote_version_wins() -> anyhow::Result<()> {
        let local = sample_yaml(1, "store_AAAAAAAAAAA", "a")?;
        let remote = sample_yaml(3, "store_AAAAAAAAAAA", "b")?;
        assert_eq!(
            compare_vault_sync(&local, &remote)?,
            VaultSyncAction::AdoptRemote
        );
        Ok(())
    }

    #[test]
    fn higher_local_version_pushes() -> anyhow::Result<()> {
        let local = sample_yaml(5, "store_AAAAAAAAAAA", "a")?;
        let remote = sample_yaml(2, "store_AAAAAAAAAAA", "b")?;
        assert_eq!(
            compare_vault_sync(&local, &remote)?,
            VaultSyncAction::PushLocal
        );
        Ok(())
    }

    #[test]
    fn same_version_different_content_is_conflict() -> anyhow::Result<()> {
        let local = sample_yaml(2, "store_AAAAAAAAAAA", "a")?;
        let remote = sample_yaml(2, "store_AAAAAAAAAAA", "b")?;
        assert_eq!(
            compare_vault_sync(&local, &remote)?,
            VaultSyncAction::Conflict
        );
        Ok(())
    }

    #[test]
    fn common_hash_allows_single_successor_to_win() -> anyhow::Result<()> {
        let base = sample_yaml(2, "store_AAAAAAAAAAA", "base")?;
        let local = sample_yaml(3, "store_AAAAAAAAAAA", "local")?;
        let remote = base.clone();
        let base_hash = vault_content_hash(&base);

        assert_eq!(
            compare_vault_sync_with_common(&local, &remote, CommonContentHash::Known(&base_hash))?,
            VaultSyncAction::PushLocal
        );
        assert_eq!(
            compare_vault_sync_with_common(&remote, &local, CommonContentHash::Known(&base_hash))?,
            VaultSyncAction::AdoptRemote
        );
        Ok(())
    }

    #[test]
    fn common_hash_rejects_divergent_scalar_winner() -> anyhow::Result<()> {
        let base = sample_yaml(2, "store_AAAAAAAAAAA", "base")?;
        let local = sample_yaml(4, "store_AAAAAAAAAAA", "local")?;
        let remote = sample_yaml(3, "store_AAAAAAAAAAA", "remote")?;
        let base_hash = vault_content_hash(&base);

        assert_eq!(
            compare_vault_sync_with_common(&local, &remote, CommonContentHash::Known(&base_hash))?,
            VaultSyncAction::Conflict
        );
        Ok(())
    }

    #[test]
    fn store_id_mismatch_is_error() -> anyhow::Result<()> {
        let local = sample_yaml(1, "store_AAAAAAAAAAA", "")?;
        let remote = sample_yaml(1, "store_BBBBBBBBBBB", "")?;
        assert!(compare_vault_sync(&local, &remote).is_err());
        Ok(())
    }

    #[test]
    fn labels_are_stable_for_web_layer() {
        assert_eq!(VaultSyncAction::Unchanged.label(), "unchanged");
        assert_eq!(VaultSyncAction::AdoptRemote.label(), "adopt_remote");
        assert_eq!(VaultSyncAction::PushLocal.label(), "push_local");
        assert_eq!(VaultSyncAction::Conflict.label(), "conflict");
    }
}
