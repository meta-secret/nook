//! Version-based reconciliation between local and remote vault copies.
//!
//! Each vault YAML carries a monotonic `vault_version` counter incremented on
//! every save. When syncing across storage providers the higher version wins;
//! equal version with different content is a conflict that requires explicit
//! user choice (never auto-merged).
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::VaultStoreIdentity;

use crate::VaultFormatDocument;
use crate::errors::VaultSyncError;

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
    pub version: crate::VaultVersion,
    /// SHA-256 hex digest of trimmed UTF-8 content (for conflict detection).
    pub content_hash: String,
    pub store: VaultRevisionStore,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VaultRevisionStore {
    EmptyVault,
    Identified(String),
}

impl VaultRevision {
    /// Hash trimmed vault content for provider checkpoints and conflict decisions.
    #[must_use]
    pub fn content_hash(content: &str) -> String {
        use sha2::{Digest, Sha256};
        let digest = Sha256::digest(content.trim().as_bytes());
        hex::encode(digest)
    }

    /// Read revision metadata without decrypting secret values.
    pub fn from_stored(stored: &str) -> VaultSyncResult<Self> {
        let trimmed = stored.trim();
        if trimmed.is_empty() {
            return Ok(Self {
                version: 0.into(),
                content_hash: Self::content_hash(trimmed),
                store: VaultRevisionStore::EmptyVault,
            });
        }
        let store_id = match VaultFormatDocument::new(trimmed).store_id()? {
            VaultStoreIdentity::Assigned(store_id) => store_id,
            VaultStoreIdentity::Unassigned => return Err(VaultSyncError::MissingStoreId),
        };
        Ok(Self {
            version: crate::VaultFormatDocument::new(trimmed).version()?,
            content_hash: Self::content_hash(trimmed),
            store: VaultRevisionStore::Identified(store_id),
        })
    }
}

/// Borrowed local and remote vault blobs awaiting one synchronization decision.
pub struct VaultSyncComparison<'a> {
    local: &'a str,
    remote: &'a str,
    last_common_content_hash: CommonContentHash<'a>,
}

impl<'a> VaultSyncComparison<'a> {
    /// Compare local and remote blobs without a remembered common content hash.
    #[must_use]
    pub fn new(local: &'a str, remote: &'a str) -> Self {
        Self::with_common(local, remote, CommonContentHash::Unknown)
    }

    /// Compare blobs using the last successfully shared content hash as a causal base.
    #[must_use]
    pub fn with_common(
        local: &'a str,
        remote: &'a str,
        last_common_content_hash: CommonContentHash<'a>,
    ) -> Self {
        Self {
            local,
            remote,
            last_common_content_hash,
        }
    }

    /// Consume the comparison state into a safe synchronization action.
    ///
    /// Rules (in order): identical content, empty-side adoption, store identity
    /// validation, remembered common ancestry, version precedence, then conflict.
    pub fn decide(self) -> VaultSyncResult<VaultSyncAction> {
        let local_trim = self.local.trim();
        let remote_trim = self.remote.trim();

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

        let local_rev = VaultRevision::from_stored(local_trim)?;
        let remote_rev = VaultRevision::from_stored(remote_trim)?;

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

        if let CommonContentHash::Known(base_hash) = self.last_common_content_hash
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
                    local_version = %local_rev.version,
                    remote_version = %remote_rev.version,
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
            local_version = %local_rev.version,
            remote_version = %remote_rev.version,
            action = action.label(),
            "reconciled vault versions"
        );
        Ok(action)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::sample_vault_yaml as sample_yaml;

    #[test]
    fn identical_content_is_unchanged() -> anyhow::Result<()> {
        let yaml = sample_yaml(1, "store_AAAAAAAAAAA", "test")?;
        assert_eq!(
            VaultSyncComparison::new(&yaml, &yaml).decide()?,
            VaultSyncAction::Unchanged
        );
        Ok(())
    }

    #[test]
    fn empty_local_adopts_remote() -> anyhow::Result<()> {
        let remote = sample_yaml(1, "store_AAAAAAAAAAA", "test")?;
        assert_eq!(
            VaultSyncComparison::new("", &remote).decide()?,
            VaultSyncAction::AdoptRemote
        );
        Ok(())
    }

    #[test]
    fn empty_remote_pushes_local() -> anyhow::Result<()> {
        let local = sample_yaml(1, "store_AAAAAAAAAAA", "test")?;
        assert_eq!(
            VaultSyncComparison::new(&local, "").decide()?,
            VaultSyncAction::PushLocal
        );
        Ok(())
    }

    #[test]
    fn higher_remote_version_wins() -> anyhow::Result<()> {
        let local = sample_yaml(1, "store_AAAAAAAAAAA", "a")?;
        let remote = sample_yaml(3, "store_AAAAAAAAAAA", "b")?;
        assert_eq!(
            VaultSyncComparison::new(&local, &remote).decide()?,
            VaultSyncAction::AdoptRemote
        );
        Ok(())
    }

    #[test]
    fn higher_local_version_pushes() -> anyhow::Result<()> {
        let local = sample_yaml(5, "store_AAAAAAAAAAA", "a")?;
        let remote = sample_yaml(2, "store_AAAAAAAAAAA", "b")?;
        assert_eq!(
            VaultSyncComparison::new(&local, &remote).decide()?,
            VaultSyncAction::PushLocal
        );
        Ok(())
    }

    #[test]
    fn same_version_different_content_is_conflict() -> anyhow::Result<()> {
        let local = sample_yaml(2, "store_AAAAAAAAAAA", "a")?;
        let remote = sample_yaml(2, "store_AAAAAAAAAAA", "b")?;
        assert_eq!(
            VaultSyncComparison::new(&local, &remote).decide()?,
            VaultSyncAction::Conflict
        );
        Ok(())
    }

    #[test]
    fn common_hash_allows_single_successor_to_win() -> anyhow::Result<()> {
        let base = sample_yaml(2, "store_AAAAAAAAAAA", "base")?;
        let local = sample_yaml(3, "store_AAAAAAAAAAA", "local")?;
        let remote = base.clone();
        let base_hash = VaultRevision::content_hash(&base);

        assert_eq!(
            VaultSyncComparison::with_common(&local, &remote, CommonContentHash::Known(&base_hash))
                .decide()?,
            VaultSyncAction::PushLocal
        );
        assert_eq!(
            VaultSyncComparison::with_common(&remote, &local, CommonContentHash::Known(&base_hash))
                .decide()?,
            VaultSyncAction::AdoptRemote
        );
        Ok(())
    }

    #[test]
    fn common_hash_rejects_divergent_scalar_winner() -> anyhow::Result<()> {
        let base = sample_yaml(2, "store_AAAAAAAAAAA", "base")?;
        let local = sample_yaml(4, "store_AAAAAAAAAAA", "local")?;
        let remote = sample_yaml(3, "store_AAAAAAAAAAA", "remote")?;
        let base_hash = VaultRevision::content_hash(&base);

        assert_eq!(
            VaultSyncComparison::with_common(&local, &remote, CommonContentHash::Known(&base_hash))
                .decide()?,
            VaultSyncAction::Conflict
        );
        Ok(())
    }

    #[test]
    fn store_id_mismatch_is_error() -> anyhow::Result<()> {
        let local = sample_yaml(1, "store_AAAAAAAAAAA", "")?;
        let remote = sample_yaml(1, "store_BBBBBBBBBBB", "")?;
        assert!(VaultSyncComparison::new(&local, &remote).decide().is_err());
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
