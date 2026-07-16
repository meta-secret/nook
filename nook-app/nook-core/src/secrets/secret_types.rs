//! Typed plaintext secret payloads.
//!
//! `nook-auth2` owns `SecretType` plus the opaque stored row shape because auth
//! metadata shares the same YAML row boundary. `nook-core` owns the plaintext
//! password-manager payloads and session records.

use crate::SecretId;
use crate::errors::{SecretPayloadError, SecretPayloadResult};
use crate::vault_wire::SecretPayloadYaml;
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use std::fmt;
use zeroize::Zeroize;

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

pub const PASSKEY_SECRET_VERSION: u32 = 1;
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
        validate_base64url_field(
            "ES256 private key",
            &encoded,
            1,
            PASSKEY_PRIVATE_KEY_MAX_LEN,
        )?;
        Ok(Self(encoded))
    }

    fn validate(&self) -> SecretPayloadResult<()> {
        validate_base64url_field("ES256 private key", &self.0, 1, PASSKEY_PRIVATE_KEY_MAX_LEN)?;
        crate::passkey_authenticator::validate_es256_credential_key(self, None).map_err(|error| {
            SecretPayloadError::InvalidPasskey {
                reason: error.to_string(),
            }
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
        validate_base64url_field("ES256 public key", &encoded, 1, PASSKEY_PUBLIC_KEY_MAX_LEN)?;
        Ok(Self(encoded))
    }

    fn validate(&self) -> SecretPayloadResult<()> {
        validate_base64url_field("ES256 public key", &self.0, 1, PASSKEY_PUBLIC_KEY_MAX_LEN)
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
                crate::passkey_authenticator::validate_es256_credential_key(
                    private_key_pkcs8,
                    Some(public_key_cose),
                )
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
    pub version: u32,
    pub rp_id: String,
    pub rp_name: String,
    pub credential_id: String,
    pub user_handle: String,
    pub user_name: String,
    pub user_display_name: String,
    pub key: PasskeyCredentialKey,
    pub signature_count: u32,
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

impl PasskeySecret {
    pub fn validate(&self) -> SecretPayloadResult<()> {
        if self.version != PASSKEY_SECRET_VERSION {
            return invalid_passkey("unsupported passkey payload version");
        }
        validate_rp_id(&self.rp_id)?;
        validate_text_field("RP name", &self.rp_name, 1, 256)?;
        validate_base64url_field(
            "credential id",
            &self.credential_id,
            16,
            PASSKEY_CREDENTIAL_ID_MAX_LEN,
        )?;
        validate_base64url_field(
            "user handle",
            &self.user_handle,
            1,
            PASSKEY_USER_HANDLE_MAX_LEN,
        )?;
        validate_text_field("user name", &self.user_name, 1, 256)?;
        validate_text_field("user display name", &self.user_display_name, 1, 256)?;
        self.key.validate()?;
        if !self.discoverable {
            return invalid_passkey("passkey credentials must be discoverable");
        }
        if self.backup_state && !self.backup_eligible {
            return invalid_passkey("backup state requires backup eligibility");
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

fn invalid_passkey<T>(reason: impl Into<String>) -> SecretPayloadResult<T> {
    Err(SecretPayloadError::InvalidPasskey {
        reason: reason.into(),
    })
}

fn validate_text_field(
    name: &'static str,
    value: &str,
    minimum: usize,
    maximum: usize,
) -> SecretPayloadResult<()> {
    let length = value.chars().count();
    if value.trim() != value || length < minimum || length > maximum {
        return invalid_passkey(format!(
            "{name} has an invalid length or surrounding whitespace"
        ));
    }
    if value.chars().any(char::is_control) {
        return invalid_passkey(format!("{name} contains control characters"));
    }
    Ok(())
}

fn validate_base64url_field(
    name: &'static str,
    encoded: &str,
    minimum: usize,
    maximum: usize,
) -> SecretPayloadResult<()> {
    let decoded =
        URL_SAFE_NO_PAD
            .decode(encoded)
            .map_err(|_| SecretPayloadError::InvalidPasskey {
                reason: format!("{name} is not canonical base64url"),
            })?;
    if decoded.len() < minimum || decoded.len() > maximum {
        return invalid_passkey(format!("{name} has an invalid byte length"));
    }
    if URL_SAFE_NO_PAD.encode(&decoded) != encoded {
        return invalid_passkey(format!("{name} is not canonical base64url"));
    }
    Ok(())
}

fn validate_rp_id(rp_id: &str) -> SecretPayloadResult<()> {
    validate_text_field("RP id", rp_id, 1, 253)?;
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
        return invalid_passkey("RP id must be a canonical DNS domain or localhost");
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SecretValue {
    Login(LoginSecret),
    ApiKey(ApiKeySecret),
    SeedPhrase(SeedPhraseSecret),
    SecureNote(SecureNoteSecret),
    Passkey(PasskeySecret),
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
                crate::bip39::validate_bip39_mnemonic(&secret.seed)?;
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

    fn encoded(byte: u8, length: usize) -> String {
        URL_SAFE_NO_PAD.encode(vec![byte; length])
    }

    fn passkey() -> PasskeySecret {
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
        let mut passkey = crate::create_website_passkey(&request, &[])
            .unwrap()
            .credential;
        passkey.signature_count = 4;
        passkey
    }

    #[test]
    fn passkey_payload_round_trips_as_versioned_yaml() {
        let value = SecretValue::Passkey(passkey());
        let yaml = value.to_yaml().unwrap();
        let decoded = SecretValue::from_yaml(SecretType::Passkey, &yaml).unwrap();

        assert_eq!(decoded, value);
        assert!(yaml.as_str().contains("version: 1"));
        assert!(yaml.as_str().contains("rpId: accounts.example.com"));
    }

    #[test]
    fn passkey_validation_rejects_invalid_domains_and_backup_state() {
        let mut invalid_domain = passkey();
        invalid_domain.rp_id = "https://example.com".to_owned();
        assert!(invalid_domain.validate().is_err());

        let mut invalid_backup = passkey();
        invalid_backup.backup_eligible = false;
        assert!(invalid_backup.validate().is_err());

        let mut non_discoverable = passkey();
        non_discoverable.discoverable = false;
        assert!(non_discoverable.validate().is_err());
    }

    #[test]
    fn passkey_validation_rejects_noncanonical_or_wrong_length_binary_fields() {
        let mut padded = passkey();
        padded.credential_id.push('=');
        assert!(padded.validate().is_err());

        let mut short_user_handle = passkey();
        short_user_handle.user_handle = encoded(7, 0);
        assert!(short_user_handle.validate().is_err());
    }

    #[test]
    fn passkey_debug_and_zeroize_do_not_retain_private_material() {
        let mut value = SecretValue::Passkey(passkey());
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
    }
}
