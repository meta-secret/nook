//! Sentinel share delivery and member onboarding boundary.

use super::super::NookVaultManager;
use super::StoredSentinelGenesisDelivery;
use crate::storage::auth_providers::ProviderSnapshotPublication;
use crate::storage::indexed_db::{
    list_sentinel_genesis_share_deliveries, load_sentinel_genesis_share_delivery,
    save_sentinel_genesis_share_delivery,
};
use crate::{NookError, NookSentinelStoredDeliverySummary};
use nook_core::{DeviceMode, SentinelGenesisPhase, VaultArchitecture, VaultMetaState};
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
impl NookVaultManager {
    /// Build one member-addressed post-genesis package. Provider credentials
    /// are encrypted to the same device key that owns the Sentinel share.
    #[wasm_bindgen]
    #[allow(clippy::needless_pass_by_value)]
    pub fn create_sentinel_onboarding_package(
        &self,
        request_json: &str,
        delivery_json: &str,
        provider_snapshot: nook_core::AuthProvidersSnapshotData,
    ) -> Result<String, JsError> {
        let request: nook_core::SentinelGenesisRequest = serde_json::from_str(request_json)
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        let delivery: nook_core::SentinelGenesisShareDelivery = serde_json::from_str(delivery_json)
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        let package =
            nook_core::create_sentinel_onboarding_package(request, delivery, &provider_snapshot)?;
        Ok(nook_core::encode_sentinel_onboarding_package(&package)?)
    }

    /// Accept a member-addressed package, persist this device's encrypted
    /// share, and install the included sync provider credentials locally.
    #[wasm_bindgen]
    pub async fn accept_sentinel_onboarding_package(
        &mut self,
        package_json: String,
    ) -> Result<String, JsError> {
        let package = nook_core::decode_sentinel_onboarding_package(&package_json)?;
        let identity = self.ensure_device_identity()?;
        let accepted = nook_core::accept_sentinel_onboarding_package(&package, &identity)?;
        let stored_json = serde_json::to_string(&StoredSentinelGenesisDelivery {
            request: package.request.clone(),
            delivery: package.delivery.clone(),
        })
        .map_err(|error| NookError::Serialization(error.to_string()))?;
        save_sentinel_genesis_share_delivery(
            package.delivery.store_id.as_str(),
            identity.device_id().as_str(),
            &stored_json,
        )
        .await?;
        ProviderSnapshotPublication {
            identity: &identity,
            snapshot: &accepted.provider_snapshot,
        }
        .save()
        .await?;
        self.install_accepted_sentinel_delivery(&package.delivery, &accepted.share_record)?;
        self.sentinel_genesis_phase = SentinelGenesisPhase::Complete;
        self.pending_sentinel_genesis_request = super::super::CeremonyState::Inactive;
        Ok(package.delivery.store_id.to_string())
    }

    /// List provider-free Sentinel shares accepted by this protected device.
    #[wasm_bindgen]
    pub async fn list_sentinel_genesis_share_deliveries(
        &self,
    ) -> Result<Vec<NookSentinelStoredDeliverySummary>, JsError> {
        let identity = self.device_identity()?;
        let mut summaries = Vec::new();
        for entry in list_sentinel_genesis_share_deliveries(identity.device_id().as_str()).await? {
            let stored: StoredSentinelGenesisDelivery = serde_json::from_str(&entry.delivery_json)
                .map_err(|error| NookError::Serialization(error.to_string()))?;
            // Revalidate the persisted bundle before advertising it to UI.
            let _ = stored
                .delivery
                .check(&nook_core::SentinelGenesisDeliveryRecipient {
                    expected_request: &stored.request,
                    identity: &identity,
                })
                .and_then(nook_core::CheckedSentinelGenesisDelivery::into_record)?;
            summaries.push(NookSentinelStoredDeliverySummary::from_delivery(
                entry.store_id,
                &stored.delivery,
            ));
        }
        Ok(summaries)
    }

    /// Select a previously accepted provider-free delivery after refresh.
    #[wasm_bindgen]
    pub async fn load_sentinel_genesis_share_delivery(
        &mut self,
        store_id: String,
    ) -> Result<String, JsError> {
        let identity = self.ensure_device_identity()?;
        let stored_json =
            load_sentinel_genesis_share_delivery(store_id.trim(), identity.device_id().as_str())
                .await?
                .ok_or_else(|| {
                    JsError::new("No Sentinel share delivery exists for this vault and device.")
                })?;
        let stored: StoredSentinelGenesisDelivery = serde_json::from_str(&stored_json)
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        let record = stored
            .delivery
            .check(&nook_core::SentinelGenesisDeliveryRecipient {
                expected_request: &stored.request,
                identity: &identity,
            })
            .and_then(nook_core::CheckedSentinelGenesisDelivery::into_record)?;
        self.install_accepted_sentinel_delivery(&stored.delivery, &record)?;
        Ok(serde_json::to_string(&record)
            .map_err(|error| NookError::Serialization(error.to_string()))?)
    }
}

impl NookVaultManager {
    fn install_accepted_sentinel_delivery(
        &mut self,
        delivery: &nook_core::SentinelGenesisShareDelivery,
        record: &nook_core::StoredSecretRecord,
    ) -> Result<(), NookError> {
        let mut meta = VaultMetaState::default();
        meta.apply_record(record)?;
        self.vault.reset();
        self.vault.store_id = delivery.store_id.as_str().to_owned();
        self.vault.architecture = VaultArchitecture::sentinel_personal(
            DeviceMode::Standard,
            nook_core::SentinelPolicy {
                threshold: delivery.policy.threshold,
                required_participants: delivery.policy.participant_count,
                ready_participants: 1.into(),
            },
        );
        self.vault.meta = meta;
        Ok(())
    }
}
