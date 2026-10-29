//! Asking the members of a vault the signed-in Google account's Nook folder
//! holds to grant this app access.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use nook_core::StoreId;
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

use super::NookVaultManager;
use crate::storage::provider_vault_listing::DriveVaultListing;

#[wasm_bindgen]
impl NookVaultManager {
    /// Ask the members of a vault in the account's Nook folder to grant this
    /// app access. The request carries this app's public keys only; a member
    /// approves it when its device syncs the vault.
    #[wasm_bindgen]
    pub async fn request_google_drive_vault_access(
        &mut self,
        access_token: String,
        store_id: String,
    ) -> Result<(), JsError> {
        let store_id = StoreId::parse(&store_id)?;
        let root = crate::DriveStorageClient::new(&access_token)
            .existing_nook_root()
            .await?;
        let listing = DriveVaultListing {
            token: &access_token,
            root: &root,
        };
        let events = listing.vault_events(&store_id).await?;
        let app_key = self.device_identity()?;
        let signing = self.ensure_signing_identity().await?;
        let created_at =
            nook_core::IsoTimestamp::parse(&crate::BrowserTimestamp::now().into_iso_string())?;
        let (request, bytes) = nook_core::ProviderVaultAccessRequest {
            store_id: &store_id,
            events,
            app_key: &app_key,
            signing: &signing,
            created_at: &created_at,
        }
        .build()?;
        listing
            .put_vault_event(&store_id, &request.id()?, bytes.as_ref())
            .await?;
        Ok(())
    }
}
