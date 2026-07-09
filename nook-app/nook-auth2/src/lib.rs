#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::uninlined_format_args
)]

//! Portable vault authentication and key-access primitives.
//!
//! This crate owns the browser-independent security layer for Nook vaults:
//! device identities, passkey-PRF wrapping after the platform ceremony,
//! password envelopes, member authorization rows, and the vault key material
//! those mechanisms resolve. Storage providers and replication stay outside
//! this crate.

pub mod errors;

mod auth;
mod crypto;
mod ids;
mod records;
mod wire;

pub use auth::device_key_protection::{
    DeviceKeyProtectionSetup, PasskeyAssertionRequest, PasskeyDeviceIdentityMaterial,
    PasskeyDeviceProtectionMode, PasskeyRecoveryRequest, PasskeyRegistrationResolution,
    WrappedDeviceIdentity, derive_device_identity_from_passkey_prf,
    deterministic_passkey_prf_input, finish_passkey_device_identity,
    finish_passkey_device_identity_for_mode, finish_passkey_wrapped_device_identity,
    parse_wrapped_device_identity, passkey_assertion_request,
    passkey_derived_device_identity_record, passkey_recovery_request,
    passkey_wrapped_device_identity_record, recover_passkey_device_identity,
    resolve_passkey_registration, serialize_wrapped_device_identity,
    unlock_passkey_device_identity, unwrap_device_identity_with_pin, wrap_device_identity_with_pin,
};
pub use auth::enrollment::{
    DecryptedEnrollmentPayload, EnrollmentCodeEnvelope, EnrollmentIssueInput, EnrollmentProvider,
    build_enrollment_link, decrypt_enrollment_payload, encrypt_enrollment_payload,
    normalize_enrollment_code, parse_enrollment_envelope, peek_enrollment_entry_id,
    peek_enrollment_entry_label, peek_enrollment_issued_at,
};
#[cfg(any(test, feature = "mock-passkey"))]
pub use auth::mock_passkey::{
    MemoryPasskeyAuthenticator, MockPasskeyAssertion, MockPasskeyAssertionRequest,
    MockPasskeyError, MockPasskeyRegistration, MockPasskeyRegistrationRequest, MockPasskeyResult,
    MockPasskeyUserAuthorization, StoredMockPasskey,
};
pub use auth::multi_device::{
    AuthEnvelopes, ConnectAccessStatus, DeviceIdentity, JoinRequest, MEMBER_RECORD_PREFIX,
    MemberEntry, NEXUS_SHARE_RECORD_PREFIX, NexusShareEnvelope, OpenedNexusShare, VaultKeys,
    VaultMember, VaultMetaRecord, VaultMetaState, approve_join_request, assess_connect_access,
    auth_record, build_members_records, count_nexus_share_records, create_join_request_record,
    create_join_request_record_with_signing_key, create_nexus_share_records,
    create_nexus_share_records_for_recipients, dec_auth_id, dec_auth_id_from_public_key,
    deny_join_request, device_is_enrolled, encrypt_for_recipient, encrypt_member_entry,
    enroll_device_with_dec, enroll_device_with_keys, ensure_self_in_roster,
    explain_connect_blocked, generate_dec, generate_id, generate_symmetric_key,
    generate_vault_keys, genesis_auth_record, genesis_dec_record, genesis_members_records,
    is_auth_id, is_auth_stored_record, is_dec_stored_record, is_join_stored_record,
    is_members_stored_record, is_nexus_share_stored_record, is_reserved_device_label,
    is_vault_meta_record, join_record_key, list_join_requests, member_from_identity,
    member_from_join, member_stored_key, merge_remote_join_records, nexus_share_record_key,
    open_nexus_share_for_identity, parse_auth_envelopes, parse_join_request,
    parse_nexus_share_envelope, pending_join_for_device, reconstruct_nexus_vault_keys,
    reconstruct_nexus_vault_keys_from_opened, rename_vault_member, replace_member_records,
    resolve_dec, resolve_dek, resolve_member_roster, resolve_members_key, resolve_secrets_key,
    revoke_vault_member, roster_add_member, user_stored_records, vault_has_multi_device_records,
};
pub use auth::password_envelope::{
    LEGACY_PASSWORD_ENTRY_LABEL, PASSWORD_MIN_LENGTH, PASSWORD_SCRYPT_LOG_N, PasswordEnvelope,
    PasswordUnlockEntry, VaultUnlock, attach_password_envelope,
    attach_password_envelope_with_work_factor, create_password_entry,
    create_password_entry_with_work_factor, is_vault_password_long_enough,
    is_vault_password_recommended_length, resolve_keys_from_entry, resolve_keys_from_password,
    vault_password_min_length, vault_password_recommended_min_length, verify_password,
    verify_password_entry,
};
pub use crypto::vault_crypto::VaultCrypto;
pub use errors::{
    AgeCryptoError, DeviceKeyProtectionError, DeviceKeyProtectionResult, EnrollmentError,
    EnrollmentResult, MultiDeviceError, MultiDeviceResult, PasswordError, PasswordResult,
    SecretPayloadError, SecretPayloadResult, ValidationError, ValidationResult, VaultCryptoError,
    VaultCryptoResult,
};
pub use ids::{
    AUTH_KEY_ID_PREFIX, AuthKeyId, CompactToken, DeviceId, SECRET_ID_PREFIX, STORE_ID_PREFIX,
    SecretId, StoreId, auth_key_digest, format_auth_key_id, format_secret_id, format_store_id,
    generate_secret_id, generate_store_id, is_auth_key_id, is_compact_token, is_device_id,
    normalize_auth_key_id, normalize_secret_id_for_write, normalize_store_id, validate_secret_id,
    validate_store_id,
};
pub use records::{SecretType, StoredRecordPayload, StoredSecretRecord};
pub use wire::{
    AgeArmoredCiphertext, DecryptedPlaintext, DeviceIdentitySecret, DevicePublicKey,
    DeviceSigningPublicKey, IsoTimestamp, MemberLabel, OpaqueCiphertext, PasswordEntryId,
    Sha256Hex, SigningSeedHex, SymmetricKey, Url64EncodedString,
};
