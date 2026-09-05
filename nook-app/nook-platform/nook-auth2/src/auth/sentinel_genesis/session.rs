//! One-use collection and issuance authority for a Sentinel genesis roster.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super as genesis;
use super::super::multi_device;
use super::{
    GENESIS_VERSION, PUBLIC_KEY_ANNOUNCEMENT_KIND, SentinelGenesisIssued,
    SentinelGenesisParticipant, SentinelGenesisParticipantResponse, SentinelGenesisPolicy,
    SentinelGenesisRequest, SentinelGenesisShareDelivery,
};
use crate::{
    DeviceIdentity, MultiDeviceError, MultiDeviceResult, SentinelParticipantCount,
    SentinelThreshold, StoreId,
};
use ed25519_dalek::{Signer, SigningKey};
use multi_device::{VaultMember, VaultMetaRecord};
use serde_json::Value;

/// Public observations never construct a verified roster.
///
/// ```
/// use nook_auth2::{SentinelGenesisSession, SentinelGenesisParticipantResponse, StoreId};
/// use ed25519_dalek::SigningKey;
/// let issue = |session: SentinelGenesisSession, response: SentinelGenesisParticipantResponse,
///     signer: &SigningKey, store: &StoreId| -> anyhow::Result<_> {
///     Ok(session.collect(response)?.prepare(signer)?.issue(store)?)
/// };
/// ```
///
/// Collecting sessions cannot issue shares directly.
/// ```compile_fail,E0599
/// use nook_auth2::{SentinelGenesisSession, StoreId};
/// let issue = |session: SentinelGenesisSession, store: &StoreId| session.issue(store);
/// ```
///
/// Collection consumes the old roster.
/// ```compile_fail,E0382
/// use nook_auth2::{SentinelGenesisSession, SentinelGenesisParticipantResponse};
/// let collect = |session: SentinelGenesisSession, response: SentinelGenesisParticipantResponse| {
///     let next = session.collect(response);
///     session.request();
/// };
/// ```
///
/// Preparation consumes its source.
/// ```compile_fail,E0382
/// use nook_auth2::SentinelGenesisSession;
/// use ed25519_dalek::SigningKey;
/// let prepare = |session: SentinelGenesisSession, signer: &SigningKey| {
///     let ready = session.prepare(signer);
///     session.request();
/// };
/// ```
///
/// Public request data cannot construct a collecting capability.
/// ```compile_fail,E0451
/// use nook_auth2::{SentinelGenesisSession, SentinelGenesisRequest};
/// let forge = |request: SentinelGenesisRequest| {
///     let _ = SentinelGenesisSession { request, participants: Vec::new() };
/// };
/// ```
///
/// ```compile_fail,E0594
/// use nook_auth2::SentinelGenesisSession;
/// let amend = |session: SentinelGenesisSession| {
///     session.request().signature = String::new();
/// };
/// ```
///
/// ```compile_fail,E0599
/// use nook_auth2::SentinelGenesisSession;
/// let duplicate = |session: SentinelGenesisSession| session.clone();
/// ```
///
/// ```compile_fail,E0277
/// use nook_auth2::SentinelGenesisSession;
/// let decode = |json: &str| serde_json::from_str::<SentinelGenesisSession>(json);
/// ```
#[derive(Debug)]
pub struct SentinelGenesisSession {
    request: SentinelGenesisRequest,
    participants: Vec<SentinelGenesisParticipant>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SentinelGenesisReadiness {
    Collecting,
    Complete,
}

#[derive(Debug, thiserror::Error)]
#[error("{error}")]
pub struct SentinelGenesisRejection {
    session: Box<SentinelGenesisSession>,
    error: MultiDeviceError,
}
impl SentinelGenesisRejection {
    #[must_use]
    pub fn into_parts(self) -> (SentinelGenesisSession, MultiDeviceError) {
        (*self.session, self.error)
    }
}

/// All configured participants have been admitted and the issuer is bound.
/// The signer is borrowed until issuance; no alternative signer is accepted.
///
/// Issuance consumes the prepared signer-bound capability.
/// ```compile_fail,E0382
/// use nook_auth2::{ReadySentinelGenesis, StoreId};
/// let issue = |ready: ReadySentinelGenesis<'_>, store: &StoreId| {
///     let first = ready.issue(store);
///     ready.issue(store);
/// };
/// ```
///
/// ```compile_fail,E0451
/// use nook_auth2::{SentinelGenesisSession, ReadySentinelGenesis};
/// use ed25519_dalek::SigningKey;
/// let forge = |session: SentinelGenesisSession, signing_key: &SigningKey| {
///     let _ = ReadySentinelGenesis { session, signing_key };
/// };
/// ```
///
/// ```compile_fail,E0061
/// use nook_auth2::{ReadySentinelGenesis, StoreId};
/// use ed25519_dalek::SigningKey;
/// let substitute = |ready: ReadySentinelGenesis<'_>, store: &StoreId, signer: &SigningKey| {
///     ready.issue(store, signer);
/// };
/// ```
///
/// ```compile_fail,E0599
/// use nook_auth2::ReadySentinelGenesis;
/// let duplicate = |ready: ReadySentinelGenesis<'_>| ready.clone();
/// ```
///
/// ```compile_fail,E0277
/// use nook_auth2::ReadySentinelGenesis;
/// let decode = |json: &str| serde_json::from_str::<ReadySentinelGenesis<'_>>(json);
/// ```
pub struct ReadySentinelGenesis<'signing> {
    session: SentinelGenesisSession,
    signing_key: &'signing SigningKey,
}

impl SentinelGenesisSession {
    pub fn start(
        identity: &DeviceIdentity,
        signing_key: &SigningKey,
        participant_count: SentinelParticipantCount,
        threshold: SentinelThreshold,
        label: String,
    ) -> MultiDeviceResult<Self> {
        let policy = SentinelGenesisPolicy {
            participant_count,
            threshold,
        };
        policy.validate()?;
        let session_id = multi_device::generate_id()?;
        let signing_public_key = genesis::signing_public_key(signing_key);
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
                .sign(&genesis::request_signing_bytes(&request)?)
                .to_bytes(),
        );
        let response =
            genesis::respond_to_sentinel_genesis_request(&request, identity, signing_key, label)?;
        let session = Self {
            request,
            participants: Vec::new(),
        };
        session
            .collect(response)
            .map_err(|rejected| rejected.into_parts().1)
    }
    #[must_use]
    pub fn request(&self) -> &SentinelGenesisRequest {
        &self.request
    }
    #[must_use]
    pub fn participants(&self) -> &[SentinelGenesisParticipant] {
        &self.participants
    }
    #[must_use]
    pub fn readiness(&self) -> SentinelGenesisReadiness {
        if self.participants.len() == usize::from(u8::from(self.request.policy.participant_count)) {
            SentinelGenesisReadiness::Complete
        } else {
            SentinelGenesisReadiness::Collecting
        }
    }
    fn reject(self, error: MultiDeviceError) -> SentinelGenesisRejection {
        SentinelGenesisRejection {
            session: Box::new(self),
            error,
        }
    }
    fn validate_response(
        &self,
        response: &SentinelGenesisParticipantResponse,
    ) -> MultiDeviceResult<()> {
        genesis::validate_request(&self.request)?;
        if response.version != GENESIS_VERSION || response.session_id != self.request.session_id {
            return Err(MultiDeviceError::InvalidSentinelGenesisSession);
        }
        genesis::validate_participant(&response.participant, &response.session_id)?;
        genesis::verify_response(response)?;
        if self.participants.iter().any(|existing| {
            existing.device_id == response.participant.device_id
                || existing.encryption_public_key == response.participant.encryption_public_key
                || existing.signing_public_key == response.participant.signing_public_key
        }) {
            return Err(MultiDeviceError::DuplicateSentinelGenesisParticipant {
                device_id: response.participant.device_id.to_string(),
            });
        }
        if self.participants.len() >= usize::from(u8::from(self.request.policy.participant_count)) {
            return Err(MultiDeviceError::SentinelGenesisRosterFull);
        }
        Ok(())
    }
    pub fn collect(
        mut self,
        response: SentinelGenesisParticipantResponse,
    ) -> Result<Self, SentinelGenesisRejection> {
        if let Err(error) = self.validate_response(&response) {
            return Err(self.reject(error));
        }
        self.participants.push(response.participant);
        Ok(self)
    }
    fn response_from_payload(
        payload: &str,
    ) -> MultiDeviceResult<SentinelGenesisParticipantResponse> {
        let value: Value = serde_json::from_str(payload)
            .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
        if value.get("kind").and_then(Value::as_str) == Some(PUBLIC_KEY_ANNOUNCEMENT_KIND) {
            return Err(MultiDeviceError::StandaloneSentinelGenesisAnnouncementRejected);
        }
        serde_json::from_str(payload).map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)
    }
    /// Verify signed keys before applying the owner's optional display label.
    pub fn collect_payload(
        self,
        payload: &str,
        label: &str,
    ) -> Result<Self, SentinelGenesisRejection> {
        let label = label.trim();
        if label.chars().count() > 80 {
            return Err(self.reject(MultiDeviceError::DeviceNameTooLong));
        }
        let response = match Self::response_from_payload(payload) {
            Ok(value) => value,
            Err(error) => return Err(self.reject(error)),
        };
        let index = self.participants.len();
        let mut next = self.collect(response)?;
        if !label.is_empty() {
            label.clone_into(&mut next.participants[index].label);
        }
        Ok(next)
    }
    fn validate_issuance(&self, signing_key: &SigningKey) -> MultiDeviceResult<()> {
        if self.readiness() != SentinelGenesisReadiness::Complete {
            return Err(MultiDeviceError::SentinelGenesisIncomplete {
                required: self.request.policy.participant_count,
                available: SentinelParticipantCount::try_from(self.participants.len())
                    .map_err(|_| MultiDeviceError::SentinelParticipantCountOverflow)?,
            });
        }
        if genesis::signing_public_key(signing_key) != self.request.initiator_signing_public_key
            || !self.participants.iter().any(|participant| {
                participant.device_id == self.request.initiator_device_id
                    && participant.signing_public_key == self.request.initiator_signing_public_key
            })
        {
            return Err(MultiDeviceError::InvalidSentinelGenesisSignature);
        }
        genesis::validate_request(&self.request)
    }
    pub fn prepare(
        self,
        signing_key: &SigningKey,
    ) -> Result<ReadySentinelGenesis<'_>, SentinelGenesisRejection> {
        if let Err(error) = self.validate_issuance(signing_key) {
            return Err(self.reject(error));
        }
        Ok(ReadySentinelGenesis {
            session: self,
            signing_key,
        })
    }
}
impl ReadySentinelGenesis<'_> {
    pub fn issue(self, store_id: &StoreId) -> MultiDeviceResult<SentinelGenesisIssued> {
        let Self {
            session,
            signing_key: initiator_signing_key,
        } = self;
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
        let (keys, share_records) =
            multi_device::create_sentinel_root_share_records_for_recipients(
                &recipients,
                session.request.policy.threshold,
            )?;
        // Construction is all-or-nothing: only publish the result after every
        // record has parsed and every delivery has been signed.
        let mut deliveries = Vec::with_capacity(share_records.len());
        for (participant, record) in session.participants.iter().zip(&share_records) {
            let VaultMetaRecord::SentinelShare(device_id, share) =
                VaultMetaRecord::classify(record)
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
                    .sign(&genesis::delivery_signing_bytes(&delivery)?)
                    .to_bytes(),
            );
            deliveries.push(delivery);
        }
        let roster = session
            .participants
            .iter()
            .map(|participant| {
                Ok(VaultMember {
                    auth_id: multi_device::dec_auth_id_from_public_key(
                        &participant.encryption_public_key,
                    )?,
                    device_id: participant.device_id.clone(),
                    public_key: participant.encryption_public_key.clone(),
                    enrolled_at: String::new(),
                    label: (!participant.label.is_empty()).then(|| participant.label.clone()),
                })
            })
            .collect::<MultiDeviceResult<Vec<_>>>()?;
        let mut records = multi_device::build_members_records(&roster, &keys.members_key)?;
        records.extend(share_records);
        Ok(SentinelGenesisIssued {
            records,
            participants: session.participants,
            deliveries,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture;
    impl Fixture {
        fn start(signer: &SigningKey) -> anyhow::Result<SentinelGenesisSession> {
            let identity = DeviceIdentity::generate()?;
            Ok(SentinelGenesisSession::start(
                &identity,
                signer,
                2.into(),
                2.into(),
                "Owner".to_owned(),
            )?)
        }
        fn response(
            session: &SentinelGenesisSession,
        ) -> anyhow::Result<SentinelGenesisParticipantResponse> {
            let identity = DeviceIdentity::generate()?;
            Ok(genesis::respond_to_sentinel_genesis_request(
                session.request(),
                &identity,
                &SigningKey::from_bytes(&[3; 32]),
                "Peer".to_owned(),
            )?)
        }
    }
    #[test]
    fn preparation_preserves_error_precedence_and_rejected_roster() -> anyhow::Result<()> {
        let signer = SigningKey::from_bytes(&[1; 32]);
        let wrong = SigningKey::from_bytes(&[2; 32]);
        let session = Fixture::start(&signer)?;
        let request = session.request().clone();
        let rejected = session
            .prepare(&wrong)
            .err()
            .ok_or_else(|| anyhow::anyhow!("incomplete roster admitted"))?;
        let (session, error) = rejected.into_parts();
        assert!(matches!(
            error,
            MultiDeviceError::SentinelGenesisIncomplete { .. }
        ));
        assert_eq!(session.request(), &request);
        let response = Fixture::response(&session)?;
        let session = session.collect(response)?;
        let rejected = session
            .prepare(&wrong)
            .err()
            .ok_or_else(|| anyhow::anyhow!("wrong signer admitted"))?;
        let (session, error) = rejected.into_parts();
        assert!(matches!(
            error,
            MultiDeviceError::InvalidSentinelGenesisSignature
        ));
        assert_eq!(session.participants().len(), 2);
        let ready = session.prepare(&signer)?;
        let issued = ready.issue(&StoreId::parse("store_AAAAAAAAAAA")?)?;
        assert_eq!(issued.deliveries.len(), 2);
        Ok(())
    }
    #[test]
    fn invalid_payload_labels_and_full_rosters_retain_the_unique_owner() -> anyhow::Result<()> {
        let signer = SigningKey::from_bytes(&[1; 32]);
        let mut session = Fixture::start(&signer)?;
        for (payload, label) in [
            ("invalid-json", "".to_owned()),
            ("invalid-json", "x".repeat(81)),
        ] {
            let rejected = session
                .collect_payload(payload, &label)
                .err()
                .ok_or_else(|| anyhow::anyhow!("invalid payload admitted"))?;
            let (retained, error) = rejected.into_parts();
            if label.is_empty() {
                assert!(matches!(
                    error,
                    MultiDeviceError::InvalidSentinelGenesisPayload
                ));
            } else {
                assert!(matches!(error, MultiDeviceError::DeviceNameTooLong));
            }
            assert_eq!(retained.participants().len(), 1);
            session = retained;
        }
        let payload = serde_json::to_string(&Fixture::response(&session)?)?;
        let session = session.collect_payload(&payload, " ")?;
        assert_eq!(session.participants()[1].label, "Peer");
        // Distinct signing key too: capacity rejection must follow uniqueness checks.
        let identity = DeviceIdentity::generate()?;
        let extra = genesis::respond_to_sentinel_genesis_request(
            session.request(),
            &identity,
            &SigningKey::from_bytes(&[4; 32]),
            "Extra".to_owned(),
        )?;
        let (session, error) = session
            .collect(extra)
            .err()
            .ok_or_else(|| anyhow::anyhow!("full roster admitted participant"))?
            .into_parts();
        assert!(matches!(error, MultiDeviceError::SentinelGenesisRosterFull));
        assert_eq!(session.participants().len(), 2);
        Ok(())
    }
    #[test]
    fn oversized_internal_roster_is_rejected_without_reconstruction() -> anyhow::Result<()> {
        let signer = SigningKey::from_bytes(&[1; 32]);
        let mut session = Fixture::start(&signer)?;
        session.participants = vec![session.participants[0].clone(); usize::from(u8::MAX) + 1];
        let (session, error) = session
            .prepare(&signer)
            .err()
            .ok_or_else(|| anyhow::anyhow!("oversized roster admitted"))?
            .into_parts();
        assert!(matches!(
            error,
            MultiDeviceError::SentinelParticipantCountOverflow
        ));
        assert_eq!(session.participants().len(), usize::from(u8::MAX) + 1);
        Ok(())
    }
}
