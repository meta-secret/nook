//! Capabilities that select identity migration and local-key replacement paths.
use nook_core::{AppId, AppKey, IdentityId};

#[derive(Clone, Copy)]
pub(crate) enum IdentityMigrationSelection<'a> {
    DirectorySelection,
    PreserveGenesis(&'a IdentityId),
}
#[derive(Clone, Copy)]
pub(crate) enum PriorAppAuthorization<'a> {
    Unavailable,
    Authorized(&'a AppKey),
}
pub(crate) enum PreviousLocalSelection {
    Unselected,
    Selected(AppId),
}
