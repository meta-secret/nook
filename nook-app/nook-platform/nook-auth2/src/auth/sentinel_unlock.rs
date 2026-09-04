//! Session-bound, provider-independent Sentinel quorum unlock.
//!
//! Opened SLIP-0039 mnemonics exist only inside Rust while a participant
//! creates a response and while the requester finalizes a quorum. The public
//! protocol types expose only signed metadata and age-encrypted ciphertext.

mod response;

pub use response::CheckedSentinelUnlockRequest;

use super::multi_device::{
    DeviceIdentity, OpenedSentinelShare, VaultKeys, device_id_from_public_key, generate_id,
    reconstruct_sentinel_vault_keys_from_opened,
};
use super::sentinel_signing;
use crate::{
    AgeArmoredCiphertext, CompactToken, DeviceId, DevicePublicKey, DeviceSigningPublicKey,
    MultiDeviceError, MultiDeviceResult, StoreId, StoredSecretRecord,
};
use crate::{SentinelParticipantCount, SentinelShareCount, SentinelShareIndex, SentinelThreshold};
use ed25519_dalek::{Signer, SigningKey};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

const UNLOCK_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentinelUnlockPolicy {
    pub threshold: SentinelThreshold,
    pub required_participants: SentinelParticipantCount,
}

impl SentinelUnlockPolicy {
    pub fn validate(self) -> MultiDeviceResult<()> {
        if u8::from(self.threshold) < 2
            || u8::from(self.required_participants) < 2
            || u8::from(self.threshold) > u8::from(self.required_participants)
            || u8::from(self.required_participants) > 16
        {
            return Err(MultiDeviceError::InvalidSentinelThreshold);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentinelUnlockRequest {
    pub version: u32,
    pub session_id: CompactToken,
    pub store_id: StoreId,
    pub policy: SentinelUnlockPolicy,
    pub requester_device_id: DeviceId,
    pub requester_encryption_public_key: DevicePublicKey,
    pub requester_signing_public_key: DeviceSigningPublicKey,
    pub signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentinelUnlockResponse {
    pub version: u32,
    pub session_id: CompactToken,
    pub store_id: StoreId,
    pub policy: SentinelUnlockPolicy,
    pub participant_device_id: DeviceId,
    pub participant_signing_public_key: DeviceSigningPublicKey,
    pub share_index: SentinelShareIndex,
    pub ciphertext: AgeArmoredCiphertext,
    pub signature: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentinelUnlockStatus {
    pub collected: SentinelShareCount,
    pub threshold: SentinelThreshold,
    pub ready: bool,
}

/// Public session state contains only encrypted vault rows and opaque signed
/// responses. It deliberately stores neither a requester private key nor an
/// opened mnemonic contribution.
#[derive(Clone)]
pub struct SentinelUnlockSession {
    request: SentinelUnlockRequest,
    records: Vec<StoredSecretRecord>,
    responses: Vec<SentinelUnlockResponse>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SentinelUnlockContribution {
    version: u32,
    session_id: CompactToken,
    store_id: StoreId,
    policy: SentinelUnlockPolicy,
    participant_device_id: DeviceId,
    participant_signing_public_key: DeviceSigningPublicKey,
    opened_share: OpenedSentinelShare,
}

pub fn start_sentinel_unlock(
    store_id: StoreId,
    policy: SentinelUnlockPolicy,
    records: &[StoredSecretRecord],
    requester_identity: &DeviceIdentity,
    requester_signing_key: &SigningKey,
) -> MultiDeviceResult<SentinelUnlockSession> {
    policy.validate()?;
    let mut request = SentinelUnlockRequest {
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
    Ok(SentinelUnlockSession {
        request,
        records: records.to_vec(),
        responses: Vec::new(),
    })
}

#[must_use]
pub fn sentinel_unlock_request(session: &SentinelUnlockSession) -> SentinelUnlockRequest {
    session.request.clone()
}

/// Verify and collect an opaque response. Decryption is intentionally delayed
/// until [`finalize_sentinel_unlock`] so plaintext mnemonics are never retained
/// in session state between calls.
pub fn add_sentinel_unlock_response(
    session: &mut SentinelUnlockSession,
    response: SentinelUnlockResponse,
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
        return Err(MultiDeviceError::DuplicateSentinelUnlockParticipant {
            device_id: response.participant_device_id.to_string(),
        });
    }
    session.responses.push(response);
    Ok(())
}

#[must_use]
pub fn sentinel_unlock_status(session: &SentinelUnlockSession) -> SentinelUnlockStatus {
    let collected = session.responses.len().into();
    SentinelUnlockStatus {
        collected,
        threshold: session.request.policy.threshold,
        ready: session.responses.len() >= usize::from(u8::from(session.request.policy.threshold)),
    }
}

#[allow(clippy::needless_pass_by_value)] // Consuming the session prevents replay/finalize reuse.
pub fn finalize_sentinel_unlock(
    session: SentinelUnlockSession,
    requester_identity: &DeviceIdentity,
) -> MultiDeviceResult<VaultKeys> {
    let SentinelUnlockSession {
        request,
        records,
        responses,
    } = session;
    validate_request(&request)?;
    if requester_identity.device_id() != &request.requester_device_id
        || requester_identity.public_key() != request.requester_encryption_public_key
    {
        return Err(MultiDeviceError::SentinelUnlockRecipientMismatch);
    }
    if responses.len() < usize::from(u8::from(request.policy.threshold)) {
        return Err(MultiDeviceError::NotEnoughSentinelShares {
            threshold: request.policy.threshold,
            available: responses.len().into(),
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
        let contribution: SentinelUnlockContribution = serde_json::from_str(&plaintext)
            .map_err(|_| MultiDeviceError::InvalidSentinelUnlockPayload)?;
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
            return Err(MultiDeviceError::InvalidSentinelUnlockPayload);
        }
        opened.push(contribution.opened_share);
    }
    reconstruct_sentinel_vault_keys_from_opened(&records, &opened)
}

fn validate_request(request: &SentinelUnlockRequest) -> MultiDeviceResult<()> {
    request.policy.validate()?;
    if request.version != UNLOCK_VERSION
        || request.requester_signing_public_key.is_empty()
        || device_id_from_public_key(&request.requester_encryption_public_key)?
            != request.requester_device_id
    {
        return Err(MultiDeviceError::InvalidSentinelUnlockSession);
    }
    verify_signature(
        &request.requester_signing_public_key,
        &request.signature,
        &request_signing_bytes(request)?,
    )
}

fn validate_response_binding(
    request: &SentinelUnlockRequest,
    response: &SentinelUnlockResponse,
) -> MultiDeviceResult<()> {
    if response.version != UNLOCK_VERSION
        || response.session_id != request.session_id
        || response.store_id != request.store_id
        || response.policy != request.policy
        || response.participant_signing_public_key.is_empty()
        || u8::from(response.share_index) == 0
        || u8::from(response.share_index) > u8::from(request.policy.required_participants)
    {
        return Err(MultiDeviceError::InvalidSentinelUnlockSession);
    }
    Ok(())
}

fn request_signing_bytes(request: &SentinelUnlockRequest) -> MultiDeviceResult<Vec<u8>> {
    serde_json::to_vec(&(
        request.version,
        &request.session_id,
        &request.store_id,
        request.policy,
        &request.requester_device_id,
        &request.requester_encryption_public_key,
        &request.requester_signing_public_key,
    ))
    .map_err(|_| MultiDeviceError::InvalidSentinelUnlockPayload)
}

fn response_signing_bytes(response: &SentinelUnlockResponse) -> MultiDeviceResult<Vec<u8>> {
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
    .map_err(|_| MultiDeviceError::InvalidSentinelUnlockPayload)
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
        MultiDeviceError::InvalidSentinelUnlockSignature
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        create_sentinel_root_share_records_for_recipients, open_sentinel_share_for_identity,
    };

    struct Fixture {
        keys: VaultKeys,
        records: Vec<StoredSecretRecord>,
        participants: Vec<DeviceIdentity>,
        requester: DeviceIdentity,
        requester_signing: SigningKey,
        store_id: StoreId,
        policy: SentinelUnlockPolicy,
    }

    #[test]
    fn signed_two_of_three_responses_unlock_without_exposing_mnemonics() -> anyhow::Result<()> {
        let fixture = Fixture::new()?;
        let mut session = fixture.session()?;
        let request = sentinel_unlock_request(&session);
        let first = fixture.response(&request, 0)?;
        let second = fixture.response(&request, 1)?;
        let local_plaintext =
            open_sentinel_share_for_identity(&fixture.records, &fixture.participants[0])?;
        assert!(!serde_json::to_string(&first)?.contains(&local_plaintext.share));
        add_sentinel_unlock_response(&mut session, first)?;
        assert_eq!(
            sentinel_unlock_status(&session),
            SentinelUnlockStatus {
                collected: 1.into(),
                threshold: 2.into(),
                ready: false,
            }
        );
        add_sentinel_unlock_response(&mut session, second)?;
        assert!(sentinel_unlock_status(&session).ready);
        assert_eq!(
            finalize_sentinel_unlock(session, &fixture.requester)?,
            fixture.keys
        );
        Ok(())
    }

    #[test]
    fn below_quorum_and_wrong_requester_are_rejected() -> anyhow::Result<()> {
        let fixture = Fixture::new()?;
        let mut session = fixture.session()?;
        let request = sentinel_unlock_request(&session);
        add_sentinel_unlock_response(&mut session, fixture.response(&request, 0)?)?;
        assert!(matches!(
            finalize_sentinel_unlock(session.clone(), &fixture.requester),
            Err(MultiDeviceError::NotEnoughSentinelShares { .. })
        ));
        let wrong = DeviceIdentity::generate()?;
        assert!(matches!(
            finalize_sentinel_unlock(session, &wrong),
            Err(MultiDeviceError::SentinelUnlockRecipientMismatch)
        ));
        Ok(())
    }

    #[test]
    fn duplicate_device_and_share_index_are_rejected() -> anyhow::Result<()> {
        let fixture = Fixture::new()?;
        let mut session = fixture.session()?;
        let request = sentinel_unlock_request(&session);
        let first = fixture.response(&request, 0)?;
        let duplicate_index = first.share_index;
        add_sentinel_unlock_response(&mut session, first.clone())?;
        assert!(matches!(
            add_sentinel_unlock_response(&mut session, first),
            Err(MultiDeviceError::DuplicateSentinelUnlockParticipant { .. })
        ));

        let mut second = fixture.response(&request, 1)?;
        second.share_index = duplicate_index;
        second.signature = hex::encode(
            Fixture::signing_key(2)
                .sign(&response_signing_bytes(&second)?)
                .to_bytes(),
        );
        assert!(matches!(
            add_sentinel_unlock_response(&mut session, second),
            Err(MultiDeviceError::DuplicateSentinelUnlockParticipant { .. })
        ));
        Ok(())
    }

    #[test]
    fn tampered_request_response_and_wrong_session_are_rejected() -> anyhow::Result<()> {
        let fixture = Fixture::new()?;
        let mut first_session = fixture.session()?;
        let first_request = sentinel_unlock_request(&first_session);
        let mut tampered_request = first_request.clone();
        tampered_request.policy.threshold = 3.into();
        assert!(matches!(
            tampered_request.check(&signing_public_key(&fixture.requester_signing)),
            Err(MultiDeviceError::InvalidSentinelUnlockSignature)
        ));

        let response = fixture.response(&first_request, 0)?;
        let second_session = fixture.session()?;
        let mut wrong_session = second_session;
        assert!(matches!(
            add_sentinel_unlock_response(&mut wrong_session, response.clone()),
            Err(MultiDeviceError::InvalidSentinelUnlockSession)
        ));

        let mut tampered_response = response;
        tampered_response.share_index = 2.into();
        assert!(matches!(
            add_sentinel_unlock_response(&mut first_session, tampered_response),
            Err(MultiDeviceError::InvalidSentinelUnlockSignature)
        ));
        Ok(())
    }

    #[test]
    fn unenrolled_requester_receives_no_unlock_response() -> anyhow::Result<()> {
        let fixture = Fixture::new()?;
        let unknown_identity = DeviceIdentity::generate()?;
        let unknown_signing = Fixture::signing_key(91);
        let session = start_sentinel_unlock(
            fixture.store_id.clone(),
            fixture.policy,
            &fixture.records,
            &unknown_identity,
            &unknown_signing,
        )?;
        let request = sentinel_unlock_request(&session);

        assert!(matches!(
            request.check(&signing_public_key(&fixture.requester_signing)),
            Err(MultiDeviceError::InvalidSentinelUnlockPayload)
        ));
        Ok(())
    }
    #[test]
    fn checking_preserves_policy_then_signature_then_expected_key_precedence() -> anyhow::Result<()>
    {
        let fixture = Fixture::new()?;
        let request = sentinel_unlock_request(&fixture.session()?);
        let wrong_key = signing_public_key(&Fixture::signing_key(92));
        let mut invalid_policy = request.clone();
        invalid_policy.policy.threshold = 1.into();
        assert!(matches!(
            invalid_policy.check(&wrong_key),
            Err(MultiDeviceError::InvalidSentinelThreshold)
        ));
        let mut invalid_signature = request.clone();
        invalid_signature.signature = "00".to_owned();
        assert!(matches!(
            invalid_signature.check(&wrong_key),
            Err(MultiDeviceError::InvalidSentinelUnlockSignature)
        ));
        assert!(matches!(
            request.check(&wrong_key),
            Err(MultiDeviceError::InvalidSentinelUnlockPayload)
        ));
        Ok(())
    }

    #[test]
    fn checked_response_still_requires_the_participants_local_share() -> anyhow::Result<()> {
        let fixture = Fixture::new()?;
        let request = sentinel_unlock_request(&fixture.session()?);
        let checked = request.check(&signing_public_key(&fixture.requester_signing))?;
        let stranger = DeviceIdentity::generate()?;
        assert!(
            matches!(checked.respond(&fixture.records, &stranger, &Fixture::signing_key(93)),
            Err(MultiDeviceError::SentinelShareNotFound { device_id }) if device_id == stranger.device_id().as_str())
        );
        Ok(())
    }

    #[test]
    fn checked_response_rejects_a_signed_policy_that_does_not_match_the_share() -> anyhow::Result<()>
    {
        let fixture = Fixture::new()?;
        let session = start_sentinel_unlock(
            fixture.store_id.clone(),
            SentinelUnlockPolicy {
                threshold: 3.into(),
                required_participants: 3.into(),
            },
            &fixture.records,
            &fixture.requester,
            &fixture.requester_signing,
        )?;
        let checked = sentinel_unlock_request(&session)
            .check(&signing_public_key(&fixture.requester_signing))?;
        assert!(matches!(
            checked.respond(
                &fixture.records,
                &fixture.participants[0],
                &Fixture::signing_key(1)
            ),
            Err(MultiDeviceError::InvalidSentinelUnlockPayload)
        ));
        Ok(())
    }

    impl Fixture {
        fn signing_key(fill: u8) -> SigningKey {
            SigningKey::from_bytes(&[fill; 32])
        }

        fn new() -> anyhow::Result<Fixture> {
            let participants = (0..3)
                .map(|_| DeviceIdentity::generate())
                .collect::<Result<Vec<_>, _>>()?;
            let recipients = participants
                .iter()
                .map(|identity| (identity.device_id().clone(), identity.public_key()))
                .collect::<Vec<_>>();
            let (keys, records) =
                create_sentinel_root_share_records_for_recipients(&recipients, 2.into())?;
            let requester = participants[2].clone();
            Ok(Fixture {
                keys,
                records,
                participants,
                requester,
                requester_signing: Self::signing_key(90),
                store_id: StoreId::parse("store_AAAAAAAAAAA")?,
                policy: SentinelUnlockPolicy {
                    threshold: 2.into(),
                    required_participants: 3.into(),
                },
            })
        }

        fn session(&self) -> anyhow::Result<SentinelUnlockSession> {
            Ok(start_sentinel_unlock(
                self.store_id.clone(),
                self.policy,
                &self.records,
                &self.requester,
                &self.requester_signing,
            )?)
        }

        fn response(
            &self,
            request: &SentinelUnlockRequest,
            index: usize,
        ) -> anyhow::Result<SentinelUnlockResponse> {
            Ok(request
                .clone()
                .check(&signing_public_key(&self.requester_signing))?
                .respond(
                    &self.records,
                    &self.participants[index],
                    &Self::signing_key(u8::try_from(index + 1)?),
                )?)
        }
    }
}
