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

/// Parsed revision metadata from an on-disk vault blob.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultRevision {
    pub version: u64,
    /// SHA-256 hex digest of trimmed UTF-8 content (for conflict detection).
    pub content_hash: String,
    pub store_id: Option<String>,
}

/// Read revision metadata without decrypting secret values.
pub fn read_vault_revision(stored: &str) -> VaultSyncResult<VaultRevision> {
    let trimmed = stored.trim();
    if trimmed.is_empty() {
        return Ok(VaultRevision {
            version: 0,
            content_hash: content_hash(trimmed),
            store_id: None,
        });
    }
    Ok(VaultRevision {
        version: crate::read_vault_version(trimmed)?,
        content_hash: content_hash(trimmed),
        store_id: read_vault_store_id(trimmed)?,
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

    if let (Some(local_store), Some(remote_store)) = (&local_rev.store_id, &remote_rev.store_id)
        && local_store != remote_store
    {
        return Err(VaultSyncError::StoreIdMismatch {
            local_store: local_store.clone(),
            remote_store: remote_store.clone(),
        });
    }

    if local_rev.version < remote_rev.version {
        return Ok(VaultSyncAction::AdoptRemote);
    }
    if local_rev.version > remote_rev.version {
        return Ok(VaultSyncAction::PushLocal);
    }

    if local_rev.content_hash != remote_rev.content_hash {
        return Ok(VaultSyncAction::Conflict);
    }

    Ok(VaultSyncAction::Unchanged)
}

fn content_hash(content: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(content.as_bytes());
    hex::encode(digest)
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
    fn identical_content_is_unchanged() {
        let yaml = sample_yaml(1, "store_AAAAAAAAAAA", "test");
        assert_eq!(
            compare_vault_sync(&yaml, &yaml).unwrap(),
            VaultSyncAction::Unchanged
        );
    }

    #[test]
    fn empty_local_adopts_remote() {
        let remote = sample_yaml(1, "store_AAAAAAAAAAA", "test");
        assert_eq!(
            compare_vault_sync("", &remote).unwrap(),
            VaultSyncAction::AdoptRemote
        );
    }

    #[test]
    fn empty_remote_pushes_local() {
        let local = sample_yaml(1, "store_AAAAAAAAAAA", "test");
        assert_eq!(
            compare_vault_sync(&local, "").unwrap(),
            VaultSyncAction::PushLocal
        );
    }

    #[test]
    fn higher_remote_version_wins() {
        let local = sample_yaml(1, "store_AAAAAAAAAAA", "a");
        let remote = sample_yaml(3, "store_AAAAAAAAAAA", "b");
        assert_eq!(
            compare_vault_sync(&local, &remote).unwrap(),
            VaultSyncAction::AdoptRemote
        );
    }

    #[test]
    fn higher_local_version_pushes() {
        let local = sample_yaml(5, "store_AAAAAAAAAAA", "a");
        let remote = sample_yaml(2, "store_AAAAAAAAAAA", "b");
        assert_eq!(
            compare_vault_sync(&local, &remote).unwrap(),
            VaultSyncAction::PushLocal
        );
    }

    #[test]
    fn same_version_different_content_is_conflict() {
        let local = sample_yaml(2, "store_AAAAAAAAAAA", "a");
        let remote = sample_yaml(2, "store_AAAAAAAAAAA", "b");
        assert_eq!(
            compare_vault_sync(&local, &remote).unwrap(),
            VaultSyncAction::Conflict
        );
    }

    #[test]
    fn store_id_mismatch_is_error() {
        let local = sample_yaml(1, "store_AAAAAAAAAAA", "");
        let remote = sample_yaml(1, "store_BBBBBBBBBBB", "");
        assert!(compare_vault_sync(&local, &remote).is_err());
    }
}
