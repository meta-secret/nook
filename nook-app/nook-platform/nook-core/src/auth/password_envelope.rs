//! Compatibility exports for password-backed vault key envelopes.

pub use nook_auth2::{
    PASSWORD_MIN_LENGTH, PASSWORD_SCRYPT_LOG_N, PasswordEntryIssuance, PasswordEntryResolution,
    PasswordEnvelope, PasswordEnvelopeAttachment, PasswordEnvelopeResolution,
    PasswordEnvelopeRewrap, PasswordEnvelopeVersion, PasswordPolicy, PasswordUnlockEntry,
    VaultUnlock,
};
