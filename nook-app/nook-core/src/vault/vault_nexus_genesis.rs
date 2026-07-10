//! Atomic core integration for provider-independent Nexus genesis.

use crate::{
    DeviceIdentity, DeviceMode, NexusGenesisSession, NexusGenesisShareDelivery, NexusPolicy,
    ReplicationType, SigningIdentity, StoredSecretRecord, VaultArchitecture, VaultType,
    finalize_nexus_genesis_shares, generate_store_id,
};

/// Complete, persistable Nexus genesis result. It contains no full-key device
/// envelope. `keys` are intentionally not exposed here; callers open the new
/// vault through the same threshold-share ceremony used after reload/import.
pub struct NexusGenesisOutput {
    pub store_id: crate::StoreId,
    pub architecture: VaultArchitecture,
    pub stored_records: Vec<StoredSecretRecord>,
    pub participant_deliveries: Vec<NexusGenesisShareDelivery>,
    pub participants: Vec<crate::NexusGenesisParticipant>,
}

/// Complete public genesis operations for an event-log root. Member enrollment
/// and encrypted shares are emitted together so event-only materialization
/// never loses the Nexus roster.
#[must_use]
pub fn nexus_genesis_operations(output: &NexusGenesisOutput) -> Vec<crate::VaultOperation> {
    let mut operations = output
        .participants
        .iter()
        .map(
            |participant| crate::VaultOperation::NexusParticipantEnrolled {
                device_id: participant.device_id.clone(),
                encryption_public_key: participant.encryption_public_key.clone(),
                signing_public_key: participant.signing_public_key.clone(),
                label: crate::MemberLabel::from_trusted(participant.label.clone()),
            },
        )
        .collect::<Vec<_>>();
    operations.push(crate::VaultOperation::NexusSharesIssued {
        shares: output
            .participant_deliveries
            .iter()
            .map(|delivery| crate::NexusShareIssuedPayload {
                device_id: delivery.device_id.clone(),
                version: delivery.share.version,
                threshold: delivery.share.threshold,
                required_participants: delivery.share.required_participants,
                share_index: delivery.share.share_index,
                ciphertext: delivery.share.ciphertext.clone(),
            })
            .collect(),
    });
    operations
}

pub fn start_nexus_genesis(
    identity: &DeviceIdentity,
    signing: &SigningIdentity,
    participant_count: u8,
    threshold: u8,
    label: String,
) -> Result<NexusGenesisSession, crate::MultiDeviceError> {
    nook_auth2::start_nexus_genesis(
        identity,
        signing.signing_key(),
        participant_count,
        threshold,
        label,
    )
}

pub fn create_nexus_genesis_public_key_announcement(
    identity: &DeviceIdentity,
    signing: &SigningIdentity,
    label: String,
) -> Result<crate::NexusGenesisPublicKeyAnnouncement, crate::MultiDeviceError> {
    nook_auth2::create_nexus_genesis_public_key_announcement(identity, signing.signing_key(), label)
}

pub fn respond_to_nexus_genesis_request(
    request: &crate::NexusGenesisRequest,
    identity: &DeviceIdentity,
    signing: &SigningIdentity,
    label: String,
) -> Result<crate::NexusGenesisParticipantResponse, crate::MultiDeviceError> {
    nook_auth2::respond_to_nexus_genesis_request(request, identity, signing.signing_key(), label)
}

/// Generate keys, encrypted member rows, and the complete encrypted share set
/// as one result after all `N` signed participant responses are verified.
pub fn finalize_nexus_genesis(
    session: NexusGenesisSession,
    initiator_signing: &SigningIdentity,
) -> Result<NexusGenesisOutput, crate::MultiDeviceError> {
    let store_id = generate_store_id()?;
    let issued =
        finalize_nexus_genesis_shares(session, &store_id, initiator_signing.signing_key())?;
    let policy = issued
        .deliveries
        .first()
        .map(|delivery| delivery.policy)
        .ok_or(crate::MultiDeviceError::InvalidNexusGenesisPayload)?;
    let stored_records = issued.records;
    let architecture = VaultArchitecture {
        device_mode: DeviceMode::Standard,
        vault_type: VaultType::Nexus,
        // Compatibility-only persisted field; it does not affect Nexus
        // genesis, readiness, quorum, or later provider configuration.
        replication_type: ReplicationType::Personal,
        nexus: Some(NexusPolicy {
            threshold: policy.threshold,
            required_participants: policy.participant_count,
            ready_participants: policy.participant_count,
        }),
    };
    architecture.validate_records(&stored_records)?;
    Ok(NexusGenesisOutput {
        store_id,
        architecture,
        stored_records,
        participants: issued.participants,
        participant_deliveries: issued.deliveries,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{NexusGenesisParticipantResponse, VaultMetaRecord, add_nexus_genesis_response};

    #[test]
    fn core_finalization_has_no_full_key_envelope() -> crate::VaultResult<()> {
        let owner = DeviceIdentity::generate()?;
        let (owner_signing, _) = SigningIdentity::generate()?;
        let mut session = start_nexus_genesis(&owner, &owner_signing, 2, 2, "Owner".to_owned())?;
        let peer = DeviceIdentity::generate()?;
        let (peer_signing, _) = SigningIdentity::generate()?;
        let response: NexusGenesisParticipantResponse = respond_to_nexus_genesis_request(
            &session.request,
            &peer,
            &peer_signing,
            "Peer".to_owned(),
        )?;
        add_nexus_genesis_response(&mut session, response)?;
        let output = finalize_nexus_genesis(session, &owner_signing)?;
        assert_eq!(output.participant_deliveries.len(), 2);
        let operations = nexus_genesis_operations(&output);
        assert_eq!(operations.len(), 3);
        let mut materialized = crate::VaultMetaState::default();
        for operation in &operations {
            crate::apply_vault_meta_operation(
                &mut materialized,
                operation,
                "2026-07-09T00:00:00Z",
            )?;
        }
        assert_eq!(materialized.nexus_participants.len(), 2);
        assert_eq!(materialized.nexus_shares.len(), 2);
        assert!(output.stored_records.iter().all(|record| {
            !matches!(VaultMetaRecord::classify(record), VaultMetaRecord::Auth(..))
        }));
        output
            .architecture
            .validate_records(&output.stored_records)?;
        Ok(())
    }
}
