//! Every vault of an identity opened at its current key epoch through one
//! member's own envelopes: what an approving member, a member adding an app,
//! or a recovery passphrase wraps to the app it admits.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use nook_auth2::{AppKey, StoreId, VaultKeys};
use nook_event_log::{
    EventError, EventId, IdentityControlState, IdentityVaultDekLookup, OpenedVaultDek,
};

use crate::errors::VaultResult;

/// One vault's DEK at its current key epoch.
pub(crate) struct OpenedIdentityVault {
    pub(crate) store_id: StoreId,
    pub(crate) key_epoch: EventId,
    pub(crate) keys: VaultKeys,
}

/// Every vault of the identity, opened.
pub(crate) struct OpenedIdentityVaults(Vec<OpenedIdentityVault>);

impl OpenedIdentityVaults {
    /// Open each vault with the member's own envelope. A vault it holds no
    /// current envelope for fails closed: the member cannot admit anyone.
    pub(crate) fn open(state: &IdentityControlState, app_key: &AppKey) -> VaultResult<Self> {
        state
            .vaults
            .iter()
            .map(|vault| match vault.current_dek_for(app_key.app_id()) {
                IdentityVaultDekLookup::Granted(dek) => Ok(OpenedIdentityVault {
                    store_id: vault.store_id.clone(),
                    key_epoch: vault.current_key_epoch.clone(),
                    keys: VaultKeys {
                        secrets_key: app_key.decrypt_envelope(&dek.secrets_key_ciphertext)?,
                        members_key: app_key.decrypt_envelope(&dek.members_key_ciphertext)?,
                    },
                }),
                IdentityVaultDekLookup::NotGranted => Err(EventError::IdentityApprovalIncomplete {
                    store_id: vault.store_id.as_str().to_owned(),
                }
                .into()),
            })
            .collect::<VaultResult<Vec<_>>>()
            .map(Self)
    }

    /// The opened vaults, as the operation builders take them.
    pub(crate) fn deks(&self) -> Vec<OpenedVaultDek<'_>> {
        self.vaults()
            .iter()
            .map(|vault| OpenedVaultDek {
                store_id: &vault.store_id,
                key_epoch: &vault.key_epoch,
                keys: &vault.keys,
            })
            .collect()
    }

    pub(crate) fn vaults(&self) -> &[OpenedIdentityVault] {
        let Self(vaults) = self;
        vaults
    }
}
