#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
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
};
pub use auth::identity_directory::{IdentityDirectory, IdentitySelection};

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
        AppKey, AuthEnvelopes, AuthRecordIssuance, ConnectAccessStatus, DeviceEnrollment,
        DeviceIdentity, JoinRequest, JoinRequestApproval, JoinRequestDenial, JoinRequestIssuance,
        MEMBER_RECORD_PREFIX, MemberEntry, OpenedSentinelShare, SENTINEL_SHARE_RECORD_PREFIX,
        SelfRosterSync, SentinelKeyReconstruction, SentinelParticipantEntry, SentinelShareEnvelope,
        SentinelShareOpening, SentinelShareVersion, VaultKeys, VaultMember, VaultMetaRecord,
        VaultMetaState, VaultRecordView,
    };
}
pub use auth::password_envelope::{
    PASSWORD_MIN_LENGTH, PASSWORD_SCRYPT_LOG_N, PasswordEntryIssuance, PasswordEntryResolution,
    PasswordEnvelope, PasswordEnvelopeAttachment, PasswordEnvelopeResolution,
    PasswordEnvelopeRewrap, PasswordEnvelopeVersion, PasswordPolicy, PasswordUnlockEntry,
    VaultUnlock,
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
    STORE_ID_PREFIX, SecretId, StoreId,
};
pub use multi_device_api::*;
pub use records::{SecretType, StoredRecordPayload, StoredSecretRecord};
pub use wire::{
    AgeArmoredCiphertext, DecryptedPlaintext, DeviceIdentitySecret, DevicePublicKey,
    DeviceSigningPublicKey, IdentityVaultEventId, IsoTimestamp, MemberLabel, OpaqueCiphertext,
    PasswordEntryId, Sha256Hex, SigningSeedHex, SymmetricKey, Url64EncodedString,
};

pub use auth::identity_genesis::IdentityVaultGenesisRecordsRequest;

pub use auth::multi_device::{
    BuildMembersRecordsRequest, DecryptMemberEntryRequest, EncryptMemberEntryRequest,
    GenesisMembersRecordsRequest, MemberFromIdentityRequest, RenameVaultMemberRequest,
    ReplaceMemberRecordsRequest, ResolveMemberRosterRequest, RevokeVaultMemberRequest,
};

pub use auth::multi_device::{
    AssessConnectAccessRequest, DeviceIsEnrolledRequest, EnsureSelfInRosterRequest,
    PendingJoinForDeviceRequest,
};

pub use auth::multi_device::RosterAddMemberRequest;

pub use auth::multi_device::{
    CreateSentinelRootShareRecordsForRecipientsRequest,
    CreateSentinelShareRecordsForRecipientsRequest, CreateSentinelShareRecordsRequest,
};
