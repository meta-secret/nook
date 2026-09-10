//! Selection and current-installation evidence used while projecting a directory.
use nook_core::{AppId, StoreId};

#[derive(Clone, Copy)]
pub(crate) enum VaultSnapshotScope<'a> {
    Directory,
    Selected(&'a StoreId),
}
pub(super) enum SnapshotVaultSelection {
    Directory,
    Selected(StoreId),
}
impl SnapshotVaultSelection {
    pub(super) fn scope(&self) -> VaultSnapshotScope<'_> {
        match self {
            Self::Directory => VaultSnapshotScope::Directory,
            Self::Selected(store_id) => VaultSnapshotScope::Selected(store_id),
        }
    }
}
pub(crate) enum CurrentAppIdentity {
    Unidentified,
    Identified(AppId),
}
impl CurrentAppIdentity {
    pub(super) fn observe(value: &str) -> Self {
        match AppId::parse(value) {
            Ok(app_id) => Self::Identified(app_id),
            Err(_) => Self::Unidentified,
        }
    }
}
