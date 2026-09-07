//! Encrypted transfer of an unlocked extension device identity.
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use std::mem;

use crate::{
    AgeArmoredCiphertext, DeviceId, DeviceIdentity, DeviceIdentitySecret, DevicePublicKey,
    DeviceSigningPublicKey, ExtensionIdentityHandoffError, SigningIdentity, VaultResult,
    encrypt_for_recipient,
};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, Zeroizing};

const HANDOFF_VERSION: u8 = 1;
const MAX_NONCE_LEN: usize = 128;

#[derive(Serialize, Deserialize)]
struct ExtensionIdentityHandoffPayload {
    version: u8,
    nonce: String,
    device_id: DeviceId,
    device_public_key: DevicePublicKey,
    device_signing_public_key: DeviceSigningPublicKey,
    identity_private_key: DeviceIdentitySecret,
    signing_seed: SensitiveSigningSeed,
}

#[derive(Serialize, Deserialize)]
#[serde(transparent)]
struct SensitiveSigningSeed(String);

impl Drop for SensitiveSigningSeed {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

pub struct ExtensionIdentityHandoffMaterial {
    identity: DeviceIdentity,
    signing_seed: SensitiveSigningSeed,
}

impl ExtensionIdentityHandoffMaterial {
    #[must_use]
    pub fn into_parts(mut self) -> (DeviceIdentity, String) {
        let signing_seed = mem::take(&mut self.signing_seed.0);
        (self.identity, signing_seed)
    }
}

/// Which event-signing seed to keep after adopting an extension age identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HandoffSigningSeedChoice {
    /// Keep the durable local signer; the handoff seed is not yet authorized.
    KeepStored { seed: String },
    /// Adopt the handoff signer (empty-log create, or no local signer yet).
    AdoptHandoff { seed: String, persist: bool },
}

/// Whether the selected vault already contains events.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HandoffEventLog {
    Empty,
    ExistingEvents,
}

/// Seed candidates owned until the existing signer-selection policy completes.
pub struct HandoffSigningSeedSelection {
    pub handoff_seed: String,
    pub stored_seed: Option<String>,
    pub event_log: HandoffEventLog,
}

impl Zeroize for HandoffSigningSeedSelection {
    fn zeroize(&mut self) {
        self.handoff_seed.zeroize();
        self.stored_seed.zeroize();
    }
}

impl Drop for HandoffSigningSeedSelection {
    fn drop(&mut self) {
        self.zeroize();
    }
}

impl HandoffSigningSeedSelection {
    #[must_use]
    pub fn choose(mut self) -> HandoffSigningSeedChoice {
        if self.event_log == HandoffEventLog::ExistingEvents
            && let Some(seed) = self.stored_seed.as_mut().filter(|value| !value.is_empty())
        {
            self.handoff_seed.zeroize();
            return HandoffSigningSeedChoice::KeepStored {
                seed: mem::take(seed),
            };
        }
        HandoffSigningSeedChoice::AdoptHandoff {
            seed: mem::take(&mut self.handoff_seed),
            persist: true,
        }
    }
}

struct HandoffNonce<'a>(&'a str);

impl HandoffNonce<'_> {
    fn validate(&self) -> Result<(), ExtensionIdentityHandoffError> {
        let nonce = self.0;
        if nonce.is_empty() || nonce.len() > MAX_NONCE_LEN || nonce.chars().any(char::is_whitespace)
        {
            return Err(ExtensionIdentityHandoffError::InvalidNonce);
        }
        Ok(())
    }
}

/// Source material and exact destination for an extension handoff.
pub struct ExtensionIdentityHandoffSeal<'a> {
    pub identity: &'a DeviceIdentity,
    pub signing_seed: &'a str,
    pub recipient_public_key: &'a DevicePublicKey,
    pub nonce: &'a str,
}

impl<'a> ExtensionIdentityHandoffSeal<'a> {
    pub fn seal(self) -> VaultResult<AgeArmoredCiphertext> {
        self.check()?.seal()
    }

    fn check(self) -> VaultResult<CheckedExtensionIdentitySeal<'a>> {
        HandoffNonce(self.nonce).validate()?;
        let signing = SigningIdentity::from_seed_hex_stored(self.signing_seed)?;
        Ok(CheckedExtensionIdentitySeal {
            source: self,
            signing,
        })
    }
}

/// Checked state is private and carries the original borrowed source/destination.
/// ```compile_fail,E0603
/// use nook_core::auth::extension_identity_handoff::CheckedExtensionIdentitySeal;
/// ```
struct CheckedExtensionIdentitySeal<'a> {
    source: ExtensionIdentityHandoffSeal<'a>,
    signing: SigningIdentity,
}

impl CheckedExtensionIdentitySeal<'_> {
    fn seal(self) -> VaultResult<AgeArmoredCiphertext> {
        let ExtensionIdentityHandoffSeal {
            identity,
            signing_seed,
            recipient_public_key,
            nonce,
        } = self.source;
        let signing = self.signing;
        let payload = ExtensionIdentityHandoffPayload {
            version: HANDOFF_VERSION,
            nonce: nonce.to_owned(),
            device_id: identity.device_id().clone(),
            device_public_key: identity.public_key(),
            device_signing_public_key: signing.public_key(),
            identity_private_key: identity.secret_string(),
            signing_seed: SensitiveSigningSeed(signing_seed.to_owned()),
        };
        let plaintext = Zeroizing::new(
            serde_json::to_string(&payload).map_err(ExtensionIdentityHandoffError::Serialize)?,
        );
        Ok(encrypt_for_recipient(
            plaintext.as_bytes(),
            recipient_public_key,
        )?)
    }
}

/// Recipient capability and exact expected handoff bindings.
pub struct ExtensionIdentityHandoffOpen<'a> {
    pub recipient_identity: &'a DeviceIdentity,
    pub envelope: &'a AgeArmoredCiphertext,
    pub expected_nonce: &'a str,
    pub expected_device_id: &'a DeviceId,
    pub expected_device_public_key: &'a DevicePublicKey,
    pub expected_device_signing_public_key: &'a DeviceSigningPublicKey,
}

impl ExtensionIdentityHandoffOpen<'_> {
    pub fn open(self) -> VaultResult<ExtensionIdentityHandoffMaterial> {
        Ok(self.check()?.into_material())
    }

    fn check(self) -> VaultResult<CheckedExtensionIdentityOpen> {
        let Self {
            recipient_identity,
            envelope,
            expected_nonce,
            expected_device_id,
            expected_device_public_key,
            expected_device_signing_public_key,
        } = self;
        HandoffNonce(expected_nonce).validate()?;
        let plaintext = Zeroizing::new(recipient_identity.open_utf8(envelope)?);
        let payload: ExtensionIdentityHandoffPayload =
            serde_json::from_str(&plaintext).map_err(ExtensionIdentityHandoffError::Deserialize)?;
        let identity = DeviceIdentity::from_secret_str(&payload.identity_private_key)?;
        let signing = SigningIdentity::from_seed_hex_stored(&payload.signing_seed.0)?;

        if payload.version != HANDOFF_VERSION
            || payload.nonce != expected_nonce
            || payload.device_id != *expected_device_id
            || payload.device_public_key != *expected_device_public_key
            || payload.device_signing_public_key != *expected_device_signing_public_key
            || identity.device_id() != expected_device_id
            || identity.public_key() != *expected_device_public_key
            || signing.public_key() != *expected_device_signing_public_key
        {
            return Err(ExtensionIdentityHandoffError::BindingMismatch.into());
        }

        Ok(CheckedExtensionIdentityOpen {
            identity,
            signing_seed: payload.signing_seed,
        })
    }
}

/// Only successful binding checks can construct this private material-release state.
/// ```compile_fail,E0603
/// use nook_core::auth::extension_identity_handoff::CheckedExtensionIdentityOpen;
/// ```
struct CheckedExtensionIdentityOpen {
    identity: DeviceIdentity,
    signing_seed: SensitiveSigningSeed,
}

impl CheckedExtensionIdentityOpen {
    fn into_material(self) -> ExtensionIdentityHandoffMaterial {
        ExtensionIdentityHandoffMaterial {
            identity: self.identity,
            signing_seed: self.signing_seed,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CheckedExtensionIdentityOpen, CheckedExtensionIdentitySeal,
        ExtensionIdentityHandoffMaterial, ExtensionIdentityHandoffOpen,
        ExtensionIdentityHandoffPayload, ExtensionIdentityHandoffSeal, HandoffEventLog,
        HandoffNonce, HandoffSigningSeedChoice, HandoffSigningSeedSelection, SensitiveSigningSeed,
    };
    use crate::{
        AgeArmoredCiphertext, DeviceIdentity, DeviceIdentitySecret, DevicePublicKey,
        DeviceSigningPublicKey, ExtensionIdentityHandoffError, SigningIdentity, SigningSeedHex,
        VaultError, VaultResult, encrypt_for_recipient,
    };
    use std::ptr;
    use zeroize::{Zeroize, Zeroizing};

    struct HandoffFixture {
        identity: DeviceIdentity,
        signing_seed: SigningSeedHex,
        recipient: DeviceIdentity,
        identity_key: DevicePublicKey,
        signing_key: DeviceSigningPublicKey,
        recipient_key: DevicePublicKey,
        envelope: AgeArmoredCiphertext,
    }

    impl HandoffFixture {
        const NONCE: &'static str = "nonce-123";

        fn new() -> VaultResult<Self> {
            let identity = DeviceIdentity::generate()?;
            let (_, signing_seed) = SigningIdentity::generate()?;
            let signing = SigningIdentity::from_seed_hex_stored(signing_seed.as_str())?;
            let recipient = DeviceIdentity::generate()?;
            let identity_key = identity.public_key();
            let signing_key = signing.public_key();
            let recipient_key = recipient.public_key();
            let envelope = ExtensionIdentityHandoffSeal {
                identity: &identity,
                signing_seed: signing_seed.as_str(),
                recipient_public_key: &recipient_key,
                nonce: Self::NONCE,
            }
            .seal()?;
            Ok(Self {
                identity,
                signing_seed,
                recipient,
                identity_key,
                signing_key,
                recipient_key,
                envelope,
            })
        }

        fn seal_request(&self) -> ExtensionIdentityHandoffSeal<'_> {
            ExtensionIdentityHandoffSeal {
                identity: &self.identity,
                signing_seed: self.signing_seed.as_str(),
                recipient_public_key: &self.recipient_key,
                nonce: Self::NONCE,
            }
        }

        fn open_request<'a>(
            &'a self,
            envelope: &'a AgeArmoredCiphertext,
        ) -> ExtensionIdentityHandoffOpen<'a> {
            ExtensionIdentityHandoffOpen {
                recipient_identity: &self.recipient,
                envelope,
                expected_nonce: Self::NONCE,
                expected_device_id: self.identity.device_id(),
                expected_device_public_key: &self.identity_key,
                expected_device_signing_public_key: &self.signing_key,
            }
        }

        fn payload(&self) -> VaultResult<ExtensionIdentityHandoffPayload> {
            let plaintext = Zeroizing::new(self.recipient.open_utf8(&self.envelope)?);
            serde_json::from_str(&plaintext)
                .map_err(|error| ExtensionIdentityHandoffError::Deserialize(error).into())
        }

        fn encrypt_payload(
            &self,
            payload: &ExtensionIdentityHandoffPayload,
        ) -> VaultResult<AgeArmoredCiphertext> {
            let plaintext = Zeroizing::new(
                serde_json::to_string(payload).map_err(ExtensionIdentityHandoffError::Serialize)?,
            );
            self.encrypt_text(&plaintext)
        }

        fn encrypt_text(&self, plaintext: &str) -> VaultResult<AgeArmoredCiphertext> {
            Ok(encrypt_for_recipient(
                plaintext.as_bytes(),
                &self.recipient_key,
            )?)
        }
    }

    #[test]
    fn handoff_roundtrips_and_preserves_both_device_keys() -> VaultResult<()> {
        let fixture = HandoffFixture::new()?;
        let opened = fixture.open_request(&fixture.envelope).open()?;
        let (opened_identity, opened_signing_seed) = opened.into_parts();
        let opened_signing_seed = Zeroizing::new(opened_signing_seed);
        assert_eq!(opened_identity.device_id(), fixture.identity.device_id());
        assert_eq!(opened_identity.public_key(), fixture.identity_key);
        assert_eq!(
            SigningIdentity::from_seed_hex_stored(&opened_signing_seed)?.public_key(),
            fixture.signing_key
        );
        Ok(())
    }

    #[test]
    fn keeps_stored_signer_when_event_log_already_has_events() {
        assert_eq!(
            HandoffSigningSeedSelection {
                handoff_seed: "handoff-seed".to_owned(),
                stored_seed: Some("authorized-seed".to_owned()),
                event_log: HandoffEventLog::ExistingEvents,
            }
            .choose(),
            HandoffSigningSeedChoice::KeepStored {
                seed: "authorized-seed".to_owned()
            }
        );
    }

    #[test]
    fn adopts_handoff_signer_for_empty_log_or_missing_local_seed() {
        for event_log in [HandoffEventLog::Empty, HandoffEventLog::ExistingEvents] {
            assert_eq!(
                HandoffSigningSeedSelection {
                    handoff_seed: "handoff-seed".to_owned(),
                    stored_seed: None,
                    event_log
                }
                .choose(),
                HandoffSigningSeedChoice::AdoptHandoff {
                    seed: "handoff-seed".to_owned(),
                    persist: true
                }
            );
        }
    }

    #[test]
    fn handoff_rejects_nonce_or_public_key_mismatch() -> VaultResult<()> {
        let fixture = HandoffFixture::new()?;
        let mut request = fixture.open_request(&fixture.envelope);
        request.expected_nonce = "other-nonce";
        assert!(matches!(
            request.open(),
            Err(VaultError::ExtensionIdentityHandoff(
                ExtensionIdentityHandoffError::BindingMismatch
            ))
        ));
        let other_identity = DeviceIdentity::generate()?;
        let other_key = other_identity.public_key();
        let mut request = fixture.open_request(&fixture.envelope);
        request.expected_device_public_key = &other_key;
        assert!(matches!(
            request.open(),
            Err(VaultError::ExtensionIdentityHandoff(
                ExtensionIdentityHandoffError::BindingMismatch
            ))
        ));
        Ok(())
    }

    #[test]
    fn nonce_checks_byte_limit_and_unicode_whitespace_without_normalization() -> VaultResult<()> {
        for nonce in [
            String::new(),
            "x".repeat(129),
            "a b".to_owned(),
            "a\u{2003}b".to_owned(),
            "\nnonce".to_owned(),
        ] {
            assert!(matches!(
                HandoffNonce(&nonce).validate(),
                Err(ExtensionIdentityHandoffError::InvalidNonce)
            ));
        }
        for nonce in ["x".repeat(128), "é".repeat(64), "nonce-123".to_owned()] {
            HandoffNonce(&nonce).validate()?;
        }
        assert!(matches!(
            HandoffNonce(&"é".repeat(65)).validate(),
            Err(ExtensionIdentityHandoffError::InvalidNonce)
        ));
        Ok(())
    }

    #[test]
    fn seal_nonce_failure_precedes_signing_seed_failure() -> VaultResult<()> {
        let fixture = HandoffFixture::new()?;
        let mut request = fixture.seal_request();
        request.nonce = "";
        request.signing_seed = "invalid";
        assert!(matches!(
            request.check(),
            Err(VaultError::ExtensionIdentityHandoff(
                ExtensionIdentityHandoffError::InvalidNonce
            ))
        ));
        let mut request = fixture.seal_request();
        request.signing_seed = "invalid";
        assert!(matches!(request.check(), Err(VaultError::Event(_))));
        Ok(())
    }

    #[test]
    fn expected_nonce_failure_precedes_wrong_recipient_decryption() -> VaultResult<()> {
        let fixture = HandoffFixture::new()?;
        let wrong_recipient = DeviceIdentity::generate()?;
        let mut request = fixture.open_request(&fixture.envelope);
        request.expected_nonce = "";
        request.recipient_identity = &wrong_recipient;
        assert!(matches!(
            request.open(),
            Err(VaultError::ExtensionIdentityHandoff(
                ExtensionIdentityHandoffError::InvalidNonce
            ))
        ));
        let mut request = fixture.open_request(&fixture.envelope);
        request.recipient_identity = &wrong_recipient;
        assert!(request.open().is_err());
        Ok(())
    }

    #[test]
    fn malformed_json_and_private_key_do_not_reach_binding_comparison() -> VaultResult<()> {
        let fixture = HandoffFixture::new()?;
        let malformed = fixture.encrypt_text("{")?;
        assert!(matches!(
            fixture.open_request(&malformed).open(),
            Err(VaultError::ExtensionIdentityHandoff(
                ExtensionIdentityHandoffError::Deserialize(_)
            ))
        ));
        let mut payload = fixture.payload()?;
        payload.version = 2;
        payload.identity_private_key =
            DeviceIdentitySecret::from_trusted("invalid-private-key".to_owned());
        let malformed = fixture.encrypt_payload(&payload)?;
        assert!(matches!(
            fixture.open_request(&malformed).open(),
            Err(VaultError::ExtensionIdentityHandoff(
                ExtensionIdentityHandoffError::Deserialize(_)
            ))
        ));
        Ok(())
    }

    #[test]
    fn signing_seed_reconstruction_precedes_version_rejection() -> VaultResult<()> {
        let fixture = HandoffFixture::new()?;
        let mut payload = fixture.payload()?;
        payload.version = 2;
        payload.signing_seed = SensitiveSigningSeed("invalid-signing-seed".to_owned());
        let envelope = fixture.encrypt_payload(&payload)?;
        assert!(matches!(
            fixture.open_request(&envelope).open(),
            Err(VaultError::Event(_))
        ));
        Ok(())
    }

    #[derive(Clone, Copy)]
    enum BindingChange {
        Version,
        Nonce,
        ReportedDevice,
        ReportedEncryptionKey,
        ReportedSigningKey,
        PrivateIdentity,
        SigningSeed,
    }

    impl BindingChange {
        fn apply(self, payload: &mut ExtensionIdentityHandoffPayload) -> VaultResult<()> {
            match self {
                Self::Version => payload.version = 2,
                Self::Nonce => payload.nonce = "different".to_owned(),
                Self::ReportedDevice => {
                    payload.device_id = DeviceIdentity::generate()?.device_id().clone();
                }
                Self::ReportedEncryptionKey => {
                    payload.device_public_key = DeviceIdentity::generate()?.public_key();
                }
                Self::ReportedSigningKey => {
                    payload.device_signing_public_key = SigningIdentity::generate()?.0.public_key();
                }
                Self::PrivateIdentity => {
                    payload.identity_private_key = DeviceIdentity::generate()?.secret_string();
                }
                Self::SigningSeed => {
                    payload.signing_seed =
                        SensitiveSigningSeed(SigningIdentity::generate()?.1.as_str().to_owned());
                }
            }
            Ok(())
        }
    }

    #[test]
    fn every_payload_binding_mismatch_is_rejected_after_valid_key_reconstruction() -> VaultResult<()>
    {
        let fixture = HandoffFixture::new()?;
        for change in [
            BindingChange::Version,
            BindingChange::Nonce,
            BindingChange::ReportedDevice,
            BindingChange::ReportedEncryptionKey,
            BindingChange::ReportedSigningKey,
            BindingChange::PrivateIdentity,
            BindingChange::SigningSeed,
        ] {
            let mut payload = fixture.payload()?;
            change.apply(&mut payload)?;
            let envelope = fixture.encrypt_payload(&payload)?;
            assert!(matches!(
                fixture.open_request(&envelope).open(),
                Err(VaultError::ExtensionIdentityHandoff(
                    ExtensionIdentityHandoffError::BindingMismatch
                ))
            ));
        }
        Ok(())
    }

    #[test]
    fn expected_device_and_signing_key_are_bound_to_the_open_request() -> VaultResult<()> {
        let fixture = HandoffFixture::new()?;
        let other = DeviceIdentity::generate()?;
        let mut request = fixture.open_request(&fixture.envelope);
        request.expected_device_id = other.device_id();
        assert!(matches!(
            request.open(),
            Err(VaultError::ExtensionIdentityHandoff(
                ExtensionIdentityHandoffError::BindingMismatch
            ))
        ));
        let key = SigningIdentity::generate()?.0.public_key();
        let mut request = fixture.open_request(&fixture.envelope);
        request.expected_device_signing_public_key = &key;
        assert!(matches!(
            request.open(),
            Err(VaultError::ExtensionIdentityHandoff(
                ExtensionIdentityHandoffError::BindingMismatch
            ))
        ));
        Ok(())
    }

    #[test]
    fn checked_seal_consumes_the_exact_borrowed_source_and_destination() -> VaultResult<()> {
        let fixture = HandoffFixture::new()?;
        let checked = fixture.seal_request().check()?;
        assert!(ptr::eq(
            checked.source.identity,
            &raw const fixture.identity
        ));
        assert!(ptr::eq(
            checked.source.recipient_public_key,
            &raw const fixture.recipient_key
        ));
        assert_eq!(checked.signing.public_key(), fixture.signing_key);
        let seal: fn(_) -> VaultResult<AgeArmoredCiphertext> = CheckedExtensionIdentitySeal::seal;
        let envelope = seal(checked)?;
        let opened = fixture.open_request(&envelope).check()?;
        let release: fn(CheckedExtensionIdentityOpen) -> ExtensionIdentityHandoffMaterial =
            CheckedExtensionIdentityOpen::into_material;
        let (identity, seed) = release(opened).into_parts();
        let seed = Zeroizing::new(seed);
        assert_eq!(identity.device_id(), fixture.identity.device_id());
        assert_eq!(seed.as_str(), fixture.signing_seed.as_str());
        Ok(())
    }

    #[test]
    fn abandoned_checked_states_leave_borrowed_keys_and_envelope_unchanged() -> VaultResult<()> {
        let fixture = HandoffFixture::new()?;
        let original_seed = Zeroizing::new(fixture.signing_seed.as_str().to_owned());
        let original_envelope = fixture.envelope.clone();
        {
            let checked = fixture.seal_request().check()?;
            assert_eq!(checked.source.signing_seed, original_seed.as_str());
        }
        {
            let checked = fixture.open_request(&fixture.envelope).check()?;
            assert_eq!(checked.identity.device_id(), fixture.identity.device_id());
        }
        assert_eq!(fixture.signing_seed.as_str(), original_seed.as_str());
        assert_eq!(fixture.envelope, original_envelope);
        Ok(())
    }

    #[test]
    fn signer_selection_keeps_whitespace_but_not_empty_stored_seed() {
        for event_log in [HandoffEventLog::Empty, HandoffEventLog::ExistingEvents] {
            let selected = HandoffSigningSeedSelection {
                handoff_seed: "incoming".to_owned(),
                stored_seed: Some(String::new()),
                event_log,
            }
            .choose();
            assert_eq!(
                selected,
                HandoffSigningSeedChoice::AdoptHandoff {
                    seed: "incoming".to_owned(),
                    persist: true
                }
            );
        }
        assert_eq!(
            HandoffSigningSeedSelection {
                handoff_seed: "incoming".to_owned(),
                stored_seed: Some(" \t ".to_owned()),
                event_log: HandoffEventLog::ExistingEvents
            }
            .choose(),
            HandoffSigningSeedChoice::KeepStored {
                seed: " \t ".to_owned()
            }
        );
        assert_eq!(
            HandoffSigningSeedSelection {
                handoff_seed: "incoming".to_owned(),
                stored_seed: Some("stored".to_owned()),
                event_log: HandoffEventLog::Empty
            }
            .choose(),
            HandoffSigningSeedChoice::AdoptHandoff {
                seed: "incoming".to_owned(),
                persist: true
            }
        );
    }

    #[test]
    fn seed_selection_cleanup_wipes_both_owned_candidates() {
        let mut request = HandoffSigningSeedSelection {
            handoff_seed: "incoming".to_owned(),
            stored_seed: Some("stored".to_owned()),
            event_log: HandoffEventLog::ExistingEvents,
        };
        request.zeroize();
        assert!(request.handoff_seed.is_empty());
        assert!(request.stored_seed.as_ref().is_none_or(String::is_empty));
    }
}
