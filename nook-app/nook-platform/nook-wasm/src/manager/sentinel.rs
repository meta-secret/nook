//! Sentinel genesis and session-bound quorum unlock for the browser.
//!
//! Plaintext SLIP-0039 shares never cross the WASM boundary. Participants open
//! their local encrypted share inside Rust and return a signed response that is
//! session-bound and encrypted to the requester.

use nook_core::{
    DeviceMode, MultiDeviceError, SentinelConfiguration, SentinelGenesisPhase,
    SentinelUnlockSigning, StoreId, SymmetricKey, VaultArchitecture, VaultMetaState, VaultType,
};
use std::mem;
mod delivery;
mod genesis_finalization;
#[path = "sentinel_policy.rs"]
mod sentinel_policy;
mod unlock_finalization;

use super::{CeremonyState, NookVaultManager, VaultCryptoState, VaultNameState};
use crate::NookError;
use crate::conversion::{LoadedVault, load_stored_vault};
use crate::storage::indexed_db::{
    load_sentinel_genesis_finalization_pending, load_sentinel_genesis_share_delivery,
    save_sentinel_genesis_share_delivery,
};
use crate::{NookSentinelGenesisStatus, NookSentinelUnlockSessionStatus};
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
    /// Start a provider-independent, public-only Sentinel genesis ceremony.
    #[wasm_bindgen]
    pub async fn start_sentinel_genesis(
        &mut self,
        mut args: nook_core::StartSentinelGenesisArgs,
    ) -> Result<NookSentinelGenesisStatus, JsError> {
        let pending = load_sentinel_genesis_finalization_pending().await;
        if self.observe_sentinel_genesis_journal(pending)?.is_some() {
            return Err(JsError::new(
                "A finalized Sentinel setup is awaiting durable completion; retry finalization first.",
            ));
        }
        args.label = args.label.trim().to_owned();
        self.assign_vault_name(&args.label);
        let identity = self.ensure_device_identity()?;
        let signing = self.ensure_signing_identity().await?;
        let session = args.start(&identity, &signing)?;
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
        Ok(serde_json::to_string(session.request())
            .map_err(|error| NookError::Serialization(error.to_string()))?)
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
        let announcement = nook_core::SentinelGenesisPublicKeyAnnouncement::create(
            nook_core::SentinelGenesisResponder {
                identity: &identity,
                signing_key: signing.signing_key(),
                label: participant_label,
            },
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
        let request_json = (nook_core::SentinelGenesisLinkInput {
            input: &request_json,
        })
        .canonical_request()?;
        let request: nook_core::SentinelGenesisRequest = serde_json::from_str(&request_json)
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        let identity = self.ensure_device_identity()?;
        let signing = self.ensure_signing_identity().await?;
        let response = request
            .prepare_response(nook_core::SentinelGenesisResponder {
                identity: &identity,
                signing_key: signing.signing_key(),
                label: participant_label,
            })
            .and_then(nook_core::CheckedSentinelGenesisResponse::sign)?;
        let response_json = serde_json::to_string(&response)
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        self.pending_sentinel_genesis_request = CeremonyState::Active(request);
        Ok(response_json)
    }

    /// Remember the initiator request so a later share delivery can be verified.
    #[wasm_bindgen]
    pub fn remember_sentinel_genesis_request(&mut self, request_json: &str) -> Result<(), JsError> {
        let request_json = (nook_core::SentinelGenesisLinkInput {
            input: request_json,
        })
        .canonical_request()?;
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
        self.sentinel_genesis
            .get("No Sentinel genesis ceremony is active.")?;
        let response_json = (nook_core::SentinelGenesisLinkInput {
            input: response_json,
        })
        .canonical_response()?;
        let session = match mem::replace(&mut self.sentinel_genesis, CeremonyState::Inactive) {
            CeremonyState::Active(session) => session,
            CeremonyState::Inactive => {
                return Err(JsError::new("No Sentinel genesis ceremony is active."));
            }
        };
        let (session, result) = match session.collect_payload(&response_json, participant_label) {
            Ok(session) => (session, Ok(())),
            Err(rejected) => {
                let (session, error) = rejected.into_parts();
                (session, Err(error))
            }
        };
        self.sentinel_genesis_phase = SentinelGenesisPhase::from_session(&session);
        self.sentinel_genesis = CeremonyState::Active(session);
        result?;
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
        let mut session = signing.start_sentinel_unlock(
            store_id,
            nook_core::SentinelUnlockPolicy {
                threshold: policy.threshold,
                required_participants: policy.required_participants,
            },
            &records,
            &identity,
        )?;
        if records.iter().any(|record| {
            record.key.as_str() == nook_core::sentinel_share_record_key(identity.device_id())
        }) {
            let request = session.request();
            let own_response = signing.respond_to_sentinel_unlock_request(
                request,
                &records,
                &identity,
                &signing.public_key(),
            )?;
            session = session
                .collect(own_response)
                .map_err(|rejected| rejected.into_parts().1)?;
        }
        self.sentinel_unlock = CeremonyState::Active(session);
        self.sentinel_unlock_session_status()
    }

    #[wasm_bindgen]
    pub fn sentinel_unlock_request_json(&self) -> Result<String, JsError> {
        let session = self
            .sentinel_unlock
            .get("No Sentinel unlock ceremony is active.")?;
        Ok(serde_json::to_string(&session.request())
            .map_err(|error| NookError::Serialization(error.to_string()))?)
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
            stored
                .delivery
                .check(&nook_core::SentinelGenesisDeliveryRecipient {
                    expected_request: &stored.request,
                    identity: &identity,
                })
                .and_then(nook_core::CheckedSentinelGenesisDelivery::into_record)
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
        let response = signing.respond_to_sentinel_unlock_request(
            request,
            &records,
            &identity,
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
        let session = self.take_sentinel_unlock()?;
        self.sentinel_unlock = match session.collect(response) {
            Ok(session) => CeremonyState::Active(session),
            Err(rejected) => {
                let (session, error) = rejected.into_parts();
                self.sentinel_unlock = CeremonyState::Active(session);
                return Err(error.into());
            }
        };
        self.sentinel_unlock_session_status()
    }

    #[wasm_bindgen]
    pub fn sentinel_unlock_session_status(
        &self,
    ) -> Result<NookSentinelUnlockSessionStatus, JsError> {
        match &self.sentinel_unlock {
            CeremonyState::Active(session) => {
                NookSentinelUnlockSessionStatus::from_status(session.status())
            }
            CeremonyState::Inactive => Ok(NookSentinelUnlockSessionStatus::inactive()),
        }
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
        let record = delivery
            .check(&nook_core::SentinelGenesisDeliveryRecipient {
                expected_request: &request,
                identity: &identity,
            })
            .and_then(nook_core::CheckedSentinelGenesisDelivery::into_record)?;
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

        self.install_accepted_sentinel_delivery(&delivery, &record)?;
        self.pending_sentinel_genesis_request = CeremonyState::Inactive;
        Ok(serde_json::to_string(&record)
            .map_err(|error| NookError::Serialization(error.to_string()))?)
    }
}

impl NookVaultManager {
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
            let meta = VaultMetaState::from_stored_records(&stored_records)?;
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
        let format = nook_core::detect_stored_format(content)?;
        let stored_records = nook_core::deserialize_stored(content, format)?;
        let meta = VaultMetaState::from_stored_records(&stored_records)?;
        let metadata = nook_core::capture_vault_unlock_from_content(content)?;
        self.application
            .validate_session_access(metadata.architecture.vault_type)?;
        let mut architecture = metadata.architecture;
        if let Some(policy) = Self::sentinel_policy_from_shares(&meta)? {
            architecture.vault_type = VaultType::Sentinel;
            architecture.sentinel = SentinelConfiguration::Enabled(policy);
        }
        if architecture.vault_type != VaultType::Sentinel {
            return Err(MultiDeviceError::InvalidSentinelThreshold.into());
        }
        self.vault.unlock = metadata.unlock;
        self.vault.password_entries = metadata.password_entries;
        self.vault.store_id = metadata.store_id;
        self.vault.vault_name = VaultNameState::Named(metadata.vault_name);
        self.vault.vault_version = metadata.version.into();
        self.vault.architecture = architecture;
        self.vault.meta = meta;
        self.vault.secrets_key.clear();
        self.vault.members_key.clear();
        self.vault.crypto = VaultCryptoState::Locked;
        self.vault.last_synced_content = content.to_owned();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_core::{
        AgeArmoredCiphertext, DeviceId, DeviceIdentity, SentinelVaultUnlockState, SigningIdentity,
    };

    #[test]
    fn genesis_status_exposes_public_roster_without_persisting_a_vault() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let (signing, _) = SigningIdentity::generate()?;
        let session = nook_core::StartSentinelGenesisArgs {
            label: "Initiator".to_owned(),
            participant_count: 3.into(),
            threshold: 2.into(),
        }
        .start(&identity, &signing)?;
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
    fn invalid_share_version_preserves_ceremony_session() -> anyhow::Result<()> {
        let keys = nook_core::generate_vault_keys()?;
        let participants = [DeviceIdentity::generate()?, DeviceIdentity::generate()?];
        let records = nook_core::create_sentinel_share_records(&keys, &participants, 2.into())?;
        let architecture = VaultArchitecture::sentinel_personal(
            DeviceMode::Standard,
            nook_core::SentinelPolicy {
                threshold: 2.into(),
                required_participants: 2.into(),
                ready_participants: 2.into(),
            },
        );
        let yaml = nook_core::serialize_stored_yaml_with_unlock_name_architecture(
            &records,
            &nook_core::VaultUnlock::Keys,
            &[],
            nook_core::VaultStoreIdentityRef::Assigned("store_AAAAAAAAAAA"),
            nook_core::VaultNameRef::Unnamed,
            nook_core::VaultVersionWrite::Initial,
            &architecture,
        )?;
        let invalid = yaml.as_str().replacen("\"version\":1", "\"version\":3", 1);
        assert_ne!(invalid, yaml.as_str());

        let mut manager = NookVaultManager::new();
        manager.vault.store_id = "unchanged".to_owned();
        match manager.prepare_sentinel_ceremony_session(&invalid) {
            Err(_) => {}
            Ok(()) => return Err(anyhow::anyhow!("invalid share must be rejected")),
        }
        assert_eq!(manager.vault.store_id, "unchanged");
        assert!(manager.vault.meta.is_empty());
        Ok(())
    }

    #[test]
    fn architecture_is_inferred_from_share_envelopes_without_hardcoded_threshold()
    -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        for (device_id, share_index) in [("0123456789abcdef", 1), ("fedcba9876543210", 2)] {
            manager.vault.meta.sentinel_shares.insert(
                DeviceId::parse(device_id)?,
                nook_core::SentinelShareEnvelope {
                    version: nook_core::SentinelShareVersion::CURRENT,
                    threshold: 3.into(),
                    required_participants: 5.into(),
                    share_index: share_index.into(),
                    ciphertext: AgeArmoredCiphertext::from_trusted("encrypted".to_owned()),
                },
            );
        }

        manager.ensure_sentinel_architecture_from_shares()?;
        let policy = manager.vault.architecture.sentinel.policy()?;
        assert_eq!(u8::from(policy.threshold), 3);
        assert_eq!(u8::from(policy.required_participants), 5);
        assert_eq!(u8::from(policy.ready_participants), 2);
        Ok(())
    }

    #[test]
    fn architecture_rejects_share_policy_above_participant_limit() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        manager.vault.meta.sentinel_shares.insert(
            DeviceId::parse("0123456789abcdef")?,
            nook_core::SentinelShareEnvelope {
                version: nook_core::SentinelShareVersion::CURRENT,
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
                threshold: 3.into(),
                required_participants: 5.into(),
                ready_participants: 5.into(),
            },
        );
        manager.vault.meta.sentinel_shares.insert(
            DeviceId::parse("0123456789abcdef")?,
            nook_core::SentinelShareEnvelope {
                version: nook_core::SentinelShareVersion::CURRENT,
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

    #[test]
    fn architecture_rejects_duplicate_or_mismatched_share_metadata() -> anyhow::Result<()> {
        let duplicate = |second: nook_core::SentinelShareEnvelope| {
            let mut manager = NookVaultManager::new();
            manager.vault.meta.sentinel_shares.insert(
                DeviceId::parse("0123456789abcdef").expect("valid device id"),
                nook_core::SentinelShareEnvelope {
                    version: nook_core::SentinelShareVersion::CURRENT,
                    threshold: 2.into(),
                    required_participants: 3.into(),
                    share_index: 1.into(),
                    ciphertext: AgeArmoredCiphertext::from_trusted("encrypted".to_owned()),
                },
            );
            manager.vault.meta.sentinel_shares.insert(
                DeviceId::parse("fedcba9876543210").expect("valid device id"),
                second,
            );
            manager.ensure_sentinel_architecture_from_shares()
        };

        assert!(
            duplicate(nook_core::SentinelShareEnvelope {
                version: nook_core::SentinelShareVersion::CURRENT,
                threshold: 2.into(),
                required_participants: 3.into(),
                share_index: 1.into(),
                ciphertext: AgeArmoredCiphertext::from_trusted("encrypted".to_owned()),
            })
            .is_err()
        );
        assert!(
            duplicate(nook_core::SentinelShareEnvelope {
                version: nook_core::SentinelShareVersion::CURRENT,
                threshold: 3.into(),
                required_participants: 3.into(),
                share_index: 2.into(),
                ciphertext: AgeArmoredCiphertext::from_trusted("encrypted".to_owned()),
            })
            .is_err()
        );
        Ok(())
    }

    fn sentinel_yaml(
        keys: &nook_core::VaultKeys,
        store_id: &'static str,
    ) -> anyhow::Result<String> {
        let participants = [DeviceIdentity::generate()?, DeviceIdentity::generate()?];
        let records = nook_core::create_sentinel_share_records(keys, &participants, 2.into())?;
        let architecture = VaultArchitecture::sentinel_personal(
            DeviceMode::Standard,
            nook_core::SentinelPolicy {
                threshold: 2.into(),
                required_participants: 2.into(),
                ready_participants: 2.into(),
            },
        );
        Ok(
            nook_core::serialize_stored_yaml_with_unlock_name_architecture(
                &records,
                &nook_core::VaultUnlock::Keys,
                &[],
                nook_core::VaultStoreIdentityRef::Assigned(store_id),
                nook_core::VaultNameRef::Unnamed,
                nook_core::VaultVersionWrite::Initial,
                &architecture,
            )?
            .into_inner(),
        )
    }

    #[test]
    fn prepare_sentinel_ceremony_session_hydrates_valid_share_metadata() -> anyhow::Result<()> {
        let keys = nook_core::generate_vault_keys()?;
        let yaml = sentinel_yaml(&keys, "store_prepare0001")?;
        let mut manager = NookVaultManager::new();

        manager.prepare_sentinel_ceremony_session(&yaml)?;

        assert_eq!(manager.vault.store_id, "store_prepare0001");
        assert_eq!(manager.vault.meta.sentinel_shares.len(), 2);
        assert_eq!(manager.vault.architecture.vault_type, VaultType::Sentinel);
        assert!(manager.vault.secrets_key.is_empty());
        assert!(manager.vault.members_key.is_empty());
        assert!(matches!(manager.vault.crypto, VaultCryptoState::Locked));
        assert_eq!(manager.vault.last_synced_content, yaml);
        Ok(())
    }

    #[test]
    fn prepare_sentinel_ceremony_session_rejects_non_sentinel_architecture() -> anyhow::Result<()> {
        let yaml = nook_core::serialize_stored_yaml_with_unlock_name_architecture(
            &[],
            &nook_core::VaultUnlock::Keys,
            &[],
            nook_core::VaultStoreIdentityRef::Assigned("store_simple_arch"),
            nook_core::VaultNameRef::Unnamed,
            nook_core::VaultVersionWrite::Initial,
            &VaultArchitecture::simple_personal(DeviceMode::Standard),
        )?
        .into_inner();
        let mut manager = NookVaultManager::new();

        assert!(matches!(
            manager.prepare_sentinel_ceremony_session(&yaml),
            Err(NookError::Encryption(message))
                if message == MultiDeviceError::InvalidSentinelThreshold.to_string()
        ));
        assert!(manager.vault.store_id.is_empty());
        Ok(())
    }

    #[test]
    fn loading_sentinel_content_requires_cached_keys_then_hydrates_with_them() -> anyhow::Result<()>
    {
        let keys = nook_core::generate_vault_keys()?;
        let yaml = sentinel_yaml(&keys, "store_loadcache01")?;
        let identity = DeviceIdentity::generate()?;
        let mut manager = NookVaultManager::new();

        assert!(matches!(
            manager.load_stored_vault_or_sentinel_ceremony(&yaml, &identity),
            Err(NookError::Encryption(message))
                if message == MultiDeviceError::SentinelCeremonyRequired.to_string()
        ));

        manager.vault.secrets_key = keys.secrets_key.to_string();
        manager.vault.members_key = keys.members_key.to_string();
        let loaded = manager.load_stored_vault_or_sentinel_ceremony(&yaml, &identity)?;
        assert_eq!(loaded.secrets_key, keys.secrets_key);
        assert_eq!(loaded.members_key, keys.members_key);
        assert_eq!(loaded.meta.sentinel_shares.len(), 2);
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use nook_core::{
        AgeArmoredCiphertext, DeviceId, DeviceIdentity, SentinelVaultUnlockState, SigningIdentity,
    };
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    fn genesis_status_and_inactive_unlock_are_projected() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let (signing, _) = SigningIdentity::generate()?;
        let session = nook_core::StartSentinelGenesisArgs {
            label: "Initiator".to_owned(),
            participant_count: 3.into(),
            threshold: 2.into(),
        }
        .start(&identity, &signing)?;
        let mut manager = NookVaultManager::new();
        manager.sentinel_genesis = CeremonyState::Active(session);
        assert_eq!(
            manager.sentinel_genesis_status().phase(),
            SentinelGenesisPhase::CollectingParticipants
        );
        assert_eq!(manager.sentinel_genesis_status().participants().len(), 1);
        assert!(manager.vault.store_id.is_empty());
        assert_eq!(
            manager.sentinel_unlock_status(),
            SentinelVaultUnlockState::NotSentinel
        );
        assert!(
            manager
                .sentinel_unlock_session_status()
                .map(|status| !status.active())
                .unwrap_or(false)
        );
        assert!(
            manager
                .sentinel_genesis_request_json()
                .map(|request| !request.is_empty())
                .unwrap_or(false)
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn share_policy_inference_and_unlock_states_are_fail_closed() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        manager.vault.meta.sentinel_shares.insert(
            DeviceId::parse("0123456789abcdef")?,
            nook_core::SentinelShareEnvelope {
                version: nook_core::SentinelShareVersion::CURRENT,
                threshold: 3.into(),
                required_participants: 5.into(),
                share_index: 1.into(),
                ciphertext: AgeArmoredCiphertext::from_trusted("encrypted".to_owned()),
            },
        );
        manager.vault.meta.sentinel_shares.insert(
            DeviceId::parse("fedcba9876543210")?,
            nook_core::SentinelShareEnvelope {
                version: nook_core::SentinelShareVersion::CURRENT,
                threshold: 3.into(),
                required_participants: 5.into(),
                share_index: 2.into(),
                ciphertext: AgeArmoredCiphertext::from_trusted("encrypted".to_owned()),
            },
        );
        manager.ensure_sentinel_architecture_from_shares()?;
        let policy = manager.vault.architecture.sentinel.policy()?;
        assert_eq!(u8::from(policy.threshold), 3);
        assert_eq!(u8::from(policy.required_participants), 5);
        assert_eq!(u8::from(policy.ready_participants), 2);
        assert_eq!(
            manager.sentinel_unlock_status(),
            SentinelVaultUnlockState::CeremonyRequired
        );

        manager.vault.meta.sentinel_shares.clear();
        assert_eq!(
            manager.sentinel_unlock_status(),
            SentinelVaultUnlockState::AwaitingShares
        );
        manager.apply_vault_keys(&"a".repeat(64), &"b".repeat(64))?;
        assert_eq!(
            manager.sentinel_unlock_status(),
            SentinelVaultUnlockState::Unlocked
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn invalid_share_policy_does_not_enable_sentinel_architecture() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        manager.vault.meta.sentinel_shares.insert(
            DeviceId::parse("0123456789abcdef")?,
            nook_core::SentinelShareEnvelope {
                version: nook_core::SentinelShareVersion::CURRENT,
                threshold: 2.into(),
                required_participants: 17.into(),
                share_index: 1.into(),
                ciphertext: AgeArmoredCiphertext::from_trusted("encrypted".to_owned()),
            },
        );
        assert!(manager.ensure_sentinel_architecture_from_shares().is_err());
        assert_eq!(manager.vault.architecture.vault_type, VaultType::Simple);
        assert_eq!(
            manager.sentinel_unlock_status(),
            SentinelVaultUnlockState::CeremonyRequired
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn ceremony_projection_and_delivery_completion_are_fail_closed() -> Result<(), JsError> {
        let identity = DeviceIdentity::generate()?;
        let (signing, _) = SigningIdentity::generate()?;
        let session = nook_core::StartSentinelGenesisArgs {
            label: "Initiator".to_owned(),
            participant_count: 2.into(),
            threshold: 2.into(),
        }
        .start(&identity, &signing)?;
        let mut manager = NookVaultManager::new();
        manager.sentinel_genesis = CeremonyState::Active(session);
        assert!(!manager.sentinel_genesis_request_json()?.is_empty());
        assert!(manager.complete_sentinel_genesis_delivery().is_err());
        manager.sentinel_genesis_phase = SentinelGenesisPhase::DeliveringShares;
        assert_eq!(
            manager.complete_sentinel_genesis_delivery()?,
            SentinelGenesisPhase::Complete
        );
        assert_eq!(
            manager.sentinel_genesis_phase(),
            SentinelGenesisPhase::Complete
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn malformed_ceremony_payloads_do_not_discard_active_sessions() -> Result<(), JsError> {
        let identity = DeviceIdentity::generate()?;
        let (signing, _) = SigningIdentity::generate()?;
        let session = nook_core::StartSentinelGenesisArgs {
            label: "Initiator".to_owned(),
            participant_count: 2.into(),
            threshold: 2.into(),
        }
        .start(&identity, &signing)?;
        let mut manager = NookVaultManager::new();
        manager.sentinel_genesis = CeremonyState::Active(session);
        assert!(
            manager
                .add_sentinel_genesis_participant_response("{}", "Participant")
                .is_err()
        );
        assert!(manager.sentinel_genesis_request_json().is_ok());
        assert!(
            manager
                .remember_sentinel_genesis_request("not json")
                .is_err()
        );
        assert!(manager.sentinel_genesis_request_json().is_ok());
        assert!(
            manager
                .create_sentinel_onboarding_package("{}", "{}", Default::default())
                .is_err()
        );
        Ok(())
    }
}
