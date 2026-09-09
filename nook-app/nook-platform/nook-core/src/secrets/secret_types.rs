//! Typed plaintext secret payloads.
//!
//! `nook-auth2` owns `SecretType` plus the opaque stored row shape because auth
//! metadata shares the same YAML row boundary. `nook-core` owns the plaintext
//! password-manager payloads and session records.

use crate::errors::{SecretPayloadError, SecretPayloadResult};
use crate::vault_wire::SecretPayloadYaml;
use crate::{AuthenticatorSecret, CreditCardSecret, SecretId};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use std::fmt;
use zeroize::Zeroize;

mod file_attachment;

pub use file_attachment::*;

pub use nook_auth2::{SecretType, StoredRecordPayload, StoredSecretRecord};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LoginSecret {
    pub website_url: String,
    pub username: String,
    pub password: String,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeySecret {
    pub website_url: String,
    pub key: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SeedPhraseSecret {
    pub name: String,
    pub seed: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SecureNoteSecret {
    pub title: String,
    pub note: String,
}

/// Version of the persisted website-passkey secret payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "u32")]
pub struct PasskeySecretVersion(u32);

impl PasskeySecretVersion {
    pub const CURRENT: Self = Self(1);
}

impl From<PasskeySecretVersion> for u32 {
    fn from(value: PasskeySecretVersion) -> Self {
        value.0
    }
}

impl TryFrom<u32> for PasskeySecretVersion {
    type Error = String;
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "serialization boundary: admits the existing numeric wire representation"
        )
    )]
    fn try_from(value: u32) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(Self::CURRENT),
            _ => Err("unsupported passkey payload version".to_owned()),
        }
    }
}

pub const PASSKEY_SECRET_VERSION: PasskeySecretVersion = PasskeySecretVersion::CURRENT;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PasskeySignatureCount(u32);

impl PasskeySignatureCount {
    pub const ZERO: Self = Self(0);

    pub(crate) fn checked_increment(self) -> Option<Self> {
        self.0.checked_add(1).map(Self)
    }
}

impl From<u32> for PasskeySignatureCount {
    fn from(value: u32) -> Self {
        Self(value)
    }
}

impl From<PasskeySignatureCount> for u32 {
    fn from(value: PasskeySignatureCount) -> Self {
        value.0
    }
}

impl Zeroize for PasskeySignatureCount {
    fn zeroize(&mut self) {
        self.0.zeroize();
    }
}

const PASSKEY_CREDENTIAL_ID_MAX_LEN: usize = 1023;
const PASSKEY_USER_HANDLE_MAX_LEN: usize = 64;
const PASSKEY_PRIVATE_KEY_MAX_LEN: usize = 4096;
const PASSKEY_PUBLIC_KEY_MAX_LEN: usize = 2048;

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(transparent)]
pub struct PasskeyPrivateKeyPkcs8(String);

impl fmt::Debug for PasskeyPrivateKeyPkcs8 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("PasskeyPrivateKeyPkcs8([REDACTED])")
    }
}

impl PasskeyPrivateKeyPkcs8 {
    pub fn parse(encoded: impl Into<String>) -> SecretPayloadResult<Self> {
        let encoded = encoded.into();
        PasskeySecret::validate_base64url_field(PasskeyEncodedField {
            name: "ES256 private key",
            encoded: &encoded,
            minimum: 1,
            maximum: PASSKEY_PRIVATE_KEY_MAX_LEN,
        })?;
        Ok(Self(encoded))
    }

    fn validate(&self) -> SecretPayloadResult<()> {
        PasskeySecret::validate_base64url_field(PasskeyEncodedField {
            name: "ES256 private key",
            encoded: &self.0,
            minimum: 1,
            maximum: PASSKEY_PRIVATE_KEY_MAX_LEN,
        })?;
        self.validate_es256(None)
            .map_err(|error| SecretPayloadError::InvalidPasskey {
                reason: error.to_string(),
            })
    }

    pub(crate) fn encoded(&self) -> &str {
        &self.0
    }

    fn zeroize(&mut self) {
        self.0.zeroize();
    }
}

impl Drop for PasskeyPrivateKeyPkcs8 {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(transparent)]
pub struct PasskeyPublicKeyCose(String);

impl fmt::Debug for PasskeyPublicKeyCose {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("PasskeyPublicKeyCose([REDACTED])")
    }
}

impl PasskeyPublicKeyCose {
    pub fn parse(encoded: impl Into<String>) -> SecretPayloadResult<Self> {
        let encoded = encoded.into();
        PasskeySecret::validate_base64url_field(PasskeyEncodedField {
            name: "ES256 public key",
            encoded: &encoded,
            minimum: 1,
            maximum: PASSKEY_PUBLIC_KEY_MAX_LEN,
        })?;
        Ok(Self(encoded))
    }

    fn validate(&self) -> SecretPayloadResult<()> {
        PasskeySecret::validate_base64url_field(PasskeyEncodedField {
            name: "ES256 public key",
            encoded: &self.0,
            minimum: 1,
            maximum: PASSKEY_PUBLIC_KEY_MAX_LEN,
        })
    }

    pub(crate) fn encoded(&self) -> &str {
        &self.0
    }

    fn zeroize(&mut self) {
        self.0.zeroize();
    }
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum PasskeyCredentialKey {
    Es256 {
        private_key_pkcs8: PasskeyPrivateKeyPkcs8,
        public_key_cose: PasskeyPublicKeyCose,
    },
}

impl fmt::Debug for PasskeyCredentialKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Es256 { .. } => formatter
                .debug_struct("Es256")
                .field("private_key_pkcs8", &"[REDACTED]")
                .field("public_key_cose", &"[REDACTED]")
                .finish(),
        }
    }
}

impl PasskeyCredentialKey {
    fn validate(&self) -> SecretPayloadResult<()> {
        match self {
            Self::Es256 {
                private_key_pkcs8,
                public_key_cose,
            } => {
                private_key_pkcs8.validate()?;
                public_key_cose.validate()?;
                private_key_pkcs8
                    .validate_es256(Some(public_key_cose))
                    .map_err(|error| SecretPayloadError::InvalidPasskey {
                        reason: error.to_string(),
                    })
            }
        }
    }

    fn zeroize(&mut self) {
        match self {
            Self::Es256 {
                private_key_pkcs8,
                public_key_cose,
            } => {
                private_key_pkcs8.zeroize();
                public_key_cose.zeroize();
            }
        }
    }
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PasskeySecret {
    pub version: PasskeySecretVersion,
    pub rp_id: String,
    pub rp_name: String,
    pub credential_id: String,
    pub user_handle: String,
    pub user_name: String,
    pub user_display_name: String,
    pub key: PasskeyCredentialKey,
    pub signature_count: PasskeySignatureCount,
    pub discoverable: bool,
    pub backup_eligible: bool,
    pub backup_state: bool,
}

impl fmt::Debug for PasskeySecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PasskeySecret")
            .field("version", &self.version)
            .field("rp_id", &"[REDACTED]")
            .field("rp_name", &"[REDACTED]")
            .field("credential_id", &"[REDACTED]")
            .field("user_handle", &"[REDACTED]")
            .field("user_name", &"[REDACTED]")
            .field("user_display_name", &"[REDACTED]")
            .field("key", &self.key)
            .field("signature_count", &self.signature_count)
            .field("discoverable", &self.discoverable)
            .field("backup_eligible", &self.backup_eligible)
            .field("backup_state", &self.backup_state)
            .finish()
    }
}

/// Named values required by PasskeySecret::validate_text_field.
struct PasskeyTextField<'a> {
    name: &'static str,
    value: &'a str,
    minimum: usize,
    maximum: usize,
}

/// Named values required by PasskeySecret::validate_base64url_field.
struct PasskeyEncodedField<'a> {
    name: &'static str,
    encoded: &'a str,
    minimum: usize,
    maximum: usize,
}

impl PasskeySecret {
    pub fn validate(&self) -> SecretPayloadResult<()> {
        PasskeySecret::validate_rp_id(&self.rp_id)?;
        PasskeySecret::validate_text_field(PasskeyTextField {
            name: "RP name",
            value: &self.rp_name,
            minimum: 1,
            maximum: 256,
        })?;
        PasskeySecret::validate_base64url_field(PasskeyEncodedField {
            name: "credential id",
            encoded: &self.credential_id,
            minimum: 16,
            maximum: PASSKEY_CREDENTIAL_ID_MAX_LEN,
        })?;
        PasskeySecret::validate_base64url_field(PasskeyEncodedField {
            name: "user handle",
            encoded: &self.user_handle,
            minimum: 1,
            maximum: PASSKEY_USER_HANDLE_MAX_LEN,
        })?;
        PasskeySecret::validate_text_field(PasskeyTextField {
            name: "user name",
            value: &self.user_name,
            minimum: 1,
            maximum: 256,
        })?;
        PasskeySecret::validate_text_field(PasskeyTextField {
            name: "user display name",
            value: &self.user_display_name,
            minimum: 1,
            maximum: 256,
        })?;
        self.key.validate()?;
        if !self.discoverable {
            return PasskeySecret::invalid_passkey("passkey credentials must be discoverable");
        }
        if self.backup_state && !self.backup_eligible {
            return PasskeySecret::invalid_passkey("backup state requires backup eligibility");
        }
        Ok(())
    }

    pub fn zeroize_plaintext(&mut self) {
        self.rp_id.zeroize();
        self.rp_name.zeroize();
        self.credential_id.zeroize();
        self.user_handle.zeroize();
        self.user_name.zeroize();
        self.user_display_name.zeroize();
        self.key.zeroize();
        self.signature_count.zeroize();
        self.discoverable.zeroize();
        self.backup_eligible.zeroize();
        self.backup_state.zeroize();
    }
}

impl Zeroize for PasskeySecret {
    fn zeroize(&mut self) {
        self.zeroize_plaintext();
    }
}

impl PasskeySecret {
    fn invalid_passkey<T>(reason: impl Into<String>) -> SecretPayloadResult<T> {
        Err(SecretPayloadError::InvalidPasskey {
            reason: reason.into(),
        })
    }
}

impl PasskeySecret {
    fn validate_text_field(request: PasskeyTextField<'_>) -> SecretPayloadResult<()> {
        let PasskeyTextField {
            name,
            value,
            minimum,
            maximum,
        } = request;
        let length = value.chars().count();
        if value.trim() != value || length < minimum || length > maximum {
            return PasskeySecret::invalid_passkey(format!(
                "{name} has an invalid length or surrounding whitespace"
            ));
        }
        if value.chars().any(char::is_control) {
            return PasskeySecret::invalid_passkey(format!("{name} contains control characters"));
        }
        Ok(())
    }
}

impl PasskeySecret {
    fn validate_base64url_field(request: PasskeyEncodedField<'_>) -> SecretPayloadResult<()> {
        let PasskeyEncodedField {
            name,
            encoded,
            minimum,
            maximum,
        } = request;
        let decoded =
            URL_SAFE_NO_PAD
                .decode(encoded)
                .map_err(|_| SecretPayloadError::InvalidPasskey {
                    reason: format!("{name} is not canonical base64url"),
                })?;
        if decoded.len() < minimum || decoded.len() > maximum {
            return PasskeySecret::invalid_passkey(format!("{name} has an invalid byte length"));
        }
        if URL_SAFE_NO_PAD.encode(&decoded) != encoded {
            return PasskeySecret::invalid_passkey(format!("{name} is not canonical base64url"));
        }
        Ok(())
    }
}

impl PasskeySecret {
    fn validate_rp_id(rp_id: &str) -> SecretPayloadResult<()> {
        PasskeySecret::validate_text_field(PasskeyTextField {
            name: "RP id",
            value: rp_id,
            minimum: 1,
            maximum: 253,
        })?;
        if rp_id == "localhost" {
            return Ok(());
        }
        if !rp_id.is_ascii()
            || rp_id.starts_with('.')
            || rp_id.ends_with('.')
            || !rp_id.contains('.')
            || rp_id.split('.').any(|label| {
                label.is_empty()
                    || label.len() > 63
                    || label.starts_with('-')
                    || label.ends_with('-')
                    || !label
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            })
        {
            return PasskeySecret::invalid_passkey(
                "RP id must be a canonical DNS domain or localhost",
            );
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SecretValue {
    Login(LoginSecret),
    ApiKey(ApiKeySecret),
    SeedPhrase(SeedPhraseSecret),
    SecureNote(SecureNoteSecret),
    Passkey(PasskeySecret),
    Authenticator(AuthenticatorSecret),
    CreditCard(CreditCardSecret),
    FileAttachment(FileAttachmentSecret),
}

impl SecretValue {
    pub fn from_yaml(
        secret_type: SecretType,
        yaml: &SecretPayloadYaml,
    ) -> SecretPayloadResult<Self> {
        Self::from_yaml_str(secret_type, yaml.as_str())
    }

    pub fn from_yaml_str(secret_type: SecretType, yaml: &str) -> SecretPayloadResult<Self> {
        match secret_type {
            SecretType::Login => serde_yaml::from_str(yaml)
                .map(Self::Login)
                .map_err(SecretPayloadError::InvalidLogin),
            SecretType::ApiKey => serde_yaml::from_str(yaml)
                .map(Self::ApiKey)
                .map_err(SecretPayloadError::InvalidApiKey),
            SecretType::SeedPhrase => {
                let secret: SeedPhraseSecret =
                    serde_yaml::from_str(yaml).map_err(SecretPayloadError::InvalidSeedPhrase)?;
                SeedPhraseSecret::validate_bip39_mnemonic(&secret.seed)?;
                Ok(Self::SeedPhrase(secret))
            }
            SecretType::SecureNote => serde_yaml::from_str(yaml)
                .map(Self::SecureNote)
                .map_err(SecretPayloadError::InvalidSecureNote),
            SecretType::Passkey => {
                let passkey: PasskeySecret =
                    serde_yaml::from_str(yaml).map_err(SecretPayloadError::InvalidPasskeyYaml)?;
                passkey.validate()?;
                Ok(Self::Passkey(passkey))
            }
            SecretType::Authenticator => {
                let mut secret: AuthenticatorSecret =
                    serde_yaml::from_str(yaml).map_err(SecretPayloadError::InvalidAuthenticator)?;
                secret.normalize()?;
                Ok(Self::Authenticator(secret))
            }
            SecretType::CreditCard => {
                let mut secret: CreditCardSecret =
                    serde_yaml::from_str(yaml).map_err(SecretPayloadError::InvalidCreditCard)?;
                secret.normalize()?;
                Ok(Self::CreditCard(secret))
            }
            SecretType::FileAttachment => {
                let secret: FileAttachmentSecret = serde_yaml::from_str(yaml)
                    .map_err(SecretPayloadError::InvalidFileAttachmentYaml)?;
                secret.validate()?;
                Ok(Self::FileAttachment(secret))
            }
        }
    }

    pub fn to_yaml(&self) -> SecretPayloadResult<SecretPayloadYaml> {
        let yaml = match self {
            Self::Login(value) => serde_yaml::to_string(value),
            Self::ApiKey(value) => serde_yaml::to_string(value),
            Self::SeedPhrase(value) => serde_yaml::to_string(value),
            Self::SecureNote(value) => serde_yaml::to_string(value),
            Self::Passkey(value) => {
                value.validate()?;
                serde_yaml::to_string(value)
            }
            Self::Authenticator(value) => serde_yaml::to_string(value),
            Self::CreditCard(value) => serde_yaml::to_string(value),
            Self::FileAttachment(value) => {
                value.validate()?;
                serde_yaml::to_string(value)
            }
        }
        .map_err(SecretPayloadError::Serialize)?;
        Ok(SecretPayloadYaml::from_trusted(yaml))
    }

    #[must_use]
    pub const fn secret_type(&self) -> SecretType {
        match self {
            Self::Login(_) => SecretType::Login,
            Self::ApiKey(_) => SecretType::ApiKey,
            Self::SeedPhrase(_) => SecretType::SeedPhrase,
            Self::SecureNote(_) => SecretType::SecureNote,
            Self::Passkey(_) => SecretType::Passkey,
            Self::Authenticator(_) => SecretType::Authenticator,
            Self::CreditCard(_) => SecretType::CreditCard,
            Self::FileAttachment(_) => SecretType::FileAttachment,
        }
    }

    pub fn zeroize_plaintext(&mut self) {
        match self {
            Self::Login(value) => {
                value.website_url.zeroize();
                value.username.zeroize();
                value.password.zeroize();
                value.notes.zeroize();
            }
            Self::ApiKey(value) => {
                value.website_url.zeroize();
                value.key.zeroize();
                value.expires_at.zeroize();
            }
            Self::SeedPhrase(value) => {
                value.name.zeroize();
                value.seed.zeroize();
            }
            Self::SecureNote(value) => {
                value.title.zeroize();
                value.note.zeroize();
            }
            Self::Passkey(value) => value.zeroize_plaintext(),
            Self::Authenticator(value) => value.zeroize(),
            Self::CreditCard(value) => value.zeroize_plaintext(),
            Self::FileAttachment(value) => value.zeroize_plaintext(),
        }
    }
}

/// Typed plaintext secret (in memory only).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SecretRecord {
    pub id: SecretId,
    #[serde(rename = "type")]
    pub secret_type: SecretType,
    pub data: SecretValue,
}

impl SecretRecord {
    pub fn zeroize_plaintext(&mut self) {
        self.data.zeroize_plaintext();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passkey_version_preserves_scalars_and_rejects_unsupported_values() -> anyhow::Result<()> {
        let version = PasskeySecretVersion::CURRENT;
        assert_eq!(serde_json::to_string(&version)?, "1");
        assert_eq!(serde_yaml::to_string(&version)?.trim(), "1");
        assert_eq!(serde_json::from_str::<PasskeySecretVersion>("1")?, version);
        assert_eq!(serde_yaml::from_str::<PasskeySecretVersion>("1")?, version);
        for invalid in ["0", "2", "4294967296"] {
            assert!(serde_json::from_str::<PasskeySecretVersion>(invalid).is_err());
        }
        Ok(())
    }

    fn encoded(byte: u8, length: usize) -> String {
        URL_SAFE_NO_PAD.encode(vec![byte; length])
    }

    fn passkey() -> anyhow::Result<PasskeySecret> {
        let request = crate::PasskeyRegistrationRequest {
            origin: "https://accounts.example.com".to_owned(),
            challenge: encoded(1, 32),
            relying_party: crate::PasskeyRelyingParty {
                id: "accounts.example.com".to_owned(),
                name: "Example".to_owned(),
            },
            user: crate::PasskeyUser {
                id: encoded(2, 32),
                name: "alice@example.com".to_owned(),
                display_name: "Alice".to_owned(),
            },
            algorithms: vec![-7],
            exclude_credentials: Vec::new(),
            resident_key_required: true,
            user_verification_required: true,
        };
        let mut passkey = request
            .prepare(&[])
            .and_then(crate::CheckedPasskeyRegistration::generate)?
            .credential;
        passkey.signature_count = 4.into();
        Ok(passkey)
    }

    #[test]
    fn passkey_payload_round_trips_as_versioned_yaml() -> anyhow::Result<()> {
        let value = SecretValue::Passkey(passkey()?);
        let yaml = value.to_yaml()?;
        let decoded = SecretValue::from_yaml(SecretType::Passkey, &yaml)?;

        assert_eq!(decoded, value);
        assert!(yaml.as_str().contains("version: 1"));
        assert!(yaml.as_str().contains("signatureCount: 4"));
        assert!(yaml.as_str().contains("rpId: accounts.example.com"));
        Ok(())
    }

    #[test]
    fn passkey_validation_rejects_invalid_domains_and_backup_state() -> anyhow::Result<()> {
        let mut invalid_domain = passkey()?;
        invalid_domain.rp_id = "https://example.com".to_owned();
        assert!(invalid_domain.validate().is_err());

        let mut invalid_backup = passkey()?;
        invalid_backup.backup_eligible = false;
        assert!(invalid_backup.validate().is_err());

        let mut non_discoverable = passkey()?;
        non_discoverable.discoverable = false;
        assert!(non_discoverable.validate().is_err());
        Ok(())
    }

    #[test]
    fn passkey_validation_rejects_noncanonical_or_wrong_length_binary_fields() -> anyhow::Result<()>
    {
        let mut padded = passkey()?;
        padded.credential_id.push('=');
        assert!(padded.validate().is_err());

        let mut short_user_handle = passkey()?;
        short_user_handle.user_handle = encoded(7, 0);
        assert!(short_user_handle.validate().is_err());
        Ok(())
    }

    #[test]
    fn passkey_debug_and_zeroize_do_not_retain_private_material() -> anyhow::Result<()> {
        let mut value = SecretValue::Passkey(passkey()?);
        let debug = format!("{value:?}");
        assert!(debug.contains("[REDACTED]"));
        assert!(!debug.contains(&encoded(3, 96)));
        assert!(!debug.contains(&encoded(1, 32)));

        value.zeroize_plaintext();
        let SecretValue::Passkey(value) = value else {
            panic!("expected passkey");
        };
        assert!(value.credential_id.is_empty());
        assert!(value.user_handle.is_empty());
        match &value.key {
            PasskeyCredentialKey::Es256 {
                private_key_pkcs8,
                public_key_cose,
            } => {
                assert!(private_key_pkcs8.0.is_empty());
                assert!(public_key_cose.0.is_empty());
            }
        }
        Ok(())
    }
}
