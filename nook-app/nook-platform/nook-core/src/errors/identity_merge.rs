//! Why another identity's vaults cannot merge into the identity in use.

use nook_auth2::{IdentityId, StoreId};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum IdentityMergeError {
    #[error("The identity in use has no control log to record the merge in.")]
    DestinationNotReplicated,

    #[error("This device is not a member of the identity in use.")]
    SignerNotMember,

    #[error("An identity cannot be merged into itself.")]
    IntoItself,

    #[error("The source holds no control log for identity {identity_id}.")]
    IdentityNotHeld { identity_id: IdentityId },

    #[error("This passkey does not open identity {identity_id}.")]
    PasskeyNotMember { identity_id: IdentityId },

    #[error("Identity {identity_id} grants this passkey no current key for vault {store_id}.")]
    VaultKeyNotGranted {
        identity_id: IdentityId,
        store_id: StoreId,
    },

    #[error("The source holds no events for vault {store_id}.")]
    VaultEventsNotHeld { store_id: StoreId },

    #[error("The source files vault {store_id} under more than one identity.")]
    VaultFiledTwice { store_id: StoreId },

    #[error("Vault {store_id} is at another key epoch than its identity grants.")]
    VaultKeyEpochMismatch { store_id: StoreId },

    #[error("Vault {store_id} has an unresolved security conflict.")]
    VaultConflicted { store_id: StoreId },

    #[error("Vault {store_id} already belongs to identity {identity_id} on this browser.")]
    VaultKeptByAnotherLocalIdentity {
        store_id: StoreId,
        identity_id: IdentityId,
    },
}
