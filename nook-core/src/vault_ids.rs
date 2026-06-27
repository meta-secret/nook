//! Prefixed vault identifiers (`store_`, `pass_`, `key_`) for typed on-disk ids.

use crate::{generate_id, is_device_id};

pub const STORE_ID_PREFIX: &str = "store_";
pub const SECRET_ID_PREFIX: &str = "pass_";
pub const AUTH_KEY_ID_PREFIX: &str = "key_";

const AUTH_DIGEST_LEN: usize = 64;

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

pub fn format_auth_key_id(digest_hex: &str) -> Result<String, String> {
    if !is_auth_digest(digest_hex) {
        return Err("errors.validation.auth_key_id_invalid".to_owned());
    }
    Ok(format!("{AUTH_KEY_ID_PREFIX}{digest_hex}"))
}

pub fn normalize_auth_key_id(id: &str) -> Result<String, String> {
    let trimmed = id.trim();
    if let Some(digest) = trimmed.strip_prefix(AUTH_KEY_ID_PREFIX) {
        return format_auth_key_id(digest);
    }
    format_auth_key_id(trimmed)
}

pub fn format_store_id(token: &str) -> Result<String, String> {
    if !is_compact_token(token) {
        return Err("errors.validation.store_id_invalid".to_owned());
    }
    if is_device_id(token) {
        return Err("errors.validation.store_id_reserved".to_owned());
    }
    Ok(format!("{STORE_ID_PREFIX}{token}"))
}

pub fn normalize_store_id(id: &str) -> Result<String, String> {
    let trimmed = id.trim();
    if let Some(token) = trimmed.strip_prefix(STORE_ID_PREFIX) {
        return format_store_id(token);
    }
    format_store_id(trimmed)
}

pub fn generate_store_id() -> Result<String, String> {
    format_store_id(&generate_id()?)
}

pub fn format_secret_id(token: &str) -> Result<String, String> {
    if !is_compact_token(token) {
        return Err("errors.validation.secret_id_invalid".to_owned());
    }
    Ok(format!("{SECRET_ID_PREFIX}{token}"))
}

pub fn generate_secret_id() -> Result<String, String> {
    format_secret_id(&generate_id()?)
}

/// Accept prefixed compact ids and legacy human labels (e.g. `github.com`).
pub fn validate_secret_id(id: &str) -> Result<String, String> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return Err("errors.validation.secret_id_required".to_owned());
    }
    if let Some(token) = trimmed.strip_prefix(SECRET_ID_PREFIX) {
        if !is_compact_token(token) {
            return Err("errors.validation.secret_id_invalid".to_owned());
        }
        if is_device_id(token) || is_auth_key_id(trimmed) {
            return Err("errors.validation.secret_id_reserved".to_owned());
        }
        return Ok(format!("{SECRET_ID_PREFIX}{token}"));
    }
    if is_device_id(trimmed) || is_auth_key_id(trimmed) || trimmed.starts_with(STORE_ID_PREFIX) {
        return Err("errors.validation.secret_id_reserved".to_owned());
    }
    Ok(trimmed.to_owned())
}

/// On write: legacy labels stay as-is; bare compact tokens gain `pass_`.
pub fn normalize_secret_id_for_write(id: &str) -> Result<String, String> {
    let trimmed = id.trim();
    if trimmed.starts_with(SECRET_ID_PREFIX) {
        return validate_secret_id(trimmed);
    }
    if is_compact_token(trimmed) {
        return format_secret_id(trimmed);
    }
    validate_secret_id(trimmed)
}

pub fn validate_store_id(id: &str) -> Result<String, String> {
    normalize_store_id(id)
}
