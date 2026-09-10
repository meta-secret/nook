//! Sentinel share delivery and member onboarding boundary.

use crate::NookDatabase;
use crate::SentinelDbLoadSentinelGenesisShareDelivery;
use crate::SentinelDbSaveSentinelGenesisShareDelivery;
use crate::storage::indexed_db::StoredSentinelShareDelivery;
use nook_core::{
    SentinelOnboardingIssuance, SentinelOnboardingPackage, SentinelOnboardingRecipient,
};

use super::super::NookVaultManager;
use super::StoredSentinelGenesisDelivery;
use crate::storage::auth_providers::ProviderSnapshotPublication;

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
        let package = SentinelOnboardingIssuance {
            request,
            delivery,
            provider_snapshot: &provider_snapshot,
        }
        .create()?;
        Ok(package.encode()?)
    }

    /// Accept a member-addressed package, persist this device's encrypted
    /// share, and install the included sync provider credentials locally.
    #[wasm_bindgen]
    pub async fn accept_sentinel_onboarding_package(
        &mut self,
        package_json: String,
    ) -> Result<String, JsError> {
        let package = SentinelOnboardingPackage::decode(&package_json)?;
        let identity = self.ensure_device_identity()?;
        let accepted = SentinelOnboardingRecipient {
            package: &package,
            identity: &identity,
        }
        .accept()?;
        let stored_json = serde_json::to_string(&StoredSentinelGenesisDelivery {
            request: package.request.clone(),
            delivery: package.delivery.clone(),
        })
        .map_err(|error| NookError::Serialization(error.to_string()))?;
        NookDatabase::save_sentinel_genesis_share_delivery(
            SentinelDbSaveSentinelGenesisShareDelivery {
                store_id: package.delivery.store_id.as_str(),
                device_id: identity.device_id().as_str(),
                delivery_json: &stored_json,
            },
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
        for entry in
            NookDatabase::list_sentinel_genesis_share_deliveries(identity.device_id().as_str())
                .await?
        {
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
        let stored_json = match NookDatabase::load_sentinel_genesis_share_delivery(
            SentinelDbLoadSentinelGenesisShareDelivery {
                store_id: store_id.trim(),
                device_id: identity.device_id().as_str(),
            },
        )
        .await?
        {
            StoredSentinelShareDelivery::Delivered(value) => Ok(value),
            StoredSentinelShareDelivery::NotDelivered => Err({
                JsError::new("No Sentinel share delivery exists for this vault and device.")
            }),
        }?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use nook_core::{
        DeviceIdentity, SentinelGenesisDeliveryRecipient, SentinelGenesisRequest,
        SentinelGenesisResponder, SentinelGenesisShareDelivery, SigningIdentity,
        StartSentinelGenesisArgs, StoredSecretRecord,
    };
    use wasm_bindgen_test::wasm_bindgen_test;

    pub(crate) fn delivery_fixture() -> anyhow::Result<(
        SentinelGenesisRequest,
        SentinelGenesisShareDelivery,
        StoredSecretRecord,
    )> {
        let owner = DeviceIdentity::generate()?;
        let member = DeviceIdentity::generate()?;
        let owner_signing = SigningIdentity::generate()?.0;
        let member_signing = SigningIdentity::generate()?.0;
        let session = StartSentinelGenesisArgs {
            label: "Owner".to_owned(),
            participant_count: 2.into(),
            threshold: 2.into(),
        }
        .start(&owner, &owner_signing)?;
        let response = session
            .request()
            .prepare_response(SentinelGenesisResponder {
                identity: &member,
                signing_key: member_signing.signing_key(),
                label: "Member".to_owned(),
            })
            .and_then(nook_core::CheckedSentinelGenesisResponse::sign)?;
        let session = session.collect(response)?;
        let request = session.request().clone();
        let store_id = nook_core::StoreId::generate()?;
        let issued = session
            .prepare(owner_signing.signing_key())?
            .issue(&store_id)?;
        let delivery = issued
            .deliveries
            .into_iter()
            .find(|delivery| delivery.device_id == *member.device_id())
            .ok_or_else(|| anyhow::anyhow!("member delivery must exist"))?;
        let record = delivery
            .check(&SentinelGenesisDeliveryRecipient {
                expected_request: &request,
                identity: &member,
            })?
            .into_record()?;
        Ok((request, delivery, record))
    }

    #[wasm_bindgen_test]
    fn installation_projects_delivery_store_policy_and_share() -> anyhow::Result<()> {
        let (_, delivery, record) = delivery_fixture()?;
        let mut manager = NookVaultManager::new();
        manager.vault.store_id = "stale-store".to_owned();

        manager.install_accepted_sentinel_delivery(&delivery, &record)?;

        assert_eq!(manager.vault.store_id, delivery.store_id.as_str());
        assert_eq!(
            manager.vault.architecture.vault_type,
            nook_core::VaultType::Sentinel
        );
        assert_eq!(manager.vault.meta.sentinel_shares.len(), 1);
        let policy = manager.vault.architecture.sentinel.policy()?;
        assert_eq!(policy.threshold, delivery.policy.threshold);
        assert_eq!(
            policy.required_participants,
            delivery.policy.participant_count
        );
        assert_eq!(policy.ready_participants, 1.into());
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    fn onboarding_wrapper_runs_core_validation_after_json_parsing() -> Result<(), JsError> {
        let (request, delivery, _) =
            tests::delivery_fixture().map_err(|error| JsError::new(&error.to_string()))?;
        let manager = NookVaultManager::new();
        let request_json =
            serde_json::to_string(&request).map_err(|error| JsError::new(&error.to_string()))?;
        let delivery_json =
            serde_json::to_string(&delivery).map_err(|error| JsError::new(&error.to_string()))?;

        assert!(
            manager
                .create_sentinel_onboarding_package(&request_json, "{}", Default::default())
                .is_err()
        );
        assert!(
            manager
                .create_sentinel_onboarding_package(
                    &request_json,
                    &delivery_json,
                    Default::default()
                )
                .is_err()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn onboarding_delivery_guards_fail_closed() -> Result<(), JsError> {
        let mut manager = NookVaultManager::new();
        assert!(
            manager
                .accept_sentinel_onboarding_package("not-a-package".to_owned())
                .await
                .is_err()
        );
        assert!(
            manager
                .list_sentinel_genesis_share_deliveries()
                .await
                .is_err()
        );
        assert!(
            manager
                .load_sentinel_genesis_share_delivery("store".to_owned())
                .await
                .is_err()
        );
        Ok(())
    }
}

impl NookVaultManager {
    pub(super) fn install_accepted_sentinel_delivery(
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
