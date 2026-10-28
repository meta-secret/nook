//! Access checks against the sync provider this manager is connected to or
//! has staged for a recovery: iCloud, GitHub, Google Drive, or a local
//! folder. The provider's identity logs and vault logs are read with the
//! credentials already in the session; nothing is written.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use nook_core::{
    CheckedVaultEvents, CredentialCheckReport, EventLogLocation, IdentityId, LocalEventWrite,
    ProviderIdentityLogEvents, VaultPlacement,
};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};
use zeroize::Zeroizing;

use super::NookVaultManager;
use crate::NookError;
use crate::public_api::SourceContents;
use crate::storage::remote_event::RemoteEventRead;

impl NookVaultManager {
    /// Every vault the current provider files, with the identity filing it,
    /// and those identities' control logs.
    async fn current_provider_contents(&self) -> Result<SourceContents, NookError> {
        let mut vaults = Vec::new();
        let mut identities: Vec<IdentityId> = Vec::new();
        for store_id in self.list_vault_ids_at_current_provider().await? {
            let location = EventLogLocation::Vault(store_id.clone());
            let VaultPlacement::Filed(placed) = self.placed_at_current_provider(&location).await?
            else {
                return Err(NookError::Database(format!(
                    "Vault {store_id} disappeared from the provider during the check."
                )));
            };
            let mut events = Vec::new();
            for event_id in self.list_provider_event_ids_at(&location).await? {
                if let RemoteEventRead::Retrieved(bytes) =
                    self.read_provider_event_at(&location, &event_id).await?
                {
                    events.push(LocalEventWrite { event_id, bytes });
                }
            }
            if !identities.contains(placed.identity()) {
                identities.push(placed.identity().clone());
            }
            vaults.push(CheckedVaultEvents {
                store_id,
                filed_under: placed.identity().clone(),
                events,
            });
        }
        let mut identity_logs = Vec::new();
        for identity_id in identities {
            let location = EventLogLocation::Identity(identity_id.clone());
            let mut events = Vec::new();
            for event_id in self.list_provider_event_ids_at(&location).await? {
                if let RemoteEventRead::Retrieved(bytes) =
                    self.read_provider_event_at(&location, &event_id).await?
                {
                    events.push(bytes);
                }
            }
            identity_logs.push(ProviderIdentityLogEvents {
                identity_id,
                events,
            });
        }
        Ok(SourceContents {
            identity_logs,
            vaults,
        })
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Ask for one passkey and report which of the current provider's vaults
    /// it opens, each proven by decrypting its key and name.
    pub async fn check_passkey_access_at_current_provider(
        &self,
        rp_id: &str,
    ) -> Result<tsify::Ts<CredentialCheckReport>, JsError> {
        self.current_provider_contents()
            .await?
            .check_passkey(rp_id)
            .await
    }

    /// Report which of the current provider's vaults a backup password opens.
    pub async fn check_backup_password_access_at_current_provider(
        &self,
        password: String,
    ) -> Result<tsify::Ts<CredentialCheckReport>, JsError> {
        let password = Zeroizing::new(password);
        self.current_provider_contents()
            .await?
            .check_backup_password(&password)
    }
}
