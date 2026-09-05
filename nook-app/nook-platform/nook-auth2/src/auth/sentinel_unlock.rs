//! Session-bound, provider-independent Sentinel quorum unlock.
//!
//! Opened SLIP-0039 mnemonics exist only inside Rust while a participant
//! creates a response and while the requester finalizes a quorum. The public
//! protocol types expose only signed metadata and age-encrypted ciphertext.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

mod response;

pub use response::CheckedSentinelUnlockRequest;

use super::multi_device::{
    DeviceIdentity, OpenedSentinelShare, VaultKeys, device_id_from_public_key, generate_id,
    reconstruct_sentinel_vault_keys_from_opened,
};
use crate::{
    AgeArmoredCiphertext, CompactToken, DeviceId, DevicePublicKey, DeviceSigningPublicKey,
    MultiDeviceError, MultiDeviceResult, StoreId, StoredSecretRecord,
};
use crate::{SentinelParticipantCount, SentinelShareCount, SentinelShareIndex, SentinelThreshold};
use ed25519_dalek::{Signer, SigningKey};
use serde::{Deserialize, Deserializer, Serialize, de};
use std::collections::BTreeSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct SentinelUnlockVersion(u32);

impl SentinelUnlockVersion {
    pub const CURRENT: Self = Self(1);

    fn parse(value: u32) -> Result<Self, &'static str> {
        match value {
            1 => Ok(Self::CURRENT),
            _ => Err("unsupported Sentinel unlock version"),
        }
    }
}

impl From<SentinelUnlockVersion> for u32 {
    fn from(value: SentinelUnlockVersion) -> Self {
        value.0
    }
}

impl<'de> Deserialize<'de> for SentinelUnlockVersion {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::parse(u32::deserialize(deserializer)?).map_err(de::Error::custom)
    }
}

const UNLOCK_VERSION: SentinelUnlockVersion = SentinelUnlockVersion::CURRENT;

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
    pub version: SentinelUnlockVersion,
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
    pub version: SentinelUnlockVersion,
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
    pub readiness: SentinelUnlockReadiness,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SentinelUnlockReadiness {
    Collecting,
    Ready,
}

/// Public session state contains only encrypted vault rows and opaque signed
/// responses. It deliberately stores neither a requester private key nor an
/// opened mnemonic contribution.
/// Collection and quorum admission return ownership on rejection:
///
/// ```
/// use nook_auth2::{SentinelUnlockSession, SentinelUnlockResponse, DeviceIdentity,
///     MultiDeviceResult, VaultKeys};
/// let complete = |session: SentinelUnlockSession, response: SentinelUnlockResponse,
///     identity: &DeviceIdentity| -> MultiDeviceResult<VaultKeys> {
///     let session = session.collect(response).map_err(|rejected| rejected.into_parts().1)?;
///     session.into_quorum(identity).map_err(|rejected| rejected.into_parts().1)?.finalize()
/// };
/// ```
///
/// Collecting sessions cannot finalize or duplicate themselves.
///
/// ```compile_fail,E0599
/// use nook_auth2::SentinelUnlockSession;
/// let premature = |session: SentinelUnlockSession| session.finalize();
/// ```
///
/// ```compile_fail,E0599
/// use nook_auth2::SentinelUnlockSession;
/// let duplicate = |session: SentinelUnlockSession| session.clone();
/// ```
///
/// ```compile_fail,E0277
/// use nook_auth2::SentinelUnlockSession;
/// let decode = |json: &str| serde_json::from_str::<SentinelUnlockSession>(json);
/// ```
///
/// ```compile_fail,E0382
/// use nook_auth2::{SentinelUnlockSession, SentinelUnlockResponse};
/// let reuse = |session: SentinelUnlockSession, response: SentinelUnlockResponse| {
///     let successor = session.collect(response);
///     session.request()
/// };
/// ```
pub struct SentinelUnlockSession {
    request: SentinelUnlockRequest,
    records: Vec<StoredSecretRecord>,
    responses: Vec<SentinelUnlockResponse>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SentinelUnlockContribution {
    version: SentinelUnlockVersion,
    session_id: CompactToken,
    store_id: StoreId,
    policy: SentinelUnlockPolicy,
    participant_device_id: DeviceId,
    participant_signing_public_key: DeviceSigningPublicKey,
    opened_share: OpenedSentinelShare,
}

/// Rejected collection or quorum admission retains the sole collecting session.
pub struct SentinelUnlockRejection {
    session: Box<SentinelUnlockSession>,
    error: MultiDeviceError,
}

impl SentinelUnlockRejection {
    #[must_use]
    pub fn into_parts(self) -> (SentinelUnlockSession, MultiDeviceError) {
        (*self.session, self.error)
    }
}

/// A quorum bound to the requester identity checked during admission.
/// Fields are private; callers cannot substitute the borrowed identity.
/// Finalization consumes the quorum and uses its originally borrowed identity.
///
/// ```
/// use nook_auth2::SentinelUnlockQuorum;
/// let finalize = |quorum: SentinelUnlockQuorum<'_>| quorum.finalize();
/// ```
///
/// ```compile_fail,E0382
/// use nook_auth2::{SentinelUnlockQuorum, MultiDeviceResult, VaultKeys};
/// let repeat = |quorum: SentinelUnlockQuorum<'_>| -> MultiDeviceResult<VaultKeys> {
///     quorum.finalize()?;
///     quorum.finalize()
/// };
/// ```
///
/// ```compile_fail,E0599
/// use nook_auth2::SentinelUnlockQuorum;
/// let duplicate = |quorum: SentinelUnlockQuorum<'_>| quorum.clone();
/// ```
///
/// ```compile_fail,E0277
/// use nook_auth2::SentinelUnlockQuorum;
/// let decode = |json: &str| serde_json::from_str::<SentinelUnlockQuorum<'_>>(json);
/// ```
///
/// ```compile_fail,E0451
/// use nook_auth2::{SentinelUnlockQuorum, SentinelUnlockSession, DeviceIdentity};
/// struct Probe;
/// impl Probe {
///     fn forge<'a>(session: SentinelUnlockSession, requester_identity: &'a DeviceIdentity)
///         -> SentinelUnlockQuorum<'a> {
///         SentinelUnlockQuorum { session, requester_identity }
///     }
/// }
/// ```
///
/// ```compile_fail,E0061
/// use nook_auth2::{SentinelUnlockQuorum, DeviceIdentity};
/// let substitute = |quorum: SentinelUnlockQuorum<'_>, identity: &DeviceIdentity| {
///     quorum.finalize(identity)
/// };
/// ```
pub struct SentinelUnlockQuorum<'a> {
    session: SentinelUnlockSession,
    requester_identity: &'a DeviceIdentity,
}

impl SentinelUnlockSession {
    pub fn start(
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
            requester_signing_public_key: DeviceSigningPublicKey::from_signing_key(
                requester_signing_key,
            ),
            signature: String::new(),
        };
        request.signature = hex::encode(
            requester_signing_key
                .sign(&request.signing_bytes()?)
                .to_bytes(),
        );
        request.validate()?;
        Ok(SentinelUnlockSession {
            request,
            records: records.to_vec(),
            responses: Vec::new(),
        })
    }
    #[must_use]
    pub fn request(&self) -> SentinelUnlockRequest {
        self.request.clone()
    }

    /// Validate an opaque contribution before retaining it; do not open shares.
    pub fn collect(
        mut self,
        response: SentinelUnlockResponse,
    ) -> Result<Self, SentinelUnlockRejection> {
        if let Err(error) = self.validate_response(&response) {
            return Err(SentinelUnlockRejection {
                session: Box::new(self),
                error,
            });
        }
        self.responses.push(response);
        Ok(self)
    }

    fn validate_response(&self, response: &SentinelUnlockResponse) -> MultiDeviceResult<()> {
        self.request.validate()?;
        response.validate_binding(&self.request)?;
        response.verify_signature()?;
        if self.responses.iter().any(|existing| {
            existing.participant_device_id == response.participant_device_id
                || existing.participant_signing_public_key
                    == response.participant_signing_public_key
                || existing.share_index == response.share_index
        }) {
            return Err(MultiDeviceError::DuplicateSentinelUnlockParticipant {
                device_id: response.participant_device_id.to_string(),
            });
        }
        Ok(())
    }

    pub fn into_quorum(
        self,
        requester_identity: &DeviceIdentity,
    ) -> Result<SentinelUnlockQuorum<'_>, SentinelUnlockRejection> {
        if let Err(error) = self.validate_quorum_identity(requester_identity) {
            return Err(SentinelUnlockRejection {
                session: Box::new(self),
                error,
            });
        }
        Ok(SentinelUnlockQuorum {
            session: self,
            requester_identity,
        })
    }

    fn validate_quorum_identity(
        &self,
        requester_identity: &DeviceIdentity,
    ) -> MultiDeviceResult<()> {
        self.request.validate()?;
        if requester_identity.device_id() != &self.request.requester_device_id
            || requester_identity.public_key() != self.request.requester_encryption_public_key
        {
            return Err(MultiDeviceError::SentinelUnlockRecipientMismatch);
        }
        if self.responses.len() < usize::from(u8::from(self.request.policy.threshold)) {
            return Err(MultiDeviceError::NotEnoughSentinelShares {
                threshold: self.request.policy.threshold,
                available: self.responses.len().into(),
            });
        }
        Ok(())
    }
    #[must_use]
    pub fn status(&self) -> SentinelUnlockStatus {
        let collected = self.responses.len().into();
        SentinelUnlockStatus {
            collected,
            threshold: self.request.policy.threshold,
            readiness: if self.responses.len()
                >= usize::from(u8::from(self.request.policy.threshold))
            {
                SentinelUnlockReadiness::Ready
            } else {
                SentinelUnlockReadiness::Collecting
            },
        }
    }
}

impl SentinelUnlockQuorum<'_> {
    pub fn check_context(
        &self,
        store_id: &StoreId,
        policy: SentinelUnlockPolicy,
    ) -> MultiDeviceResult<()> {
        if &self.session.request.store_id != store_id || self.session.request.policy != policy {
            return Err(MultiDeviceError::InvalidSentinelUnlockSession);
        }
        Ok(())
    }

    pub fn finalize(self) -> MultiDeviceResult<VaultKeys> {
        self.session
            .validate_quorum_identity(self.requester_identity)?;
        let Self {
            session,
            requester_identity,
        } = self;
        let SentinelUnlockSession {
            request,
            records,
            responses,
        } = session;
        let mut opened = Vec::with_capacity(responses.len());
        let mut device_ids = BTreeSet::new();
        let mut share_indices = BTreeSet::new();
        for response in &responses {
            response.validate_binding(&request)?;
            response.verify_signature()?;
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
}

impl SentinelUnlockRequest {
    fn validate(&self) -> MultiDeviceResult<()> {
        self.policy.validate()?;
        if self.version != UNLOCK_VERSION
            || self.requester_signing_public_key.is_empty()
            || device_id_from_public_key(&self.requester_encryption_public_key)?
                != self.requester_device_id
        {
            return Err(MultiDeviceError::InvalidSentinelUnlockSession);
        }
        self.requester_signing_public_key.verify_signature(
            &self.signature,
            &self.signing_bytes()?,
            || MultiDeviceError::InvalidSentinelUnlockSignature,
        )
    }
    fn signing_bytes(&self) -> MultiDeviceResult<Vec<u8>> {
        serde_json::to_vec(&(
            self.version,
            &self.session_id,
            &self.store_id,
            self.policy,
            &self.requester_device_id,
            &self.requester_encryption_public_key,
            &self.requester_signing_public_key,
        ))
        .map_err(|_| MultiDeviceError::InvalidSentinelUnlockPayload)
    }
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
    fn sentinel_unlock_version_validates_serde_input() -> anyhow::Result<()> {
        assert_eq!(
            serde_json::from_str::<SentinelUnlockVersion>("1")?,
            SentinelUnlockVersion::CURRENT
        );
        assert!(serde_json::from_str::<SentinelUnlockVersion>("2").is_err());
        assert!(serde_json::from_str::<SentinelUnlockVersion>("4294967296").is_err());
        Ok(())
    }
    #[test]
    fn signed_two_of_three_responses_unlock_without_exposing_mnemonics() -> anyhow::Result<()> {
        let fixture = Fixture::new()?;
        let mut session = fixture.session()?;
        let request = session.request();
        let first = fixture.response(&request, 0)?;
        let second = fixture.response(&request, 1)?;
        let local_plaintext =
            open_sentinel_share_for_identity(&fixture.records, &fixture.participants[0])?;
        assert!(!serde_json::to_string(&first)?.contains(&local_plaintext.share));
        session = Fixture::collect(session, first)?;
        assert_eq!(
            session.status(),
            SentinelUnlockStatus {
                collected: 1.into(),
                threshold: 2.into(),
                readiness: SentinelUnlockReadiness::Collecting,
            }
        );
        session = Fixture::collect(session, second)?;
        assert_eq!(session.status().readiness, SentinelUnlockReadiness::Ready);
        assert_eq!(
            session
                .into_quorum(&fixture.requester)
                .map_err(|rejected| rejected.into_parts().1)?
                .finalize()?,
            fixture.keys
        );
        Ok(())
    }

    #[test]
    fn below_quorum_and_wrong_requester_are_rejected() -> anyhow::Result<()> {
        let fixture = Fixture::new()?;
        let session = fixture.session()?;
        let request = session.request();
        let session = Fixture::collect(session, fixture.response(&request, 0)?)?;
        let before = session.status();
        let rejected = session
            .into_quorum(&fixture.requester)
            .err()
            .ok_or_else(|| anyhow::anyhow!("incomplete quorum must reject"))?;
        let (session, error) = rejected.into_parts();
        assert!(matches!(
            error,
            MultiDeviceError::NotEnoughSentinelShares { .. }
        ));
        assert_eq!(session.status(), before);
        let wrong = DeviceIdentity::generate()?;
        let rejected = session
            .into_quorum(&wrong)
            .err()
            .ok_or_else(|| anyhow::anyhow!("wrong requester must reject"))?;
        let (session, error) = rejected.into_parts();
        assert!(matches!(
            error,
            MultiDeviceError::SentinelUnlockRecipientMismatch
        ));
        assert_eq!(session.status(), before);
        let session = Fixture::collect(session, fixture.response(&request, 1)?)?;
        assert_eq!(
            session
                .into_quorum(&fixture.requester)
                .map_err(|rejected| rejected.into_parts().1)?
                .finalize()?,
            fixture.keys
        );
        Ok(())
    }

    #[test]
    fn duplicate_device_and_share_index_are_rejected() -> anyhow::Result<()> {
        let fixture = Fixture::new()?;
        let mut session = fixture.session()?;
        let request = session.request();
        let first = fixture.response(&request, 0)?;
        let duplicate_index = first.share_index;
        session = Fixture::collect(session, first.clone())?;
        let before = session.status();
        let (retained, error) = Fixture::rejected_collection(session, first)?;
        session = retained;
        assert!(matches!(
            error,
            MultiDeviceError::DuplicateSentinelUnlockParticipant { .. }
        ));
        assert_eq!(session.status(), before);

        let mut second = fixture.response(&request, 1)?;
        second.share_index = duplicate_index;
        second.signature = hex::encode(
            Fixture::signing_key(2)
                .sign(&second.signing_bytes()?)
                .to_bytes(),
        );
        let (session, error) = Fixture::rejected_collection(session, second)?;
        assert!(matches!(
            error,
            MultiDeviceError::DuplicateSentinelUnlockParticipant { .. }
        ));
        assert_eq!(session.status(), before);
        Ok(())
    }

    #[test]
    fn duplicate_signing_key_retains_the_collecting_session() -> anyhow::Result<()> {
        let fixture = Fixture::new()?;
        let session = fixture.session()?;
        let request = session.request();
        let session = Fixture::collect(session, fixture.response(&request, 0)?)?;
        let response = request
            .check(&DeviceSigningPublicKey::from_signing_key(
                &fixture.requester_signing,
            ))?
            .respond(
                &fixture.records,
                &fixture.participants[1],
                &Fixture::signing_key(1),
            )?;
        let before = session.status();
        let (session, error) = Fixture::rejected_collection(session, response)?;
        assert!(matches!(
            error,
            MultiDeviceError::DuplicateSentinelUnlockParticipant { .. }
        ));
        assert_eq!(session.status(), before);
        Ok(())
    }

    #[test]
    fn tampered_request_response_and_wrong_session_are_rejected() -> anyhow::Result<()> {
        let fixture = Fixture::new()?;
        let first_session = fixture.session()?;
        let first_request = first_session.request();
        let mut tampered_request = first_request.clone();
        tampered_request.policy.threshold = 3.into();
        assert!(matches!(
            tampered_request.check(&DeviceSigningPublicKey::from_signing_key(
                &fixture.requester_signing
            )),
            Err(MultiDeviceError::InvalidSentinelUnlockSignature)
        ));

        let response = fixture.response(&first_request, 0)?;
        let second_session = fixture.session()?;
        let wrong_session = second_session;
        let (wrong_session, error) = Fixture::rejected_collection(wrong_session, response.clone())?;
        assert!(matches!(
            error,
            MultiDeviceError::InvalidSentinelUnlockSession
        ));
        assert_eq!(usize::from(wrong_session.status().collected), 0);

        let mut tampered_response = response;
        tampered_response.share_index = 2.into();
        let (first_session, error) =
            Fixture::rejected_collection(first_session, tampered_response)?;
        assert!(matches!(
            error,
            MultiDeviceError::InvalidSentinelUnlockSignature
        ));
        assert_eq!(usize::from(first_session.status().collected), 0);
        Ok(())
    }

    #[test]
    fn unenrolled_requester_receives_no_unlock_response() -> anyhow::Result<()> {
        let fixture = Fixture::new()?;
        let unknown_identity = DeviceIdentity::generate()?;
        let unknown_signing = Fixture::signing_key(91);
        let session = SentinelUnlockSession::start(
            fixture.store_id.clone(),
            fixture.policy,
            &fixture.records,
            &unknown_identity,
            &unknown_signing,
        )?;
        let request = session.request();

        assert!(matches!(
            request.check(&DeviceSigningPublicKey::from_signing_key(
                &fixture.requester_signing
            )),
            Err(MultiDeviceError::InvalidSentinelUnlockPayload)
        ));
        Ok(())
    }
    #[test]
    fn checking_preserves_policy_then_signature_then_expected_key_precedence() -> anyhow::Result<()>
    {
        let fixture = Fixture::new()?;
        let request = fixture.session()?.request();
        let wrong_key = DeviceSigningPublicKey::from_signing_key(&Fixture::signing_key(92));
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
        let request = fixture.session()?.request();
        let checked = request.check(&DeviceSigningPublicKey::from_signing_key(
            &fixture.requester_signing,
        ))?;
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
        let session = SentinelUnlockSession::start(
            fixture.store_id.clone(),
            SentinelUnlockPolicy {
                threshold: 3.into(),
                required_participants: 3.into(),
            },
            &fixture.records,
            &fixture.requester,
            &fixture.requester_signing,
        )?;
        let checked = session
            .request()
            .check(&DeviceSigningPublicKey::from_signing_key(
                &fixture.requester_signing,
            ))?;
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

    #[test]
    fn every_alternative_quorum_reconstructs_and_context_is_bound() -> anyhow::Result<()> {
        let fixture = Fixture::new()?;
        for pair in [[0, 1], [0, 2], [1, 2]] {
            let mut session = fixture.session()?;
            let request = session.request();
            for index in pair {
                session = Fixture::collect(session, fixture.response(&request, index)?)?;
            }
            let quorum = session
                .into_quorum(&fixture.requester)
                .map_err(|rejected| rejected.into_parts().1)?;
            quorum.check_context(&fixture.store_id, fixture.policy)?;
            assert!(matches!(
                quorum.check_context(&StoreId::parse("store_BBBBBBBBBBB")?, fixture.policy),
                Err(MultiDeviceError::InvalidSentinelUnlockSession)
            ));
            assert!(
                quorum
                    .check_context(
                        &fixture.store_id,
                        SentinelUnlockPolicy {
                            threshold: 3.into(),
                            ..fixture.policy
                        }
                    )
                    .is_err()
            );
            assert_eq!(quorum.finalize()?, fixture.keys);
        }
        Ok(())
    }

    #[test]
    fn signed_but_invalid_ciphertext_fails_only_at_terminal_finalization() -> anyhow::Result<()> {
        let fixture = Fixture::new()?;
        let mut session = fixture.session()?;
        let request = session.request();
        let mut response = fixture.response(&request, 0)?;
        response.ciphertext = AgeArmoredCiphertext::from_trusted("invalid".to_owned());
        response.signature = hex::encode(
            Fixture::signing_key(1)
                .sign(&response.signing_bytes()?)
                .to_bytes(),
        );
        session = Fixture::collect(session, response)?;
        session = Fixture::collect(session, fixture.response(&request, 1)?)?;
        let quorum = session
            .into_quorum(&fixture.requester)
            .map_err(|rejected| rejected.into_parts().1)?;
        assert!(quorum.finalize().is_err());
        Ok(())
    }

    impl Fixture {
        fn collect(
            session: SentinelUnlockSession,
            response: SentinelUnlockResponse,
        ) -> anyhow::Result<SentinelUnlockSession> {
            session
                .collect(response)
                .map_err(|rejected| rejected.into_parts().1.into())
        }

        fn rejected_collection(
            session: SentinelUnlockSession,
            response: SentinelUnlockResponse,
        ) -> anyhow::Result<(SentinelUnlockSession, MultiDeviceError)> {
            session
                .collect(response)
                .err()
                .map(SentinelUnlockRejection::into_parts)
                .ok_or_else(|| anyhow::anyhow!("invalid contribution must reject"))
        }

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
            Ok(SentinelUnlockSession::start(
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
                .check(&DeviceSigningPublicKey::from_signing_key(
                    &self.requester_signing,
                ))?
                .respond(
                    &self.records,
                    &self.participants[index],
                    &Self::signing_key(u8::try_from(index + 1)?),
                )?)
        }
    }
}
