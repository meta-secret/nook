//! Typed vault row tags and opaque on-disk record shapes.
//!
//! User secrets, auth rows, join rows, and member rows all cross the vault YAML
//! boundary as `StoredSecretRecord`. `SecretValue` plaintext payloads live in
//! `nook-core`; this crate only needs the record tag and ciphertext/JSON row
//! wrapper used by authentication metadata.

use crate::SecretId;
use crate::errors::{SecretPayloadError, SecretPayloadResult};
use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SecretType {
    Login,
    ApiKey,
    SeedPhrase,
    SecureNote,
    Authenticator,
}

impl SecretType {
    pub fn parse(value: &str) -> SecretPayloadResult<Self> {
        match value {
            "login" => Ok(Self::Login),
            "api-key" => Ok(Self::ApiKey),
            "seed-phrase" => Ok(Self::SeedPhrase),
            "secure-note" => Ok(Self::SecureNote),
            "authenticator" => Ok(Self::Authenticator),
            _ => Err(SecretPayloadError::UnknownSecretType {
                value: value.to_owned(),
            }),
        }
    }

    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Login => "login",
            Self::ApiKey => "api-key",
            Self::SeedPhrase => "seed-phrase",
            Self::SecureNote => "secure-note",
            Self::Authenticator => "authenticator",
        }
    }
}

/// Opaque on-disk payload — user secrets are age-armored YAML; auth/join/member rows use JSON or nested armor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct StoredRecordPayload(String);

impl StoredRecordPayload {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(self) -> String {
        self.0
    }

    #[must_use]
    pub fn from_trusted(value: String) -> Self {
        Self(value)
    }

    #[must_use]
    pub fn from_age_armored(value: crate::AgeArmoredCiphertext) -> Self {
        Self(value.into_inner())
    }
}

impl fmt::Display for StoredRecordPayload {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl AsRef<str> for StoredRecordPayload {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

/// One record on disk — label is plaintext, `value` is an opaque encrypted or JSON payload.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoredSecretRecord {
    #[serde(rename = "id")]
    pub key: SecretId,
    #[serde(rename = "type", default, skip_serializing_if = "Option::is_none")]
    pub secret_type: Option<SecretType>,
    #[serde(rename = "data")]
    pub value: StoredRecordPayload,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::AgeArmoredCiphertext;

    #[test]
    fn secret_type_parse_display_and_serde_roundtrip() {
        let cases = [
            ("login", SecretType::Login),
            ("api-key", SecretType::ApiKey),
            ("seed-phrase", SecretType::SeedPhrase),
            ("secure-note", SecretType::SecureNote),
            ("authenticator", SecretType::Authenticator),
        ];
        for (tag, expected) in cases {
            assert_eq!(SecretType::parse(tag).unwrap(), expected);
            assert_eq!(expected.as_str(), tag);
            let encoded = serde_json::to_string(&expected).unwrap();
            assert_eq!(
                serde_json::from_str::<SecretType>(&encoded).unwrap(),
                expected
            );
        }
        assert!(SecretType::parse("totp").is_err());
    }

    #[test]
    fn stored_record_payload_wraps_trusted_and_armored_values() {
        let trusted = StoredRecordPayload::from_trusted("opaque-json".to_owned());
        assert_eq!(trusted.as_str(), "opaque-json");
        assert_eq!(trusted.as_ref(), "opaque-json");
        assert_eq!(trusted.to_string(), "opaque-json");
        assert_eq!(trusted.clone().into_inner(), "opaque-json");

        let armor = "-----BEGIN AGE ENCRYPTED FILE-----\nabc\n-----END AGE ENCRYPTED FILE-----";
        let armored = AgeArmoredCiphertext::parse(armor).unwrap();
        let payload = StoredRecordPayload::from_age_armored(armored);
        assert_eq!(payload.as_str(), armor);
    }

    #[test]
    fn stored_secret_record_uses_disk_field_names() {
        let record = StoredSecretRecord {
            key: SecretId::from_vault_record("secret_token001"),
            secret_type: Some(SecretType::ApiKey),
            value: StoredRecordPayload::from_trusted("ciphertext".to_owned()),
        };

        let encoded = serde_json::to_value(&record).unwrap();
        assert_eq!(encoded["id"], "secret_token001");
        assert_eq!(encoded["type"], "api-key");
        assert_eq!(encoded["data"], "ciphertext");

        let decoded: StoredSecretRecord = serde_json::from_value(encoded).unwrap();
        assert_eq!(decoded, record);

        let auth_row = StoredSecretRecord {
            key: SecretId::from_vault_record("auth:key"),
            secret_type: None,
            value: StoredRecordPayload::from_trusted("{}".to_owned()),
        };
        assert_eq!(
            serde_json::to_value(&auth_row).unwrap()["type"],
            serde_json::Value::Null
        );
    }
}
