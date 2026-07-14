//! Cross-origin migration ceremony for the legacy unified web application.

use super::NookVaultManager;
use crate::NookError;
use crate::passkey_browser;
use crate::storage::{auth_providers, indexed_db};
use serde::Deserialize;
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;
use zeroize::Zeroizing;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSentinelGenesisDelivery {
    request: nook_core::SentinelGenesisRequest,
    delivery: nook_core::SentinelGenesisShareDelivery,
}

fn epoch_ms_from_javascript(value: f64) -> Result<u64, NookError> {
    const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;
    if !value.is_finite() || !(0.0..=MAX_SAFE_INTEGER).contains(&value) || value.fract() != 0.0 {
        return Err(nook_core::ValidationError::MigrationRequestInvalid.into());
    }

    // The checks above constrain the value to JavaScript's non-negative safe
    // integer range, so this conversion is exact.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    Ok(value as u64)
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Destination step: create a short-lived, in-memory transport key. Only
    /// the matching isolated application capability may request that vault type.
    #[wasm_bindgen(js_name = beginVaultMigration)]
    pub fn begin_vault_migration(
        &mut self,
        vault_type: &str,
        expires_at_epoch_ms: f64,
    ) -> Result<String, JsError> {
        let vault_type = nook_core::VaultType::parse(vault_type)?;
        self.application.validate_session_access(vault_type)?;
        let (request_json, transport_identity) = nook_core::create_vault_migration_request(
            vault_type,
            epoch_ms_from_javascript(expires_at_epoch_ms)?,
        )?;
        self.migration_request_json = request_json.clone();
        self.migration_transport_identity = Some(transport_identity);
        self.migration_payload = None;
        self.migration_passkey_ready = false;
        Ok(request_json)
    }

    /// Legacy-origin step: after explicit device authorization, collect only
    /// vaults matching the destination request and seal them to its ephemeral key.
    #[wasm_bindgen(js_name = buildVaultMigrationCapsule)]
    pub async fn build_vault_migration_capsule(
        &self,
        request_json: String,
        now_epoch_ms: f64,
    ) -> Result<String, JsError> {
        if self.application != nook_core::VaultApplication::LegacyMigration {
            return Err(nook_core::ValidationError::MigrationApplicationCannotOpenVault.into());
        }
        let identity = self.device_identity()?;
        let now_epoch_ms = epoch_ms_from_javascript(now_epoch_ms)?;
        let requested_type = nook_core::vault_migration_request_type(&request_json, now_epoch_ms)?;
        let mut vault_blobs = Vec::new();
        let mut store_ids = Vec::new();
        for entry in indexed_db::list_vault_registry_entries().await? {
            let Some(blob) = indexed_db::load_vault_blob(&entry.store_id).await? else {
                continue;
            };
            if nook_core::read_vault_architecture(&blob)?.vault_type == requested_type {
                store_ids.push(entry.store_id);
                vault_blobs.push(blob);
            }
        }
        let auth_snapshot_json =
            auth_providers::export_raw_auth_snapshot_for_store_ids(&store_ids).await?;
        let sentinel_share_deliveries = if requested_type == nook_core::VaultType::Sentinel {
            indexed_db::list_sentinel_genesis_share_deliveries(identity.device_id().as_str())
                .await?
                .into_iter()
                .filter(|entry| store_ids.contains(&entry.store_id))
                .map(|entry| {
                    serde_json::to_string(&entry)
                        .map_err(|error| NookError::Serialization(error.to_string()))
                })
                .collect::<Result<Vec<_>, _>>()?
        } else {
            Vec::new()
        };
        Ok(nook_core::build_vault_migration_capsule(
            &request_json,
            now_epoch_ms,
            &identity.secret_string(),
            vault_blobs,
            auth_snapshot_json,
            sentinel_share_deliveries,
        )?)
    }

    /// Destination step: authenticate and decrypt the capsule in Rust. The
    /// plaintext identity remains in WASM memory until a new origin passkey is
    /// created and the import commit succeeds.
    #[wasm_bindgen(js_name = acceptVaultMigrationCapsule)]
    pub async fn accept_vault_migration_capsule(
        &mut self,
        request_json: String,
        capsule_json: String,
        now_epoch_ms: f64,
    ) -> Result<u32, JsError> {
        if request_json != self.migration_request_json {
            return Err(nook_core::ValidationError::MigrationNonceMismatch.into());
        }
        let transport_identity = self
            .migration_transport_identity
            .as_ref()
            .ok_or(nook_core::ValidationError::MigrationRequestInvalid)?;
        let payload = nook_core::open_vault_migration_capsule(
            &request_json,
            &capsule_json,
            epoch_ms_from_javascript(now_epoch_ms)?,
            transport_identity,
        )?;
        self.application
            .validate_session_access(payload.vault_type())?;
        if indexed_db::migration_nonce_was_consumed(payload.nonce()).await? {
            return Err(nook_core::ValidationError::MigrationNonceMismatch.into());
        }
        validate_migration_payload_contents(&payload)?;
        let count = u32::try_from(payload.vault_blobs().len()).unwrap_or(u32::MAX);
        self.migration_payload = Some(payload);
        self.migration_passkey_ready = false;
        Ok(count)
    }

    /// Bind the migrated device identity to a fresh passkey scoped to the new
    /// RP ID, then idempotently install all matching vault-local state.
    #[wasm_bindgen(js_name = finishVaultMigrationWithPasskey)]
    pub async fn finish_vault_migration_with_passkey(
        &mut self,
        rp_id: &str,
        rp_name: &str,
        passkey_label: &str,
    ) -> Result<u32, JsError> {
        let payload = self
            .migration_payload
            .clone()
            .ok_or(nook_core::ValidationError::MigrationRequestInvalid)?;
        if !self.migration_passkey_ready {
            let identity_secret =
                nook_core::DeviceIdentitySecret::parse(payload.device_identity_secret())?;
            let setup = nook_core::DeviceKeyProtectionSetup::generate()?;
            let creation_options = passkey_browser::creation_options(
                rp_id,
                rp_name,
                passkey_label,
                setup.user_handle(),
                setup.prf_input(),
            )?;
            let credential = passkey_browser::create_credential(&creation_options).await?;
            let credential_id = passkey_browser::credential_id(&credential)?;
            let prf_output = if let Some(output) = passkey_browser::prf_output(&credential, true)? {
                Zeroizing::new(output)
            } else {
                let request_options =
                    passkey_browser::request_options(rp_id, &credential_id, setup.prf_input())?;
                let assertion = passkey_browser::get_credential(&request_options).await?;
                Zeroizing::new(passkey_browser::require_prf_output(&assertion)?)
            };
            let material = nook_core::wrap_existing_device_identity_with_passkey(
                &credential_id,
                setup.user_handle(),
                setup.prf_input(),
                prf_output.as_slice(),
                &identity_secret,
            )?;
            self.save_passkey_material(&material).await?;
            self.migration_passkey_ready = true;
        }

        let identity = self.device_identity()?;
        let mut imported = 0u32;
        for blob in payload.vault_blobs() {
            validate_migration_blob_for_application(self.application, blob)?;
            indexed_db::import_vault_blob(blob, None).await?;
            imported = imported.saturating_add(1);
        }
        if let Some(snapshot) = payload.auth_snapshot_json() {
            auth_providers::import_raw_auth_snapshot_json(&identity, snapshot).await?;
        }
        for encoded_entry in payload.sentinel_share_deliveries() {
            let entry: indexed_db::SentinelGenesisShareCatalogEntry =
                serde_json::from_str(encoded_entry)
                    .map_err(|error| NookError::Serialization(error.to_string()))?;
            let stored: StoredSentinelGenesisDelivery = serde_json::from_str(&entry.delivery_json)
                .map_err(|error| NookError::Serialization(error.to_string()))?;
            let _ = nook_core::accept_sentinel_genesis_share_delivery(
                &stored.delivery,
                &stored.request,
                &identity,
            )?;
            if stored.delivery.store_id.as_str() != entry.store_id
                || identity.device_id().as_str() != entry.device_id
            {
                return Err(nook_core::ValidationError::MigrationVaultTypeMismatch.into());
            }
            indexed_db::save_sentinel_genesis_share_delivery(
                &entry.store_id,
                &entry.device_id,
                &entry.delivery_json,
            )
            .await?;
        }
        indexed_db::mark_migration_nonce_consumed(payload.nonce()).await?;
        self.migration_request_json.clear();
        self.migration_transport_identity = None;
        self.migration_payload = None;
        self.migration_passkey_ready = false;
        Ok(imported)
    }
}

fn validate_migration_payload_contents(
    payload: &nook_core::VaultMigrationPayload,
) -> Result<(), NookError> {
    let identity_secret = nook_core::DeviceIdentitySecret::parse(payload.device_identity_secret())?;
    let identity = nook_core::DeviceIdentity::from_secret_str(&identity_secret)?;
    let store_ids = payload
        .vault_blobs()
        .iter()
        .map(|blob| {
            nook_core::read_vault_store_id(blob)?
                .ok_or(nook_core::ValidationError::MigrationRequestInvalid.into())
        })
        .collect::<Result<Vec<_>, NookError>>()?;
    if payload.vault_type() == nook_core::VaultType::Simple
        && !payload.sentinel_share_deliveries().is_empty()
    {
        return Err(nook_core::ValidationError::MigrationVaultTypeMismatch.into());
    }
    if let Some(snapshot) = payload.auth_snapshot_json() {
        auth_providers::validate_raw_auth_snapshot_for_store_ids(snapshot, &store_ids)?;
    }
    for encoded_entry in payload.sentinel_share_deliveries() {
        let entry: indexed_db::SentinelGenesisShareCatalogEntry =
            serde_json::from_str(encoded_entry)
                .map_err(|error| NookError::Serialization(error.to_string()))?;
        let stored: StoredSentinelGenesisDelivery = serde_json::from_str(&entry.delivery_json)
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        let _ = nook_core::accept_sentinel_genesis_share_delivery(
            &stored.delivery,
            &stored.request,
            &identity,
        )?;
        if stored.delivery.store_id.as_str() != entry.store_id
            || identity.device_id().as_str() != entry.device_id
            || !store_ids.contains(&entry.store_id)
        {
            return Err(nook_core::ValidationError::MigrationVaultTypeMismatch.into());
        }
    }
    Ok(())
}

fn validate_migration_blob_for_application(
    application: nook_core::VaultApplication,
    blob: &str,
) -> Result<(), NookError> {
    let architecture = nook_core::read_vault_architecture(blob)?;
    application.validate_session_access(architecture.vault_type)?;
    Ok(())
}
