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
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, tsify::Tsify)]
#[tsify(type_suffix = "Wire")]
#[serde(rename_all = "kebab-case")]
pub enum SecretType {
    Login,
    ApiKey,
    SeedPhrase,
    SecureNote,
    Passkey,
    Authenticator,
    CreditCard,
    FileAttachment,
    Person,
    Address,
    IdentityDocument,
    InternationalAccount,
    DomesticAccount,
}

/// Vault section that owns a secret type: credentials and keys, or personal data
/// used to fill identity, address, and payment forms.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SecretCategory {
    Secrets,
    PersonalData,
}

impl SecretType {
    pub fn parse(value: &str) -> SecretPayloadResult<Self> {
        match value {
            "login" => Ok(Self::Login),
            "api-key" => Ok(Self::ApiKey),
            "seed-phrase" => Ok(Self::SeedPhrase),
            "secure-note" => Ok(Self::SecureNote),
            "passkey" => Ok(Self::Passkey),
            "authenticator" => Ok(Self::Authenticator),
            "credit-card" => Ok(Self::CreditCard),
            "file-attachment" => Ok(Self::FileAttachment),
            "person" => Ok(Self::Person),
            "address" => Ok(Self::Address),
            "identity-document" => Ok(Self::IdentityDocument),
            "international-account" => Ok(Self::InternationalAccount),
            "domestic-account" => Ok(Self::DomesticAccount),
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
            Self::Passkey => "passkey",
            Self::Authenticator => "authenticator",
            Self::CreditCard => "credit-card",
            Self::FileAttachment => "file-attachment",
            Self::Person => "person",
            Self::Address => "address",
            Self::IdentityDocument => "identity-document",
            Self::InternationalAccount => "international-account",
            Self::DomesticAccount => "domestic-account",
        }
    }

    /// Vault section that lists and creates this secret type.
    #[must_use]
    pub const fn category(self) -> SecretCategory {
        match self {
            Self::Login
            | Self::ApiKey
            | Self::SeedPhrase
            | Self::SecureNote
            | Self::Passkey
            | Self::Authenticator
            | Self::FileAttachment => SecretCategory::Secrets,
            Self::Person
            | Self::Address
            | Self::IdentityDocument
            | Self::InternationalAccount
            | Self::DomesticAccount
            | Self::CreditCard => SecretCategory::PersonalData,
        }
    }
}

/// Opaque on-disk payload — user secrets are age-armored YAML; auth/join/member rows use JSON or nested armor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, tsify::Tsify)]
#[tsify(type = "string")]
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

/// An explicit secret tag or the historical untyped record representation.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum RecordTypeDeclaration {
    Secret(SecretType),
    #[default]
    Undeclared,
}

impl RecordTypeDeclaration {
    pub fn is_undeclared(&self) -> bool {
        matches!(self, Self::Undeclared)
    }
}

/// One record on disk — label is plaintext, `value` is an opaque encrypted or JSON payload.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, tsify::Tsify)]
pub struct StoredSecretRecord {
    #[serde(rename = "id")]
    pub key: SecretId,
    #[serde(
        rename = "type",
        default,
        skip_serializing_if = "RecordTypeDeclaration::is_undeclared"
    )]
    // Preserve the existing optional scalar TS wire field; the Rust state is explicit.
    #[tsify(optional, type = "SecretTypeWire")]
    pub secret_type: RecordTypeDeclaration,
    #[serde(rename = "data")]
    pub value: StoredRecordPayload,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::AgeArmoredCiphertext;

    #[test]
    fn secret_type_parse_display_and_serde_roundtrip() -> anyhow::Result<()> {
        let cases = [
            ("login", SecretType::Login),
            ("api-key", SecretType::ApiKey),
            ("seed-phrase", SecretType::SeedPhrase),
            ("secure-note", SecretType::SecureNote),
            ("passkey", SecretType::Passkey),
            ("authenticator", SecretType::Authenticator),
            ("credit-card", SecretType::CreditCard),
            ("file-attachment", SecretType::FileAttachment),
            ("person", SecretType::Person),
            ("address", SecretType::Address),
            ("identity-document", SecretType::IdentityDocument),
            ("international-account", SecretType::InternationalAccount),
            ("domestic-account", SecretType::DomesticAccount),
        ];
        for (tag, expected) in cases {
            assert_eq!(SecretType::parse(tag)?, expected);
            assert_eq!(expected.as_str(), tag);
            let encoded = serde_json::to_string(&expected)?;
            assert_eq!(serde_json::from_str::<SecretType>(&encoded)?, expected);
        }
        assert!(SecretType::parse("totp").is_err());
        assert!(SecretType::parse("identity_document").is_err());
        assert!(SecretType::parse("bank-account").is_err());
        Ok(())
    }

    #[test]
    fn secret_type_category_splits_personal_data_from_secrets() -> anyhow::Result<()> {
        let personal = [
            SecretType::Person,
            SecretType::Address,
            SecretType::IdentityDocument,
            SecretType::InternationalAccount,
            SecretType::DomesticAccount,
            SecretType::CreditCard,
        ];
        let secrets = [
            SecretType::Login,
            SecretType::ApiKey,
            SecretType::SeedPhrase,
            SecretType::SecureNote,
            SecretType::Passkey,
            SecretType::Authenticator,
            SecretType::FileAttachment,
        ];
        for secret_type in personal {
            assert_eq!(secret_type.category(), SecretCategory::PersonalData);
        }
        for secret_type in secrets {
            assert_eq!(secret_type.category(), SecretCategory::Secrets);
        }
        assert_eq!(
            serde_json::to_string(&SecretCategory::PersonalData)?,
            "\"personal-data\""
        );
        assert_eq!(
            serde_json::from_str::<SecretCategory>("\"secrets\"")?,
            SecretCategory::Secrets
        );
        Ok(())
    }

    #[test]
    fn stored_record_payload_wraps_trusted_and_armored_values() -> anyhow::Result<()> {
        let trusted = StoredRecordPayload::from_trusted("opaque-json".to_owned());
        assert_eq!(trusted.as_str(), "opaque-json");
        assert_eq!(trusted.as_ref(), "opaque-json");
        assert_eq!(trusted.to_string(), "opaque-json");
        assert_eq!(trusted.clone().into_inner(), "opaque-json");

        let armor = "-----BEGIN AGE ENCRYPTED FILE-----\nabc\n-----END AGE ENCRYPTED FILE-----";
        let armored = AgeArmoredCiphertext::parse(armor)?;
        let payload = StoredRecordPayload::from_age_armored(armored);
        assert_eq!(payload.as_str(), armor);
        Ok(())
    }

    #[test]
    fn stored_secret_record_uses_disk_field_names() -> anyhow::Result<()> {
        let record = StoredSecretRecord {
            key: SecretId::from_vault_record("secret_token001"),
            secret_type: RecordTypeDeclaration::Secret(SecretType::ApiKey),
            value: StoredRecordPayload::from_trusted("ciphertext".to_owned()),
        };

        let encoded = serde_json::to_value(&record)?;
        assert!(encoded.get("id").is_some());
        assert!(encoded.get("type").is_some());
        assert!(encoded.get("data").is_some());

        let decoded: StoredSecretRecord = serde_json::from_value(encoded)?;
        assert_eq!(decoded, record);

        let auth_row = StoredSecretRecord {
            key: SecretId::from_vault_record("auth:key"),
            secret_type: RecordTypeDeclaration::Undeclared,
            value: StoredRecordPayload::from_trusted("{}".to_owned()),
        };
        let encoded_auth_row = serde_json::to_value(&auth_row)?;
        assert!(encoded_auth_row.get("type").is_none());
        assert_eq!(
            serde_json::from_value::<StoredSecretRecord>(encoded_auth_row)?,
            auth_row
        );
        let explicit_null = serde_json::json!({"id": "auth:key", "type": null, "data": "{}"});
        assert_eq!(
            serde_json::from_value::<StoredSecretRecord>(explicit_null)?,
            auth_row
        );
        let unknown_type = serde_json::json!({"id": "auth:key", "type": "unknown", "data": "{}"});
        assert!(serde_json::from_value::<StoredSecretRecord>(unknown_type).is_err());
        Ok(())
    }
}
