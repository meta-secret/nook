//! Provider-independent Sentinel pre-genesis ceremony.
//!
//! Session state contains public data only. Vault keys and shares are generated
//! together only after the complete `N`-participant roster has been verified.
//! Sentinel roots are split with the current extendable SLIP-0039 format.

use super::multi_device::{
    DeviceIdentity, SentinelShareEnvelope, VaultMember, VaultMetaRecord, build_members_records,
    create_sentinel_root_share_records_for_recipients, dec_auth_id_from_public_key,
    device_id_from_public_key, generate_id,
};
use crate::{
    CompactToken, DeviceId, DevicePublicKey, DeviceSigningPublicKey, MultiDeviceError,
    MultiDeviceResult, StoreId, StoredSecretRecord,
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const GENESIS_VERSION: u32 = 1;
const PUBLIC_KEY_ANNOUNCEMENT_KIND: &str = "publicKeyAnnouncement";
const SENTINEL_REQUEST_HASH_PREFIX: &str = "#sentinel-request=";
const SENTINEL_RESPONSE_HASH_PREFIX: &str = "#sentinel-response=";
const MAX_SENTINEL_LINK_PAYLOAD_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentinelGenesisPolicy {
    pub participant_count: u8,
    pub threshold: u8,
}

impl SentinelGenesisPolicy {
    pub fn validate(self) -> MultiDeviceResult<()> {
        if self.threshold < 2
            || self.participant_count < 2
            || self.participant_count > 16
            || self.threshold > self.participant_count
        {
            return Err(MultiDeviceError::InvalidSentinelThreshold);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentinelGenesisRequest {
    pub version: u32,
    pub session_id: CompactToken,
    pub policy: SentinelGenesisPolicy,
    pub initiator_device_id: DeviceId,
    pub initiator_signing_public_key: DeviceSigningPublicKey,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentinelGenesisParticipant {
    pub device_id: DeviceId,
    pub encryption_public_key: DevicePublicKey,
    pub signing_public_key: DeviceSigningPublicKey,
    pub label: String,
    pub fingerprint: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentinelGenesisParticipantResponse {
    pub version: u32,
    pub session_id: CompactToken,
    pub participant: SentinelGenesisParticipant,
    pub signature: String,
}

/// Provider-free public key bundle a participant can share before any initiator
/// request exists. The initiator binds it to the active genesis session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentinelGenesisPublicKeyAnnouncement {
    pub kind: String,
    pub version: u32,
    pub device_id: DeviceId,
    pub encryption_public_key: DevicePublicKey,
    pub signing_public_key: DeviceSigningPublicKey,
    pub label: String,
    pub fingerprint: String,
    pub signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentinelGenesisSession {
    pub request: SentinelGenesisRequest,
    /// Verified responses are intentionally session-only. Serializing a public
    /// draft never turns unverified participant fields into a trusted roster;
    /// deserialization yields an incomplete request-only draft that must be
    /// restarted through `start_sentinel_genesis`.
    #[serde(skip, default)]
    participants: Vec<SentinelGenesisParticipant>,
}

impl SentinelGenesisSession {
    #[must_use]
    pub fn participants(&self) -> &[SentinelGenesisParticipant] {
        &self.participants
    }

    #[must_use]
    pub fn is_complete(&self) -> bool {
        self.participants.len() == usize::from(self.request.policy.participant_count)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentinelGenesisShareDelivery {
    pub version: u32,
    pub session_id: CompactToken,
    pub store_id: StoreId,
    pub policy: SentinelGenesisPolicy,
    pub device_id: DeviceId,
    pub encryption_public_key: DevicePublicKey,
    pub share: SentinelShareEnvelope,
    pub initiator_signing_public_key: DeviceSigningPublicKey,
    pub signature: String,
}

/// Atomic result of the key-generation step. Callers must serialize all
/// records together; no API exposes a partially issued share set.
pub struct SentinelGenesisIssued {
    pub records: Vec<StoredSecretRecord>,
    pub participants: Vec<SentinelGenesisParticipant>,
    pub deliveries: Vec<SentinelGenesisShareDelivery>,
}

pub fn start_sentinel_genesis(
    identity: &DeviceIdentity,
    signing_key: &SigningKey,
    participant_count: u8,
    threshold: u8,
    label: String,
) -> MultiDeviceResult<SentinelGenesisSession> {
    let policy = SentinelGenesisPolicy {
        participant_count,
        threshold,
    };
    policy.validate()?;
    let session_id = generate_id()?;
    let signing_public_key = signing_public_key(signing_key);
    let request = SentinelGenesisRequest {
        version: GENESIS_VERSION,
        session_id: session_id.clone(),
        policy,
        initiator_device_id: identity.device_id().clone(),
        initiator_signing_public_key: signing_public_key,
    };
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

/// Build a browser deep link for the public owner request. The browser supplies
/// the app base URL; Rust owns canonical serialization and payload validation.
pub fn build_sentinel_genesis_request_link(
    request_json: &str,
    base_url: &str,
) -> MultiDeviceResult<String> {
    let canonical = normalize_sentinel_genesis_request(request_json)?;
    Ok(build_sentinel_link(
        &canonical,
        base_url,
        SENTINEL_REQUEST_HASH_PREFIX,
    ))
}

/// Accept a raw request payload or a full Sentinel request URL and return the
/// canonical JSON consumed by the signed response ceremony.
pub fn normalize_sentinel_genesis_request(input: &str) -> MultiDeviceResult<String> {
    let json =
        decode_sentinel_link_payload(input, SENTINEL_REQUEST_HASH_PREFIX, "sentinel-request")?;
    let request: SentinelGenesisRequest =
        serde_json::from_str(&json).map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
    validate_request(&request)?;
    serde_json::to_string(&request).map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)
}

/// Build the return URL a participant sends back to the owner. The signed
/// response remains public ceremony data and is verified against the active
/// session when the owner imports it.
pub fn build_sentinel_genesis_participant_response_link(
    response_json: &str,
    base_url: &str,
) -> MultiDeviceResult<String> {
    let canonical = normalize_sentinel_genesis_participant_payload(response_json)?;
    Ok(build_sentinel_link(
        &canonical,
        base_url,
        SENTINEL_RESPONSE_HASH_PREFIX,
    ))
}

/// Accept a signed response/public-key announcement as JSON or as a return URL.
/// Signature and session verification still happen in
/// `add_sentinel_genesis_participant_payload`.
pub fn normalize_sentinel_genesis_participant_payload(input: &str) -> MultiDeviceResult<String> {
    let json =
        decode_sentinel_link_payload(input, SENTINEL_RESPONSE_HASH_PREFIX, "sentinel-response")?;
    let value: serde_json::Value =
        serde_json::from_str(&json).map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
    if value.get("kind").and_then(serde_json::Value::as_str) == Some(PUBLIC_KEY_ANNOUNCEMENT_KIND) {
        let announcement: SentinelGenesisPublicKeyAnnouncement = serde_json::from_value(value)
            .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
        return serde_json::to_string(&announcement)
            .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload);
    }
    let response: SentinelGenesisParticipantResponse = serde_json::from_value(value)
        .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
    serde_json::to_string(&response).map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)
}

fn build_sentinel_link(payload: &str, base_url: &str, hash_prefix: &str) -> String {
    let base = base_url.trim().trim_end_matches('/');
    let encoded = URL_SAFE_NO_PAD.encode(payload.as_bytes());
    format!("{base}/{hash_prefix}{encoded}")
}

fn decode_sentinel_link_payload(
    input: &str,
    hash_prefix: &str,
    query_key: &str,
) -> MultiDeviceResult<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_SENTINEL_LINK_PAYLOAD_BYTES {
        return Err(MultiDeviceError::InvalidSentinelGenesisPayload);
    }
    if trimmed.starts_with('{') {
        return Ok(trimmed.to_owned());
    }

    let encoded = extract_link_value(trimmed, hash_prefix, query_key)
        .ok_or(MultiDeviceError::InvalidSentinelGenesisPayload)?;
    let decoded = percent_decode_str(encoded)
        .decode_utf8()
        .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
    if decoded.starts_with('{') {
        return Ok(decoded.into_owned());
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(decoded.as_bytes())
        .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
    if bytes.len() > MAX_SENTINEL_LINK_PAYLOAD_BYTES {
        return Err(MultiDeviceError::InvalidSentinelGenesisPayload);
    }
    String::from_utf8(bytes).map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)
}

fn extract_link_value<'a>(input: &'a str, hash_prefix: &str, query_key: &str) -> Option<&'a str> {
    if let Some(value) = input.strip_prefix(hash_prefix) {
        return Some(value);
    }
    if let Some(hash) = input.split_once('#').map(|(_, hash)| hash) {
        let prefix = hash_prefix.trim_start_matches('#');
        if let Some(value) = hash.strip_prefix(prefix) {
            return Some(value);
        }
    }
    let query = input.split_once('?').map_or(input, |(_, query)| query);
    query.split('&').find_map(|part| {
        let (key, value) = part.split_once('=')?;
        (key == query_key).then_some(value)
    })
}

/// Accept either a session-bound response or a standalone public-key announcement.
pub fn add_sentinel_genesis_participant_payload(
    session: &mut SentinelGenesisSession,
    payload_json: &str,
) -> MultiDeviceResult<()> {
    let value: serde_json::Value = serde_json::from_str(payload_json)
        .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
    if value.get("kind").and_then(serde_json::Value::as_str) == Some(PUBLIC_KEY_ANNOUNCEMENT_KIND) {
        let announcement: SentinelGenesisPublicKeyAnnouncement = serde_json::from_value(value)
            .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
        return add_sentinel_genesis_public_key_announcement(session, &announcement);
    }
    let response: SentinelGenesisParticipantResponse = serde_json::from_str(payload_json)
        .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
    add_sentinel_genesis_response(session, response)
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
    if session.participants.len() >= usize::from(session.request.policy.participant_count) {
        return Err(MultiDeviceError::SentinelGenesisRosterFull);
    }
    session.participants.push(response.participant);
    Ok(())
}

pub fn add_sentinel_genesis_public_key_announcement(
    session: &mut SentinelGenesisSession,
    announcement: &SentinelGenesisPublicKeyAnnouncement,
) -> MultiDeviceResult<()> {
    validate_request(&session.request)?;
    verify_public_key_announcement(announcement)?;
    let participant = bind_announcement_to_session(announcement, &session.request.session_id);
    if session.participants.iter().any(|existing| {
        existing.device_id == participant.device_id
            || existing.encryption_public_key == participant.encryption_public_key
            || existing.signing_public_key == participant.signing_public_key
    }) {
        return Err(MultiDeviceError::DuplicateSentinelGenesisParticipant {
            device_id: participant.device_id.to_string(),
        });
    }
    if session.participants.len() >= usize::from(session.request.policy.participant_count) {
        return Err(MultiDeviceError::SentinelGenesisRosterFull);
    }
    session.participants.push(participant);
    Ok(())
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
            available: session.participants.len(),
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
        || delivery.share.share_index == 0
        || delivery.share.share_index > delivery.policy.participant_count
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
    Ok(())
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
        .ok_or(MultiDeviceError::InvalidSentinelGenesisSignature)?;
    let signature: [u8; 64] = hex::decode(signature)
        .ok()
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or(MultiDeviceError::InvalidSentinelGenesisSignature)?;
    let verifying_key = VerifyingKey::from_bytes(&public)
        .map_err(|_| MultiDeviceError::InvalidSentinelGenesisSignature)?;
    verifying_key
        .verify(bytes, &Signature::from_bytes(&signature))
        .map_err(|_| MultiDeviceError::InvalidSentinelGenesisSignature)
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

fn bind_announcement_to_session(
    announcement: &SentinelGenesisPublicKeyAnnouncement,
    session_id: &CompactToken,
) -> SentinelGenesisParticipant {
    SentinelGenesisParticipant {
        device_id: announcement.device_id.clone(),
        encryption_public_key: announcement.encryption_public_key.clone(),
        signing_public_key: announcement.signing_public_key.clone(),
        label: announcement.label.clone(),
        fingerprint: participant_fingerprint(
            &announcement.encryption_public_key,
            &announcement.signing_public_key,
            session_id,
        ),
    }
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
    use super::*;

    fn signing_key() -> SigningKey {
        let mut seed = [0_u8; 32];
        getrandom::getrandom(&mut seed).unwrap();
        SigningKey::from_bytes(&seed)
    }

    fn participant(
        request: &SentinelGenesisRequest,
        label: &str,
    ) -> (
        DeviceIdentity,
        SigningKey,
        SentinelGenesisParticipantResponse,
    ) {
        let identity = DeviceIdentity::generate().unwrap();
        let signing = signing_key();
        let response =
            respond_to_sentinel_genesis_request(request, &identity, &signing, label.to_owned())
                .unwrap();
        (identity, signing, response)
    }

    #[test]
    fn policy_requires_real_threshold() {
        assert!(
            SentinelGenesisPolicy {
                participant_count: 3,
                threshold: 2
            }
            .validate()
            .is_ok()
        );
        assert!(
            SentinelGenesisPolicy {
                participant_count: 3,
                threshold: 1
            }
            .validate()
            .is_err()
        );
        assert!(
            SentinelGenesisPolicy {
                participant_count: 2,
                threshold: 3
            }
            .validate()
            .is_err()
        );
        assert!(
            SentinelGenesisPolicy {
                participant_count: 17,
                threshold: 2
            }
            .validate()
            .is_err()
        );
    }

    #[test]
    fn public_key_announcement_joins_without_initiator_request() {
        let owner = DeviceIdentity::generate().unwrap();
        let owner_signing = signing_key();
        let mut session =
            start_sentinel_genesis(&owner, &owner_signing, 2, 2, "Owner".into()).unwrap();
        let peer = DeviceIdentity::generate().unwrap();
        let peer_signing = signing_key();
        let announcement =
            create_sentinel_genesis_public_key_announcement(&peer, &peer_signing, "Peer".into())
                .unwrap();
        let payload = serde_json::to_string(&announcement).unwrap();
        add_sentinel_genesis_participant_payload(&mut session, &payload).unwrap();
        assert!(session.is_complete());
        let issued = finalize_sentinel_genesis_shares(
            session,
            &StoreId::parse("store_AAAAAAAAAAA").unwrap(),
            &owner_signing,
        )
        .unwrap();
        assert_eq!(issued.deliveries.len(), 2);
    }

    #[test]
    fn request_link_round_trips_as_canonical_validated_json() {
        let owner = DeviceIdentity::generate().unwrap();
        let owner_signing = signing_key();
        let session = start_sentinel_genesis(&owner, &owner_signing, 3, 2, "Owner".into()).unwrap();
        let request_json = serde_json::to_string(&session.request).unwrap();

        let link = build_sentinel_genesis_request_link(&request_json, "https://nook.example/app/")
            .unwrap();
        assert!(link.starts_with("https://nook.example/app/#sentinel-request="));
        assert!(!link.contains(&session.request.session_id.to_string()));
        assert_eq!(
            normalize_sentinel_genesis_request(&link).unwrap(),
            request_json
        );
        assert!(normalize_sentinel_genesis_request("not-a-request").is_err());
    }

    #[test]
    fn participant_response_link_round_trips_and_remains_session_verified() {
        let owner = DeviceIdentity::generate().unwrap();
        let owner_signing = signing_key();
        let mut session =
            start_sentinel_genesis(&owner, &owner_signing, 2, 2, "Owner".into()).unwrap();
        let (_, _, response) = participant(&session.request, "Peer");
        let response_json = serde_json::to_string(&response).unwrap();

        let link = build_sentinel_genesis_participant_response_link(
            &response_json,
            "https://nook.example/app/",
        )
        .unwrap();
        assert!(link.starts_with("https://nook.example/app/#sentinel-response="));
        assert!(!link.contains(&response.signature));
        let normalized = normalize_sentinel_genesis_participant_payload(&link).unwrap();
        assert_eq!(normalized, response_json);
        add_sentinel_genesis_participant_payload(&mut session, &normalized).unwrap();
        assert!(session.is_complete());
        assert!(normalize_sentinel_genesis_participant_payload("not-a-response").is_err());
    }

    #[test]
    fn tampered_public_key_announcement_fails() {
        let owner = DeviceIdentity::generate().unwrap();
        let owner_signing = signing_key();
        let mut session =
            start_sentinel_genesis(&owner, &owner_signing, 2, 2, "Owner".into()).unwrap();
        let peer = DeviceIdentity::generate().unwrap();
        let peer_signing = signing_key();
        let mut announcement =
            create_sentinel_genesis_public_key_announcement(&peer, &peer_signing, "Peer".into())
                .unwrap();
        announcement.label = "Mallory".into();
        let payload = serde_json::to_string(&announcement).unwrap();
        assert!(matches!(
            add_sentinel_genesis_participant_payload(&mut session, &payload),
            Err(MultiDeviceError::InvalidSentinelGenesisSignature)
        ));
    }

    #[test]
    fn response_is_session_bound_signed_and_unique() {
        let owner = DeviceIdentity::generate().unwrap();
        let owner_signing = signing_key();
        let mut session =
            start_sentinel_genesis(&owner, &owner_signing, 2, 2, "Owner".into()).unwrap();
        let (_, _, response) = participant(&session.request, "Peer");
        let duplicate = response.clone();
        add_sentinel_genesis_response(&mut session, response).unwrap();
        assert!(session.is_complete());
        assert!(matches!(
            add_sentinel_genesis_response(&mut session, duplicate),
            Err(MultiDeviceError::DuplicateSentinelGenesisParticipant { .. })
        ));
    }

    #[test]
    fn tampered_response_and_cross_session_response_fail() {
        let owner = DeviceIdentity::generate().unwrap();
        let owner_signing = signing_key();
        let mut first =
            start_sentinel_genesis(&owner, &owner_signing, 2, 2, "Owner".into()).unwrap();
        let second_owner = DeviceIdentity::generate().unwrap();
        let second_signing = signing_key();
        let second =
            start_sentinel_genesis(&second_owner, &second_signing, 2, 2, "Other".into()).unwrap();
        let (_, _, mut response) = participant(&first.request, "Peer");
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
    }

    #[test]
    fn finalize_is_all_participants_or_nothing_and_deliveries_are_verified() {
        let owner = DeviceIdentity::generate().unwrap();
        let owner_signing = signing_key();
        let incomplete =
            start_sentinel_genesis(&owner, &owner_signing, 2, 2, "Owner".into()).unwrap();
        let store_id = StoreId::parse("store_AAAAAAAAAAA").unwrap();
        assert!(matches!(
            finalize_sentinel_genesis_shares(incomplete, &store_id, &owner_signing),
            Err(MultiDeviceError::SentinelGenesisIncomplete { .. })
        ));

        let mut session =
            start_sentinel_genesis(&owner, &owner_signing, 2, 2, "Owner".into()).unwrap();
        let (peer, _, response) = participant(&session.request, "Peer");
        add_sentinel_genesis_response(&mut session, response).unwrap();
        let issued = finalize_sentinel_genesis_shares(session, &store_id, &owner_signing).unwrap();
        assert_eq!(issued.records.len(), 4);
        assert_eq!(issued.deliveries.len(), 2);
        let peer_delivery = issued
            .deliveries
            .iter()
            .find(|delivery| delivery.device_id == *peer.device_id())
            .unwrap();
        let expected_request = SentinelGenesisRequest {
            version: GENESIS_VERSION,
            session_id: peer_delivery.session_id.clone(),
            policy: peer_delivery.policy,
            initiator_device_id: owner.device_id().clone(),
            initiator_signing_public_key: peer_delivery.initiator_signing_public_key.clone(),
        };
        let accepted =
            accept_sentinel_genesis_share_delivery(peer_delivery, &expected_request, &peer)
                .unwrap();
        assert!(issued.records.contains(&accepted));
        assert!(matches!(
            accept_sentinel_genesis_share_delivery(peer_delivery, &expected_request, &owner),
            Err(MultiDeviceError::SentinelGenesisDeliveryRecipientMismatch)
        ));
    }

    #[test]
    fn no_full_key_envelope_and_quorum_is_required() {
        let owner = DeviceIdentity::generate().unwrap();
        let owner_signing = signing_key();
        let mut session =
            start_sentinel_genesis(&owner, &owner_signing, 3, 2, "Owner".into()).unwrap();
        let (peer_a, _, a) = participant(&session.request, "A");
        let (peer_b, _, b) = participant(&session.request, "B");
        add_sentinel_genesis_response(&mut session, a).unwrap();
        add_sentinel_genesis_response(&mut session, b).unwrap();
        let issued = finalize_sentinel_genesis_shares(
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
            super::super::multi_device::count_sentinel_share_records(&issued.records),
            3
        );
        assert!(
            super::super::multi_device::reconstruct_sentinel_vault_keys(
                &issued.records,
                std::slice::from_ref(&owner)
            )
            .is_err()
        );
        let first_quorum = super::super::multi_device::reconstruct_sentinel_vault_keys(
            &issued.records,
            &[owner, peer_a],
        )
        .unwrap();
        assert_eq!(first_quorum.secrets_key.as_str().len(), 64);
        assert!(
            super::super::multi_device::reconstruct_sentinel_vault_keys(&issued.records, &[peer_b])
                .is_err()
        );
    }
}
