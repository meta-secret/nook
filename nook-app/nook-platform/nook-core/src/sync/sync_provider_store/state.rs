use serde::{Deserialize, Serialize};
use tsify::Tsify;

use super::{LocalFolderConfig, OAuthFileConfig};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
pub enum StoredOAuthRefreshCredential {
    #[default]
    NotIssued,
    Token(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
pub enum StoredOAuthAccessCredential {
    #[default]
    SignedOut,
    AccessToken(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
pub enum StoredOAuthTokenExpiry {
    #[default]
    Unknown,
    ExpiresAt(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
pub enum StoredOAuthRemoteFileId {
    #[default]
    Unresolved,
    FileId(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
pub enum StoredOAuthRemoteFileName {
    #[default]
    Unresolved,
    FileName(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
pub enum StoredOAuthAccountIdentity {
    #[default]
    Unknown,
    Email(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
pub enum StoredGoogleDriveFolder {
    #[default]
    Root,
    FolderId(String),
}

/// Private Google Drive event target for a schema-2 provider.
///
/// Schema-1 rows default to `LegacyAppDataFolder`, preserving their existing
/// root event log. New private Drive providers use `Pending` until the adapter
/// resolves or creates a named child folder, then persist its stable Drive ID.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
pub enum StoredGoogleDrivePrivateTarget {
    #[default]
    LegacyAppDataFolder,
    Pending,
    FolderId(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
pub enum StoredICloudShareTarget {
    #[default]
    Personal,
    SharedTarget(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
pub enum StoredLocalFolderDirectory {
    #[default]
    Unnamed,
    DirectoryName(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
pub enum StoredLocalFolderHandle {
    #[default]
    Unbound,
    HandleId(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
pub enum StoredGithubPat {
    #[default]
    Missing,
    Token(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
pub enum StoredGithubRepository {
    #[default]
    DefaultRepository,
    Repository(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
pub enum ProviderVaultScope {
    #[default]
    Unscoped,
    StoreId(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
pub enum ActiveVaultScope {
    #[default]
    Unselected,
    StoreId(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "config", rename_all = "camelCase")]
pub enum StoredOAuthFileConfiguration {
    #[default]
    NotApplicable,
    Configured(Box<OAuthFileConfig>),
}

impl StoredOAuthFileConfiguration {
    #[must_use]
    pub fn configured(config: OAuthFileConfig) -> Self {
        Self::Configured(Box::new(config))
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "config", rename_all = "camelCase")]
pub enum StoredLocalFolderConfiguration {
    #[default]
    NotApplicable,
    Configured(LocalFolderConfig),
}

impl StoredLocalFolderConfiguration {
    #[must_use]
    pub const fn configured(config: LocalFolderConfig) -> Self {
        Self::Configured(config)
    }
}
