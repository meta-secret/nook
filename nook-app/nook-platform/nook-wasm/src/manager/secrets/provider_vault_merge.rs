//! Merging a vault the signed-in Google account's Nook folder holds into the
//! vault open on this device.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use nook_core::{
    LocalEventWrite, ProviderVaultGrantedOpening, ProviderVaultPasswordOpening,
    SecretImportUnsupportedRecordCount, SecretValue, StoreId,
};
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;
use zeroize::Zeroizing;

use super::NookVaultManager;
use super::secret_import::SecretImportSource;
use crate::storage::provider_vault_listing::DriveVaultListing;
use crate::{NookError, NookImportResult};

impl NookVaultManager {
    /// The events of one vault in the account's Nook folder.
    async fn google_drive_vault_events(
        access_token: &str,
        store_id: &StoreId,
    ) -> Result<Vec<LocalEventWrite>, NookError> {
        let root = crate::DriveStorageClient::new(access_token)
            .existing_nook_root()
            .await?;
        DriveVaultListing {
            token: access_token,
            root: &root,
        }
        .vault_events(store_id)
        .await
    }

    async fn merge_opened_vault(
        &mut self,
        items: Vec<SecretValue>,
    ) -> Result<NookImportResult, JsError> {
        self.commit_secret_import(
            items,
            SecretImportUnsupportedRecordCount::default(),
            SecretImportSource::ProviderVault,
        )
        .await
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Copy the records of a vault in the account's Nook folder into the open
    /// vault, opened with that vault's backup password. Identical logins are
    /// matched and different passwords kept apart, as any import does; the
    /// source vault stays where it is.
    #[wasm_bindgen]
    pub async fn merge_google_drive_vault_with_password(
        &mut self,
        access_token: String,
        store_id: String,
        password: String,
    ) -> Result<NookImportResult, JsError> {
        let password = Zeroizing::new(password);
        let store_id = StoreId::parse(&store_id)?;
        let events = Self::google_drive_vault_events(&access_token, &store_id).await?;
        let items = ProviderVaultPasswordOpening {
            store_id: &store_id,
            events,
            password: password.as_str(),
        }
        .open_secrets()
        .map_err(|error| NookError::Decryption(error.to_string()))?;
        drop(password);
        self.merge_opened_vault(items).await
    }

    /// Copy the records of a vault a member granted this app into the open
    /// vault, opened with this app's key.
    #[wasm_bindgen]
    pub async fn merge_google_drive_vault_with_app_key(
        &mut self,
        access_token: String,
        store_id: String,
    ) -> Result<NookImportResult, JsError> {
        let store_id = StoreId::parse(&store_id)?;
        let events = Self::google_drive_vault_events(&access_token, &store_id).await?;
        let app_key = self.device_identity()?;
        let items = ProviderVaultGrantedOpening {
            store_id: &store_id,
            events,
            app_key: &app_key,
        }
        .open_secrets()
        .map_err(|error| NookError::Decryption(error.to_string()))?;
        self.merge_opened_vault(items).await
    }

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
