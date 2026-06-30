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
    Ok(format_store_id(&generate_id()?)?)
}

pub fn format_secret_id(token: &str) -> ValidationResult<SecretId> {
    let token = CompactToken::parse(token)?;
    Ok(SecretId(format!("{SECRET_ID_PREFIX}{}", token.as_str())))
}

pub fn generate_secret_id() -> MultiDeviceResult<SecretId> {
    Ok(format_secret_id(&generate_id()?)?)
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
