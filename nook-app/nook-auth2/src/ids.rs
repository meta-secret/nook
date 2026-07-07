//! Prefixed vault identifiers (`store_`, `secret_`, `key_`) for typed on-disk ids.

use crate::errors::{MultiDeviceResult, ValidationError, ValidationResult};
use crate::generate_id;
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
        if !is_compact_token(token) {
            return Err(ValidationError::StoreIdInvalid);
        }
        Ok(Self(token.to_owned()))
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

/// Short device fingerprint (16 hex chars — first 8 bytes of SHA256).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct DeviceId(String);

impl DeviceId {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let id = raw.trim();
        if id.len() != 16 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(ValidationError::DeviceIdInvalid);
        }
        Ok(Self(id.to_owned()))
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

impl fmt::Display for DeviceId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl AsRef<str> for DeviceId {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

/// Vault store identifier (`store_{compact_token}`).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct StoreId(String);

impl StoreId {
    #[must_use]
    pub fn from_token(token: &CompactToken) -> Self {
        Self(format!("{STORE_ID_PREFIX}{}", token.as_str()))
    }

    pub fn parse(raw: &str) -> ValidationResult<Self> {
        normalize_store_id(raw)
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
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SecretId(String);

impl SecretId {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        validate_secret_id(raw)
    }

    pub fn from_token(token: &CompactToken) -> ValidationResult<Self> {
        format_secret_id(token.as_str())
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

/// Device auth key identifier (`key_{sha256_hex}` or legacy bare 64-hex digest).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct AuthKeyId(String);

impl AuthKeyId {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        normalize_auth_key_id(raw)
    }

    pub fn from_digest_hex(digest_hex: &str) -> ValidationResult<Self> {
        format_auth_key_id(digest_hex)
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn digest(&self) -> &str {
        auth_key_digest(self.as_str()).unwrap_or(self.as_str())
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

/// Random token suffix (`generate_id` — 11 chars, base64url).
#[must_use]
pub fn is_compact_token(token: &str) -> bool {
    token.len() == 11
        && token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn is_auth_digest(digest: &str) -> bool {
    digest.len() == AUTH_DIGEST_LEN && digest.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// `key_{sha256_hex}` or legacy bare 64-hex digest.
#[must_use]
pub fn is_auth_key_id(id: &str) -> bool {
    auth_key_digest(id).is_some()
}

#[must_use]
pub fn auth_key_digest(id: &str) -> Option<&str> {
    if let Some(digest) = id.strip_prefix(AUTH_KEY_ID_PREFIX) {
        return is_auth_digest(digest).then_some(digest);
    }
    is_auth_digest(id).then_some(id)
}

pub fn format_auth_key_id(digest_hex: &str) -> ValidationResult<AuthKeyId> {
    if !is_auth_digest(digest_hex) {
        return Err(ValidationError::AuthKeyIdInvalid);
    }
    Ok(AuthKeyId(format!("{AUTH_KEY_ID_PREFIX}{digest_hex}")))
}

pub fn normalize_auth_key_id(id: &str) -> ValidationResult<AuthKeyId> {
    let trimmed = id.trim();
    if let Some(digest) = trimmed.strip_prefix(AUTH_KEY_ID_PREFIX) {
        return format_auth_key_id(digest);
    }
    format_auth_key_id(trimmed)
}

pub fn format_store_id(token: &str) -> ValidationResult<StoreId> {
    let token = CompactToken::parse(token)?;
    if DeviceId::parse(token.as_str()).is_ok() {
        return Err(ValidationError::StoreIdReserved);
    }
    Ok(StoreId::from_token(&token))
}

pub fn normalize_store_id(id: &str) -> ValidationResult<StoreId> {
    let trimmed = id.trim();
    if let Some(token) = trimmed.strip_prefix(STORE_ID_PREFIX) {
        return format_store_id(token);
    }
    format_store_id(trimmed)
}

pub fn generate_store_id() -> MultiDeviceResult<StoreId> {
    Ok(format_store_id(generate_id()?.as_str())?)
}

pub fn format_secret_id(token: &str) -> ValidationResult<SecretId> {
    let token = CompactToken::parse(token)?;
    Ok(SecretId(format!("{SECRET_ID_PREFIX}{}", token.as_str())))
}

pub fn generate_secret_id() -> MultiDeviceResult<SecretId> {
    Ok(format_secret_id(generate_id()?.as_str())?)
}

/// Accept prefixed compact ids and legacy human labels (e.g. `github.com`).
pub fn validate_secret_id(id: &str) -> ValidationResult<SecretId> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return Err(ValidationError::SecretIdRequired);
    }
    if let Some(token) = trimmed.strip_prefix(SECRET_ID_PREFIX) {
        if !is_compact_token(token) {
            return Err(ValidationError::SecretIdInvalid);
        }
        if DeviceId::parse(token).is_ok() || is_auth_key_id(trimmed) {
            return Err(ValidationError::SecretIdReserved);
        }
        return Ok(SecretId(format!("{SECRET_ID_PREFIX}{token}")));
    }
    // Brief rollout alias — normalize to `secret_` on read.
    if let Some(token) = trimmed.strip_prefix("pass_")
        && is_compact_token(token)
    {
        return format_secret_id(token);
    }
    if DeviceId::parse(trimmed).is_ok()
        || is_auth_key_id(trimmed)
        || trimmed.starts_with(STORE_ID_PREFIX)
    {
        return Err(ValidationError::SecretIdReserved);
    }
    Ok(SecretId(trimmed.to_owned()))
}

/// On write: legacy labels stay as-is; bare compact tokens gain `secret_`.
pub fn normalize_secret_id_for_write(id: &str) -> ValidationResult<SecretId> {
    let trimmed = id.trim();
    if trimmed.starts_with(SECRET_ID_PREFIX) {
        return validate_secret_id(trimmed);
    }
    if is_compact_token(trimmed) {
        return format_secret_id(trimmed);
    }
    validate_secret_id(trimmed)
}

pub fn validate_store_id(id: &str) -> ValidationResult<StoreId> {
    normalize_store_id(id)
}

#[must_use]
pub fn is_device_id(key: &str) -> bool {
    DeviceId::parse(key).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "Abcdef_1234";
    const DEVICE_ID: &str = "0123456789abcdef";
    const DIGEST: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    #[test]
    fn compact_token_and_device_id_validate_expected_shapes() {
        let token = CompactToken::parse(TOKEN).unwrap();
        assert_eq!(token.as_str(), TOKEN);
        assert_eq!(token.as_ref(), TOKEN);
        assert_eq!(token.to_string(), TOKEN);
        assert_eq!(token.clone().into_inner(), TOKEN);
        assert!(CompactToken::parse("too-short").is_err());
        assert!(CompactToken::parse("has/slash11").is_err());

        let device_id = DeviceId::parse(DEVICE_ID).unwrap();
        assert_eq!(device_id.as_str(), DEVICE_ID);
        assert_eq!(device_id.as_ref(), DEVICE_ID);
        assert_eq!(device_id.to_string(), DEVICE_ID);
        assert_eq!(device_id.clone().into_inner(), DEVICE_ID);
        assert!(is_device_id(DEVICE_ID));
        assert!(!is_device_id("not-a-device"));
    }

    #[test]
    fn store_ids_normalize_tokens_and_reject_reserved_device_ids() {
        let token = CompactToken::parse(TOKEN).unwrap();
        let store = StoreId::from_token(&token);
        assert_eq!(store.as_str(), "store_Abcdef_1234");
        assert_eq!(store.as_ref(), store.as_str());
        assert_eq!(store.to_string(), store.as_str());
        assert_eq!(store.clone().into_inner(), store.as_str());

        assert_eq!(format_store_id(TOKEN).unwrap(), store);
        assert_eq!(normalize_store_id(TOKEN).unwrap(), store);
        assert_eq!(normalize_store_id(" store_Abcdef_1234 ").unwrap(), store);
        assert_eq!(validate_store_id(store.as_str()).unwrap(), store);
        assert!(format_store_id(DEVICE_ID).is_err());
        assert!(normalize_store_id("store_not-valid!").is_err());
        assert!(
            generate_store_id()
                .unwrap()
                .as_str()
                .starts_with(STORE_ID_PREFIX)
        );
    }

    #[test]
    fn auth_key_ids_normalize_prefixed_and_legacy_digests() {
        let auth = AuthKeyId::from_digest_hex(DIGEST).unwrap();
        assert_eq!(auth.as_str(), format!("key_{DIGEST}"));
        assert_eq!(auth.digest(), DIGEST);
        assert_eq!(auth.as_ref(), auth.as_str());
        assert_eq!(auth.to_string(), auth.as_str());
        assert_eq!(auth.clone().into_inner(), auth.as_str());

        assert_eq!(format_auth_key_id(DIGEST).unwrap(), auth);
        assert_eq!(normalize_auth_key_id(DIGEST).unwrap(), auth);
        assert_eq!(
            normalize_auth_key_id(&format!(" key_{DIGEST} ")).unwrap(),
            auth
        );
        assert_eq!(auth_key_digest(auth.as_str()), Some(DIGEST));
        assert_eq!(auth_key_digest(DIGEST), Some(DIGEST));
        assert!(is_auth_key_id(auth.as_str()));
        assert!(format_auth_key_id("not-hex").is_err());
    }

    #[test]
    fn secret_ids_accept_legacy_labels_and_reject_reserved_rows() {
        let token = CompactToken::parse(TOKEN).unwrap();
        let secret = SecretId::from_token(&token).unwrap();
        assert_eq!(secret.as_str(), "secret_Abcdef_1234");
        assert_eq!(secret.as_ref(), secret.as_str());
        assert_eq!(secret.to_string(), secret.as_str());
        assert_eq!(secret.clone().into_inner(), secret.as_str());

        assert_eq!(format_secret_id(TOKEN).unwrap(), secret);
        assert_eq!(validate_secret_id(secret.as_str()).unwrap(), secret);
        assert_eq!(validate_secret_id("pass_Abcdef_1234").unwrap(), secret);
        assert_eq!(normalize_secret_id_for_write(TOKEN).unwrap(), secret);
        assert_eq!(
            normalize_secret_id_for_write("github.com")
                .unwrap()
                .as_str(),
            "github.com"
        );
        assert_eq!(SecretId::from_vault_record("auth:key").as_str(), "auth:key");
        assert!(validate_secret_id("").is_err());
        assert!(validate_secret_id(DEVICE_ID).is_err());
        assert!(validate_secret_id(DIGEST).is_err());
        assert!(validate_secret_id("store_Abcdef_1234").is_err());
        assert!(
            generate_secret_id()
                .unwrap()
                .as_str()
                .starts_with(SECRET_ID_PREFIX)
        );
    }
}
