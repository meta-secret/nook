//! Session-bound, provider-independent Nexus quorum unlock.
//!
//! Opened SLIP-0039 mnemonics exist only inside Rust while a participant
//! creates a response and while the requester finalizes a quorum. The public
//! protocol types expose only signed metadata and age-encrypted ciphertext.

use super::multi_device::{
    DeviceIdentity, OpenedNexusShare, VaultKeys, device_id_from_public_key, encrypt_for_recipient,
    generate_id, open_nexus_share_for_identity, reconstruct_nexus_vault_keys_from_opened,
};
use crate::{
    AgeArmoredCiphertext, CompactToken, DeviceId, DevicePublicKey, DeviceSigningPublicKey,
    MultiDeviceError, MultiDeviceResult, StoreId, StoredSecretRecord,
};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

const UNLOCK_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NexusUnlockPolicy {
    pub threshold: u8,
    pub required_participants: u8,
}

impl NexusUnlockPolicy {
    pub fn validate(self) -> MultiDeviceResult<()> {
        if self.threshold < 2
            || self.required_participants < 2
            || self.threshold > self.required_participants
            || self.required_participants > 16
        {
            return Err(MultiDeviceError::InvalidNexusThreshold);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NexusUnlockRequest {
    pub version: u32,
    pub session_id: CompactToken,
    pub store_id: StoreId,
    pub policy: NexusUnlockPolicy,
    pub requester_device_id: DeviceId,
    pub requester_encryption_public_key: DevicePublicKey,
    pub requester_signing_public_key: DeviceSigningPublicKey,
    pub signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NexusUnlockResponse {
    pub version: u32,
    pub session_id: CompactToken,
    pub store_id: StoreId,
    pub policy: NexusUnlockPolicy,
    pub participant_device_id: DeviceId,
    pub participant_signing_public_key: DeviceSigningPublicKey,
    pub share_index: u8,
    pub ciphertext: AgeArmoredCiphertext,
    pub signature: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NexusUnlockStatus {
    pub collected: u8,
    pub threshold: u8,
    pub ready: bool,
}

/// Public session state contains only encrypted vault rows and opaque signed
/// responses. It deliberately stores neither a requester private key nor an
/// opened mnemonic contribution.
#[derive(Clone)]
pub struct NexusUnlockSession {
    request: NexusUnlockRequest,
    records: Vec<StoredSecretRecord>,
    responses: Vec<NexusUnlockResponse>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NexusUnlockContribution {
    version: u32,
    session_id: CompactToken,
    store_id: StoreId,
    policy: NexusUnlockPolicy,
    participant_device_id: DeviceId,
    participant_signing_public_key: DeviceSigningPublicKey,
    opened_share: OpenedNexusShare,
}

pub fn start_nexus_unlock(
    store_id: StoreId,
    policy: NexusUnlockPolicy,
    records: &[StoredSecretRecord],
    requester_identity: &DeviceIdentity,
    requester_signing_key: &SigningKey,
) -> MultiDeviceResult<NexusUnlockSession> {
    policy.validate()?;
    let mut request = NexusUnlockRequest {
        version: UNLOCK_VERSION,
        session_id: generate_id()?,
        store_id,
        policy,
        requester_device_id: requester_identity.device_id().clone(),
        requester_encryption_public_key: requester_identity.public_key(),
        requester_signing_public_key: signing_public_key(requester_signing_key),
        signature: String::new(),
    };
    request.signature = hex::encode(
        requester_signing_key
            .sign(&request_signing_bytes(&request)?)
            .to_bytes(),
    );
    validate_request(&request)?;
    Ok(NexusUnlockSession {
        request,
        records: records.to_vec(),
        responses: Vec::new(),
    })
}

#[must_use]
pub fn nexus_unlock_request(session: &NexusUnlockSession) -> NexusUnlockRequest {
    session.request.clone()
}

pub fn respond_to_nexus_unlock_request(
    request: &NexusUnlockRequest,
    records: &[StoredSecretRecord],
    identity: &DeviceIdentity,
    signing_key: &SigningKey,
) -> MultiDeviceResult<NexusUnlockResponse> {
    validate_request(request)?;
    let opened_share = open_nexus_share_for_identity(records, identity)?;
    if opened_share.threshold != request.policy.threshold
        || opened_share.required_participants != request.policy.required_participants
        || opened_share.device_id != identity.device_id().as_str()
        || opened_share.share_index == 0
        || opened_share.share_index > request.policy.required_participants
    {
        return Err(MultiDeviceError::InvalidNexusUnlockPayload);
    }
    let participant_signing_public_key = signing_public_key(signing_key);
    let contribution = NexusUnlockContribution {
        version: UNLOCK_VERSION,
        session_id: request.session_id.clone(),
        store_id: request.store_id.clone(),
        policy: request.policy,
        participant_device_id: identity.device_id().clone(),
        participant_signing_public_key: participant_signing_public_key.clone(),
        opened_share,
    };
    let plaintext = serde_json::to_vec(&contribution)
        .map_err(|_| MultiDeviceError::InvalidNexusUnlockPayload)?;
    let mut response = NexusUnlockResponse {
        version: UNLOCK_VERSION,
        session_id: request.session_id.clone(),
        store_id: request.store_id.clone(),
        policy: request.policy,
        participant_device_id: identity.device_id().clone(),
        participant_signing_public_key,
        share_index: contribution.opened_share.share_index,
        ciphertext: encrypt_for_recipient(&plaintext, &request.requester_encryption_public_key)?,
        signature: String::new(),
    };
    response.signature = hex::encode(
        signing_key
            .sign(&response_signing_bytes(&response)?)
            .to_bytes(),
    );
    Ok(response)
}

/// Verify and collect an opaque response. Decryption is intentionally delayed
/// until [`finalize_nexus_unlock`] so plaintext mnemonics are never retained
/// in session state between calls.
pub fn add_nexus_unlock_response(
    session: &mut NexusUnlockSession,
    response: NexusUnlockResponse,
) -> MultiDeviceResult<()> {
    validate_request(&session.request)?;
    validate_response_binding(&session.request, &response)?;
    verify_signature(
        &response.participant_signing_public_key,
        &response.signature,
        &response_signing_bytes(&response)?,
    )?;
    if session.responses.iter().any(|existing| {
        existing.participant_device_id == response.participant_device_id
            || existing.participant_signing_public_key == response.participant_signing_public_key
            || existing.share_index == response.share_index
    }) {
        return Err(MultiDeviceError::DuplicateNexusUnlockParticipant {
            device_id: response.participant_device_id.to_string(),
        });
    }
    session.responses.push(response);
    Ok(())
}

#[must_use]
pub fn nexus_unlock_status(session: &NexusUnlockSession) -> NexusUnlockStatus {
    let collected = u8::try_from(session.responses.len()).unwrap_or(u8::MAX);
    NexusUnlockStatus {
        collected,
        threshold: session.request.policy.threshold,
        ready: collected >= session.request.policy.threshold,
    }
}

#[allow(clippy::needless_pass_by_value)] // Consuming the session prevents replay/finalize reuse.
pub fn finalize_nexus_unlock(
    session: NexusUnlockSession,
    requester_identity: &DeviceIdentity,
) -> MultiDeviceResult<VaultKeys> {
    let NexusUnlockSession {
        request,
        records,
        responses,
    } = session;
    validate_request(&request)?;
    if requester_identity.device_id() != &request.requester_device_id
        || requester_identity.public_key() != request.requester_encryption_public_key
    {
        return Err(MultiDeviceError::NexusUnlockRecipientMismatch);
    }
    if responses.len() < usize::from(request.policy.threshold) {
        return Err(MultiDeviceError::NotEnoughNexusShares {
            threshold: request.policy.threshold,
            available: responses.len(),
        });
    }

    let mut opened = Vec::with_capacity(responses.len());
    let mut device_ids = BTreeSet::new();
    let mut share_indices = BTreeSet::new();
    for response in &responses {
        validate_response_binding(&request, response)?;
        verify_signature(
            &response.participant_signing_public_key,
            &response.signature,
            &response_signing_bytes(response)?,
        )?;
        let plaintext = requester_identity.open_utf8(&response.ciphertext)?;
        let contribution: NexusUnlockContribution = serde_json::from_str(&plaintext)
            .map_err(|_| MultiDeviceError::InvalidNexusUnlockPayload)?;
        if contribution.version != response.version
            || contribution.session_id != response.session_id
            || contribution.store_id != response.store_id
            || contribution.policy != response.policy
            || contribution.participant_device_id != response.participant_device_id
            || contribution.participant_signing_public_key
                != response.participant_signing_public_key
            || contribution.opened_share.device_id != response.participant_device_id.as_str()
            || contribution.opened_share.share_index != response.share_index
            || contribution.opened_share.threshold != response.policy.threshold
            || contribution.opened_share.required_participants
                != response.policy.required_participants
            || !device_ids.insert(contribution.participant_device_id.clone())
            || !share_indices.insert(contribution.opened_share.share_index)
        {
            return Err(MultiDeviceError::InvalidNexusUnlockPayload);
        }
        opened.push(contribution.opened_share);
    }
    reconstruct_nexus_vault_keys_from_opened(&records, &opened)
}

fn validate_request(request: &NexusUnlockRequest) -> MultiDeviceResult<()> {
    request.policy.validate()?;
    if request.version != UNLOCK_VERSION
        || request.requester_signing_public_key.is_empty()
        || device_id_from_public_key(&request.requester_encryption_public_key)?
            != request.requester_device_id
    {
        return Err(MultiDeviceError::InvalidNexusUnlockSession);
    }
    verify_signature(
        &request.requester_signing_public_key,
        &request.signature,
        &request_signing_bytes(request)?,
    )
}

fn validate_response_binding(
    request: &NexusUnlockRequest,
    response: &NexusUnlockResponse,
) -> MultiDeviceResult<()> {
    if response.version != UNLOCK_VERSION
        || response.session_id != request.session_id
        || response.store_id != request.store_id
        || response.policy != request.policy
        || response.participant_signing_public_key.is_empty()
        || response.share_index == 0
        || response.share_index > request.policy.required_participants
    {
        return Err(MultiDeviceError::InvalidNexusUnlockSession);
    }
    Ok(())
}

fn request_signing_bytes(request: &NexusUnlockRequest) -> MultiDeviceResult<Vec<u8>> {
    serde_json::to_vec(&(
        request.version,
        &request.session_id,
        &request.store_id,
        request.policy,
        &request.requester_device_id,
        &request.requester_encryption_public_key,
        &request.requester_signing_public_key,
    ))
    .map_err(|_| MultiDeviceError::InvalidNexusUnlockPayload)
}

fn response_signing_bytes(response: &NexusUnlockResponse) -> MultiDeviceResult<Vec<u8>> {
    serde_json::to_vec(&(
        response.version,
        &response.session_id,
        &response.store_id,
        response.policy,
        &response.participant_device_id,
        &response.participant_signing_public_key,
        response.share_index,
        &response.ciphertext,
    ))
    .map_err(|_| MultiDeviceError::InvalidNexusUnlockPayload)
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
        .ok_or(MultiDeviceError::InvalidNexusUnlockSignature)?;
    let signature: [u8; 64] = hex::decode(signature)
        .ok()
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or(MultiDeviceError::InvalidNexusUnlockSignature)?;
    let verifying_key = VerifyingKey::from_bytes(&public)
        .map_err(|_| MultiDeviceError::InvalidNexusUnlockSignature)?;
    verifying_key
        .verify(bytes, &Signature::from_bytes(&signature))
        .map_err(|_| MultiDeviceError::InvalidNexusUnlockSignature)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::create_nexus_root_share_records_for_recipients;

    fn signing_key(fill: u8) -> SigningKey {
        SigningKey::from_bytes(&[fill; 32])
    }

    struct Fixture {
        keys: VaultKeys,
        records: Vec<StoredSecretRecord>,
        participants: Vec<DeviceIdentity>,
        requester: DeviceIdentity,
        requester_signing: SigningKey,
        store_id: StoreId,
        policy: NexusUnlockPolicy,
    }

    fn fixture() -> Fixture {
        let participants = (0..3)
            .map(|_| DeviceIdentity::generate().unwrap())
            .collect::<Vec<_>>();
        let recipients = participants
            .iter()
            .map(|identity| (identity.device_id().clone(), identity.public_key()))
            .collect::<Vec<_>>();
        let (keys, records) =
            create_nexus_root_share_records_for_recipients(&recipients, 2).unwrap();
        Fixture {
            keys,
            records,
            participants,
            requester: DeviceIdentity::generate().unwrap(),
            requester_signing: signing_key(90),
            store_id: StoreId::parse("store_AAAAAAAAAAA").unwrap(),
            policy: NexusUnlockPolicy {
                threshold: 2,
                required_participants: 3,
            },
        }
    }

    fn session(fixture: &Fixture) -> NexusUnlockSession {
        start_nexus_unlock(
            fixture.store_id.clone(),
            fixture.policy,
            &fixture.records,
            &fixture.requester,
            &fixture.requester_signing,
        )
        .unwrap()
    }

    fn response(
        fixture: &Fixture,
        request: &NexusUnlockRequest,
        index: usize,
    ) -> NexusUnlockResponse {
        respond_to_nexus_unlock_request(
            request,
            &fixture.records,
            &fixture.participants[index],
            &signing_key(u8::try_from(index + 1).unwrap()),
        )
        .unwrap()
    }

    #[test]
    fn signed_two_of_three_responses_unlock_without_exposing_mnemonics() {
        let fixture = fixture();
        let mut session = session(&fixture);
        let request = nexus_unlock_request(&session);
        let first = response(&fixture, &request, 0);
        let second = response(&fixture, &request, 1);
        let local_plaintext =
            open_nexus_share_for_identity(&fixture.records, &fixture.participants[0]).unwrap();
        assert!(
            !serde_json::to_string(&first)
                .unwrap()
                .contains(&local_plaintext.share)
        );
        add_nexus_unlock_response(&mut session, first).unwrap();
        assert_eq!(
            nexus_unlock_status(&session),
            NexusUnlockStatus {
                collected: 1,
                threshold: 2,
                ready: false,
            }
        );
        add_nexus_unlock_response(&mut session, second).unwrap();
        assert!(nexus_unlock_status(&session).ready);
        assert_eq!(
            finalize_nexus_unlock(session, &fixture.requester).unwrap(),
            fixture.keys
        );
    }

    #[test]
    fn below_quorum_and_wrong_requester_are_rejected() {
        let fixture = fixture();
        let mut session = session(&fixture);
        let request = nexus_unlock_request(&session);
        add_nexus_unlock_response(&mut session, response(&fixture, &request, 0)).unwrap();
        assert!(matches!(
            finalize_nexus_unlock(session.clone(), &fixture.requester),
            Err(MultiDeviceError::NotEnoughNexusShares { .. })
        ));
        let wrong = DeviceIdentity::generate().unwrap();
        assert!(matches!(
            finalize_nexus_unlock(session, &wrong),
            Err(MultiDeviceError::NexusUnlockRecipientMismatch)
        ));
    }

    #[test]
    fn duplicate_device_and_share_index_are_rejected() {
        let fixture = fixture();
        let mut session = session(&fixture);
        let request = nexus_unlock_request(&session);
        let first = response(&fixture, &request, 0);
        let duplicate_index = first.share_index;
        add_nexus_unlock_response(&mut session, first.clone()).unwrap();
        assert!(matches!(
            add_nexus_unlock_response(&mut session, first),
            Err(MultiDeviceError::DuplicateNexusUnlockParticipant { .. })
        ));

        let mut second = response(&fixture, &request, 1);
        second.share_index = duplicate_index;
        second.signature = hex::encode(
            signing_key(2)
                .sign(&response_signing_bytes(&second).unwrap())
                .to_bytes(),
        );
        assert!(matches!(
            add_nexus_unlock_response(&mut session, second),
            Err(MultiDeviceError::DuplicateNexusUnlockParticipant { .. })
        ));
    }

    #[test]
    fn tampered_request_response_and_wrong_session_are_rejected() {
        let fixture = fixture();
        let mut first_session = session(&fixture);
        let first_request = nexus_unlock_request(&first_session);
        let mut tampered_request = first_request.clone();
        tampered_request.policy.threshold = 3;
        assert!(matches!(
            respond_to_nexus_unlock_request(
                &tampered_request,
                &fixture.records,
                &fixture.participants[0],
                &signing_key(1),
            ),
            Err(MultiDeviceError::InvalidNexusUnlockSignature)
        ));

        let response = response(&fixture, &first_request, 0);
        let second_session = session(&fixture);
        let mut wrong_session = second_session;
        assert!(matches!(
            add_nexus_unlock_response(&mut wrong_session, response.clone()),
            Err(MultiDeviceError::InvalidNexusUnlockSession)
        ));

        let mut tampered_response = response;
        tampered_response.share_index = 2;
        assert!(matches!(
            add_nexus_unlock_response(&mut first_session, tampered_response),
            Err(MultiDeviceError::InvalidNexusUnlockSignature)
        ));
    }
}
