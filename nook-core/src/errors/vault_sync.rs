//! Vault sync and revision comparison errors.

use super::vault_format::VaultFormatError;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum VaultSyncError {
    #[error("Vault store_id mismatch: local {local_store}, remote {remote_store}")]
    StoreIdMismatch {
        local_store: String,
        remote_store: String,
    },

    #[error("sync provider {provider_id} disappeared during fan-out")]
    ProviderDisappeared { provider_id: String },

    #[error(transparent)]
    VaultFormat(#[from] VaultFormatError),
}
