#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use serde::{Deserialize, Serialize};
use std::fmt;
use tsify::Tsify;

use super::{DEFAULT_GITHUB_REPO_NAME, ValidationError, ValidationResult};

mod github;
mod s3;

pub use github::*;
pub use s3::{S3Connection, S3ConnectionDraft, S3DraftField, S3DraftFieldError, S3DraftValidation};

/// Validated Google Drive folder id used by shared provider connections.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, Tsify)]
#[serde(try_from = "String")]
#[tsify(type = "string")]
pub struct GoogleDriveFolderId(String);

impl TryFrom<String> for GoogleDriveFolderId {
    type Error = ValidationError;
    fn try_from(raw: String) -> ValidationResult<Self> {
        Self::parse(&raw)
    }
}

impl GoogleDriveFolderId {
    /// A Drive folder id: at most 256 ASCII letters, digits, `-`, and `_`.
    /// Every flow passes the id Drive returned, so a pasted folder URL is no
    /// id.
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        match raw.trim() {
            "" => Err(ValidationError::SharedStorageTargetRequired),
            id if id.len() > 256
                || !id.chars().all(|character| {
                    character.is_ascii_alphanumeric() || matches!(character, '-' | '_')
                }) =>
            {
                Err(ValidationError::SharedStorageTargetInvalid)
            }
            id => Ok(Self(id.to_owned())),
        }
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(self) -> String {
        self.0
    }
}

/// Validated OAuth access token (Drive / iCloud connect boundary).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct OauthAccessToken(String);

impl OauthAccessToken {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Err(ValidationError::OauthAccessTokenEmpty);
        }
        Ok(Self(trimmed.to_owned()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(self) -> String {
        self.0
    }
}

impl fmt::Display for OauthAccessToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl AsRef<str> for OauthAccessToken {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

/// The shareable My Drive folder that holds a vault's Google Drive event files.
///
/// Every Google Drive provider is shared: Nook writes app-created files with
/// `drive.file` and reads files created by other authorized accounts with
/// `drive.readonly`. Access is managed through the folder's Drive permissions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DriveEventParent {
    pub folder_id: String,
}

impl DriveEventParent {
    #[must_use]
    pub fn shared_folder_id(folder_id: &str) -> Self {
        Self {
            folder_id: folder_id.trim().to_owned(),
        }
    }

    /// The vault folder a Drive connection names. A connection without one is
    /// not connectable.
    pub fn parse_folder_id(folder_id: &str) -> ValidationResult<Self> {
        match folder_id.trim() {
            "" => Err(ValidationError::SharedStorageTargetRequired),
            folder_id => Ok(Self::shared_folder_id(folder_id)),
        }
    }
}

mod target;
pub use target::ProviderTargetKey;
