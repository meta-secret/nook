//! Compatibility exports for password-backed vault key envelopes.

pub use nook_auth2::{
    PASSWORD_MIN_LENGTH, PASSWORD_SCRYPT_LOG_N, PasswordEntryIssuance, PasswordEntryResolution,
    PasswordEnvelope, PasswordEnvelopeAttachment, PasswordEnvelopeResolution,
    PasswordEnvelopeRewrap, PasswordEnvelopeVersion, PasswordUnlockEntry, VaultUnlock,
    is_vault_password_long_enough, is_vault_password_recommended_length, vault_password_min_length,
    vault_password_recommended_min_length,
};
