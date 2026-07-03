//! On-disk vault format (YAML / JSONL) errors.

use super::validation::ValidationError;
use thiserror::Error;

pub type VaultFormatResult<T> = Result<T, VaultFormatError>;

#[derive(Debug, Error)]
pub enum VaultFormatError {
    #[error("Unrecognized vault format (first non-empty line: {first_line:?})")]
    UnrecognizedFormat { first_line: String },

    #[error("Failed to serialize stored JSONL record")]
    JsonlSerialize(#[source] serde_json::Error),

    #[error("Failed to parse stored JSONL line")]
    JsonlParse(#[source] serde_json::Error),

    #[error("Failed to serialize stored YAML")]
    YamlSerialize(#[source] serde_yaml::Error),

    #[error("Failed to parse stored YAML for vault version")]
    YamlParseVersion(#[source] serde_yaml::Error),

    #[error("Failed to parse stored YAML for password entries")]
    YamlParsePasswordEntries(#[source] serde_yaml::Error),

    #[error("Failed to parse stored YAML for store id")]
    YamlParseStoreId(#[source] serde_yaml::Error),

    #[error("Failed to parse stored YAML for vault name")]
    YamlParseName(#[source] serde_yaml::Error),

    #[error("Failed to parse stored YAML: expected secrets/auth/joins/members sections")]
    YamlMissingSections,

    #[error("Failed to parse stored YAML for unlock mode")]
    YamlParseUnlock(#[source] serde_yaml::Error),

    #[error(
        "Vault schema version {found} is newer than this app supports (max {max_supported}). Update Nook or use a pinned older app if you need rollback."
    )]
    UnsupportedSchemaVersion { found: u32, max_supported: u32 },

    #[error(transparent)]
    Validation(#[from] ValidationError),
}
