#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Provider-independent Sentinel pre-genesis ceremony.
//!
//! Session state contains public data only. Vault keys and shares are generated
//! together only after the complete `N`-participant roster has been verified.
//! Sentinel roots are split with the current extendable SLIP-0039 format.

use super::multi_device::{DeviceIdentity, VaultMetaRecord};
use crate::SentinelShareEnvelope;
mod links;
mod session;
pub use super::sentinel_genesis_types::*;
use crate::{
    CompactToken, DeviceId, DevicePublicKey, DeviceSigningPublicKey, MultiDeviceError,
    MultiDeviceResult, StoredSecretRecord,
};
use ed25519_dalek::{Signer, SigningKey};
pub use links::SentinelGenesisLinkInput;
pub use session::{
    ReadySentinelGenesis, SentinelGenesisReadiness, SentinelGenesisRejection,
    SentinelGenesisSession,
};
use sha2::{Digest, Sha256};

const GENESIS_VERSION: SentinelGenesisVersion = SentinelGenesisVersion::CURRENT;
const PUBLIC_KEY_ANNOUNCEMENT_KIND: &str = "publicKeyAnnouncement";

/// Identity, signing capability, and label for one participant response or announcement.
pub struct SentinelGenesisResponder<'a> {
    pub identity: &'a DeviceIdentity,
    pub signing_key: &'a SigningKey,
    pub label: String,
}
/// Request and recipient expected by the caller accepting one delivery.
pub struct SentinelGenesisDeliveryRecipient<'a> {
    pub expected_request: &'a SentinelGenesisRequest,
    pub identity: &'a DeviceIdentity,
}
/// A validated response request, retaining the exact request and signing key.
///
/// ```
/// use nook_auth2::{SentinelGenesisRequest, SentinelGenesisResponder, MultiDeviceError};
/// let respond = |request: &SentinelGenesisRequest, responder: SentinelGenesisResponder<'_>|
///     -> Result<_, MultiDeviceError> { request.prepare_response(responder)?.sign() };
/// ```
///
/// ```compile_fail,E0382
/// use nook_auth2::{CheckedSentinelGenesisResponse, MultiDeviceError};
/// let twice = |checked: CheckedSentinelGenesisResponse<'_>| -> Result<_, MultiDeviceError> {
///     checked.sign()?;
///     checked.sign()
/// };
/// ```
///
/// ```compile_fail,E0502
/// use nook_auth2::{SentinelGenesisRequest, SentinelGenesisResponder, MultiDeviceError};
/// let change = |request: &mut SentinelGenesisRequest, responder: SentinelGenesisResponder<'_>|
///     -> Result<_, MultiDeviceError> {
///     let checked = request.prepare_response(responder)?;
///     request.signature.clear();
///     checked.sign()
/// };
/// ```
///
/// ```compile_fail,E0451
/// use nook_auth2::{CheckedSentinelGenesisResponse, SentinelGenesisRequest, SentinelGenesisParticipant};
/// use ed25519_dalek::SigningKey;
/// let fabricate = |request: &SentinelGenesisRequest, signing_key: &SigningKey, participant: SentinelGenesisParticipant| {
///     let _ = CheckedSentinelGenesisResponse { request, signing_key, participant };
/// };
/// ```
pub struct CheckedSentinelGenesisResponse<'a> {
    request: &'a SentinelGenesisRequest,
    signing_key: &'a SigningKey,
    participant: SentinelGenesisParticipant,
}
/// Signature-checked delivery data. It does not establish persistence or replay protection.
///
/// ```
/// use nook_auth2::{SentinelGenesisShareDelivery, SentinelGenesisDeliveryRecipient, MultiDeviceError};
/// let accept = |delivery: &SentinelGenesisShareDelivery, recipient: &SentinelGenesisDeliveryRecipient<'_>|
///     -> Result<_, MultiDeviceError> { delivery.check(recipient)?.into_record() };
/// ```
///
/// ```compile_fail,E0382
/// use nook_auth2::{CheckedSentinelGenesisDelivery, MultiDeviceError};
/// let twice = |checked: CheckedSentinelGenesisDelivery<'_>| -> Result<_, MultiDeviceError> {
///     checked.into_record()?;
///     checked.into_record()
/// };
/// ```
///
/// ```compile_fail,E0502
/// use nook_auth2::{SentinelGenesisShareDelivery, SentinelGenesisDeliveryRecipient, MultiDeviceError};
/// let change = |delivery: &mut SentinelGenesisShareDelivery, recipient: &SentinelGenesisDeliveryRecipient<'_>|
///     -> Result<_, MultiDeviceError> {
///     let checked = delivery.check(recipient)?;
///     delivery.signature.clear();
///     checked.into_record()
/// };
/// ```
///
/// ```compile_fail,E0451
/// use nook_auth2::{CheckedSentinelGenesisDelivery, SentinelGenesisShareDelivery};
/// let fabricate = |delivery: &SentinelGenesisShareDelivery| {
///     let _ = CheckedSentinelGenesisDelivery { delivery };
/// };
/// ```
pub struct CheckedSentinelGenesisDelivery<'a> {
    delivery: &'a SentinelGenesisShareDelivery,
}
struct ParticipantKeys<'a> {
    encryption: &'a DevicePublicKey,
    signing: &'a DeviceSigningPublicKey,
}
struct GenesisSignature<'a> {
    public_key: &'a DeviceSigningPublicKey,
    signature: &'a str,
    bytes: &'a [u8],
}
struct ResponseSigningContext<'a> {
    version: SentinelGenesisVersion,
    session_id: &'a CompactToken,
}
struct AnnouncementSigningData<'a> {
    version: SentinelGenesisVersion,
    device_id: &'a DeviceId,
    encryption_public_key: &'a DevicePublicKey,
    signing_public_key: &'a DeviceSigningPublicKey,
    label: &'a str,
}
impl SentinelGenesisPublicKeyAnnouncement {
    pub fn create(responder: SentinelGenesisResponder<'_>) -> MultiDeviceResult<Self> {
        let SentinelGenesisResponder {
            identity,
            signing_key,
            label,
        } = responder;
        if label.chars().count() > 80 {
            return Err(MultiDeviceError::DeviceNameTooLong);
        }
        let encryption_public_key = identity.public_key();
        let signing_public_key = DeviceSigningPublicKey::from_signing_key(signing_key);
        let device_id = identity.device_id().clone();
        let fingerprint = ParticipantKeys {
            encryption: &encryption_public_key,
            signing: &signing_public_key,
        }
        .standalone();
        let bytes = AnnouncementSigningData {
            version: GENESIS_VERSION,
            device_id: &device_id,
            encryption_public_key: &encryption_public_key,
            signing_public_key: &signing_public_key,
            label: &label,
        }
        .bytes()?;
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
}
impl SentinelGenesisRequest {
    pub fn prepare_response<'a>(
        &'a self,
        responder: SentinelGenesisResponder<'a>,
    ) -> MultiDeviceResult<CheckedSentinelGenesisResponse<'a>> {
        let request = self;
        let SentinelGenesisResponder {
            identity,
            signing_key,
            label,
        } = responder;
        request.validate()?;
        if label.chars().count() > 80 {
            return Err(MultiDeviceError::DeviceNameTooLong);
        }
        let encryption_public_key = identity.public_key();
        let signing_public_key = DeviceSigningPublicKey::from_signing_key(signing_key);
        let participant = SentinelGenesisParticipant {
            device_id: identity.device_id().clone(),
            fingerprint: ParticipantKeys {
                encryption: &encryption_public_key,
                signing: &signing_public_key,
            }
            .in_session(&request.session_id),
            encryption_public_key,
            signing_public_key,
            label,
        };

        Ok(CheckedSentinelGenesisResponse {
            request,
            signing_key,
            participant,
        })
    }
}
impl CheckedSentinelGenesisResponse<'_> {
    pub fn sign(self) -> MultiDeviceResult<SentinelGenesisParticipantResponse> {
        let Self {
            request,
            signing_key,
            participant,
        } = self;
        let bytes = participant.response_signing_bytes(&ResponseSigningContext {
            version: GENESIS_VERSION,
            session_id: &request.session_id,
        })?;
        Ok(SentinelGenesisParticipantResponse {
            version: GENESIS_VERSION,
            session_id: request.session_id.clone(),
            participant,
            signature: hex::encode(signing_key.sign(&bytes).to_bytes()),
        })
    }
}
impl SentinelGenesisShareDelivery {
    pub fn check<'a>(
        &'a self,
        recipient: &SentinelGenesisDeliveryRecipient<'_>,
    ) -> MultiDeviceResult<CheckedSentinelGenesisDelivery<'a>> {
        let delivery = self;
        let SentinelGenesisDeliveryRecipient {
            expected_request,
            identity,
        } = recipient;
        delivery.policy.validate()?;
        if delivery.version != GENESIS_VERSION
            || delivery.session_id != expected_request.session_id
            || delivery.policy != expected_request.policy
            || delivery.initiator_signing_public_key
                != expected_request.initiator_signing_public_key
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
        GenesisSignature {
            public_key: &delivery.initiator_signing_public_key,
            signature: &delivery.signature,
            bytes: &delivery.signing_bytes()?,
        }
        .verify()?;

        Ok(CheckedSentinelGenesisDelivery { delivery })
    }
}
impl CheckedSentinelGenesisDelivery<'_> {
    pub fn into_record(self) -> MultiDeviceResult<StoredSecretRecord> {
        let delivery = self.delivery;
        VaultMetaRecord::SentinelShare(delivery.device_id.clone(), delivery.share.clone())
            .to_stored()
    }
}
impl SentinelGenesisRequest {
    fn validate(&self) -> MultiDeviceResult<()> {
        let request = self;
        request.policy.validate()?;
        if request.version != GENESIS_VERSION || request.initiator_signing_public_key.is_empty() {
            return Err(MultiDeviceError::InvalidSentinelGenesisSession);
        }
        GenesisSignature {
            public_key: &request.initiator_signing_public_key,
            signature: &request.signature,
            bytes: &request.signing_bytes()?,
        }
        .verify()
    }
}
impl SentinelGenesisRequest {
    fn signing_bytes(&self) -> MultiDeviceResult<Vec<u8>> {
        let request = self;
        serde_json::to_vec(&(
            request.version,
            &request.session_id,
            request.policy,
            &request.initiator_device_id,
            &request.initiator_signing_public_key,
        ))
        .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)
    }
}
impl SentinelGenesisParticipant {
    fn validate_for(&self, session_id: &CompactToken) -> MultiDeviceResult<()> {
        let participant = self;
        if participant.encryption_public_key.try_app_id()? != participant.device_id
            || participant.signing_public_key.is_empty()
            || participant.fingerprint
                != (ParticipantKeys {
                    encryption: &participant.encryption_public_key,
                    signing: &participant.signing_public_key,
                })
                .in_session(session_id)
        {
            return Err(MultiDeviceError::InvalidSentinelGenesisPayload);
        }
        Ok(())
    }
}
impl SentinelGenesisParticipantResponse {
    fn verify_signature(&self) -> MultiDeviceResult<()> {
        let response = self;
        GenesisSignature {
            public_key: &response.participant.signing_public_key,
            signature: &response.signature,
            bytes: &response
                .participant
                .response_signing_bytes(&ResponseSigningContext {
                    version: response.version,
                    session_id: &response.session_id,
                })?,
        }
        .verify()
    }
}
impl SentinelGenesisParticipant {
    fn response_signing_bytes(
        &self,
        context: &ResponseSigningContext<'_>,
    ) -> MultiDeviceResult<Vec<u8>> {
        let participant = self;
        let ResponseSigningContext {
            version,
            session_id,
        } = context;
        serde_json::to_vec(&(version, session_id, participant))
            .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)
    }
}
impl SentinelGenesisShareDelivery {
    fn signing_bytes(&self) -> MultiDeviceResult<Vec<u8>> {
        let delivery = self;
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
}
impl GenesisSignature<'_> {
    fn verify(self) -> MultiDeviceResult<()> {
        let Self {
            public_key,
            signature,
            bytes,
        } = self;
        public_key.verify_signature(signature, bytes, || {
            MultiDeviceError::InvalidSentinelGenesisSignature
        })
    }
}
impl ParticipantKeys<'_> {
    fn in_session(&self, session_id: &CompactToken) -> String {
        let Self {
            encryption,
            signing,
        } = *self;
        let mut digest = Sha256::new();
        digest.update(b"nook-sentinel-genesis-participant-v1\0");
        digest.update(session_id.as_str().as_bytes());
        digest.update(b"\0");
        digest.update(encryption.as_str().as_bytes());
        digest.update(b"\0");
        digest.update(signing.as_str().as_bytes());
        hex::encode(digest.finalize())
    }
}
impl ParticipantKeys<'_> {
    fn standalone(&self) -> String {
        let Self {
            encryption,
            signing,
        } = *self;
        let mut digest = Sha256::new();
        digest.update(b"nook-sentinel-genesis-public-key-v1\0");
        digest.update(encryption.as_str().as_bytes());
        digest.update(b"\0");
        digest.update(signing.as_str().as_bytes());
        hex::encode(digest.finalize())
    }
}
impl SentinelGenesisPublicKeyAnnouncement {
    fn validate(&self) -> MultiDeviceResult<()> {
        let announcement = self;
        if announcement.kind != PUBLIC_KEY_ANNOUNCEMENT_KIND
            || announcement.version != GENESIS_VERSION
            || announcement.signing_public_key.is_empty()
        {
            return Err(MultiDeviceError::InvalidSentinelGenesisPayload);
        }
        if announcement.encryption_public_key.try_app_id()? != announcement.device_id
            || announcement.fingerprint
                != (ParticipantKeys {
                    encryption: &announcement.encryption_public_key,
                    signing: &announcement.signing_public_key,
                })
                .standalone()
        {
            return Err(MultiDeviceError::InvalidSentinelGenesisPayload);
        }
        GenesisSignature {
            public_key: &announcement.signing_public_key,
            signature: &announcement.signature,
            bytes: &AnnouncementSigningData {
                version: announcement.version,
                device_id: &announcement.device_id,
                encryption_public_key: &announcement.encryption_public_key,
                signing_public_key: &announcement.signing_public_key,
                label: &announcement.label,
            }
            .bytes()?,
        }
        .verify()
    }
}
impl AnnouncementSigningData<'_> {
    fn bytes(self) -> MultiDeviceResult<Vec<u8>> {
        let Self {
            version,
            device_id,
            encryption_public_key,
            signing_public_key,
            label,
        } = self;
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
}
#[cfg(test)]
mod tests {
    use std::io::Error as IoError;
    use std::ptr;
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
            let response = request
                .prepare_response(SentinelGenesisResponder {
                    identity: &identity,
                    signing_key: &signing,
                    label: label.to_owned(),
                })
                .and_then(CheckedSentinelGenesisResponse::sign)?;
            Ok((identity, signing, response))
        }
    }

    #[test]
    fn checked_response_preserves_request_signer_and_validation_order() -> anyhow::Result<()> {
        let owner = DeviceIdentity::generate()?;
        let signing = Fixture::signing_key()?;
        let session =
            SentinelGenesisSession::start(&owner, &signing, 2.into(), 2.into(), "Owner".into())?;
        let peer = DeviceIdentity::generate()?;
        let peer_signing = Fixture::signing_key()?;
        let mut invalid = session.request().clone();
        invalid.signature.clear();
        match invalid.prepare_response(SentinelGenesisResponder {
            identity: &peer,
            signing_key: &peer_signing,
            label: "é".repeat(81),
        }) {
            Err(error) => assert!(matches!(
                error,
                MultiDeviceError::InvalidSentinelGenesisSignature
            )),
            Ok(_) => anyhow::bail!("invalid request reached signing state"),
        }
        match session
            .request()
            .prepare_response(SentinelGenesisResponder {
                identity: &peer,
                signing_key: &peer_signing,
                label: "é".repeat(81),
            }) {
            Err(error) => assert!(matches!(error, MultiDeviceError::DeviceNameTooLong)),
            Ok(_) => anyhow::bail!("oversized label reached signing state"),
        }
        let checked = session
            .request()
            .prepare_response(SentinelGenesisResponder {
                identity: &peer,
                signing_key: &peer_signing,
                label: "é".repeat(80),
            })?;
        assert!(ptr::eq(
            ptr::from_ref(checked.request),
            ptr::from_ref(session.request())
        ));
        assert!(ptr::eq(
            ptr::from_ref(checked.signing_key),
            ptr::from_ref(&peer_signing)
        ));
        let response = checked.sign()?;
        response.verify_signature()?;
        assert_eq!(response.session_id, session.request().session_id);
        assert_eq!(response.participant.label, "é".repeat(80));
        assert_eq!(response.participant.device_id, *peer.device_id());
        let checked = session
            .request()
            .prepare_response(SentinelGenesisResponder {
                identity: &peer,
                signing_key: &peer_signing,
                label: "Discard".into(),
            })?;
        drop(checked);
        assert_eq!(session.participants().len(), 1);
        Ok(())
    }

    #[test]
    fn checked_delivery_binds_original_and_preserves_recipient_before_signature_error()
    -> anyhow::Result<()> {
        let owner = DeviceIdentity::generate()?;
        let signing = Fixture::signing_key()?;
        let session =
            SentinelGenesisSession::start(&owner, &signing, 2.into(), 2.into(), "Owner".into())?;
        let request = session.request().clone();
        let (peer, _, response) = Fixture::participant(&request, "Peer")?;
        let issued = session
            .collect(response)?
            .prepare(&signing)?
            .issue(&StoreId::parse("store_AAAAAAAAAAA")?)?;
        let delivery = issued
            .deliveries
            .iter()
            .find(|delivery| delivery.device_id == *peer.device_id())
            .ok_or_else(|| IoError::other("peer delivery must exist"))?;
        let checked = delivery.check(&SentinelGenesisDeliveryRecipient {
            expected_request: &request,
            identity: &peer,
        })?;
        assert!(ptr::eq(
            ptr::from_ref(checked.delivery),
            ptr::from_ref(delivery)
        ));
        let record = checked.into_record()?;
        assert_eq!(
            record,
            VaultMetaRecord::SentinelShare(delivery.device_id.clone(), delivery.share.clone())
                .to_stored()?
        );
        let before = delivery.clone();
        {
            let _checked = delivery.check(&SentinelGenesisDeliveryRecipient {
                expected_request: &request,
                identity: &peer,
            })?;
        }
        assert_eq!(delivery, &before);
        let mut tampered = delivery.clone();
        tampered.signature.clear();
        match tampered.check(&SentinelGenesisDeliveryRecipient {
            expected_request: &request,
            identity: &owner,
        }) {
            Err(error) => assert!(matches!(
                error,
                MultiDeviceError::SentinelGenesisDeliveryRecipientMismatch
            )),
            Ok(_) => anyhow::bail!("wrong recipient reached record state"),
        }
        match tampered.check(&SentinelGenesisDeliveryRecipient {
            expected_request: &request,
            identity: &peer,
        }) {
            Err(error) => assert!(matches!(
                error,
                MultiDeviceError::InvalidSentinelGenesisSignature
            )),
            Ok(_) => anyhow::bail!("tampered delivery reached record state"),
        }
        Ok(())
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
            SentinelGenesisPublicKeyAnnouncement::create(SentinelGenesisResponder {
                identity: &peer,
                signing_key: &peer_signing,
                label: "Peer".into(),
            })?;
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
        let announcement_link = (SentinelGenesisLinkInput { input: &payload })
            .response_link("https://nook.example/app/");
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
        let accepted = peer_delivery
            .check(&SentinelGenesisDeliveryRecipient {
                expected_request: &expected_request,
                identity: &peer,
            })
            .and_then(CheckedSentinelGenesisDelivery::into_record)?;
        assert!(issued.records.contains(&accepted));
        assert!(matches!(
            peer_delivery
                .check(&SentinelGenesisDeliveryRecipient {
                    expected_request: &expected_request,
                    identity: &owner
                })
                .and_then(CheckedSentinelGenesisDelivery::into_record),
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
        let share_count = SentinelShareEnvelope::count_sentinel_share_records(&issued.records)?;
        assert_eq!(usize::from(share_count), 3);
        assert!(
            multi_device::SentinelKeyReconstruction::from_identities(
                &issued.records,
                slice::from_ref(&owner)
            )
            .reconstruct()
            .is_err()
        );
        let first_quorum = multi_device::SentinelKeyReconstruction::from_identities(
            &issued.records,
            &[owner, peer_a],
        )
        .reconstruct()?;
        assert_eq!(first_quorum.secrets_key.as_str().len(), 64);
        assert!(
            multi_device::SentinelKeyReconstruction::from_identities(&issued.records, &[peer_b])
                .reconstruct()
                .is_err()
        );
        Ok(())
    }
}
