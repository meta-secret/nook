//! Input validation and prefixed vault identifier errors.

use thiserror::Error;

pub type ValidationResult<T> = Result<T, ValidationError>;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ValidationError {
    #[error("errors.validation.unknown_storage_mode:{mode}")]
    UnknownStorageMode { mode: String },

    #[error("errors.validation.unknown_device_mode:{mode}")]
    UnknownDeviceMode { mode: String },

    #[error("errors.validation.unknown_vault_type:{vault_type}")]
    UnknownVaultType { vault_type: String },

    #[error("errors.validation.unknown_vault_application:{application}")]
    UnknownVaultApplication { application: String },

    #[error("errors.validation.vault_application_type_mismatch:{application}:{vault_type}")]
    VaultApplicationTypeMismatch {
        application: String,
        vault_type: String,
    },

    #[error("errors.validation.sentinel_extension_forbidden")]
    SentinelExtensionForbidden,

    #[error("errors.validation.extension_approval_application_forbidden:{application}")]
    ExtensionApprovalApplicationForbidden { application: String },

    #[error("errors.validation.unknown_replication_type:{replication_type}")]
    UnknownReplicationType { replication_type: String },

    #[error(
        "errors.validation.unsupported_provider_replication:{provider_type}:{oauth_preset}:{replication_type}"
    )]
    UnsupportedProviderReplication {
        provider_type: String,
        oauth_preset: String,
        replication_type: String,
    },

    #[error("errors.validation.simple_vault_has_sentinel_policy")]
    SimpleVaultHasSentinelPolicy,

    #[error("errors.validation.invalid_sentinel_policy")]
    InvalidSentinelPolicy,

    #[error("errors.validation.sentinel_vault_has_full_key_envelopes")]
    SentinelVaultHasFullKeyEnvelopes,

    #[error("errors.validation.simple_vault_has_sentinel_shares")]
    SimpleVaultHasSentinelShares,

    #[error("errors.validation.invalid_sentinel_share_set")]
    InvalidSentinelShareSet,

    #[error("errors.validation.github_pat_empty")]
    GithubPatEmpty,

    #[error("errors.validation.github_repo_length")]
    GithubRepoLength,

    #[error("errors.validation.github_repo_invalid")]
    GithubRepoInvalid,

    #[error("errors.validation.github_repo_chars")]
    GithubRepoChars,

    #[error("errors.validation.drive_file_name_length")]
    DriveFileNameLength,

    #[error("errors.validation.drive_file_name_invalid")]
    DriveFileNameInvalid,

    #[error("errors.validation.drive_file_name_chars")]
    DriveFileNameChars,

    #[error("errors.validation.oauth_access_token_empty")]
    OauthAccessTokenEmpty,

    #[error("errors.validation.shared_joiner_identity_required")]
    SharedJoinerIdentityRequired,

    #[error("errors.validation.shared_joiner_identity_invalid")]
    SharedJoinerIdentityInvalid,

    #[error("errors.validation.shared_storage_target_required")]
    SharedStorageTargetRequired,

    #[error("errors.validation.shared_storage_target_invalid")]
    SharedStorageTargetInvalid,

    #[error("errors.validation.secret_data_required")]
    SecretDataRequired,

    #[error("errors.validation.secret_id_required")]
    SecretIdRequired,

    #[error("errors.validation.secret_id_invalid")]
    SecretIdInvalid,

    #[error("errors.validation.secret_id_reserved")]
    SecretIdReserved,

    #[error("errors.validation.store_id_invalid")]
    StoreIdInvalid,

    #[error("errors.validation.store_id_reserved")]
    StoreIdReserved,

    #[error("errors.validation.auth_key_id_invalid")]
    AuthKeyIdInvalid,

    #[error("errors.validation.device_id_invalid")]
    DeviceIdInvalid,

    #[error("errors.validation.bip39_empty")]
    Bip39Empty,

    #[error("errors.validation.bip39_invalid")]
    Bip39Invalid,

    #[error("errors.validation.authenticator_issuer_required")]
    AuthenticatorIssuerRequired,

    #[error("errors.validation.authenticator_secret_invalid")]
    AuthenticatorSecretInvalid,

    #[error("errors.validation.authenticator_digits_invalid")]
    AuthenticatorDigitsInvalid,

    #[error("errors.validation.authenticator_period_invalid")]
    AuthenticatorPeriodInvalid,

    #[error("errors.validation.authenticator_uri_invalid")]
    AuthenticatorUriInvalid,

    #[error("errors.validation.symmetric_key_invalid")]
    SymmetricKeyInvalid,

    #[error("errors.validation.age_armored_invalid")]
    AgeArmoredInvalid,

    #[error("errors.validation.device_public_key_invalid")]
    DevicePublicKeyInvalid,

    #[error("errors.validation.device_identity_secret_invalid")]
    DeviceIdentitySecretInvalid,

    #[error("errors.validation.sha256_hex_invalid")]
    Sha256HexInvalid,

    #[error("errors.validation.device_signing_public_key_invalid")]
    DeviceSigningPublicKeyInvalid,

    #[error("errors.validation.iso_timestamp_invalid")]
    IsoTimestampInvalid,

    #[error("errors.validation.password_entry_id_invalid")]
    PasswordEntryIdInvalid,

    #[error("errors.validation.signing_seed_invalid")]
    SigningSeedInvalid,
}
