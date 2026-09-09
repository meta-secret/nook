#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

//! Prefixed vault identifiers (`store_`, `secret_`, `key_`) for typed on-disk ids.

use crate::errors::{MultiDeviceResult, ValidationError, ValidationResult};
use serde::{Deserialize, Serialize};
use std::fmt;

pub const STORE_ID_PREFIX: &str = "store_";
pub const SECRET_ID_PREFIX: &str = "secret_";
pub const AUTH_KEY_ID_PREFIX: &str = "key_";

const AUTH_DIGEST_LEN: usize = 64;

/// Compact random token suffix (`generate_id` — 11 chars, base64url).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct CompactToken(String);

impl CompactToken {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let token = raw.trim();
        if !Self::is_valid(token) {
            return Err(ValidationError::StoreIdInvalid);
        }
        Ok(Self(token.to_owned()))
    }

    #[must_use]
    pub fn is_valid(token: &str) -> bool {
        token.len() == 11
            && token
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(self) -> String {
        self.0
    }
}

impl fmt::Display for CompactToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl AsRef<str> for CompactToken {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

/// Short app-key fingerprint (16 hex chars — first 8 bytes of SHA256).
///
/// Historical name was `DeviceId`. New code must use [`AppId`].
#[derive(
    Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, tsify::Tsify,
)]
#[tsify(type = "string")]
#[serde(transparent)]
pub struct AppId(String);

/// Migration alias for [`AppId`].
#[tsify::declare]
pub type DeviceId = AppId;

impl AppId {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let id = raw.trim();
        if !Self::is_valid(id) {
            return Err(ValidationError::DeviceIdInvalid);
        }
        Ok(Self(id.to_owned()))
    }

    #[must_use]
    pub fn is_valid(id: &str) -> bool {
        id.len() == 16 && id.bytes().all(|byte| byte.is_ascii_hexdigit())
    }

    #[must_use]
    pub(crate) fn from_sha256_prefix(prefix: [u8; 8]) -> Self {
        Self(hex::encode(prefix))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(self) -> String {
        self.0
    }
}

impl fmt::Display for AppId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl AsRef<str> for AppId {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

/// Vault store identifier (`store_{compact_token}`).
#[derive(
    Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, tsify::Tsify,
)]
#[tsify(type = "string")]
#[serde(transparent)]
pub struct StoreId(String);

impl StoreId {
    #[must_use]
    pub fn before_genesis_placeholder() -> Self {
        Self("store_abcdefghijk".to_owned())
    }

    #[must_use]
    pub fn from_token(token: &CompactToken) -> Self {
        Self(format!("{STORE_ID_PREFIX}{}", token.as_str()))
    }

    pub fn from_raw_token(raw: &str) -> ValidationResult<Self> {
        let token = CompactToken::parse(raw)?;
        if AppId::parse(token.as_str()).is_ok() {
            return Err(ValidationError::StoreIdReserved);
        }
        Ok(Self::from_token(&token))
    }

    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let trimmed = raw.trim();
        match trimmed.strip_prefix(STORE_ID_PREFIX) {
            Some(token) => Self::from_raw_token(token),
            None => Self::from_raw_token(trimmed),
        }
    }

    pub fn generate() -> MultiDeviceResult<Self> {
        Ok(Self::from_raw_token(CompactToken::generate()?.as_str())?)
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(self) -> String {
        self.0
    }
}

impl fmt::Display for StoreId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl AsRef<str> for StoreId {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

/// On-disk secret label — prefixed compact id or legacy human label (e.g. `github.com`).
#[derive(
    Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, tsify::Tsify,
)]
#[tsify(type = "string")]
#[serde(transparent)]
pub struct SecretId(String);

impl SecretId {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Err(ValidationError::SecretIdRequired);
        }
        let token = trimmed
            .strip_prefix(SECRET_ID_PREFIX)
            .ok_or(ValidationError::SecretIdInvalid)?;
        if !CompactToken::is_valid(token) {
            return Err(ValidationError::SecretIdInvalid);
        }
        if AppId::parse(token).is_ok() || AuthKeyId::is_valid(trimmed) {
            return Err(ValidationError::SecretIdReserved);
        }
        Ok(Self(format!("{SECRET_ID_PREFIX}{token}")))
    }

    pub fn from_token(token: &CompactToken) -> ValidationResult<Self> {
        Ok(Self(format!("{SECRET_ID_PREFIX}{}", token.as_str())))
    }

    pub fn from_raw_token(raw: &str) -> ValidationResult<Self> {
        Self::from_token(&CompactToken::parse(raw)?)
    }

    pub fn generate() -> MultiDeviceResult<Self> {
        Ok(Self::from_raw_token(CompactToken::generate()?.as_str())?)
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(self) -> String {
        self.0
    }

    /// On-disk vault row label (user secret, auth, join, or member key).
    #[must_use]
    pub fn from_vault_record(raw: &str) -> Self {
        Self(raw.to_owned())
    }
}

impl fmt::Display for SecretId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl AsRef<str> for SecretId {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

/// Device auth key identifier (`key_{sha256_hex}`).
#[derive(
    Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, tsify::Tsify,
)]
#[tsify(type = "string")]
#[serde(transparent)]
pub struct AuthKeyId(String);

impl AuthKeyId {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let trimmed = raw.trim();
        let digest = Self::digest_from(trimmed)?;
        Self::from_digest_hex(digest)
    }

    pub fn from_digest_hex(digest_hex: &str) -> ValidationResult<Self> {
        if !Self::is_digest(digest_hex) {
            return Err(ValidationError::AuthKeyIdInvalid);
        }
        Ok(Self(format!("{AUTH_KEY_ID_PREFIX}{digest_hex}")))
    }

    #[must_use]
    pub(crate) fn from_sha256_digest(digest: &[u8; 32]) -> Self {
        Self(format!("{AUTH_KEY_ID_PREFIX}{}", hex::encode(digest)))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn digest(&self) -> ValidationResult<&str> {
        Self::digest_from(self.as_str())
    }

    #[must_use]
    pub fn is_valid(id: &str) -> bool {
        Self::digest_from(id).is_ok()
    }

    pub fn digest_from(id: &str) -> ValidationResult<&str> {
        let digest = id
            .strip_prefix(AUTH_KEY_ID_PREFIX)
            .ok_or(ValidationError::AuthKeyIdInvalid)?;
        if !Self::is_digest(digest) {
            return Err(ValidationError::AuthKeyIdInvalid);
        }
        Ok(digest)
    }

    fn is_digest(digest: &str) -> bool {
        digest.len() == AUTH_DIGEST_LEN && digest.bytes().all(|byte| byte.is_ascii_hexdigit())
    }

    #[must_use]
    pub fn into_inner(self) -> String {
        self.0
    }
}

impl fmt::Display for AuthKeyId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl AsRef<str> for AuthKeyId {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "Abcdef_1234";
    const DEVICE_ID: &str = "0123456789abcdef";
    const DIGEST: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    #[test]
    fn compact_token_and_device_id_validate_expected_shapes() -> anyhow::Result<()> {
        let token = CompactToken::parse(TOKEN)?;
        assert_eq!(token.as_str(), TOKEN);
        assert_eq!(token.as_ref(), TOKEN);
        assert_eq!(token.to_string(), TOKEN);
        assert_eq!(token.clone().into_inner(), TOKEN);
        assert!(CompactToken::parse("too-short").is_err());
        assert!(CompactToken::parse("has/slash11").is_err());

        let device_id = DeviceId::parse(DEVICE_ID)?;
        assert_eq!(device_id.as_str(), DEVICE_ID);
        assert_eq!(device_id.as_ref(), DEVICE_ID);
        assert_eq!(device_id.to_string(), DEVICE_ID);
        assert_eq!(device_id.clone().into_inner(), DEVICE_ID);
        assert!(AppId::is_valid(DEVICE_ID));
        assert!(!AppId::is_valid("not-a-device"));
        Ok(())
    }

    #[test]
    fn store_ids_normalize_tokens_and_reject_reserved_device_ids() -> anyhow::Result<()> {
        let token = CompactToken::parse(TOKEN)?;
        let store = StoreId::from_token(&token);
        assert_eq!(store.as_str(), "store_Abcdef_1234");
        assert_eq!(store.as_ref(), store.as_str());
        assert_eq!(store.to_string(), store.as_str());
        assert_eq!(store.clone().into_inner(), store.as_str());

        assert_eq!(StoreId::from_raw_token(TOKEN)?, store);
        assert_eq!(StoreId::parse(TOKEN)?, store);
        assert_eq!(StoreId::parse(" store_Abcdef_1234 ")?, store);
        assert_eq!(StoreId::parse(store.as_str())?, store);
        assert!(StoreId::from_raw_token(DEVICE_ID).is_err());
        assert!(StoreId::parse("store_not-valid!").is_err());
        assert!(StoreId::generate()?.as_str().starts_with(STORE_ID_PREFIX));
        Ok(())
    }

    #[test]
    fn auth_key_ids_require_the_current_prefixed_format() -> anyhow::Result<()> {
        let auth = AuthKeyId::from_digest_hex(DIGEST)?;
        assert_eq!(auth.as_str(), format!("key_{DIGEST}"));
        assert_eq!(auth.digest()?, DIGEST);
        assert_eq!(auth.as_ref(), auth.as_str());
        assert_eq!(auth.to_string(), auth.as_str());
        assert_eq!(auth.clone().into_inner(), auth.as_str());

        assert_eq!(AuthKeyId::from_digest_hex(DIGEST)?, auth);
        assert!(AuthKeyId::parse(DIGEST).is_err());
        assert_eq!(AuthKeyId::parse(&format!(" key_{DIGEST} "))?, auth);
        assert_eq!(auth.digest()?, DIGEST);
        assert!(AuthKeyId::digest_from(DIGEST).is_err());
        assert!(AuthKeyId::is_valid(auth.as_str()));
        assert!(AuthKeyId::from_digest_hex("not-hex").is_err());
        Ok(())
    }

    #[test]
    fn secret_ids_require_the_current_prefixed_format() -> anyhow::Result<()> {
        let token = CompactToken::parse(TOKEN)?;
        let secret = SecretId::from_token(&token)?;
        assert_eq!(secret.as_str(), "secret_Abcdef_1234");
        assert_eq!(secret.as_ref(), secret.as_str());
        assert_eq!(secret.to_string(), secret.as_str());
        assert_eq!(secret.clone().into_inner(), secret.as_str());

        assert_eq!(SecretId::from_raw_token(TOKEN)?, secret);
        assert_eq!(SecretId::parse(secret.as_str())?, secret);
        assert!(SecretId::parse("pass_Abcdef_1234").is_err());
        assert!(SecretId::parse(TOKEN).is_err());
        assert!(SecretId::parse("github.com").is_err());
        assert_eq!(SecretId::from_vault_record("auth:key").as_str(), "auth:key");
        assert!(SecretId::parse("").is_err());
        assert!(SecretId::parse(DEVICE_ID).is_err());
        assert!(SecretId::parse(DIGEST).is_err());
        assert!(SecretId::parse("store_Abcdef_1234").is_err());
        assert!(SecretId::generate()?.as_str().starts_with(SECRET_ID_PREFIX));
        Ok(())
    }
}
