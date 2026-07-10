//! Provider-independent Nexus pre-genesis ceremony.
//!
//! Session state contains public data only. Vault keys and shares are generated
//! together only after the complete `N`-participant roster has been verified.
//! Nexus roots are split with the current extendable SLIP-0039 format.

use super::multi_device::{
    DeviceIdentity, NexusShareEnvelope, VaultMember, VaultMetaRecord, build_members_records,
    create_nexus_root_share_records_for_recipients, dec_auth_id_from_public_key,
    device_id_from_public_key, generate_id,
};
use crate::{
    CompactToken, DeviceId, DevicePublicKey, DeviceSigningPublicKey, MultiDeviceError,
    MultiDeviceResult, StoreId, StoredSecretRecord,
};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const GENESIS_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NexusGenesisPolicy {
    pub participant_count: u8,
    pub threshold: u8,
}

impl NexusGenesisPolicy {
    pub fn validate(self) -> MultiDeviceResult<()> {
        if self.threshold < 2
            || self.participant_count < 2
            || self.participant_count > 16
            || self.threshold > self.participant_count
        {
            return Err(MultiDeviceError::InvalidNexusThreshold);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NexusGenesisRequest {
    pub version: u32,
    pub session_id: CompactToken,
    pub policy: NexusGenesisPolicy,
    pub initiator_device_id: DeviceId,
    pub initiator_signing_public_key: DeviceSigningPublicKey,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NexusGenesisParticipant {
    pub device_id: DeviceId,
    pub encryption_public_key: DevicePublicKey,
    pub signing_public_key: DeviceSigningPublicKey,
    pub label: String,
    pub fingerprint: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NexusGenesisParticipantResponse {
    pub version: u32,
    pub session_id: CompactToken,
    pub participant: NexusGenesisParticipant,
    pub signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NexusGenesisSession {
    pub request: NexusGenesisRequest,
    /// Verified responses are intentionally session-only. Serializing a public
    /// draft never turns unverified participant fields into a trusted roster;
    /// deserialization yields an incomplete request-only draft that must be
    /// restarted through `start_nexus_genesis`.
    #[serde(skip, default)]
    participants: Vec<NexusGenesisParticipant>,
}

impl NexusGenesisSession {
    #[must_use]
    pub fn participants(&self) -> &[NexusGenesisParticipant] {
        &self.participants
    }

    #[must_use]
    pub fn is_complete(&self) -> bool {
        self.participants.len() == usize::from(self.request.policy.participant_count)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NexusGenesisShareDelivery {
    pub version: u32,
    pub session_id: CompactToken,
    pub store_id: StoreId,
    pub policy: NexusGenesisPolicy,
    pub device_id: DeviceId,
    pub encryption_public_key: DevicePublicKey,
    pub share: NexusShareEnvelope,
    pub initiator_signing_public_key: DeviceSigningPublicKey,
    pub signature: String,
}

/// Atomic result of the key-generation step. Callers must serialize all
/// records together; no API exposes a partially issued share set.
pub struct NexusGenesisIssued {
    pub records: Vec<StoredSecretRecord>,
    pub participants: Vec<NexusGenesisParticipant>,
    pub deliveries: Vec<NexusGenesisShareDelivery>,
}

pub fn start_nexus_genesis(
    identity: &DeviceIdentity,
    signing_key: &SigningKey,
    participant_count: u8,
    threshold: u8,
    label: String,
) -> MultiDeviceResult<NexusGenesisSession> {
    let policy = NexusGenesisPolicy {
        participant_count,
        threshold,
    };
    policy.validate()?;
    let session_id = generate_id()?;
    let signing_public_key = signing_public_key(signing_key);
    let request = NexusGenesisRequest {
        version: GENESIS_VERSION,
        session_id: session_id.clone(),
        policy,
        initiator_device_id: identity.device_id().clone(),
        initiator_signing_public_key: signing_public_key,
    };
    let response = respond_to_nexus_genesis_request(&request, identity, signing_key, label)?;
    let mut session = NexusGenesisSession {
        request,
        participants: Vec::new(),
    };
    add_nexus_genesis_response(&mut session, response)?;
    Ok(session)
}

#[must_use]
pub fn nexus_genesis_request(session: &NexusGenesisSession) -> NexusGenesisRequest {
    session.request.clone()
}

pub fn respond_to_nexus_genesis_request(
    request: &NexusGenesisRequest,
    identity: &DeviceIdentity,
    signing_key: &SigningKey,
    label: String,
) -> MultiDeviceResult<NexusGenesisParticipantResponse> {
    validate_request(request)?;
    if label.chars().count() > 80 {
        return Err(MultiDeviceError::DeviceNameTooLong);
    }
    let encryption_public_key = identity.public_key();
    let signing_public_key = signing_public_key(signing_key);
    let participant = NexusGenesisParticipant {
        device_id: identity.device_id().clone(),
        fingerprint: participant_fingerprint(
            &encryption_public_key,
            &signing_public_key,
            &request.session_id,
        ),
        encryption_public_key,
        signing_public_key,
        label,
    };
    let bytes = response_signing_bytes(GENESIS_VERSION, &request.session_id, &participant)?;
    Ok(NexusGenesisParticipantResponse {
        version: GENESIS_VERSION,
        session_id: request.session_id.clone(),
        participant,
        signature: hex::encode(signing_key.sign(&bytes).to_bytes()),
    })
}

pub fn add_nexus_genesis_response(
    session: &mut NexusGenesisSession,
    response: NexusGenesisParticipantResponse,
) -> MultiDeviceResult<()> {
    validate_request(&session.request)?;
    if response.version != GENESIS_VERSION || response.session_id != session.request.session_id {
        return Err(MultiDeviceError::InvalidNexusGenesisSession);
    }
    validate_participant(&response.participant, &response.session_id)?;
    verify_response(&response)?;
    if session.participants.iter().any(|existing| {
        existing.device_id == response.participant.device_id
            || existing.encryption_public_key == response.participant.encryption_public_key
            || existing.signing_public_key == response.participant.signing_public_key
    }) {
        return Err(MultiDeviceError::DuplicateNexusGenesisParticipant {
            device_id: response.participant.device_id.to_string(),
        });
    }
    if session.participants.len() >= usize::from(session.request.policy.participant_count) {
        return Err(MultiDeviceError::NexusGenesisRosterFull);
    }
    session.participants.push(response.participant);
    Ok(())
}

#[allow(clippy::needless_pass_by_value)] // Consuming the session prevents issuing twice.
pub fn finalize_nexus_genesis_shares(
    session: NexusGenesisSession,
    store_id: &StoreId,
    initiator_signing_key: &SigningKey,
) -> MultiDeviceResult<NexusGenesisIssued> {
    if !session.is_complete() {
        return Err(MultiDeviceError::NexusGenesisIncomplete {
            required: session.request.policy.participant_count,
            available: session.participants.len(),
        });
    }
    if signing_public_key(initiator_signing_key) != session.request.initiator_signing_public_key
        || !session.participants.iter().any(|participant| {
            participant.device_id == session.request.initiator_device_id
                && participant.signing_public_key == session.request.initiator_signing_public_key
        })
    {
        return Err(MultiDeviceError::InvalidNexusGenesisSignature);
    }
    let recipients = session
        .participants
        .iter()
        .map(|participant| {
            (
                participant.device_id.clone(),
                participant.encryption_public_key.clone(),
            )
        })
        .collect::<Vec<_>>();
    let (keys, share_records) = create_nexus_root_share_records_for_recipients(
        &recipients,
        session.request.policy.threshold,
    )?;
    // Construction is all-or-nothing: only publish the result after every
    // record has parsed and every delivery has been signed.
    let mut deliveries = Vec::with_capacity(share_records.len());
    for (participant, record) in session.participants.iter().zip(&share_records) {
        let VaultMetaRecord::NexusShare(device_id, share) = VaultMetaRecord::classify(record)
        else {
            return Err(MultiDeviceError::InvalidNexusGenesisPayload);
        };
        if device_id != participant.device_id {
            return Err(MultiDeviceError::InvalidNexusGenesisPayload);
        }
        let mut delivery = NexusGenesisShareDelivery {
            version: GENESIS_VERSION,
            session_id: session.request.session_id.clone(),
            store_id: store_id.clone(),
            policy: session.request.policy,
            device_id,
            encryption_public_key: participant.encryption_public_key.clone(),
            share,
            initiator_signing_public_key: session.request.initiator_signing_public_key.clone(),
            signature: String::new(),
        };
        delivery.signature = hex::encode(
            initiator_signing_key
                .sign(&delivery_signing_bytes(&delivery)?)
                .to_bytes(),
        );
        deliveries.push(delivery);
    }
    let roster = session
        .participants
        .iter()
        .map(|participant| {
            Ok(VaultMember {
                auth_id: dec_auth_id_from_public_key(&participant.encryption_public_key)?,
                device_id: participant.device_id.clone(),
                public_key: participant.encryption_public_key.clone(),
                enrolled_at: String::new(),
                label: (!participant.label.is_empty()).then(|| participant.label.clone()),
            })
        })
        .collect::<MultiDeviceResult<Vec<_>>>()?;
    let mut records = build_members_records(&roster, &keys.members_key)?;
    records.extend(share_records);
    Ok(NexusGenesisIssued {
        records,
        participants: session.participants,
        deliveries,
    })
}

pub fn accept_nexus_genesis_share_delivery(
    delivery: &NexusGenesisShareDelivery,
    expected_request: &NexusGenesisRequest,
    identity: &DeviceIdentity,
) -> MultiDeviceResult<StoredSecretRecord> {
    delivery.policy.validate()?;
    if delivery.version != GENESIS_VERSION
        || delivery.session_id != expected_request.session_id
        || delivery.policy != expected_request.policy
        || delivery.initiator_signing_public_key != expected_request.initiator_signing_public_key
    {
        return Err(MultiDeviceError::InvalidNexusGenesisSession);
    }
    if delivery.device_id != *identity.device_id()
        || delivery.encryption_public_key != identity.public_key()
    {
        return Err(MultiDeviceError::NexusGenesisDeliveryRecipientMismatch);
    }
    if delivery.share.threshold != delivery.policy.threshold
        || delivery.share.required_participants != delivery.policy.participant_count
        || delivery.share.share_index == 0
        || delivery.share.share_index > delivery.policy.participant_count
    {
        return Err(MultiDeviceError::InvalidNexusGenesisPayload);
    }
    verify_signature(
        &delivery.initiator_signing_public_key,
        &delivery.signature,
        &delivery_signing_bytes(delivery)?,
    )?;
    VaultMetaRecord::NexusShare(delivery.device_id.clone(), delivery.share.clone()).to_stored()
}

fn validate_request(request: &NexusGenesisRequest) -> MultiDeviceResult<()> {
    request.policy.validate()?;
    if request.version != GENESIS_VERSION || request.initiator_signing_public_key.is_empty() {
        return Err(MultiDeviceError::InvalidNexusGenesisSession);
    }
    Ok(())
}

fn validate_participant(
    participant: &NexusGenesisParticipant,
    session_id: &CompactToken,
) -> MultiDeviceResult<()> {
    if device_id_from_public_key(&participant.encryption_public_key)? != participant.device_id
        || participant.signing_public_key.is_empty()
        || participant.fingerprint
            != participant_fingerprint(
                &participant.encryption_public_key,
                &participant.signing_public_key,
                session_id,
            )
    {
        return Err(MultiDeviceError::InvalidNexusGenesisPayload);
    }
    Ok(())
}

fn verify_response(response: &NexusGenesisParticipantResponse) -> MultiDeviceResult<()> {
    verify_signature(
        &response.participant.signing_public_key,
        &response.signature,
        &response_signing_bytes(
            response.version,
            &response.session_id,
            &response.participant,
        )?,
    )
}

fn response_signing_bytes(
    version: u32,
    session_id: &CompactToken,
    participant: &NexusGenesisParticipant,
) -> MultiDeviceResult<Vec<u8>> {
    serde_json::to_vec(&(version, session_id, participant))
        .map_err(|_| MultiDeviceError::InvalidNexusGenesisPayload)
}

fn delivery_signing_bytes(delivery: &NexusGenesisShareDelivery) -> MultiDeviceResult<Vec<u8>> {
    serde_json::to_vec(&(
        delivery.version,
        &delivery.session_id,
        &delivery.store_id,
        delivery.policy,
        &delivery.device_id,
        &delivery.encryption_public_key,
        &delivery.share,
        &delivery.initiator_signing_public_key,
    ))
    .map_err(|_| MultiDeviceError::InvalidNexusGenesisPayload)
}

fn signing_public_key(signing_key: &SigningKey) -> DeviceSigningPublicKey {
    DeviceSigningPublicKey::from_trusted(hex::encode(signing_key.verifying_key().to_bytes()))
}

fn verify_signature(
    public_key: &DeviceSigningPublicKey,
    signature: &str,
    bytes: &[u8],
) -> MultiDeviceResult<()> {
    let public: [u8; 32] = hex::decode(public_key.as_str())
        .ok()
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or(MultiDeviceError::InvalidNexusGenesisSignature)?;
    let signature: [u8; 64] = hex::decode(signature)
        .ok()
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or(MultiDeviceError::InvalidNexusGenesisSignature)?;
    let verifying_key = VerifyingKey::from_bytes(&public)
        .map_err(|_| MultiDeviceError::InvalidNexusGenesisSignature)?;
    verifying_key
        .verify(bytes, &Signature::from_bytes(&signature))
        .map_err(|_| MultiDeviceError::InvalidNexusGenesisSignature)
}

fn participant_fingerprint(
    encryption: &DevicePublicKey,
    signing: &DeviceSigningPublicKey,
    session_id: &CompactToken,
) -> String {
    let mut digest = Sha256::new();
    digest.update(b"nook-nexus-genesis-participant-v1\0");
    digest.update(session_id.as_str().as_bytes());
    digest.update(b"\0");
    digest.update(encryption.as_str().as_bytes());
    digest.update(b"\0");
    digest.update(signing.as_str().as_bytes());
    hex::encode(digest.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn signing_key() -> SigningKey {
        let mut seed = [0_u8; 32];
        getrandom::getrandom(&mut seed).unwrap();
        SigningKey::from_bytes(&seed)
    }

    fn participant(
        request: &NexusGenesisRequest,
        label: &str,
    ) -> (DeviceIdentity, SigningKey, NexusGenesisParticipantResponse) {
        let identity = DeviceIdentity::generate().unwrap();
        let signing = signing_key();
        let response =
            respond_to_nexus_genesis_request(request, &identity, &signing, label.to_owned())
                .unwrap();
        (identity, signing, response)
    }

    #[test]
    fn policy_requires_real_threshold() {
        assert!(
            NexusGenesisPolicy {
                participant_count: 3,
                threshold: 2
            }
            .validate()
            .is_ok()
        );
        assert!(
            NexusGenesisPolicy {
                participant_count: 3,
                threshold: 1
            }
            .validate()
            .is_err()
        );
        assert!(
            NexusGenesisPolicy {
                participant_count: 2,
                threshold: 3
            }
            .validate()
            .is_err()
        );
        assert!(
            NexusGenesisPolicy {
                participant_count: 17,
                threshold: 2
            }
            .validate()
            .is_err()
        );
    }

    #[test]
    fn response_is_session_bound_signed_and_unique() {
        let owner = DeviceIdentity::generate().unwrap();
        let owner_signing = signing_key();
        let mut session =
            start_nexus_genesis(&owner, &owner_signing, 2, 2, "Owner".into()).unwrap();
        let (_, _, response) = participant(&session.request, "Peer");
        let duplicate = response.clone();
        add_nexus_genesis_response(&mut session, response).unwrap();
        assert!(session.is_complete());
        assert!(matches!(
            add_nexus_genesis_response(&mut session, duplicate),
            Err(MultiDeviceError::DuplicateNexusGenesisParticipant { .. })
        ));
    }

    #[test]
    fn tampered_response_and_cross_session_response_fail() {
        let owner = DeviceIdentity::generate().unwrap();
        let owner_signing = signing_key();
        let mut first = start_nexus_genesis(&owner, &owner_signing, 2, 2, "Owner".into()).unwrap();
        let second_owner = DeviceIdentity::generate().unwrap();
        let second_signing = signing_key();
        let second =
            start_nexus_genesis(&second_owner, &second_signing, 2, 2, "Other".into()).unwrap();
        let (_, _, mut response) = participant(&first.request, "Peer");
        let cross = response.clone();
        response.participant.label = "Mallory".into();
        assert!(matches!(
            add_nexus_genesis_response(&mut first, response),
            Err(MultiDeviceError::InvalidNexusGenesisSignature)
        ));
        assert!(matches!(
            add_nexus_genesis_response(
                &mut first,
                NexusGenesisParticipantResponse {
                    session_id: second.request.session_id,
                    ..cross
                }
            ),
            Err(MultiDeviceError::InvalidNexusGenesisSession)
        ));
    }

    #[test]
    fn finalize_is_all_participants_or_nothing_and_deliveries_are_verified() {
        let owner = DeviceIdentity::generate().unwrap();
        let owner_signing = signing_key();
        let incomplete = start_nexus_genesis(&owner, &owner_signing, 2, 2, "Owner".into()).unwrap();
        let store_id = StoreId::parse("store_AAAAAAAAAAA").unwrap();
        assert!(matches!(
            finalize_nexus_genesis_shares(incomplete, &store_id, &owner_signing),
            Err(MultiDeviceError::NexusGenesisIncomplete { .. })
        ));

        let mut session =
            start_nexus_genesis(&owner, &owner_signing, 2, 2, "Owner".into()).unwrap();
        let (peer, _, response) = participant(&session.request, "Peer");
        add_nexus_genesis_response(&mut session, response).unwrap();
        let issued = finalize_nexus_genesis_shares(session, &store_id, &owner_signing).unwrap();
        assert_eq!(issued.records.len(), 4);
        assert_eq!(issued.deliveries.len(), 2);
        let peer_delivery = issued
            .deliveries
            .iter()
            .find(|delivery| delivery.device_id == *peer.device_id())
            .unwrap();
        let expected_request = NexusGenesisRequest {
            version: GENESIS_VERSION,
            session_id: peer_delivery.session_id.clone(),
            policy: peer_delivery.policy,
            initiator_device_id: owner.device_id().clone(),
            initiator_signing_public_key: peer_delivery.initiator_signing_public_key.clone(),
        };
        let accepted =
            accept_nexus_genesis_share_delivery(peer_delivery, &expected_request, &peer).unwrap();
        assert!(issued.records.contains(&accepted));
        assert!(matches!(
            accept_nexus_genesis_share_delivery(peer_delivery, &expected_request, &owner),
            Err(MultiDeviceError::NexusGenesisDeliveryRecipientMismatch)
        ));
    }

    #[test]
    fn no_full_key_envelope_and_quorum_is_required() {
        let owner = DeviceIdentity::generate().unwrap();
        let owner_signing = signing_key();
        let mut session =
            start_nexus_genesis(&owner, &owner_signing, 3, 2, "Owner".into()).unwrap();
        let (peer_a, _, a) = participant(&session.request, "A");
        let (peer_b, _, b) = participant(&session.request, "B");
        add_nexus_genesis_response(&mut session, a).unwrap();
        add_nexus_genesis_response(&mut session, b).unwrap();
        let issued = finalize_nexus_genesis_shares(
            session,
            &StoreId::parse("store_AAAAAAAAAAA").unwrap(),
            &owner_signing,
        )
        .unwrap();
        assert!(
            issued.records.iter().all(|record| !matches!(
                VaultMetaRecord::classify(record),
                VaultMetaRecord::Auth(..)
            ))
        );
        assert_eq!(
            super::super::multi_device::count_nexus_share_records(&issued.records),
            3
        );
        assert!(
            super::super::multi_device::reconstruct_nexus_vault_keys(
                &issued.records,
                std::slice::from_ref(&owner)
            )
            .is_err()
        );
        let first_quorum = super::super::multi_device::reconstruct_nexus_vault_keys(
            &issued.records,
            &[owner, peer_a],
        )
        .unwrap();
        assert_eq!(first_quorum.secrets_key.as_str().len(), 64);
        assert!(
            super::super::multi_device::reconstruct_nexus_vault_keys(&issued.records, &[peer_b])
                .is_err()
        );
    }
}
