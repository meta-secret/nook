#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Canonical fields and their vault key stay bound until digest completion.
use super::metadata::{FingerprintText, ImportMetadataPolicy, ProviderNotes};
use crate::{PasskeyCredentialKey, SecretValue, SymmetricKey};
use hmac::{Hmac, KeyInit, Mac};
use nook_auth2::{ValidationError, ValidationResult};
use nook_event_log::SecretFingerprint;
use sha2::Sha256;
const IDENTITY_DOMAIN: &[u8] = b"nook/secret-identity/v1\0";
const VERSION_DOMAIN: &[u8] = b"nook/secret-version/v1\0";
const IDENTITY_FINGERPRINT_SCHEME: &str = "hmac-sha256:v1:";
const SECRET_VERSION_FINGERPRINT_SCHEME: &str = "hmac-sha256:v2:";

pub(super) enum FingerprintKind {
    Identity,
    Version,
}
impl FingerprintKind {
    fn domain(&self) -> &'static [u8] {
        match self {
            Self::Identity => IDENTITY_DOMAIN,
            Self::Version => VERSION_DOMAIN,
        }
    }
    fn scheme(&self) -> &'static str {
        match self {
            Self::Identity => IDENTITY_FINGERPRINT_SCHEME,
            Self::Version => SECRET_VERSION_FINGERPRINT_SCHEME,
        }
    }
}
pub(super) struct FingerprintRequest<'a> {
    pub(super) value: &'a SecretValue,
    pub(super) secrets_key: &'a SymmetricKey,
}
impl<'a> FingerprintRequest<'a> {
    pub(super) fn prepare(self, kind: FingerprintKind) -> CanonicalSecretFingerprint<'a> {
        let canonical = match kind {
            FingerprintKind::Identity => CanonicalSecretBytes::identity(self.value),
            FingerprintKind::Version => CanonicalSecretBytes::version(self.value),
        };
        CanonicalSecretFingerprint {
            canonical,
            kind,
            secrets_key: self.secrets_key,
        }
    }
}
pub(super) struct CanonicalSecretFingerprint<'a> {
    canonical: CanonicalSecretBytes,
    kind: FingerprintKind,
    secrets_key: &'a SymmetricKey,
}
impl CanonicalSecretFingerprint<'_> {
    pub(super) fn finish(self) -> ValidationResult<SecretFingerprint> {
        let mut mac = Hmac::<Sha256>::new_from_slice(self.secrets_key.as_str().as_bytes())
            .map_err(|_| ValidationError::SecretFingerprintKeyInvalid)?;
        mac.update(self.kind.domain());
        mac.update(&self.canonical.0);
        let scheme = self.kind.scheme();
        Ok(SecretFingerprint::from_trusted(format!(
            "{scheme}{}",
            hex::encode(mac.finalize().into_bytes())
        )))
    }
}
struct CanonicalSecretBytes(Vec<u8>);
impl CanonicalSecretBytes {
    fn append(&mut self, value: &str) {
        self.0.extend_from_slice(value.len().to_string().as_bytes());
        self.0.push(b':');
        self.0.extend_from_slice(value.as_bytes());
        self.0.push(0);
    }
    fn identity(value: &SecretValue) -> Self {
        let mut bytes = Self(Vec::new());
        match value {
            SecretValue::Login(login) => {
                bytes.append("login");
                bytes.append(
                    FingerprintText::new(&login.website_url)
                        .normalized()
                        .as_str(),
                );
                bytes.append(FingerprintText::new(&login.username).normalized().as_str());
            }
            SecretValue::ApiKey(api_key) => {
                bytes.append("api-key");
                bytes.append(
                    FingerprintText::new(&api_key.website_url)
                        .normalized()
                        .as_str(),
                );
            }
            SecretValue::SeedPhrase(seed_phrase) => {
                bytes.append("seed-phrase");
                bytes.append(
                    FingerprintText::new(&seed_phrase.name)
                        .normalized()
                        .as_str(),
                );
            }
            SecretValue::SecureNote(note) => {
                bytes.append("secure-note");
                bytes.append(FingerprintText::new(&note.title).normalized().as_str());
            }
            SecretValue::Passkey(passkey) => {
                bytes.append("passkey");
                bytes.append(passkey.rp_id.as_str());
                bytes.append(passkey.credential_id.as_str());
            }
            SecretValue::Authenticator(authenticator) => {
                bytes.append("authenticator");
                bytes.append(
                    FingerprintText::new(&authenticator.issuer)
                        .normalized()
                        .as_str(),
                );
                bytes.append(
                    FingerprintText::new(&authenticator.account)
                        .normalized()
                        .as_str(),
                );
            }
            SecretValue::CreditCard(card) => {
                bytes.append("credit-card");
                bytes.append(FingerprintText::new(&card.title).normalized().as_str());
                bytes.append(
                    FingerprintText::new(&card.cardholder_name)
                        .normalized()
                        .as_str(),
                );
                bytes.append(card.last4().as_str());
            }
            SecretValue::FileAttachment(file) => {
                bytes.append("file-attachment");
                bytes.append(FingerprintText::new(&file.title).normalized().as_str());
                bytes.append(FingerprintText::new(&file.file_name).normalized().as_str());
                bytes.append(FingerprintText::new(&file.mime_type).normalized().as_str());
                bytes.append(u64::from(file.size_bytes).to_string().as_str());
            }
        }
        bytes
    }
    fn version(value: &SecretValue) -> Self {
        let mut bytes = Self::identity(value);
        match value {
            SecretValue::Login(login) => bytes.append(login.password.as_str()),
            SecretValue::ApiKey(api_key) => bytes.append(api_key.key.as_str()),
            SecretValue::SeedPhrase(seed_phrase) => bytes.append(
                seed_phrase
                    .seed
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ")
                    .as_str(),
            ),
            SecretValue::SecureNote(note) => {
                bytes.append(
                    (ProviderNotes {
                        text: &note.note,
                        policy: ImportMetadataPolicy::General,
                    })
                    .neutral()
                    .as_str(),
                );
            }
            SecretValue::Passkey(passkey) => {
                bytes.append(passkey.user_handle.as_str());
                let PasskeyCredentialKey::Es256 {
                    public_key_cose, ..
                } = &passkey.key;
                bytes.append(public_key_cose.encoded());
                bytes.append(u32::from(passkey.signature_count).to_string().as_str());
                bytes.append(if passkey.discoverable { "1" } else { "0" });
                bytes.append(if passkey.backup_eligible { "1" } else { "0" });
                bytes.append(if passkey.backup_state { "1" } else { "0" });
            }
            SecretValue::Authenticator(authenticator) => {
                bytes.append(authenticator.secret.as_str());
                bytes.append(authenticator.algorithm.as_str());
                bytes.append(authenticator.digits.to_string().as_str());
                bytes.append(authenticator.period.to_string().as_str());
                let mut backup_codes = authenticator
                    .backup_codes
                    .iter()
                    .map(|code| FingerprintText::new(code).normalized())
                    .collect::<Vec<_>>();
                backup_codes.sort();
                for code in backup_codes {
                    bytes.append(code.as_str());
                }
            }
            SecretValue::CreditCard(card) => {
                bytes.append(card.number.as_str());
                bytes.append(card.expiration_month.as_str());
                bytes.append(card.expiration_year.as_str());
                bytes.append(card.cvv.as_str());
                bytes.append(
                    (ProviderNotes {
                        text: &card.notes,
                        policy: ImportMetadataPolicy::General,
                    })
                    .neutral()
                    .as_str(),
                );
            }
            SecretValue::FileAttachment(file) => {
                bytes.append(file.content_base64.as_str());
            }
        }
        bytes
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CanonicalSecretBytes, CanonicalSecretFingerprint, FingerprintKind, FingerprintRequest,
    };
    use crate::{
        ApiKeySecret, CreditCardSecret, FileAttachmentSecret, LoginSecret, SecretValue,
        SecureNoteSecret, SeedPhraseSecret, SymmetricKey,
    };
    use nook_auth2::ValidationResult;
    use nook_event_log::SecretFingerprint;
    use std::ptr;

    #[test]
    fn completion_consumes_one_bound_operation_without_a_replacement_key() -> anyhow::Result<()> {
        let fixture = LoginFingerprintFixture::new()?;
        let prepared = fixture.request().prepare(FingerprintKind::Version);
        let finish: fn(CanonicalSecretFingerprint<'_>) -> ValidationResult<SecretFingerprint> =
            CanonicalSecretFingerprint::finish;
        assert_eq!(finish(prepared)?, fixture.value.fingerprint(&fixture.key)?);
        Ok(())
    }

    struct LoginFingerprintFixture {
        value: SecretValue,
        key: SymmetricKey,
    }
    impl LoginFingerprintFixture {
        fn new() -> anyhow::Result<Self> {
            Ok(Self {
                value: SecretValue::Login(LoginSecret {
                    website_url: " https://example.com ".to_owned(),
                    username: " alice\r\n".to_owned(),
                    password: " secret ".to_owned(),
                    notes: "ignored".to_owned(),
                }),
                key: SymmetricKey::parse(&"a".repeat(64))?,
            })
        }
        fn request(&self) -> FingerprintRequest<'_> {
            FingerprintRequest {
                value: &self.value,
                secrets_key: &self.key,
            }
        }
    }

    #[test]
    fn canonical_login_frames_and_digest_schemes_are_fixed() -> anyhow::Result<()> {
        let fixture = LoginFingerprintFixture::new()?;
        let identity = fixture.request().prepare(FingerprintKind::Identity);
        assert_eq!(
            identity.canonical.0,
            b"5:login\x0019:https://example.com\x005:alice\x00"
        );
        assert!(ptr::eq(identity.secrets_key, &fixture.key));
        assert_eq!(
            identity.finish()?.as_str(),
            "hmac-sha256:v1:adcfee05e4060a40a182e52d2c882bf8695038a157c37555573b4f88586a4900"
        );
        let version = fixture.request().prepare(FingerprintKind::Version);
        assert_eq!(
            version.canonical.0,
            b"5:login\x0019:https://example.com\x005:alice\x008: secret \x00"
        );
        assert!(ptr::eq(version.secrets_key, &fixture.key));
        assert_eq!(
            version.finish()?.as_str(),
            "hmac-sha256:v2:01f1bd07a8e721b68e5d973fe5e86917830c5081438ca066bae7acbe8bf28499"
        );
        Ok(())
    }

    #[test]
    fn framing_counts_utf8_bytes_and_prevents_field_concatenation() {
        let mut framed = CanonicalSecretBytes(Vec::new());
        framed.append("é");
        framed.append("a\0b");
        framed.append("");
        assert_eq!(framed.0, b"2:\xc3\xa9\x003:a\0b\x000:\x00");
        let mut first = CanonicalSecretBytes(Vec::new());
        first.append("ab");
        first.append("c");
        let mut second = CanonicalSecretBytes(Vec::new());
        second.append("a");
        second.append("bc");
        assert_ne!(first.0, second.0);
    }

    #[test]
    fn api_key_expiry_is_excluded_but_exact_key_bytes_are_retained() {
        let value = SecretValue::ApiKey(ApiKeySecret {
            website_url: " Example ".to_owned(),
            key: " key ".to_owned(),
            expires_at: "tomorrow".to_owned(),
        });
        assert_eq!(
            CanonicalSecretBytes::identity(&value).0,
            b"7:api-key\x007:Example\x00"
        );
        assert_eq!(
            CanonicalSecretBytes::version(&value).0,
            b"7:api-key\x007:Example\x005: key \x00"
        );
        let mut changed = value.clone();
        if let SecretValue::ApiKey(key) = &mut changed {
            key.expires_at = "later".to_owned();
        }
        assert_eq!(
            CanonicalSecretBytes::version(&value).0,
            CanonicalSecretBytes::version(&changed).0
        );
    }

    #[test]
    fn seed_phrase_whitespace_is_collapsed_only_in_the_version_field() {
        let value = SecretValue::SeedPhrase(SeedPhraseSecret {
            name: " Recovery\r\n ".to_owned(),
            seed: " alpha\t beta\n gamma ".to_owned(),
        });
        assert_eq!(
            CanonicalSecretBytes::identity(&value).0,
            b"11:seed-phrase\x008:Recovery\x00"
        );
        assert_eq!(
            CanonicalSecretBytes::version(&value).0,
            b"11:seed-phrase\x008:Recovery\x0016:alpha beta gamma\x00"
        );
    }

    #[test]
    fn secure_note_canonical_bytes_keep_only_recognized_provider_neutral_content() {
        let value = SecretValue::SecureNote(SecureNoteSecret {
            title: " Note ".to_owned(),
            note: " body\r\n\r\n## LastPass\r\n- group: Work ".to_owned(),
        });
        assert_eq!(
            CanonicalSecretBytes::identity(&value).0,
            b"11:secure-note\x004:Note\x00"
        );
        assert_eq!(
            CanonicalSecretBytes::version(&value).0,
            b"11:secure-note\x004:Note\x004:body\x00"
        );
    }

    #[test]
    fn attachment_identity_keeps_size_and_version_keeps_exact_content() {
        let value = SecretValue::FileAttachment(FileAttachmentSecret {
            title: " File ".to_owned(),
            file_name: " name.txt ".to_owned(),
            mime_type: " text/plain ".to_owned(),
            size_bytes: 3_u64.into(),
            content_base64: "YWJj".to_owned(),
        });
        assert_eq!(
            CanonicalSecretBytes::identity(&value).0,
            b"15:file-attachment\x004:File\x008:name.txt\x0010:text/plain\x001:3\x00"
        );
        assert_eq!(
            CanonicalSecretBytes::version(&value).0,
            b"15:file-attachment\x004:File\x008:name.txt\x0010:text/plain\x001:3\x004:YWJj\x00"
        );
    }

    #[test]
    fn card_framing_preserves_number_expiry_cvv_and_general_note_policy() {
        let value = SecretValue::CreditCard(CreditCardSecret {
            title: " Card ".to_owned(),
            cardholder_name: " Alice ".to_owned(),
            number: "4111111111111111".to_owned(),
            expiration_month: "01".to_owned(),
            expiration_year: "2030".to_owned(),
            cvv: "007".to_owned(),
            notes: "note\n\n## LastPass\n- group: Work".to_owned(),
        });
        assert_eq!(
            CanonicalSecretBytes::identity(&value).0,
            b"11:credit-card\x004:Card\x005:Alice\x004:1111\x00"
        );
        assert_eq!(CanonicalSecretBytes::version(&value).0,
            b"11:credit-card\x004:Card\x005:Alice\x004:1111\x0016:4111111111111111\x002:01\x004:2030\x003:007\x004:note\x00");
    }

    #[test]
    fn discarding_prepared_bytes_preserves_source_and_key() -> anyhow::Result<()> {
        let fixture = LoginFingerprintFixture::new()?;
        let original = fixture.value.clone();
        {
            let prepared = fixture.request().prepare(FingerprintKind::Version);
            assert!(ptr::eq(prepared.secrets_key, &fixture.key));
        }
        assert_eq!(fixture.value, original);
        assert_eq!(fixture.key.as_str(), "a".repeat(64));
        assert_eq!(
            fixture.value.fingerprint(&fixture.key)?.as_str(),
            "hmac-sha256:v2:01f1bd07a8e721b68e5d973fe5e86917830c5081438ca066bae7acbe8bf28499"
        );
        Ok(())
    }
}
