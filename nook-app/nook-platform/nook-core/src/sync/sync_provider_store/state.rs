use serde::{Deserialize, Serialize};
use tsify::Tsify;

use super::{LocalFolderConfig, OAuthFileConfig};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum StoredOAuthRefreshCredential {
    #[default]
    NotIssued,
    Token(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum StoredOAuthAccessCredential {
    #[default]
    SignedOut,
    AccessToken(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum StoredOAuthTokenExpiry {
    #[default]
    Unknown,
    ExpiresAt(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum StoredOAuthRemoteFileId {
    #[default]
    Unresolved,
    FileId(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum StoredOAuthRemoteFileName {
    #[default]
    Unresolved,
    FileName(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum StoredOAuthAccountIdentity {
    #[default]
    Unknown,
    Email(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum StoredGoogleDriveFolder {
    #[default]
    Root,
    FolderId(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum StoredICloudShareTarget {
    #[default]
    Personal,
    SharedTarget(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum StoredLocalFolderDirectory {
    #[default]
    Unnamed,
    DirectoryName(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum StoredLocalFolderHandle {
    #[default]
    Unbound,
    HandleId(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum StoredGithubPat {
    #[default]
    Missing,
    Token(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum StoredGithubRepository {
    #[default]
    DefaultRepository,
    Repository(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ProviderVaultScope {
    #[default]
    Unscoped,
    StoreId(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ActiveVaultScope {
    #[default]
    Unselected,
    StoreId(String),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "config", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum StoredOAuthFileConfiguration {
    #[default]
    NotApplicable,
    Configured(OAuthFileConfig),
}

impl StoredOAuthFileConfiguration {
    #[must_use]
    pub const fn configured(config: OAuthFileConfig) -> Self {
        Self::Configured(config)
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "config", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
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
