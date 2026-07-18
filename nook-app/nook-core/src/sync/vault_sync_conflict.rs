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

    #[must_use]
    pub const fn content(&self) -> Option<&ContentSyncConflict> {
        match self {
            Self::Content(conflict) => Some(conflict),
            Self::StoreId(_) => None,
        }
    }

    #[must_use]
    pub const fn store_id(&self) -> Option<&StoreIdSyncConflict> {
        match self {
            Self::Content(_) => None,
            Self::StoreId(conflict) => Some(conflict),
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
        assert_eq!(content.content().map(|value| value.local_version), Some(4));
        assert!(content.store_id().is_none());

        let store_id = VaultSyncConflict::StoreId(StoreIdSyncConflict {
            local_store_id: "local".to_owned(),
            remote_store_id: "remote".to_owned(),
        });
        assert_eq!(store_id.kind(), VaultSyncConflictKind::StoreId);
        assert!(store_id.content().is_none());
        assert_eq!(
            store_id
                .store_id()
                .map(|value| value.remote_store_id.as_str()),
            Some("remote")
        );
    }
}
