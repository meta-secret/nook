//! Provider-independent Sentinel pre-genesis ceremony.
//!
//! Session state contains public data only. Vault keys and shares are generated
//! together only after the complete `N`-participant roster has been verified.
//! Sentinel roots are split with the current extendable SLIP-0039 format.

use super::multi_device::{
    DeviceIdentity, VaultMember, VaultMetaRecord, build_members_records,
    create_sentinel_root_share_records_for_recipients, dec_auth_id_from_public_key,
    device_id_from_public_key, generate_id,
};
mod links;
pub use super::sentinel_genesis_types::*;
use super::sentinel_signing;
use crate::{
    CompactToken, DeviceId, DevicePublicKey, DeviceSigningPublicKey, MultiDeviceError,
    MultiDeviceResult, StoreId, StoredSecretRecord,
};
use crate::{SentinelParticipantCount, SentinelThreshold};
use ed25519_dalek::{Signer, SigningKey};
pub use links::{
    build_sentinel_genesis_participant_response_link, build_sentinel_genesis_request_link,
    normalize_sentinel_genesis_participant_payload, normalize_sentinel_genesis_request,
    sentinel_genesis_participant_fingerprint,
};
use sha2::{Digest, Sha256};

const GENESIS_VERSION: u32 = 1;
const PUBLIC_KEY_ANNOUNCEMENT_KIND: &str = "publicKeyAnnouncement";

pub fn start_sentinel_genesis(
    identity: &DeviceIdentity,
    signing_key: &SigningKey,
    participant_count: SentinelParticipantCount,
    threshold: SentinelThreshold,
    label: String,
) -> MultiDeviceResult<SentinelGenesisSession> {
    let policy = SentinelGenesisPolicy {
        participant_count,
        threshold,
    };
    policy.validate()?;
    let session_id = generate_id()?;
    let signing_public_key = signing_public_key(signing_key);
    let mut request = SentinelGenesisRequest {
        version: GENESIS_VERSION,
        session_id: session_id.clone(),
        policy,
        initiator_device_id: identity.device_id().clone(),
        initiator_signing_public_key: signing_public_key,
        signature: String::new(),
    };
    request.signature = hex::encode(
        signing_key
            .sign(&request_signing_bytes(&request)?)
            .to_bytes(),
    );
    let response = respond_to_sentinel_genesis_request(&request, identity, signing_key, label)?;
    let mut session = SentinelGenesisSession {
        request,
        participants: Vec::new(),
    };
    add_sentinel_genesis_response(&mut session, response)?;
    Ok(session)
}

#[must_use]
pub fn sentinel_genesis_request(session: &SentinelGenesisSession) -> SentinelGenesisRequest {
    session.request.clone()
}

pub fn create_sentinel_genesis_public_key_announcement(
    identity: &DeviceIdentity,
    signing_key: &SigningKey,
    label: String,
) -> MultiDeviceResult<SentinelGenesisPublicKeyAnnouncement> {
    if label.chars().count() > 80 {
        return Err(MultiDeviceError::DeviceNameTooLong);
    }
    let encryption_public_key = identity.public_key();
    let signing_public_key = signing_public_key(signing_key);
    let device_id = identity.device_id().clone();
    let fingerprint =
        standalone_participant_fingerprint(&encryption_public_key, &signing_public_key);
    let bytes = announcement_signing_bytes(
        GENESIS_VERSION,
        &device_id,
        &encryption_public_key,
        &signing_public_key,
        &label,
    )?;
    Ok(SentinelGenesisPublicKeyAnnouncement {
        kind: PUBLIC_KEY_ANNOUNCEMENT_KIND.to_owned(),
        version: GENESIS_VERSION,
        device_id,
        encryption_public_key,
        signing_public_key,
        label,
        fingerprint,
        signature: hex::encode(signing_key.sign(&bytes).to_bytes()),
    })
}

pub fn respond_to_sentinel_genesis_request(
    request: &SentinelGenesisRequest,
    identity: &DeviceIdentity,
    signing_key: &SigningKey,
    label: String,
) -> MultiDeviceResult<SentinelGenesisParticipantResponse> {
    validate_request(request)?;
    if label.chars().count() > 80 {
        return Err(MultiDeviceError::DeviceNameTooLong);
    }
    let encryption_public_key = identity.public_key();
    let signing_public_key = signing_public_key(signing_key);
    let participant = SentinelGenesisParticipant {
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
    Ok(SentinelGenesisParticipantResponse {
        version: GENESIS_VERSION,
        session_id: request.session_id.clone(),
        participant,
        signature: hex::encode(signing_key.sign(&bytes).to_bytes()),
    })
}

/// Accept a session-bound participant response bound to the active owner invitation.
/// Standalone `publicKeyAnnouncement` payloads are rejected for remote enrollment.
pub fn add_sentinel_genesis_participant_payload(
    session: &mut SentinelGenesisSession,
    payload_json: &str,
) -> MultiDeviceResult<()> {
    let value: serde_json::Value = serde_json::from_str(payload_json)
        .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
    if value.get("kind").and_then(serde_json::Value::as_str) == Some(PUBLIC_KEY_ANNOUNCEMENT_KIND) {
        return Err(MultiDeviceError::StandaloneSentinelGenesisAnnouncementRejected);
    }
    let response: SentinelGenesisParticipantResponse = serde_json::from_str(payload_json)
        .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
    add_sentinel_genesis_response(session, response)
}

/// Verify a participant payload, then assign the owner-authored display name.
/// The label is not part of device identity or the participant fingerprint;
/// signed keys are always verified before this local roster metadata changes.
pub fn add_sentinel_genesis_participant_payload_with_label(
    session: &mut SentinelGenesisSession,
    payload_json: &str,
    participant_label: &str,
) -> MultiDeviceResult<()> {
    let participant_label = participant_label.trim();
    if participant_label.chars().count() > 80 {
        return Err(MultiDeviceError::DeviceNameTooLong);
    }
    let participant_index = session.participants.len();
    add_sentinel_genesis_participant_payload(session, payload_json)?;
    if !participant_label.is_empty() {
        participant_label.clone_into(&mut session.participants[participant_index].label);
    }
    Ok(())
}

pub fn add_sentinel_genesis_response(
    session: &mut SentinelGenesisSession,
    response: SentinelGenesisParticipantResponse,
) -> MultiDeviceResult<()> {
    validate_request(&session.request)?;
    if response.version != GENESIS_VERSION || response.session_id != session.request.session_id {
        return Err(MultiDeviceError::InvalidSentinelGenesisSession);
    }
    validate_participant(&response.participant, &response.session_id)?;
    verify_response(&response)?;
    if session.participants.iter().any(|existing| {
        existing.device_id == response.participant.device_id
            || existing.encryption_public_key == response.participant.encryption_public_key
            || existing.signing_public_key == response.participant.signing_public_key
    }) {
        return Err(MultiDeviceError::DuplicateSentinelGenesisParticipant {
            device_id: response.participant.device_id.to_string(),
        });
    }
    if session.participants.len() >= usize::from(u8::from(session.request.policy.participant_count))
    {
        return Err(MultiDeviceError::SentinelGenesisRosterFull);
    }
    session.participants.push(response.participant);
    Ok(())
}

/// Reject standalone public-key announcements for remote enrollment.
///
/// Kept as an explicit fail-closed entry point so callers cannot accidentally
/// reintroduce announcement-based roster import.
pub fn add_sentinel_genesis_public_key_announcement(
    _session: &mut SentinelGenesisSession,
    _announcement: &SentinelGenesisPublicKeyAnnouncement,
) -> MultiDeviceResult<()> {
    Err(MultiDeviceError::StandaloneSentinelGenesisAnnouncementRejected)
}

#[allow(clippy::needless_pass_by_value)] // Consuming the session prevents issuing twice.
pub fn finalize_sentinel_genesis_shares(
    session: SentinelGenesisSession,
    store_id: &StoreId,
    initiator_signing_key: &SigningKey,
) -> MultiDeviceResult<SentinelGenesisIssued> {
    if !session.is_complete() {
        return Err(MultiDeviceError::SentinelGenesisIncomplete {
            required: session.request.policy.participant_count,
            available: SentinelParticipantCount::try_from(session.participants.len())
                .map_err(|_| MultiDeviceError::SentinelParticipantCountOverflow)?,
        });
    }
    if signing_public_key(initiator_signing_key) != session.request.initiator_signing_public_key
        || !session.participants.iter().any(|participant| {
            participant.device_id == session.request.initiator_device_id
                && participant.signing_public_key == session.request.initiator_signing_public_key
        })
    {
        return Err(MultiDeviceError::InvalidSentinelGenesisSignature);
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
    let (keys, share_records) = create_sentinel_root_share_records_for_recipients(
        &recipients,
        session.request.policy.threshold,
    )?;
    // Construction is all-or-nothing: only publish the result after every
    // record has parsed and every delivery has been signed.
    let mut deliveries = Vec::with_capacity(share_records.len());
    for (participant, record) in session.participants.iter().zip(&share_records) {
        let VaultMetaRecord::SentinelShare(device_id, share) = VaultMetaRecord::classify(record)
        else {
            return Err(MultiDeviceError::InvalidSentinelGenesisPayload);
        };
        if device_id != participant.device_id {
            return Err(MultiDeviceError::InvalidSentinelGenesisPayload);
        }
        let mut delivery = SentinelGenesisShareDelivery {
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
    Ok(SentinelGenesisIssued {
        records,
        participants: session.participants,
        deliveries,
    })
}

pub fn accept_sentinel_genesis_share_delivery(
    delivery: &SentinelGenesisShareDelivery,
    expected_request: &SentinelGenesisRequest,
    identity: &DeviceIdentity,
) -> MultiDeviceResult<StoredSecretRecord> {
    delivery.policy.validate()?;
    if delivery.version != GENESIS_VERSION
        || delivery.session_id != expected_request.session_id
        || delivery.policy != expected_request.policy
        || delivery.initiator_signing_public_key != expected_request.initiator_signing_public_key
    {
        return Err(MultiDeviceError::InvalidSentinelGenesisSession);
    }
    if delivery.device_id != *identity.device_id()
        || delivery.encryption_public_key != identity.public_key()
    {
        return Err(MultiDeviceError::SentinelGenesisDeliveryRecipientMismatch);
    }
    if delivery.share.threshold != delivery.policy.threshold
        || delivery.share.required_participants != delivery.policy.participant_count
        || u8::from(delivery.share.share_index) == 0
        || u8::from(delivery.share.share_index) > u8::from(delivery.policy.participant_count)
    {
        return Err(MultiDeviceError::InvalidSentinelGenesisPayload);
    }
    verify_signature(
        &delivery.initiator_signing_public_key,
        &delivery.signature,
        &delivery_signing_bytes(delivery)?,
    )?;
    VaultMetaRecord::SentinelShare(delivery.device_id.clone(), delivery.share.clone()).to_stored()
}

fn validate_request(request: &SentinelGenesisRequest) -> MultiDeviceResult<()> {
    request.policy.validate()?;
    if request.version != GENESIS_VERSION || request.initiator_signing_public_key.is_empty() {
        return Err(MultiDeviceError::InvalidSentinelGenesisSession);
    }
    verify_signature(
        &request.initiator_signing_public_key,
        &request.signature,
        &request_signing_bytes(request)?,
    )
}

fn request_signing_bytes(request: &SentinelGenesisRequest) -> MultiDeviceResult<Vec<u8>> {
    serde_json::to_vec(&(
        request.version,
        &request.session_id,
        request.policy,
        &request.initiator_device_id,
        &request.initiator_signing_public_key,
    ))
    .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)
}

fn validate_participant(
    participant: &SentinelGenesisParticipant,
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
        return Err(MultiDeviceError::InvalidSentinelGenesisPayload);
    }
    Ok(())
}

fn verify_response(response: &SentinelGenesisParticipantResponse) -> MultiDeviceResult<()> {
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
    participant: &SentinelGenesisParticipant,
) -> MultiDeviceResult<Vec<u8>> {
    serde_json::to_vec(&(version, session_id, participant))
        .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)
}

fn delivery_signing_bytes(delivery: &SentinelGenesisShareDelivery) -> MultiDeviceResult<Vec<u8>> {
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
    .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)
}

fn signing_public_key(signing_key: &SigningKey) -> DeviceSigningPublicKey {
    sentinel_signing::signing_public_key(signing_key)
}

fn verify_signature(
    public_key: &DeviceSigningPublicKey,
    signature: &str,
    bytes: &[u8],
) -> MultiDeviceResult<()> {
    sentinel_signing::verify_signature(public_key, signature, bytes, || {
        MultiDeviceError::InvalidSentinelGenesisSignature
    })
}

fn participant_fingerprint(
    encryption: &DevicePublicKey,
    signing: &DeviceSigningPublicKey,
    session_id: &CompactToken,
) -> String {
    let mut digest = Sha256::new();
    digest.update(b"nook-sentinel-genesis-participant-v1\0");
    digest.update(session_id.as_str().as_bytes());
    digest.update(b"\0");
    digest.update(encryption.as_str().as_bytes());
    digest.update(b"\0");
    digest.update(signing.as_str().as_bytes());
    hex::encode(digest.finalize())
}

fn standalone_participant_fingerprint(
    encryption: &DevicePublicKey,
    signing: &DeviceSigningPublicKey,
) -> String {
    let mut digest = Sha256::new();
    digest.update(b"nook-sentinel-genesis-public-key-v1\0");
    digest.update(encryption.as_str().as_bytes());
    digest.update(b"\0");
    digest.update(signing.as_str().as_bytes());
    hex::encode(digest.finalize())
}

fn verify_public_key_announcement(
    announcement: &SentinelGenesisPublicKeyAnnouncement,
) -> MultiDeviceResult<()> {
    if announcement.kind != PUBLIC_KEY_ANNOUNCEMENT_KIND
        || announcement.version != GENESIS_VERSION
        || announcement.signing_public_key.is_empty()
    {
        return Err(MultiDeviceError::InvalidSentinelGenesisPayload);
    }
    if device_id_from_public_key(&announcement.encryption_public_key)? != announcement.device_id
        || announcement.fingerprint
            != standalone_participant_fingerprint(
                &announcement.encryption_public_key,
                &announcement.signing_public_key,
            )
    {
        return Err(MultiDeviceError::InvalidSentinelGenesisPayload);
    }
    verify_signature(
        &announcement.signing_public_key,
        &announcement.signature,
        &announcement_signing_bytes(
            announcement.version,
            &announcement.device_id,
            &announcement.encryption_public_key,
            &announcement.signing_public_key,
            &announcement.label,
        )?,
    )
}

fn announcement_signing_bytes(
    version: u32,
    device_id: &DeviceId,
    encryption_public_key: &DevicePublicKey,
    signing_public_key: &DeviceSigningPublicKey,
    label: &str,
) -> MultiDeviceResult<Vec<u8>> {
    serde_json::to_vec(&(
        PUBLIC_KEY_ANNOUNCEMENT_KIND,
        version,
        device_id,
        encryption_public_key,
        signing_public_key,
        label,
    ))
    .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)
}

#[cfg(test)]
mod tests {
    use std::{io, slice};

    use super::*;

    fn signing_key() -> anyhow::Result<SigningKey> {
        let mut seed = [0_u8; 32];
        getrandom::fill(&mut seed)?;
        Ok(SigningKey::from_bytes(&seed))
    }

    fn participant(
        request: &SentinelGenesisRequest,
        label: &str,
    ) -> anyhow::Result<(
        DeviceIdentity,
        SigningKey,
        SentinelGenesisParticipantResponse,
    )> {
        let identity = DeviceIdentity::generate()?;
        let signing = signing_key()?;
        let response =
            respond_to_sentinel_genesis_request(request, &identity, &signing, label.to_owned())?;
        Ok((identity, signing, response))
    }

    #[test]
    fn policy_requires_real_threshold() {
        assert!(
            SentinelGenesisPolicy {
                participant_count: 3.into(),
                threshold: 2.into()
            }
            .validate()
            .is_ok()
        );
        assert!(
            SentinelGenesisPolicy {
                participant_count: 3.into(),
                threshold: 1.into()
            }
            .validate()
            .is_err()
        );
        assert!(
            SentinelGenesisPolicy {
                participant_count: 2.into(),
                threshold: 3.into()
            }
            .validate()
            .is_err()
        );
        assert!(
            SentinelGenesisPolicy {
                participant_count: 17.into(),
                threshold: 2.into()
            }
            .validate()
            .is_err()
        );
    }

    #[test]
    fn standalone_public_key_announcement_is_rejected_for_enrollment() -> anyhow::Result<()> {
        let owner = DeviceIdentity::generate()?;
        let owner_signing = signing_key()?;
        let mut session =
            start_sentinel_genesis(&owner, &owner_signing, 2.into(), 2.into(), "Owner".into())?;
        let peer = DeviceIdentity::generate()?;
        let peer_signing = signing_key()?;
        let announcement =
            create_sentinel_genesis_public_key_announcement(&peer, &peer_signing, "Peer".into())?;
        let payload = serde_json::to_string(&announcement)?;
        assert!(matches!(
            add_sentinel_genesis_participant_payload(&mut session, &payload),
            Err(MultiDeviceError::StandaloneSentinelGenesisAnnouncementRejected)
        ));
        assert!(matches!(
            add_sentinel_genesis_public_key_announcement(&mut session, &announcement),
            Err(MultiDeviceError::StandaloneSentinelGenesisAnnouncementRejected)
        ));
        let announcement_link =
            build_sentinel_genesis_participant_response_link(&payload, "https://nook.example/app/");
        assert!(matches!(
            announcement_link,
            Err(MultiDeviceError::StandaloneSentinelGenesisAnnouncementRejected)
        ));
        assert_eq!(session.participants().len(), 1);
        Ok(())
    }

    #[test]
    fn owner_can_name_a_verified_session_bound_participant() -> anyhow::Result<()> {
        let owner = DeviceIdentity::generate()?;
        let owner_signing = signing_key()?;
        let mut session =
            start_sentinel_genesis(&owner, &owner_signing, 2.into(), 2.into(), "Owner".into())?;
        let (peer, _, response) = participant(&session.request, "Peer")?;
        let payload = serde_json::to_string(&response)?;

        add_sentinel_genesis_participant_payload_with_label(
            &mut session,
            &payload,
            "  Ada's iPhone  ",
        )?;

        assert_eq!(session.participants()[1].label, "Ada's iPhone");
        assert_eq!(
            session.participants()[1].device_id,
            peer.device_id().clone()
        );
        Ok(())
    }

    #[test]
    fn response_is_session_bound_signed_and_unique() -> anyhow::Result<()> {
        let owner = DeviceIdentity::generate()?;
        let owner_signing = signing_key()?;
        let mut session =
            start_sentinel_genesis(&owner, &owner_signing, 2.into(), 2.into(), "Owner".into())?;
        let (_, _, response) = participant(&session.request, "Peer")?;
        let duplicate = response.clone();
        add_sentinel_genesis_response(&mut session, response)?;
        assert!(session.is_complete());
        assert!(matches!(
            add_sentinel_genesis_response(&mut session, duplicate),
            Err(MultiDeviceError::DuplicateSentinelGenesisParticipant { .. })
        ));
        Ok(())
    }

    #[test]
    fn tampered_response_and_cross_session_response_fail() -> anyhow::Result<()> {
        let owner = DeviceIdentity::generate()?;
        let owner_signing = signing_key()?;
        let mut first =
            start_sentinel_genesis(&owner, &owner_signing, 2.into(), 2.into(), "Owner".into())?;
        let second_owner = DeviceIdentity::generate()?;
        let second_signing = signing_key()?;
        let second = start_sentinel_genesis(
            &second_owner,
            &second_signing,
            2.into(),
            2.into(),
            "Other".into(),
        )?;
        let (_, _, mut response) = participant(&first.request, "Peer")?;
        let cross = response.clone();
        response.participant.label = "Mallory".into();
        assert!(matches!(
            add_sentinel_genesis_response(&mut first, response),
            Err(MultiDeviceError::InvalidSentinelGenesisSignature)
        ));
        assert!(matches!(
            add_sentinel_genesis_response(
                &mut first,
                SentinelGenesisParticipantResponse {
                    session_id: second.request.session_id,
                    ..cross
                }
            ),
            Err(MultiDeviceError::InvalidSentinelGenesisSession)
        ));
        Ok(())
    }

    #[test]
    fn finalize_rejects_deserialized_oversized_roster_without_mutation() -> anyhow::Result<()> {
        let owner = DeviceIdentity::generate()?;
        let owner_signing = signing_key()?;
        let started =
            start_sentinel_genesis(&owner, &owner_signing, 2.into(), 2.into(), "Owner".into())?;
        let participant = started
            .participants()
            .first()
            .ok_or_else(|| io::Error::other("started session must include its owner"))?
            .clone();
        let mut session: SentinelGenesisSession =
            serde_json::from_str(&serde_json::to_string(&started)?)?;
        session.participants = vec![participant; usize::from(u8::MAX) + 1];
        let snapshot = session.clone();

        let result = finalize_sentinel_genesis_shares(
            session.clone(),
            &StoreId::parse("store_AAAAAAAAAAA")?,
            &owner_signing,
        );
        assert!(matches!(
            result,
            Err(MultiDeviceError::SentinelParticipantCountOverflow)
        ));
        assert_eq!(session, snapshot);
        Ok(())
    }

    #[test]
    fn finalize_is_all_participants_or_nothing_and_deliveries_are_verified() -> anyhow::Result<()> {
        let owner = DeviceIdentity::generate()?;
        let owner_signing = signing_key()?;
        let incomplete =
            start_sentinel_genesis(&owner, &owner_signing, 2.into(), 2.into(), "Owner".into())?;
        let store_id = StoreId::parse("store_AAAAAAAAAAA")?;
        assert!(matches!(
            finalize_sentinel_genesis_shares(incomplete, &store_id, &owner_signing),
            Err(MultiDeviceError::SentinelGenesisIncomplete { .. })
        ));

        let mut session =
            start_sentinel_genesis(&owner, &owner_signing, 2.into(), 2.into(), "Owner".into())?;
        let (peer, _, response) = participant(&session.request, "Peer")?;
        add_sentinel_genesis_response(&mut session, response)?;
        let expected_request = session.request.clone();
        let issued = finalize_sentinel_genesis_shares(session, &store_id, &owner_signing)?;
        assert_eq!(issued.records.len(), 4);
        assert_eq!(issued.deliveries.len(), 2);
        let peer_delivery = issued
            .deliveries
            .iter()
            .find(|delivery| delivery.device_id == *peer.device_id())
            .ok_or_else(|| io::Error::other("peer delivery must exist"))?;
        let accepted =
            accept_sentinel_genesis_share_delivery(peer_delivery, &expected_request, &peer)?;
        assert!(issued.records.contains(&accepted));
        assert!(matches!(
            accept_sentinel_genesis_share_delivery(peer_delivery, &expected_request, &owner),
            Err(MultiDeviceError::SentinelGenesisDeliveryRecipientMismatch)
        ));
        Ok(())
    }

    #[test]
    fn no_full_key_envelope_and_quorum_is_required() -> anyhow::Result<()> {
        let owner = DeviceIdentity::generate()?;
        let owner_signing = signing_key()?;
        let mut session =
            start_sentinel_genesis(&owner, &owner_signing, 3.into(), 2.into(), "Owner".into())?;
        let (peer_a, _, a) = participant(&session.request, "A")?;
        let (peer_b, _, b) = participant(&session.request, "B")?;
        add_sentinel_genesis_response(&mut session, a)?;
        add_sentinel_genesis_response(&mut session, b)?;
        let issued = finalize_sentinel_genesis_shares(
            session,
            &StoreId::parse("store_AAAAAAAAAAA")?,
            &owner_signing,
        )?;
        assert!(
            issued.records.iter().all(|record| !matches!(
                VaultMetaRecord::classify(record),
                VaultMetaRecord::Auth(..)
            ))
        );
        let share_count = super::super::multi_device::count_sentinel_share_records(&issued.records);
        assert_eq!(usize::from(share_count), 3);
        assert!(
            super::super::multi_device::reconstruct_sentinel_vault_keys(
                &issued.records,
                slice::from_ref(&owner)
            )
            .is_err()
        );
        let first_quorum = super::super::multi_device::reconstruct_sentinel_vault_keys(
            &issued.records,
            &[owner, peer_a],
        )?;
        assert_eq!(first_quorum.secrets_key.as_str().len(), 64);
        assert!(
            super::super::multi_device::reconstruct_sentinel_vault_keys(&issued.records, &[peer_b])
                .is_err()
        );
        Ok(())
    }
}
