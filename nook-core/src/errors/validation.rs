//! Input validation and prefixed vault identifier errors.

use thiserror::Error;

pub type ValidationResult<T> = Result<T, ValidationError>;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ValidationError {
    #[error("errors.validation.unknown_storage_mode:{mode}")]
    UnknownStorageMode { mode: String },

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

    #[error("errors.validation.bip39_empty")]
    Bip39Empty,

    #[error("errors.validation.bip39_invalid")]
    Bip39Invalid,
}
