//! Provider-independent Sentinel pre-genesis ceremony.
//!
//! Session state contains public data only. Vault keys and shares are generated
//! together only after the complete `N`-participant roster has been verified.
//! Sentinel roots are split with the current extendable SLIP-0039 format.

use super::multi_device::{DeviceIdentity, VaultMetaRecord, device_id_from_public_key};
mod links;
mod session;
pub use super::sentinel_genesis_types::*;
use super::sentinel_signing;
use crate::{
    CompactToken, DeviceId, DevicePublicKey, DeviceSigningPublicKey, MultiDeviceError,
    MultiDeviceResult, StoredSecretRecord,
};
use ed25519_dalek::{Signer, SigningKey};
pub use links::{
    build_sentinel_genesis_participant_response_link, build_sentinel_genesis_request_link,
    normalize_sentinel_genesis_participant_payload, normalize_sentinel_genesis_request,
    sentinel_genesis_participant_fingerprint,
};
pub use session::{
    ReadySentinelGenesis, SentinelGenesisReadiness, SentinelGenesisRejection,
    SentinelGenesisSession,
};
use sha2::{Digest, Sha256};

const GENESIS_VERSION: SentinelGenesisVersion = SentinelGenesisVersion::CURRENT;
const PUBLIC_KEY_ANNOUNCEMENT_KIND: &str = "publicKeyAnnouncement";

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
    version: SentinelGenesisVersion,
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
    version: SentinelGenesisVersion,
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
    use std::io::Error as IoError;
    use std::slice;

    use super::super::multi_device;
    use super::*;
    use crate::StoreId;

    struct Fixture;
    impl Fixture {
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
            let signing = Self::signing_key()?;
            let response = respond_to_sentinel_genesis_request(
                request,
                &identity,
                &signing,
                label.to_owned(),
            )?;
            Ok((identity, signing, response))
        }
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
    fn sentinel_genesis_version_validates_serde_input() -> anyhow::Result<()> {
        assert_eq!(
            serde_json::from_str::<SentinelGenesisVersion>("1")?,
            SentinelGenesisVersion::CURRENT
        );
        assert!(serde_json::from_str::<SentinelGenesisVersion>("2").is_err());
        assert!(serde_json::from_str::<SentinelGenesisVersion>("4294967296").is_err());
        Ok(())
    }

    #[test]
    fn standalone_public_key_announcement_is_rejected_for_enrollment() -> anyhow::Result<()> {
        let owner = DeviceIdentity::generate()?;
        let owner_signing = Fixture::signing_key()?;
        let session = SentinelGenesisSession::start(
            &owner,
            &owner_signing,
            2.into(),
            2.into(),
            "Owner".into(),
        )?;
        let peer = DeviceIdentity::generate()?;
        let peer_signing = Fixture::signing_key()?;
        let announcement =
            create_sentinel_genesis_public_key_announcement(&peer, &peer_signing, "Peer".into())?;
        let payload = serde_json::to_string(&announcement)?;
        let (session, error) = session
            .collect_payload(&payload, "")
            .err()
            .ok_or_else(|| IoError::other("announcement must be rejected"))?
            .into_parts();
        assert!(matches!(
            error,
            MultiDeviceError::StandaloneSentinelGenesisAnnouncementRejected
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
        let owner_signing = Fixture::signing_key()?;
        let session = SentinelGenesisSession::start(
            &owner,
            &owner_signing,
            2.into(),
            2.into(),
            "Owner".into(),
        )?;
        let (peer, _, response) = Fixture::participant(session.request(), "Peer")?;
        let payload = serde_json::to_string(&response)?;

        let session = session.collect_payload(&payload, "  Ada's iPhone  ")?;

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
        let owner_signing = Fixture::signing_key()?;
        let session = SentinelGenesisSession::start(
            &owner,
            &owner_signing,
            2.into(),
            2.into(),
            "Owner".into(),
        )?;
        let (_, _, response) = Fixture::participant(session.request(), "Peer")?;
        let duplicate = response.clone();
        let session = session.collect(response)?;
        assert_eq!(session.readiness(), SentinelGenesisReadiness::Complete);
        let (retained, error) = session
            .collect(duplicate)
            .err()
            .ok_or_else(|| IoError::other("duplicate must be rejected"))?
            .into_parts();
        assert!(matches!(
            error,
            MultiDeviceError::DuplicateSentinelGenesisParticipant { .. }
        ));
        assert_eq!(retained.participants().len(), 2);
        Ok(())
    }

    #[test]
    fn tampered_response_and_cross_session_response_fail() -> anyhow::Result<()> {
        let owner = DeviceIdentity::generate()?;
        let owner_signing = Fixture::signing_key()?;
        let first = SentinelGenesisSession::start(
            &owner,
            &owner_signing,
            2.into(),
            2.into(),
            "Owner".into(),
        )?;
        let second_owner = DeviceIdentity::generate()?;
        let second_signing = Fixture::signing_key()?;
        let second = SentinelGenesisSession::start(
            &second_owner,
            &second_signing,
            2.into(),
            2.into(),
            "Other".into(),
        )?;
        let (_, _, mut response) = Fixture::participant(first.request(), "Peer")?;
        let cross = response.clone();
        response.participant.label = "Mallory".into();
        let (first, error) = first
            .collect(response)
            .err()
            .ok_or_else(|| IoError::other("tampered signature must be rejected"))?
            .into_parts();
        assert!(matches!(
            error,
            MultiDeviceError::InvalidSentinelGenesisSignature
        ));
        let (retained, error) = first
            .collect(SentinelGenesisParticipantResponse {
                session_id: second.request().session_id.clone(),
                ..cross
            })
            .err()
            .ok_or_else(|| IoError::other("cross-session response must be rejected"))?
            .into_parts();
        assert!(matches!(
            error,
            MultiDeviceError::InvalidSentinelGenesisSession
        ));
        assert_eq!(retained.participants().len(), 1);
        Ok(())
    }

    #[test]
    fn finalize_is_all_participants_or_nothing_and_deliveries_are_verified() -> anyhow::Result<()> {
        let owner = DeviceIdentity::generate()?;
        let owner_signing = Fixture::signing_key()?;
        let incomplete = SentinelGenesisSession::start(
            &owner,
            &owner_signing,
            2.into(),
            2.into(),
            "Owner".into(),
        )?;
        let store_id = StoreId::parse("store_AAAAAAAAAAA")?;
        let (_, error) = incomplete
            .prepare(&owner_signing)
            .err()
            .ok_or_else(|| IoError::other("incomplete roster must be rejected"))?
            .into_parts();
        assert!(matches!(
            error,
            MultiDeviceError::SentinelGenesisIncomplete { .. }
        ));

        let session = SentinelGenesisSession::start(
            &owner,
            &owner_signing,
            2.into(),
            2.into(),
            "Owner".into(),
        )?;
        let (peer, _, response) = Fixture::participant(session.request(), "Peer")?;
        let session = session.collect(response)?;
        let expected_request = session.request().clone();
        let issued = session.prepare(&owner_signing)?.issue(&store_id)?;
        assert_eq!(issued.records.len(), 4);
        assert_eq!(issued.deliveries.len(), 2);
        let peer_delivery = issued
            .deliveries
            .iter()
            .find(|delivery| delivery.device_id == *peer.device_id())
            .ok_or_else(|| IoError::other("peer delivery must exist"))?;
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
        let owner_signing = Fixture::signing_key()?;
        let session = SentinelGenesisSession::start(
            &owner,
            &owner_signing,
            3.into(),
            2.into(),
            "Owner".into(),
        )?;
        let (peer_a, _, a) = Fixture::participant(session.request(), "A")?;
        let (peer_b, _, b) = Fixture::participant(session.request(), "B")?;
        let session = session.collect(a)?;
        let session = session.collect(b)?;
        let issued = session
            .prepare(&owner_signing)?
            .issue(&StoreId::parse("store_AAAAAAAAAAA")?)?;
        for record in &issued.records {
            assert!(!matches!(
                VaultMetaRecord::classify(record)?,
                VaultMetaRecord::Auth(..)
            ));
        }
        let share_count = multi_device::count_sentinel_share_records(&issued.records)?;
        assert_eq!(usize::from(share_count), 3);
        assert!(
            multi_device::reconstruct_sentinel_vault_keys(&issued.records, slice::from_ref(&owner))
                .is_err()
        );
        let first_quorum =
            multi_device::reconstruct_sentinel_vault_keys(&issued.records, &[owner, peer_a])?;
        assert_eq!(first_quorum.secrets_key.as_str().len(), 64);
        assert!(multi_device::reconstruct_sentinel_vault_keys(&issued.records, &[peer_b]).is_err());
        Ok(())
    }
}
