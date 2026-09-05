//! Atomic core integration for provider-independent Sentinel genesis.

use crate::{MemberLabel, MultiDeviceError, SentinelConfiguration, VaultOperation};

use crate::i18n_keys;
use crate::{
    DeviceIdentity, DeviceMode, ReadySentinelGenesis, ReplicationType, SentinelGenesisReadiness,
    SentinelGenesisSession, SentinelGenesisShareDelivery, SentinelPolicy, SigningIdentity,
    StoredSecretRecord, VaultArchitecture, VaultType,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

/// Typed command for starting a Sentinel genesis ceremony.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct StartSentinelGenesisArgs {
    pub label: String,
    pub participant_count: u8,
    pub threshold: u8,
}

/// Portable Sentinel setup phase shared by every host.
///
/// Hosts may separately track request-in-flight state while a transition is
/// being performed; that transient UI state is not a genesis phase.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SentinelGenesisPhase {
    Inactive,
    CollectingParticipants,
    ReadyToFinalize,
    DeliveringShares,
    Complete,
    AwaitingCompletionCheck,
}

impl SentinelGenesisPhase {
    #[must_use]
    pub fn from_session(session: &SentinelGenesisSession) -> Self {
        if session.readiness() == SentinelGenesisReadiness::Complete {
            Self::ReadyToFinalize
        } else {
            Self::CollectingParticipants
        }
    }

    #[must_use]
    pub const fn translation_key(self) -> &'static str {
        match self {
            Self::Inactive => i18n_keys::LOGIN_SENTINEL_GENESIS_PHASE_INACTIVE,
            Self::CollectingParticipants => {
                i18n_keys::LOGIN_SENTINEL_GENESIS_PHASE_COLLECTING_PARTICIPANTS
            }
            Self::ReadyToFinalize => i18n_keys::LOGIN_SENTINEL_GENESIS_PHASE_READY_TO_FINALIZE,
            Self::DeliveringShares => i18n_keys::LOGIN_SENTINEL_GENESIS_PHASE_DELIVERING_SHARES,
            Self::Complete => i18n_keys::LOGIN_SENTINEL_GENESIS_PHASE_COMPLETE,
            Self::AwaitingCompletionCheck => {
                i18n_keys::LOGIN_SENTINEL_GENESIS_PHASE_AWAITING_COMPLETION_CHECK
            }
        }
    }

    #[must_use]
    pub const fn complete_delivery(self) -> Option<Self> {
        if matches!(self, Self::DeliveringShares) {
            Some(Self::Complete)
        } else {
            None
        }
    }
}

/// Complete, persistable Sentinel genesis result. It contains no full-key device
/// envelope. `keys` are intentionally not exposed here; callers open the new
/// vault through the same threshold-share ceremony used after reload/import.
pub struct SentinelGenesisOutput {
    pub store_id: crate::StoreId,
    pub architecture: VaultArchitecture,
    pub stored_records: Vec<StoredSecretRecord>,
    pub participant_deliveries: Vec<SentinelGenesisShareDelivery>,
    pub participants: Vec<crate::SentinelGenesisParticipant>,
}

/// Complete public genesis operations for an event-log root. Member enrollment
/// and encrypted shares are emitted together so event-only materialization
/// never loses the Sentinel roster.
#[must_use]
pub fn sentinel_genesis_operations(output: &SentinelGenesisOutput) -> Vec<crate::VaultOperation> {
    let mut operations = output
        .participants
        .iter()
        .map(|participant| VaultOperation::SentinelParticipantEnrolled {
            device_id: participant.device_id.clone(),
            encryption_public_key: participant.encryption_public_key.clone(),
            signing_public_key: participant.signing_public_key.clone(),
            label: MemberLabel::from_trusted(participant.label.clone()),
        })
        .collect::<Vec<_>>();
    operations.push(VaultOperation::SentinelSharesIssued {
        shares: output
            .participant_deliveries
            .iter()
            .map(|delivery| crate::SentinelShareIssuedPayload {
                device_id: delivery.device_id.clone(),
                version: delivery.share.version,
                threshold: delivery.share.threshold.into(),
                required_participants: delivery.share.required_participants.into(),
                share_index: delivery.share.share_index.into(),
                ciphertext: delivery.share.ciphertext.clone(),
            })
            .collect(),
    });
    operations
}

impl StartSentinelGenesisArgs {
    pub fn start(
        self,
        identity: &DeviceIdentity,
        signing: &SigningIdentity,
    ) -> Result<SentinelGenesisSession, crate::MultiDeviceError> {
        SentinelGenesisSession::start(
            identity,
            signing.signing_key(),
            self.participant_count.into(),
            self.threshold.into(),
            self.label,
        )
    }
}

pub fn create_sentinel_genesis_public_key_announcement(
    identity: &DeviceIdentity,
    signing: &SigningIdentity,
    label: String,
) -> Result<crate::SentinelGenesisPublicKeyAnnouncement, crate::MultiDeviceError> {
    nook_auth2::create_sentinel_genesis_public_key_announcement(
        identity,
        signing.signing_key(),
        label,
    )
}

pub fn respond_to_sentinel_genesis_request(
    request: &crate::SentinelGenesisRequest,
    identity: &DeviceIdentity,
    signing: &SigningIdentity,
    label: String,
) -> Result<crate::SentinelGenesisParticipantResponse, crate::MultiDeviceError> {
    nook_auth2::respond_to_sentinel_genesis_request(request, identity, signing.signing_key(), label)
}

/// Generate keys, encrypted member rows, and the complete encrypted share set
/// as one result after all `N` signed participant responses are verified.
impl SentinelGenesisOutput {
    pub fn from_ready(
        ready: ReadySentinelGenesis<'_>,
    ) -> Result<SentinelGenesisOutput, crate::MultiDeviceError> {
        let store_id = crate::generate_store_id()?;
        let issued = ready.issue(&store_id)?;
        let policy = issued
            .deliveries
            .first()
            .map(|delivery| delivery.policy)
            .ok_or(MultiDeviceError::InvalidSentinelGenesisPayload)?;
        let stored_records = issued.records;
        let architecture = VaultArchitecture {
            device_mode: DeviceMode::Standard,
            vault_type: VaultType::Sentinel,
            // Compatibility-only persisted field; it does not affect Sentinel
            // genesis, readiness, quorum, or later provider configuration.
            replication_type: ReplicationType::Personal,
            sentinel: SentinelConfiguration::Enabled(SentinelPolicy {
                threshold: policy.threshold.into(),
                required_participants: policy.participant_count.into(),
                ready_participants: policy.participant_count.into(),
            }),
        };
        architecture.validate_records(&stored_records)?;
        Ok(SentinelGenesisOutput {
            store_id,
            architecture,
            stored_records,
            participants: issued.participants,
            participant_deliveries: issued.deliveries,
        })
    }
}

#[cfg(test)]
mod tests {
    use crate::VaultMetaState;

    use super::*;
    use crate::{SentinelGenesisParticipantResponse, VaultMetaRecord};

    #[test]
    fn appended_completion_phase_preserves_public_discriminants() {
        for (phase, discriminant) in [
            (SentinelGenesisPhase::Inactive, 0),
            (SentinelGenesisPhase::CollectingParticipants, 1),
            (SentinelGenesisPhase::ReadyToFinalize, 2),
            (SentinelGenesisPhase::DeliveringShares, 3),
            (SentinelGenesisPhase::Complete, 4),
            (SentinelGenesisPhase::AwaitingCompletionCheck, 5),
        ] {
            assert_eq!(phase as u32, discriminant);
        }
    }

    #[test]
    fn core_finalization_has_no_full_key_envelope() -> crate::VaultResult<()> {
        assert_eq!(
            SentinelGenesisPhase::CollectingParticipants.translation_key(),
            i18n_keys::LOGIN_SENTINEL_GENESIS_PHASE_COLLECTING_PARTICIPANTS
        );
        assert_eq!(
            SentinelGenesisPhase::DeliveringShares.complete_delivery(),
            Some(SentinelGenesisPhase::Complete)
        );
        assert_eq!(
            SentinelGenesisPhase::ReadyToFinalize.complete_delivery(),
            None
        );
        let owner = DeviceIdentity::generate()?;
        let (owner_signing, _) = SigningIdentity::generate()?;
        let session = StartSentinelGenesisArgs {
            label: "Owner".to_owned(),
            participant_count: 2,
            threshold: 2,
        }
        .start(&owner, &owner_signing)?;
        assert_eq!(
            SentinelGenesisPhase::from_session(&session),
            SentinelGenesisPhase::CollectingParticipants
        );
        let peer = DeviceIdentity::generate()?;
        let (peer_signing, _) = SigningIdentity::generate()?;
        let response: SentinelGenesisParticipantResponse = respond_to_sentinel_genesis_request(
            session.request(),
            &peer,
            &peer_signing,
            "Peer".to_owned(),
        )?;
        let session = session
            .collect(response)
            .map_err(|rejected| rejected.into_parts().1)?;
        assert_eq!(
            SentinelGenesisPhase::from_session(&session),
            SentinelGenesisPhase::ReadyToFinalize
        );
        let output = SentinelGenesisOutput::from_ready(
            session
                .prepare(owner_signing.signing_key())
                .map_err(|rejected| rejected.into_parts().1)?,
        )?;
        assert_eq!(output.participant_deliveries.len(), 2);
        let operations = sentinel_genesis_operations(&output);
        assert_eq!(operations.len(), 3);
        let mut materialized = VaultMetaState::default();
        for operation in &operations {
            crate::apply_vault_meta_operation(
                &mut materialized,
                operation,
                "2026-07-09T00:00:00Z",
            )?;
        }
        assert_eq!(materialized.sentinel_participants.len(), 2);
        assert_eq!(materialized.sentinel_shares.len(), 2);
        assert!(output.stored_records.iter().all(|record| {
            !matches!(VaultMetaRecord::classify(record), VaultMetaRecord::Auth(..))
        }));
        output
            .architecture
            .validate_records(&output.stored_records)?;
        Ok(())
    }
}
