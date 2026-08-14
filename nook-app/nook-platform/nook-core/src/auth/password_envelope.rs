//! Compatibility exports for password-backed vault key envelopes.

pub use nook_auth2::{
    PASSWORD_MIN_LENGTH, PASSWORD_SCRYPT_LOG_N, PasswordEnvelope, PasswordUnlockEntry, VaultUnlock,
    attach_password_envelope, attach_password_envelope_with_work_factor, create_password_entry,
    create_password_entry_with_work_factor, is_vault_password_long_enough,
    is_vault_password_recommended_length, resolve_keys_from_entry, resolve_keys_from_password,
    vault_password_min_length, vault_password_recommended_min_length, verify_password,
    verify_password_entry,
};
