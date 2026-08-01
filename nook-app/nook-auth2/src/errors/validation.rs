//! Input validation and prefixed vault identifier errors.

use thiserror::Error;

pub type ValidationResult<T> = Result<T, ValidationError>;

const ERRORS_VALIDATION_UNKNOWN_DEVICE_MODE: &str = "errors.validation.unknown_device_mode";
const ERRORS_VALIDATION_UNKNOWN_VAULT_TYPE: &str = "errors.validation.unknown_vault_type";
const ERRORS_VALIDATION_UNKNOWN_REPLICATION_TYPE: &str =
    "errors.validation.unknown_replication_type";
const ERRORS_VALIDATION_UNSUPPORTED_PROVIDER_REPLICATION: &str =
    "errors.validation.unsupported_provider_replication";
const ERRORS_VALIDATION_SIMPLE_VAULT_HAS_SENTINEL_POLICY: &str =
    "errors.validation.simple_vault_has_sentinel_policy";
const ERRORS_VALIDATION_INVALID_SENTINEL_POLICY: &str = "errors.validation.invalid_sentinel_policy";
const ERRORS_VALIDATION_SECRET_ID_INVALID: &str = "errors.validation.secret_id_invalid";
const ERRORS_VALIDATION_STORE_ID_INVALID: &str = "errors.validation.store_id_invalid";
const ERRORS_VALIDATION_STORE_ID_RESERVED: &str = "errors.validation.store_id_reserved";
const ERRORS_VALIDATION_AUTH_KEY_ID_INVALID: &str = "errors.validation.auth_key_id_invalid";
const ERRORS_VALIDATION_DEVICE_ID_INVALID: &str = "errors.validation.device_id_invalid";
const ERRORS_VALIDATION_SYMMETRIC_KEY_INVALID: &str = "errors.validation.symmetric_key_invalid";
const ERRORS_VALIDATION_SECRET_FINGERPRINT_KEY_INVALID: &str =
    "errors.validation.secret_fingerprint_key_invalid";
const ERRORS_VALIDATION_AGE_ARMORED_INVALID: &str = "errors.validation.age_armored_invalid";
const ERRORS_VALIDATION_DEVICE_PUBLIC_KEY_INVALID: &str =
    "errors.validation.device_public_key_invalid";
const ERRORS_VALIDATION_DEVICE_IDENTITY_SECRET_INVALID: &str =
    "errors.validation.device_identity_secret_invalid";
const ERRORS_VALIDATION_SHA256_HEX_INVALID: &str = "errors.validation.sha256_hex_invalid";
const ERRORS_VALIDATION_DEVICE_SIGNING_PUBLIC_KEY_INVALID: &str =
    "errors.validation.device_signing_public_key_invalid";
const ERRORS_VALIDATION_ISO_TIMESTAMP_INVALID: &str = "errors.validation.iso_timestamp_invalid";
const ERRORS_VALIDATION_PASSWORD_ENTRY_ID_INVALID: &str =
    "errors.validation.password_entry_id_invalid";
const ERRORS_VALIDATION_SIGNING_SEED_INVALID: &str = "errors.validation.signing_seed_invalid";

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ValidationError {
    #[error(
        "{}:{mode}",
        crate::generated::i18n_keys::ERRORS_VALIDATION_UNKNOWN_STORAGE_MODE
    )]
    UnknownStorageMode { mode: String },

    #[error("{}:{mode}", ERRORS_VALIDATION_UNKNOWN_DEVICE_MODE)]
    UnknownDeviceMode { mode: String },

    #[error("{}:{vault_type}", ERRORS_VALIDATION_UNKNOWN_VAULT_TYPE)]
    UnknownVaultType { vault_type: String },

    #[error(
        "{}:{application}",
        crate::generated::i18n_keys::ERRORS_VALIDATION_UNKNOWN_VAULT_APPLICATION
    )]
    UnknownVaultApplication { application: String },

    #[error(
        "{}:{application}:{vault_type}",
        crate::generated::i18n_keys::ERRORS_VALIDATION_VAULT_APPLICATION_TYPE_MISMATCH
    )]
    VaultApplicationTypeMismatch {
        application: String,
        vault_type: String,
    },

    #[error(
        "{}",
        crate::generated::i18n_keys::ERRORS_VALIDATION_SENTINEL_EXTENSION_FORBIDDEN
    )]
    SentinelExtensionForbidden,

    #[error(
        "{}:{application}",
        crate::generated::i18n_keys::ERRORS_VALIDATION_EXTENSION_APPROVAL_APPLICATION_FORBIDDEN
    )]
    ExtensionApprovalApplicationForbidden { application: String },

    #[error("{}:{replication_type}", ERRORS_VALIDATION_UNKNOWN_REPLICATION_TYPE)]
    UnknownReplicationType { replication_type: String },

    #[error(
        "{}:{provider_type}:{oauth_preset}:{replication_type}",
        ERRORS_VALIDATION_UNSUPPORTED_PROVIDER_REPLICATION
    )]
    UnsupportedProviderReplication {
        provider_type: String,
        oauth_preset: String,
        replication_type: String,
    },

    #[error("{}", ERRORS_VALIDATION_SIMPLE_VAULT_HAS_SENTINEL_POLICY)]
    SimpleVaultHasSentinelPolicy,

    #[error("{}", ERRORS_VALIDATION_INVALID_SENTINEL_POLICY)]
    InvalidSentinelPolicy,

    #[error(
        "{}",
        crate::generated::i18n_keys::ERRORS_VALIDATION_SENTINEL_VAULT_HAS_FULL_KEY_ENVELOPES
    )]
    SentinelVaultHasFullKeyEnvelopes,

    #[error(
        "{}",
        crate::generated::i18n_keys::ERRORS_VALIDATION_SIMPLE_VAULT_HAS_SENTINEL_SHARES
    )]
    SimpleVaultHasSentinelShares,

    #[error(
        "{}",
        crate::generated::i18n_keys::ERRORS_VALIDATION_INVALID_SENTINEL_SHARE_SET
    )]
    InvalidSentinelShareSet,

    #[error("{}", crate::generated::i18n_keys::ERRORS_VALIDATION_GITHUB_PAT_EMPTY)]
    GithubPatEmpty,

    #[error(
        "{}",
        crate::generated::i18n_keys::ERRORS_VALIDATION_GITHUB_REPO_LENGTH
    )]
    GithubRepoLength,

    #[error(
        "{}",
        crate::generated::i18n_keys::ERRORS_VALIDATION_GITHUB_REPO_INVALID
    )]
    GithubRepoInvalid,

    #[error("{}", crate::generated::i18n_keys::ERRORS_VALIDATION_GITHUB_REPO_CHARS)]
    GithubRepoChars,

    #[error(
        "{}",
        crate::generated::i18n_keys::ERRORS_VALIDATION_DRIVE_FILE_NAME_LENGTH
    )]
    DriveFileNameLength,

    #[error(
        "{}",
        crate::generated::i18n_keys::ERRORS_VALIDATION_DRIVE_FILE_NAME_INVALID
    )]
    DriveFileNameInvalid,

    #[error(
        "{}",
        crate::generated::i18n_keys::ERRORS_VALIDATION_DRIVE_FILE_NAME_CHARS
    )]
    DriveFileNameChars,

    #[error(
        "{}",
        crate::generated::i18n_keys::ERRORS_VALIDATION_OAUTH_ACCESS_TOKEN_EMPTY
    )]
    OauthAccessTokenEmpty,

    #[error(
        "{}",
        crate::generated::i18n_keys::ERRORS_VALIDATION_SHARED_JOINER_IDENTITY_REQUIRED
    )]
    SharedJoinerIdentityRequired,

    #[error(
        "{}",
        crate::generated::i18n_keys::ERRORS_VALIDATION_SHARED_JOINER_IDENTITY_INVALID
    )]
    SharedJoinerIdentityInvalid,

    #[error(
        "{}",
        crate::generated::i18n_keys::ERRORS_VALIDATION_SHARED_STORAGE_TARGET_REQUIRED
    )]
    SharedStorageTargetRequired,

    #[error(
        "{}",
        crate::generated::i18n_keys::ERRORS_VALIDATION_SHARED_STORAGE_TARGET_INVALID
    )]
    SharedStorageTargetInvalid,

    #[error(
        "{}",
        crate::generated::i18n_keys::ERRORS_VALIDATION_SECRET_DATA_REQUIRED
    )]
    SecretDataRequired,

    #[error(
        "{}",
        crate::generated::i18n_keys::ERRORS_VALIDATION_SECRET_ID_REQUIRED
    )]
    SecretIdRequired,

    #[error("{}", ERRORS_VALIDATION_SECRET_ID_INVALID)]
    SecretIdInvalid,

    #[error(
        "{}",
        crate::generated::i18n_keys::ERRORS_VALIDATION_SECRET_ID_RESERVED
    )]
    SecretIdReserved,

    #[error("{}", ERRORS_VALIDATION_STORE_ID_INVALID)]
    StoreIdInvalid,

    #[error("{}", ERRORS_VALIDATION_STORE_ID_RESERVED)]
    StoreIdReserved,

    #[error("{}", ERRORS_VALIDATION_AUTH_KEY_ID_INVALID)]
    AuthKeyIdInvalid,

    #[error("{}", ERRORS_VALIDATION_DEVICE_ID_INVALID)]
    DeviceIdInvalid,

    #[error("{}", crate::generated::i18n_keys::ERRORS_VALIDATION_BIP39_EMPTY)]
    Bip39Empty,

    #[error("{}", crate::generated::i18n_keys::ERRORS_VALIDATION_BIP39_INVALID)]
    Bip39Invalid,

    #[error(
        "{}",
        crate::generated::i18n_keys::ERRORS_VALIDATION_AUTHENTICATOR_ISSUER_REQUIRED
    )]
    AuthenticatorIssuerRequired,

    #[error(
        "{}",
        crate::generated::i18n_keys::ERRORS_VALIDATION_AUTHENTICATOR_SECRET_INVALID
    )]
    AuthenticatorSecretInvalid,

    #[error(
        "{}",
        crate::generated::i18n_keys::ERRORS_VALIDATION_AUTHENTICATOR_DIGITS_INVALID
    )]
    AuthenticatorDigitsInvalid,

    #[error(
        "{}",
        crate::generated::i18n_keys::ERRORS_VALIDATION_AUTHENTICATOR_PERIOD_INVALID
    )]
    AuthenticatorPeriodInvalid,

    #[error(
        "{}",
        crate::generated::i18n_keys::ERRORS_VALIDATION_AUTHENTICATOR_URI_INVALID
    )]
    AuthenticatorUriInvalid,

    #[error(
        "{}",
        crate::generated::i18n_keys::ERRORS_VALIDATION_AUTHENTICATOR_BACKUP_CODES_INVALID
    )]
    AuthenticatorBackupCodesInvalid,

    #[error(
        "{}",
        crate::generated::i18n_keys::ERRORS_VALIDATION_CREDIT_CARD_TITLE_REQUIRED
    )]
    CreditCardTitleRequired,

    #[error(
        "{}",
        crate::generated::i18n_keys::ERRORS_VALIDATION_CREDIT_CARD_NUMBER_INVALID
    )]
    CreditCardNumberInvalid,

    #[error(
        "{}",
        crate::generated::i18n_keys::ERRORS_VALIDATION_CREDIT_CARD_EXPIRATION_INVALID
    )]
    CreditCardExpirationInvalid,

    #[error(
        "{}",
        crate::generated::i18n_keys::ERRORS_VALIDATION_CREDIT_CARD_CVV_INVALID
    )]
    CreditCardCvvInvalid,

    #[error("{}", ERRORS_VALIDATION_SYMMETRIC_KEY_INVALID)]
    SymmetricKeyInvalid,

    #[error("{}", ERRORS_VALIDATION_SECRET_FINGERPRINT_KEY_INVALID)]
    SecretFingerprintKeyInvalid,

    #[error("{}", ERRORS_VALIDATION_AGE_ARMORED_INVALID)]
    AgeArmoredInvalid,

    #[error("{}", ERRORS_VALIDATION_DEVICE_PUBLIC_KEY_INVALID)]
    DevicePublicKeyInvalid,

    #[error("{}", ERRORS_VALIDATION_DEVICE_IDENTITY_SECRET_INVALID)]
    DeviceIdentitySecretInvalid,

    #[error("{}", ERRORS_VALIDATION_SHA256_HEX_INVALID)]
    Sha256HexInvalid,

    #[error("{}", ERRORS_VALIDATION_DEVICE_SIGNING_PUBLIC_KEY_INVALID)]
    DeviceSigningPublicKeyInvalid,

    #[error("{}", ERRORS_VALIDATION_ISO_TIMESTAMP_INVALID)]
    IsoTimestampInvalid,

    #[error("{}", ERRORS_VALIDATION_PASSWORD_ENTRY_ID_INVALID)]
    PasswordEntryIdInvalid,

    #[error("{}", ERRORS_VALIDATION_SIGNING_SEED_INVALID)]
    SigningSeedInvalid,
}
