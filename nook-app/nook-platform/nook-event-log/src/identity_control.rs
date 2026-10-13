//! Replicated, signed identity control log.
//!
//! The identity control log is the membership authority for an identity: its
//! app-key members, pending joins, revocations, per-vault DEK envelopes, and
//! credential-free sync-provider mounts. Events reuse the vault log's
//! canonical JSON, Ed25519 actor signatures, and causal DAG mechanics, but
//! live in their own namespace and never mix with vault events.

mod builder;
mod graph;
mod migration;
mod projection;
mod wire;

#[cfg(test)]
mod tests;

pub use builder::{
    IdentityApprovalRequest, IdentityEventSigning, IdentityGenesisRequest,
    IdentityVaultRegistration, OpenedVaultDek,
};
pub use graph::{
    IdentityControlInsertion, IdentityControlLog, IdentityControlRejection,
    IdentityEventInsertStatus,
};
pub use migration::{
    IdentityControlMigration, IdentityControlMigrationOutcome, LegacyVaultMembership,
};
pub use projection::{
    IdentityControlMember, IdentityControlState, IdentityControlVault, IdentityJoinRequest,
    IdentityVaultDekLookup, IdentityVaultEpochDeks,
};
pub use wire::{
    DriveMountTarget, ICloudMountTarget, IdentityControlOperation, IdentityEvent,
    IdentityEventBody, IdentityEventSchemaVersion, IdentityMemberKeys, IdentityMountTarget,
    IdentityProviderMount, IdentityVaultDekGrant, MemberVaultDek, ProviderMountId,
    ProviderMountLayout,
};
