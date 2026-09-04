//! Sentinel genesis and session-bound quorum unlock for the browser.
//!
//! Plaintext SLIP-0039 shares never cross the WASM boundary. Participants open
//! their local encrypted share inside Rust and return a signed response that is
//! session-bound and encrypted to the requester.

use nook_core::{
    DeviceMode, MultiDeviceError, SentinelConfiguration, SentinelGenesisPhase,
    SentinelVaultUnlockState, StoreId, SymmetricKey, VaultArchitecture, VaultMetaState, VaultType,
};
use std::collections::BTreeSet;
mod genesis_finalization;

use super::verified_access::VerifiedVaultAccessFlow;
use super::{CeremonyState, NookVaultManager, VaultCryptoState};
use crate::NookError;
use crate::conversion::{LoadedVault, load_stored_vault};
use crate::storage::auth_providers::save_auth_providers;
use crate::storage::indexed_db::{
    list_sentinel_genesis_share_deliveries, load_sentinel_genesis_finalization_pending,
    load_sentinel_genesis_share_delivery, save_sentinel_genesis_share_delivery,
};
use crate::{
    NookSecretRecord, NookSentinelGenesisStatus, NookSentinelStoredDeliverySummary,
    NookSentinelUnlockSessionStatus,
};
use serde::{Deserialize, Serialize};
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSentinelGenesisDelivery {
    request: nook_core::SentinelGenesisRequest,
    delivery: nook_core::SentinelGenesisShareDelivery,
}

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
        save_auth_providers(&identity, &accepted.provider_snapshot).await?;
        self.install_accepted_sentinel_delivery(&package.delivery, &accepted.share_record);
        self.sentinel_genesis_phase = SentinelGenesisPhase::Complete;
        self.pending_sentinel_genesis_request = CeremonyState::Inactive;
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
            let _ = nook_core::accept_sentinel_genesis_share_delivery(
                &stored.delivery,
                &stored.request,
                &identity,
            )?;
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
        let record = nook_core::accept_sentinel_genesis_share_delivery(
            &stored.delivery,
            &stored.request,
            &identity,
        )?;
        self.install_accepted_sentinel_delivery(&stored.delivery, &record);
        Ok(serde_json::to_string(&record)
            .map_err(|error| NookError::Serialization(error.to_string()))?)
    }

    /// Start a provider-independent, public-only Sentinel genesis ceremony.
    #[wasm_bindgen]
    pub async fn start_sentinel_genesis(
        &mut self,
        mut args: nook_core::StartSentinelGenesisArgs,
    ) -> Result<NookSentinelGenesisStatus, JsError> {
        if load_sentinel_genesis_finalization_pending()
            .await?
            .is_some()
        {
            return Err(JsError::new(
                "A finalized Sentinel setup is awaiting durable completion; retry finalization first.",
            ));
        }
        args.label = args.label.trim().to_owned();
        self.assign_vault_name(&args.label);
        let identity = self.ensure_device_identity()?;
        let signing = self.ensure_signing_identity().await?;
        let session = nook_core::start_sentinel_genesis(&identity, &signing, args)?;
        self.sentinel_genesis_phase = SentinelGenesisPhase::from_session(&session);
        self.sentinel_genesis = CeremonyState::Active(session);
        Ok(self.sentinel_genesis_status())
    }

    /// Public pairing request rendered as QR/link/paste JSON by the web layer.
    #[wasm_bindgen]
    pub fn sentinel_genesis_request_json(&self) -> Result<String, JsError> {
        let session = self
            .sentinel_genesis
            .get("No Sentinel genesis ceremony is active.")?;
        Ok(
            serde_json::to_string(&nook_core::sentinel_genesis_request(session))
                .map_err(|error| NookError::Serialization(error.to_string()))?,
        )
    }

    /// Create this device's signed public-key announcement for local initiator
    /// key-prep display. Remote enrollment rejects these payloads; participants
    /// must respond to an owner-issued invitation instead.
    #[wasm_bindgen]
    pub async fn create_sentinel_genesis_public_key_announcement(
        &mut self,
        participant_label: String,
    ) -> Result<String, JsError> {
        let identity = self.ensure_device_identity()?;
        let signing = self.ensure_signing_identity().await?;
        let announcement = nook_core::create_sentinel_genesis_public_key_announcement(
            &identity,
            &signing,
            participant_label,
        )?;
        Ok(serde_json::to_string(&announcement)
            .map_err(|error| NookError::Serialization(error.to_string()))?)
    }

    /// Create this device's signed participant response. The exact request is
    /// retained in memory and later required to accept its returned share.
    #[wasm_bindgen]
    pub async fn respond_to_sentinel_genesis_request(
        &mut self,
        request_json: String,
        participant_label: String,
    ) -> Result<String, JsError> {
        let request_json = nook_core::normalize_sentinel_genesis_request(&request_json)?;
        let request: nook_core::SentinelGenesisRequest = serde_json::from_str(&request_json)
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        let identity = self.ensure_device_identity()?;
        let signing = self.ensure_signing_identity().await?;
        let response = nook_core::respond_to_sentinel_genesis_request(
            &request,
            &identity,
            &signing,
            participant_label,
        )?;
        let response_json = serde_json::to_string(&response)
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        self.pending_sentinel_genesis_request = CeremonyState::Active(request);
        Ok(response_json)
    }

    /// Remember the initiator request so a later share delivery can be verified.
    #[wasm_bindgen]
    pub fn remember_sentinel_genesis_request(&mut self, request_json: &str) -> Result<(), JsError> {
        let request_json = nook_core::normalize_sentinel_genesis_request(request_json)?;
        let request: nook_core::SentinelGenesisRequest = serde_json::from_str(&request_json)
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        self.pending_sentinel_genesis_request = CeremonyState::Active(request);
        Ok(())
    }

    /// Verify and add a participant's session-bound response to the active roster.
    /// Standalone public-key announcements are rejected.
    #[wasm_bindgen]
    pub fn add_sentinel_genesis_participant_response(
        &mut self,
        response_json: &str,
        participant_label: &str,
    ) -> Result<NookSentinelGenesisStatus, JsError> {
        let session = self
            .sentinel_genesis
            .get_mut("No Sentinel genesis ceremony is active.")?;
        let response_json =
            nook_core::normalize_sentinel_genesis_participant_payload(response_json)?;
        nook_core::add_sentinel_genesis_participant_payload_with_label(
            session,
            &response_json,
            participant_label,
        )?;
        self.sentinel_genesis_phase = SentinelGenesisPhase::from_session(session);
        Ok(self.sentinel_genesis_status())
    }

    #[wasm_bindgen]
    pub fn sentinel_genesis_status(&self) -> NookSentinelGenesisStatus {
        match &self.sentinel_genesis {
            CeremonyState::Active(session) => NookSentinelGenesisStatus::from_session(session),
            CeremonyState::Inactive => {
                NookSentinelGenesisStatus::from_phase(self.sentinel_genesis_phase)
            }
        }
    }

    #[wasm_bindgen(getter, js_name = sentinelGenesisPhase)]
    pub fn sentinel_genesis_phase(&self) -> nook_core::SentinelGenesisPhase {
        self.sentinel_genesis_phase
    }

    /// Record browser delivery completion after the host has activated the new
    /// vault and refreshed its local catalog.
    #[wasm_bindgen]
    pub fn complete_sentinel_genesis_delivery(
        &mut self,
    ) -> Result<nook_core::SentinelGenesisPhase, JsError> {
        self.sentinel_genesis_phase = self
            .sentinel_genesis_phase
            .complete_delivery()
            .ok_or_else(|| JsError::new("Sentinel share delivery is not awaiting completion."))?;
        Ok(self.sentinel_genesis_phase)
    }

    /// Start a signed, session-bound quorum unlock request. No opened share is
    /// returned to JavaScript.
    #[wasm_bindgen]
    pub async fn start_sentinel_unlock(
        &mut self,
    ) -> Result<NookSentinelUnlockSessionStatus, JsError> {
        let identity = self.ensure_device_identity()?;
        let signing = self.ensure_signing_identity().await?;
        let policy = self.vault.architecture.sentinel.policy()?;
        let store_id = StoreId::parse(&self.vault.store_id)?;
        let records = self.stored_records_snapshot();
        let mut session = nook_core::start_sentinel_unlock(
            store_id,
            nook_core::SentinelUnlockPolicy {
                threshold: policy.threshold.into(),
                required_participants: policy.required_participants.into(),
            },
            &records,
            &identity,
            &signing,
        )?;
        if records.iter().any(|record| {
            record.key.as_str() == nook_core::sentinel_share_record_key(identity.device_id())
        }) {
            let request = nook_core::sentinel_unlock_request(&session);
            let own_response = nook_core::respond_to_sentinel_unlock_request(
                &request,
                &records,
                &identity,
                &signing,
                &signing.public_key(),
            )?;
            nook_core::add_sentinel_unlock_response(&mut session, own_response)?;
        }
        self.sentinel_unlock = CeremonyState::Active(session);
        self.sentinel_unlock_session_status()
    }

    #[wasm_bindgen]
    pub fn sentinel_unlock_request_json(&self) -> Result<String, JsError> {
        let session = self
            .sentinel_unlock
            .get("No Sentinel unlock ceremony is active.")?;
        Ok(
            serde_json::to_string(&nook_core::sentinel_unlock_request(session))
                .map_err(|error| NookError::Serialization(error.to_string()))?,
        )
    }

    /// Open this participant's local share only inside Rust and return an opaque
    /// response encrypted to the requester and bound to its signed challenge.
    #[wasm_bindgen]
    pub async fn respond_to_sentinel_unlock_request(
        &mut self,
        request_json: String,
    ) -> Result<String, JsError> {
        let request: nook_core::SentinelUnlockRequest = serde_json::from_str(&request_json)
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        let identity = self.ensure_device_identity()?;
        if request.store_id.as_str() != self.vault.store_id {
            return Err(MultiDeviceError::InvalidSentinelUnlockSession.into());
        }
        let signing = self.ensure_signing_identity().await?;
        let records = self.stored_records_snapshot();
        let authorized_signing_key = if let Some(participant) = self
            .vault
            .meta
            .sentinel_participants
            .get(&request.requester_device_id)
            .filter(|participant| {
                participant.encryption_public_key == request.requester_encryption_public_key
            }) {
            participant.signing_public_key.clone()
        } else {
            let stored_json = load_sentinel_genesis_share_delivery(
                request.store_id.as_str(),
                identity.device_id().as_str(),
            )
            .await?
            .ok_or(MultiDeviceError::InvalidSentinelUnlockPayload)?;
            let stored: StoredSentinelGenesisDelivery = serde_json::from_str(&stored_json)
                .map_err(|error| NookError::Serialization(error.to_string()))?;
            nook_core::accept_sentinel_genesis_share_delivery(
                &stored.delivery,
                &stored.request,
                &identity,
            )
            .map_err(|_| MultiDeviceError::InvalidSentinelUnlockPayload)?;
            if stored.request.initiator_device_id != request.requester_device_id
                || stored.delivery.store_id != request.store_id
                || stored.delivery.policy.threshold != request.policy.threshold
                || stored.delivery.policy.participant_count != request.policy.required_participants
            {
                return Err(MultiDeviceError::InvalidSentinelUnlockPayload.into());
            }
            stored.request.initiator_signing_public_key
        };
        let response = nook_core::respond_to_sentinel_unlock_request(
            &request,
            &records,
            &identity,
            &signing,
            &authorized_signing_key,
        )?;
        Ok(serde_json::to_string(&response)
            .map_err(|error| NookError::Serialization(error.to_string()))?)
    }

    #[wasm_bindgen]
    pub fn add_sentinel_unlock_response(
        &mut self,
        response_json: &str,
    ) -> Result<NookSentinelUnlockSessionStatus, JsError> {
        let response: nook_core::SentinelUnlockResponse = serde_json::from_str(response_json)
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        let session = self
            .sentinel_unlock
            .get_mut("No Sentinel unlock ceremony is active.")?;
        nook_core::add_sentinel_unlock_response(session, response)?;
        self.sentinel_unlock_session_status()
    }

    #[wasm_bindgen]
    pub fn sentinel_unlock_session_status(
        &self,
    ) -> Result<NookSentinelUnlockSessionStatus, JsError> {
        match &self.sentinel_unlock {
            CeremonyState::Active(session) => NookSentinelUnlockSessionStatus::from_status(
                nook_core::sentinel_unlock_status(session),
            ),
            CeremonyState::Inactive => Ok(NookSentinelUnlockSessionStatus::inactive()),
        }
    }

    #[wasm_bindgen]
    pub async fn finalize_sentinel_unlock(&mut self) -> Result<Vec<NookSecretRecord>, JsError> {
        let identity = self.ensure_device_identity()?;
        let session = self
            .sentinel_unlock
            .get("No Sentinel unlock ceremony is active.")?
            .clone();
        let keys = nook_core::finalize_sentinel_unlock(session, &identity)?;
        let records = self.stored_records_snapshot();
        self.apply_vault_keys(keys.secrets_key.as_str(), keys.members_key.as_str())?;
        self.vault.meta = VaultMetaState::from_stored_records(&records);
        if self.event_log_has_events().await? {
            self.apply_event_projection_to_session().await?;
        }
        self.persist_projection_cache().await?;
        self.purge_legacy_plaintext_search_catalog().await?;
        let records = VerifiedVaultAccessFlow::SentinelUnlock
            .complete(
                self.get_records(),
                identity.device_id(),
                &self.vault.store_id,
            )
            .await?;
        self.sentinel_unlock = CeremonyState::Inactive;
        Ok(records)
    }

    /// Verify this participant's returned share against the exact request it
    /// answered, then persist the encrypted delivery without a sync provider.
    #[wasm_bindgen]
    pub async fn accept_sentinel_genesis_share_delivery(
        &mut self,
        delivery_json: String,
    ) -> Result<String, JsError> {
        let delivery: nook_core::SentinelGenesisShareDelivery =
            serde_json::from_str(&delivery_json)
                .map_err(|error| NookError::Serialization(error.to_string()))?;
        let request = self
            .pending_sentinel_genesis_request
            .get("Paste the initiator request in the share section before accepting delivery.")?
            .clone();
        let identity = self.ensure_device_identity()?;
        let record =
            nook_core::accept_sentinel_genesis_share_delivery(&delivery, &request, &identity)?;
        let stored = StoredSentinelGenesisDelivery {
            request,
            delivery: delivery.clone(),
        };
        let stored_json = serde_json::to_string(&stored)
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        save_sentinel_genesis_share_delivery(
            delivery.store_id.as_str(),
            identity.device_id().as_str(),
            &stored_json,
        )
        .await?;

        self.install_accepted_sentinel_delivery(&delivery, &record);
        self.pending_sentinel_genesis_request = CeremonyState::Inactive;
        Ok(serde_json::to_string(&record)
            .map_err(|error| NookError::Serialization(error.to_string()))?)
    }

    /// Typed Sentinel unlock state for clients.
    #[wasm_bindgen]
    pub fn sentinel_unlock_status(&self) -> nook_core::SentinelVaultUnlockState {
        if !self.is_sentinel_session() {
            return SentinelVaultUnlockState::NotSentinel;
        }
        if !self.vault.secrets_key.is_empty() && !self.vault.members_key.is_empty() {
            return SentinelVaultUnlockState::Unlocked;
        }
        if self.vault.meta.sentinel_shares.is_empty() {
            SentinelVaultUnlockState::AwaitingShares
        } else {
            // Opening the one share addressed to this device is independent of
            // the reconstruction threshold. Only the later combine step needs T.
            SentinelVaultUnlockState::CeremonyRequired
        }
    }
}

impl NookVaultManager {
    fn install_accepted_sentinel_delivery(
        &mut self,
        delivery: &nook_core::SentinelGenesisShareDelivery,
        record: &nook_core::StoredSecretRecord,
    ) {
        self.vault.reset();
        self.vault.store_id = delivery.store_id.as_str().to_owned();
        self.vault.architecture = VaultArchitecture::sentinel_personal(
            DeviceMode::Standard,
            nook_core::SentinelPolicy {
                threshold: delivery.policy.threshold.into(),
                required_participants: delivery.policy.participant_count.into(),
                ready_participants: 1,
            },
        );
        self.vault.meta.apply_record(record);
    }

    /// Load vault content for sentinel only when session keys already exist;
    /// otherwise fail closed with ceremony-required.
    pub(in crate::manager) fn load_stored_vault_or_sentinel_ceremony(
        &self,
        content: &str,
        identity: &nook_core::DeviceIdentity,
    ) -> Result<LoadedVault, NookError> {
        let architecture = nook_core::read_vault_architecture(content)
            .unwrap_or_else(|_| self.vault.architecture.clone());
        if architecture.vault_type == VaultType::Sentinel {
            if self.vault.secrets_key.is_empty() || self.vault.members_key.is_empty() {
                return Err(MultiDeviceError::SentinelCeremonyRequired.into());
            }
            // Session already holds reconstructed keys — hydrate records without
            // resolving auth envelopes.
            let format = nook_core::detect_stored_format(content)?;
            let stored_records = nook_core::deserialize_stored(content, format)?;
            let secrets_key = SymmetricKey::parse(&self.vault.secrets_key)?;
            let members_key = SymmetricKey::parse(&self.vault.members_key)?;
            let meta = VaultMetaState::from_stored_records(&stored_records);
            return Ok(LoadedVault {
                meta,
                secrets_key,
                members_key,
            });
        }
        load_stored_vault(content, identity)
    }

    /// Hydrate architecture + encrypted share meta without vault keys so the
    /// browser can open a local contribution and run the ceremony UI.
    pub(in crate::manager) fn prepare_sentinel_ceremony_session(
        &mut self,
        content: &str,
    ) -> Result<(), NookError> {
        self.capture_vault_unlock(content)?;
        let format = nook_core::detect_stored_format(content)?;
        let stored_records = nook_core::deserialize_stored(content, format)?;
        self.vault.meta = VaultMetaState::from_stored_records(&stored_records);
        self.ensure_sentinel_architecture_from_shares()?;
        if !self.is_sentinel_session() {
            return Err(MultiDeviceError::InvalidSentinelThreshold.into());
        }
        self.vault.secrets_key.clear();
        self.vault.members_key.clear();
        self.vault.crypto = VaultCryptoState::Locked;
        self.vault.last_synced_content = content.to_owned();
        Ok(())
    }

    fn is_sentinel_session(&self) -> bool {
        self.vault.architecture.vault_type == VaultType::Sentinel
            || !self.vault.meta.sentinel_shares.is_empty()
    }

    /// Joiners may sync share events before architecture JSON is adopted.
    pub(in crate::manager) fn ensure_sentinel_architecture_from_shares(
        &mut self,
    ) -> Result<(), NookError> {
        if self.vault.meta.sentinel_shares.is_empty() {
            return Ok(());
        }
        let mut shares = self.vault.meta.sentinel_shares.values();
        let first = shares
            .next()
            .ok_or(MultiDeviceError::InvalidSentinelShareEncoding)?;
        let version = first.version;
        let threshold = u8::from(first.threshold);
        let required = u8::from(first.required_participants);
        let mut indexes = BTreeSet::new();
        indexes.insert(u8::from(first.share_index));
        if !matches!(version, 1 | 2)
            || threshold < 2
            || threshold > required
            || required > 16
            || u8::from(first.share_index) == 0
            || u8::from(first.share_index) > required
            || shares.any(|share| {
                share.version != version
                    || u8::from(share.threshold) != threshold
                    || u8::from(share.required_participants) != required
                    || u8::from(share.share_index) == 0
                    || u8::from(share.share_index) > required
                    || !indexes.insert(share.share_index.into())
            })
        {
            return Err(MultiDeviceError::InvalidSentinelShareEncoding.into());
        }
        let share_count = u8::try_from(self.vault.meta.sentinel_shares.len())
            .map_err(|_| MultiDeviceError::InvalidSentinelThreshold)?;
        self.vault.architecture.vault_type = VaultType::Sentinel;
        self.vault.architecture.sentinel =
            SentinelConfiguration::Enabled(nook_core::SentinelPolicy {
                threshold,
                required_participants: required,
                ready_participants: share_count,
            });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_core::{AgeArmoredCiphertext, DeviceId, DeviceIdentity, SigningIdentity};

    #[test]
    fn genesis_status_exposes_public_roster_without_persisting_a_vault() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let (signing, _) = SigningIdentity::generate()?;
        let session = nook_core::start_sentinel_genesis(
            &identity,
            &signing,
            nook_core::StartSentinelGenesisArgs {
                label: "Initiator".to_owned(),
                participant_count: 3,
                threshold: 2,
            },
        )?;
        let mut manager = NookVaultManager::new();
        manager.sentinel_genesis = CeremonyState::Active(session);

        let mut status = manager.sentinel_genesis_status();
        assert_eq!(status.phase(), SentinelGenesisPhase::CollectingParticipants);
        assert_eq!(status.participants().len(), 1);
        assert!(manager.vault.store_id.is_empty());
        Ok(())
    }

    #[test]
    fn inactive_genesis_status_is_explicit() {
        let manager = NookVaultManager::new();
        let status = manager.sentinel_genesis_status();
        assert_eq!(status.phase(), SentinelGenesisPhase::Inactive);
    }

    #[test]
    fn architecture_is_inferred_from_share_envelopes_without_hardcoded_threshold()
    -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        for (device_id, share_index) in [("0123456789abcdef", 1), ("fedcba9876543210", 2)] {
            manager.vault.meta.sentinel_shares.insert(
                DeviceId::parse(device_id)?,
                nook_core::SentinelShareEnvelope {
                    version: 2,
                    threshold: 3.into(),
                    required_participants: 5.into(),
                    share_index: share_index.into(),
                    ciphertext: AgeArmoredCiphertext::from_trusted("encrypted".to_owned()),
                },
            );
        }

        manager.ensure_sentinel_architecture_from_shares()?;
        let policy = manager.vault.architecture.sentinel.policy()?;
        assert_eq!(policy.threshold, 3);
        assert_eq!(policy.required_participants, 5);
        assert_eq!(policy.ready_participants, 2);
        Ok(())
    }

    #[test]
    fn architecture_rejects_share_policy_above_participant_limit() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        manager.vault.meta.sentinel_shares.insert(
            DeviceId::parse("0123456789abcdef")?,
            nook_core::SentinelShareEnvelope {
                version: 2,
                threshold: 2.into(),
                required_participants: 17.into(),
                share_index: 1.into(),
                ciphertext: AgeArmoredCiphertext::from_trusted("encrypted".to_owned()),
            },
        );

        assert!(manager.ensure_sentinel_architecture_from_shares().is_err());
        assert_eq!(manager.vault.architecture.vault_type, VaultType::Simple);
        assert_eq!(
            manager.vault.architecture.sentinel,
            SentinelConfiguration::Disabled
        );
        Ok(())
    }

    #[test]
    fn one_local_share_is_openable_before_reconstruction_quorum() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        manager.vault.architecture = VaultArchitecture::sentinel_personal(
            DeviceMode::Standard,
            nook_core::SentinelPolicy {
                threshold: 3,
                required_participants: 5,
                ready_participants: 5,
            },
        );
        manager.vault.meta.sentinel_shares.insert(
            DeviceId::parse("0123456789abcdef")?,
            nook_core::SentinelShareEnvelope {
                version: 2,
                threshold: 3.into(),
                required_participants: 5.into(),
                share_index: 1.into(),
                ciphertext: AgeArmoredCiphertext::from_trusted("encrypted".to_owned()),
            },
        );
        assert_eq!(
            manager.sentinel_unlock_status(),
            SentinelVaultUnlockState::CeremonyRequired
        );
        Ok(())
    }
}
