//! Compatibility exports for typed vault/security identifiers.

pub use nook_auth::{
    AUTH_KEY_ID_PREFIX, AuthKeyId, CompactToken, DeviceId, SECRET_ID_PREFIX, STORE_ID_PREFIX,
    SecretId, StoreId, auth_key_digest, format_auth_key_id, format_secret_id, format_store_id,
    generate_secret_id, generate_store_id, is_auth_key_id, is_compact_token, is_device_id,
    normalize_auth_key_id, normalize_secret_id_for_write, normalize_store_id, validate_secret_id,
    validate_store_id,
};
