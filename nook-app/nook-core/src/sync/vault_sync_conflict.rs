//! Typed whole-vault sync conflicts.

use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultSyncConflictKind {
    Content,
    StoreId,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContentSyncConflict {
    pub local_version: u64,
    pub remote_version: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoreIdSyncConflict {
    pub local_store_id: String,
    pub remote_store_id: String,
}

/// Variant-specific domain details for a paused whole-vault sync operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VaultSyncConflict {
    Content(ContentSyncConflict),
    StoreId(StoreIdSyncConflict),
}

impl VaultSyncConflict {
    #[must_use]
    pub const fn kind(&self) -> VaultSyncConflictKind {
        match self {
            Self::Content(_) => VaultSyncConflictKind::Content,
            Self::StoreId(_) => VaultSyncConflictKind::StoreId,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conflict_variants_expose_only_their_own_details() {
        let content = VaultSyncConflict::Content(ContentSyncConflict {
            local_version: 4,
            remote_version: 5,
        });
        assert_eq!(content.kind(), VaultSyncConflictKind::Content);
        assert!(matches!(
            content,
            VaultSyncConflict::Content(ContentSyncConflict {
                local_version: 4,
                remote_version: 5
            })
        ));

        let store_id = VaultSyncConflict::StoreId(StoreIdSyncConflict {
            local_store_id: "local".to_owned(),
            remote_store_id: "remote".to_owned(),
        });
        assert_eq!(store_id.kind(), VaultSyncConflictKind::StoreId);
        assert!(matches!(
            store_id,
            VaultSyncConflict::StoreId(StoreIdSyncConflict {
                local_store_id,
                remote_store_id
            }) if local_store_id == "local" && remote_store_id == "remote"
        ));
    }
}
