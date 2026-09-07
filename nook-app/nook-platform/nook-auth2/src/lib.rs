#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_raw_numeric_api_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(raw_numeric_public_api))]
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
    AwaitingPasskeyAssertion, DeviceIdentityProtection, DeviceKeyProtectionSetup,
    DeviceKeyProtectionVersion, PasskeyAssertionRequest, PasskeyDeviceIdentityMaterial,
    PasskeyIdentityUnlock, PasskeyProtectionInput, PasskeyRecordMetadata, PasskeyRecoveryInput,
    PasskeyRecoveryRequest, PasskeyRegistration, PasskeyRegistrationInput,
    PasskeyRegistrationOutcome, PasskeyRegistrationPrfOutput, PasskeyRegistrationResolution,
    WebAuthnCredentialId, WebAuthnPrfInput, WebAuthnPrfOutput, WebAuthnUserHandle,
    WrappedDeviceIdentity,
};
pub use auth::enrollment::{
    CheckedEnrollmentEnvelope, CheckedEnrollmentIssuance, DecryptedEnrollmentPayload,
    EnrollmentCodeEnvelope, EnrollmentEmail, EnrollmentEntryLabel, EnrollmentIssuance,
    EnrollmentIssueInput, EnrollmentLinkInput, EnrollmentProvider, EnrollmentProviderDataRef,
    EnrollmentState, OAuthAccountIdentity, OAuthRefreshCredential, OAuthRemoteFile,
    OAuthTokenExpiry, PersonalCredentialTransfer, PersonalEnrollmentProvider,
    PersonalEnrollmentProviderData, SharedEnrollmentProvider, SharedEnrollmentProviderData,
    SharedProviderGrant, TypedEnrollmentProvider,
};
pub use auth::identity::{
    IdentityId, IdentityMember, IdentityRecord, IdentityVaultDek, IdentityVaultDekEpoch,
    IdentityVaultDekEpochUpdate, IdentityVaultDekReconciliation, MemberDekEnvelope,
    identity_fingerprint,
};
pub use auth::identity_directory::{IdentityDirectory, IdentitySelection};
pub use auth::identity_genesis::identity_vault_genesis_records;
pub use auth::local_identity_keyring::{
    LOCAL_IDENTITY_KEYRING_VERSION, LocalIdentityKeyring, LocalIdentityKeyringEntry,
};
#[cfg(any(test, feature = "mock-passkey"))]
pub use auth::mock_passkey::{
    MemoryPasskeyAuthenticator, MockPasskeyAssertion, MockPasskeyAssertionRequest,
    MockPasskeyError, MockPasskeyRegistration, MockPasskeyRegistrationRequest, MockPasskeyResult,
    MockPasskeyUserAuthorization, StoredMockPasskey,
};
pub use auth::{
    DeviceKeyDerivationIterations, EnrollmentKeyDerivationIterations, IdentityControlEpoch,
    MockPasskeyCredentialCount, PasswordCharacterCount, PasswordWorkFactor,
    SentinelParticipantCount, SentinelRecordCount, SentinelShareCount, SentinelShareIndex,
    SentinelThreshold,
};
pub use nook_authenticator_domain::PasskeyDeviceProtectionMode;
pub mod multi_device_api {
    pub use crate::auth::multi_device::{
        AppKey, AuthEnvelopes, ConnectAccessStatus, DeviceEnrollment, DeviceIdentity, JoinRequest,
        JoinRequestApproval, JoinRequestDenial, JoinRequestIssuance, MEMBER_RECORD_PREFIX,
        MemberEntry, OpenedSentinelShare, SENTINEL_SHARE_RECORD_PREFIX, SelfRosterSync,
        SentinelKeyReconstruction, SentinelParticipantEntry, SentinelShareEnvelope,
        SentinelShareOpening, SentinelShareVersion, VaultKeys, VaultMember, VaultMetaRecord,
        VaultMetaState, app_id_from_public_key, assess_connect_access, auth_record,
        build_members_records, count_sentinel_share_records,
        create_sentinel_root_share_records_for_recipients, create_sentinel_share_records,
        create_sentinel_share_records_for_recipients, dec_auth_id, dec_auth_id_from_public_key,
        device_id_from_public_key, device_is_enrolled, encrypt_member_entry, ensure_self_in_roster,
        generate_dec, generate_id, generate_symmetric_key, generate_vault_keys,
        genesis_auth_record, genesis_dec_record, genesis_members_records, is_auth_id,
        is_auth_stored_record, is_dec_stored_record, is_join_stored_record,
        is_members_stored_record, is_reserved_device_label, is_sentinel_share_stored_record,
        is_vault_meta_record, join_record_key, list_join_requests, member_from_identity,
        member_from_join, member_stored_key, merge_remote_join_records, parse_auth_envelopes,
        parse_join_request, parse_sentinel_share_envelope, pending_join_for_device,
        rename_vault_member, replace_member_records, resolve_dec, resolve_dek,
        resolve_member_roster, resolve_members_key, resolve_secrets_key, revoke_vault_member,
        roster_add_member, sentinel_share_record_key, user_stored_records,
        vault_has_multi_device_records,
    };
}
pub use auth::multi_device::encrypt_for_recipient;
pub use auth::password_envelope::{
    PASSWORD_MIN_LENGTH, PASSWORD_SCRYPT_LOG_N, PasswordEntryIssuance, PasswordEntryResolution,
    PasswordEnvelope, PasswordEnvelopeAttachment, PasswordEnvelopeResolution,
    PasswordEnvelopeRewrap, PasswordEnvelopeVersion, PasswordUnlockEntry, VaultUnlock,
    is_vault_password_long_enough, is_vault_password_recommended_length, vault_password_min_length,
    vault_password_recommended_min_length,
};
pub use auth::sentinel_genesis::{
    CheckedSentinelGenesisDelivery, CheckedSentinelGenesisResponse, ReadySentinelGenesis,
    SentinelGenesisDeliveryRecipient, SentinelGenesisIssued, SentinelGenesisLinkInput,
    SentinelGenesisParticipant, SentinelGenesisParticipantResponse, SentinelGenesisPolicy,
    SentinelGenesisPublicKeyAnnouncement, SentinelGenesisReadiness, SentinelGenesisRejection,
    SentinelGenesisRequest, SentinelGenesisResponder, SentinelGenesisSession,
    SentinelGenesisShareDelivery, SentinelGenesisVersion,
};
pub use auth::sentinel_unlock::{
    CheckedSentinelUnlockRequest, SentinelUnlockPolicy, SentinelUnlockQuorum,
    SentinelUnlockReadiness, SentinelUnlockRejection, SentinelUnlockRequest,
    SentinelUnlockResponse, SentinelUnlockSession, SentinelUnlockStatus, SentinelUnlockVersion,
};
pub use crypto::vault_crypto::VaultCrypto;
pub use errors::{
    AgeCryptoError, DeviceKeyProtectionError, DeviceKeyProtectionResult, EnrollmentError,
    EnrollmentResult, MultiDeviceError, MultiDeviceResult, PasswordError, PasswordResult,
    RejectedPasswordEnvelopeVersion, SecretPayloadError, SecretPayloadResult, ValidationError,
    ValidationResult, VaultCryptoError, VaultCryptoResult,
};
pub use ids::{
    AUTH_KEY_ID_PREFIX, AppId, AuthKeyId, CompactToken, DeviceId, SECRET_ID_PREFIX,
    STORE_ID_PREFIX, SecretId, StoreId, auth_key_digest, format_auth_key_id, format_secret_id,
    format_store_id, generate_secret_id, generate_store_id, is_app_id, is_auth_key_id,
    is_compact_token, is_device_id, normalize_auth_key_id, normalize_secret_id_for_write,
    normalize_store_id, validate_secret_id, validate_store_id,
};
pub use multi_device_api::*;
pub use records::{SecretType, StoredRecordPayload, StoredSecretRecord};
pub use wire::{
    AgeArmoredCiphertext, DecryptedPlaintext, DeviceIdentitySecret, DevicePublicKey,
    DeviceSigningPublicKey, IdentityVaultEventId, IsoTimestamp, MemberLabel, OpaqueCiphertext,
    PasswordEntryId, Sha256Hex, SigningSeedHex, SymmetricKey, Url64EncodedString,
};
