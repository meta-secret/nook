//! Input validation and prefixed vault identifier errors.

use nook_app_common::i18n_keys;
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
const ERRORS_VALIDATION_IDENTITY_INVITE_ID_INVALID: &str =
    "errors.validation.identity_invite_id_invalid";
const ERRORS_VALIDATION_SECRET_FINGERPRINT_KEY_INVALID: &str =
    "errors.validation.secret_fingerprint_key_invalid";
const ERRORS_VALIDATION_AGE_ARMORED_INVALID: &str = "errors.validation.age_armored_invalid";
const ERRORS_VALIDATION_DEVICE_PUBLIC_KEY_INVALID: &str =
    "errors.validation.device_public_key_invalid";
const ERRORS_VALIDATION_DEVICE_IDENTITY_SECRET_INVALID: &str =
    "errors.validation.device_identity_secret_invalid";
const ERRORS_VALIDATION_SHA256_HEX_INVALID: &str = "errors.validation.sha256_hex_invalid";
const ERRORS_VALIDATION_IDENTITY_VAULT_EVENT_ID_INVALID: &str =
    "errors.validation.identity_vault_event_id_invalid";
const ERRORS_VALIDATION_DEVICE_SIGNING_PUBLIC_KEY_INVALID: &str =
    "errors.validation.device_signing_public_key_invalid";
const ERRORS_VALIDATION_ISO_TIMESTAMP_INVALID: &str = "errors.validation.iso_timestamp_invalid";
const ERRORS_VALIDATION_PASSWORD_ENTRY_ID_INVALID: &str =
    "errors.validation.password_entry_id_invalid";
const ERRORS_VALIDATION_SIGNING_SEED_INVALID: &str = "errors.validation.signing_seed_invalid";

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ValidationError {
    #[error("{}:{mode}", i18n_keys::ERRORS_VALIDATION_UNKNOWN_STORAGE_MODE)]
    UnknownStorageMode { mode: String },

    #[error("{}:{mode}", ERRORS_VALIDATION_UNKNOWN_DEVICE_MODE)]
    UnknownDeviceMode { mode: String },

    #[error("{}:{vault_type}", ERRORS_VALIDATION_UNKNOWN_VAULT_TYPE)]
    UnknownVaultType { vault_type: String },

    #[error(
        "{}:{application}",
        i18n_keys::ERRORS_VALIDATION_UNKNOWN_VAULT_APPLICATION
    )]
    UnknownVaultApplication { application: String },

    #[error(
        "{}:{application}:{vault_type}",
        i18n_keys::ERRORS_VALIDATION_VAULT_APPLICATION_TYPE_MISMATCH
    )]
    VaultApplicationTypeMismatch {
        application: String,
        vault_type: String,
    },

    #[error("{}", i18n_keys::ERRORS_VALIDATION_SENTINEL_EXTENSION_FORBIDDEN)]
    SentinelExtensionForbidden,

    #[error(
        "{}:{application}",
        i18n_keys::ERRORS_VALIDATION_EXTENSION_APPROVAL_APPLICATION_FORBIDDEN
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
        i18n_keys::ERRORS_VALIDATION_SENTINEL_VAULT_HAS_FULL_KEY_ENVELOPES
    )]
    SentinelVaultHasFullKeyEnvelopes,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_SIMPLE_VAULT_HAS_SENTINEL_SHARES)]
    SimpleVaultHasSentinelShares,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_INVALID_SENTINEL_SHARE_SET)]
    InvalidSentinelShareSet,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_GITHUB_PAT_EMPTY)]
    GithubPatEmpty,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_GITHUB_REPO_LENGTH)]
    GithubRepoLength,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_GITHUB_REPO_INVALID)]
    GithubRepoInvalid,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_GITHUB_REPO_CHARS)]
    GithubRepoChars,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_DRIVE_FILE_NAME_LENGTH)]
    DriveFileNameLength,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_DRIVE_FILE_NAME_INVALID)]
    DriveFileNameInvalid,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_DRIVE_FILE_NAME_CHARS)]
    DriveFileNameChars,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_OAUTH_ACCESS_TOKEN_EMPTY)]
    OauthAccessTokenEmpty,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_SHARED_JOINER_IDENTITY_REQUIRED)]
    SharedJoinerIdentityRequired,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_SHARED_JOINER_IDENTITY_INVALID)]
    SharedJoinerIdentityInvalid,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_SHARED_STORAGE_TARGET_REQUIRED)]
    SharedStorageTargetRequired,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_SHARED_STORAGE_TARGET_INVALID)]
    SharedStorageTargetInvalid,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_AUTHORIZED_ACCOUNT_MISSING)]
    AuthorizedAccountMissing,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_AUTHORIZED_ACCOUNT_READ_ONLY)]
    AuthorizedAccountReadOnly,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_AUTHORIZED_ACCOUNT_EXISTS)]
    AuthorizedAccountExists,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_AUTHORIZED_ACCOUNT_OWNER)]
    AuthorizedAccountOwner,

    /// Several My Drive folders carry the vault-folder name; Nook does not guess.
    #[error("{}", i18n_keys::ERRORS_VALIDATION_GOOGLE_DRIVE_VAULT_FOLDER_AMBIGUOUS)]
    GoogleDriveVaultFolderAmbiguous,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_JOINER_ACCOUNT_MISMATCH)]
    JoinerAccountMismatch,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_SECRET_DATA_REQUIRED)]
    SecretDataRequired,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_SECRET_ID_REQUIRED)]
    SecretIdRequired,

    #[error("{}", ERRORS_VALIDATION_SECRET_ID_INVALID)]
    SecretIdInvalid,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_SECRET_ID_RESERVED)]
    SecretIdReserved,

    #[error("{}", ERRORS_VALIDATION_STORE_ID_INVALID)]
    StoreIdInvalid,

    #[error("{}", ERRORS_VALIDATION_STORE_ID_RESERVED)]
    StoreIdReserved,

    #[error("{}", ERRORS_VALIDATION_AUTH_KEY_ID_INVALID)]
    AuthKeyIdInvalid,

    #[error("{}", ERRORS_VALIDATION_DEVICE_ID_INVALID)]
    DeviceIdInvalid,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_BIP39_EMPTY)]
    Bip39Empty,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_BIP39_INVALID)]
    Bip39Invalid,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_AUTHENTICATOR_ISSUER_REQUIRED)]
    AuthenticatorIssuerRequired,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_AUTHENTICATOR_SECRET_INVALID)]
    AuthenticatorSecretInvalid,

    #[error(
        "{}",
        i18n_keys::ERRORS_VALIDATION_AUTHENTICATOR_ISSUER_CATALOG_INVALID
    )]
    AuthenticatorIssuerCatalogInvalid,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_AUTHENTICATOR_DIGITS_INVALID)]
    AuthenticatorDigitsInvalid,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_AUTHENTICATOR_PERIOD_INVALID)]
    AuthenticatorPeriodInvalid,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_AUTHENTICATOR_URI_INVALID)]
    AuthenticatorUriInvalid,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_AUTHENTICATOR_BACKUP_CODES_INVALID)]
    AuthenticatorBackupCodesInvalid,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_CREDIT_CARD_TITLE_REQUIRED)]
    CreditCardTitleRequired,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_CREDIT_CARD_NUMBER_INVALID)]
    CreditCardNumberInvalid,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_CREDIT_CARD_EXPIRATION_INVALID)]
    CreditCardExpirationInvalid,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_CREDIT_CARD_CVV_INVALID)]
    CreditCardCvvInvalid,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_PERSONAL_DATA_TEXT_INVALID)]
    PersonalDataTextInvalid,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_PERSON_NAME_REQUIRED)]
    PersonNameRequired,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_PERSON_BIRTH_DATE_INVALID)]
    PersonBirthDateInvalid,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_PERSON_EMAIL_INVALID)]
    PersonEmailInvalid,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_PERSON_PHONE_INVALID)]
    PersonPhoneInvalid,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_ADDRESS_LINE1_REQUIRED)]
    AddressLine1Required,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_IDENTITY_DOCUMENT_NUMBER_REQUIRED)]
    IdentityDocumentNumberRequired,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_IDENTITY_DOCUMENT_DATE_INVALID)]
    IdentityDocumentDateInvalid,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_IDENTITY_DOCUMENT_SSN_INVALID)]
    IdentityDocumentSsnInvalid,

    #[error(
        "{}",
        i18n_keys::ERRORS_VALIDATION_IDENTITY_DOCUMENT_EXPIRY_BEFORE_ISSUE
    )]
    IdentityDocumentExpiryBeforeIssue,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_INTERNATIONAL_ACCOUNT_IBAN_REQUIRED)]
    InternationalAccountIbanRequired,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_INTERNATIONAL_ACCOUNT_IBAN_INVALID)]
    InternationalAccountIbanInvalid,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_SWIFT_BIC_INVALID)]
    SwiftBicInvalid,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_DOMESTIC_ACCOUNT_NUMBER_REQUIRED)]
    DomesticAccountNumberRequired,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_DOMESTIC_ACCOUNT_NUMBER_INVALID)]
    DomesticAccountNumberInvalid,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_ROUTING_NUMBER_REQUIRED)]
    RoutingNumberRequired,

    #[error("{}", i18n_keys::ERRORS_VALIDATION_ROUTING_NUMBER_INVALID)]
    RoutingNumberInvalid,

    #[error("{}", ERRORS_VALIDATION_SYMMETRIC_KEY_INVALID)]
    SymmetricKeyInvalid,

    #[error("{}", ERRORS_VALIDATION_IDENTITY_INVITE_ID_INVALID)]
    IdentityInviteIdInvalid,

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

    #[error("{}", ERRORS_VALIDATION_IDENTITY_VAULT_EVENT_ID_INVALID)]
    IdentityVaultEventIdInvalid,

    #[error("{}", ERRORS_VALIDATION_DEVICE_SIGNING_PUBLIC_KEY_INVALID)]
    DeviceSigningPublicKeyInvalid,

    #[error("{}", ERRORS_VALIDATION_ISO_TIMESTAMP_INVALID)]
    IsoTimestampInvalid,

    #[error("{}", ERRORS_VALIDATION_PASSWORD_ENTRY_ID_INVALID)]
    PasswordEntryIdInvalid,

    #[error("{}", ERRORS_VALIDATION_SIGNING_SEED_INVALID)]
    SigningSeedInvalid,
}
