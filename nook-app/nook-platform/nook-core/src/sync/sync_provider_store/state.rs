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

impl StoredOAuthRefreshCredential {
    #[must_use]
    pub fn from_option(value: Option<String>) -> Self {
        match value {
            Some(value) => Self::Token(value),
            None => Self::NotIssued,
        }
    }

    #[must_use]
    pub fn as_deref(&self) -> Option<&str> {
        match self {
            Self::NotIssued => None,
            Self::Token(value) => Some(value),
        }
    }

    #[must_use]
    pub fn as_mut_string(&mut self) -> Option<&mut String> {
        match self {
            Self::NotIssued => None,
            Self::Token(value) => Some(value),
        }
    }

    #[must_use]
    pub fn into_option(self) -> Option<String> {
        match self {
            Self::NotIssued => None,
            Self::Token(value) => Some(value),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum StoredOAuthAccessCredential {
    #[default]
    SignedOut,
    AccessToken(String),
}

impl StoredOAuthAccessCredential {
    #[must_use]
    pub fn from_option(value: Option<String>) -> Self {
        match value {
            Some(value) => Self::AccessToken(value),
            None => Self::SignedOut,
        }
    }

    #[must_use]
    pub fn as_deref(&self) -> Option<&str> {
        match self {
            Self::SignedOut => None,
            Self::AccessToken(value) => Some(value),
        }
    }

    #[must_use]
    pub fn as_mut_string(&mut self) -> Option<&mut String> {
        match self {
            Self::SignedOut => None,
            Self::AccessToken(value) => Some(value),
        }
    }

    #[must_use]
    pub fn into_option(self) -> Option<String> {
        match self {
            Self::SignedOut => None,
            Self::AccessToken(value) => Some(value),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum StoredOAuthTokenExpiry {
    #[default]
    Unknown,
    ExpiresAt(String),
}

impl StoredOAuthTokenExpiry {
    #[must_use]
    pub fn from_option(value: Option<String>) -> Self {
        match value {
            Some(value) => Self::ExpiresAt(value),
            None => Self::Unknown,
        }
    }

    #[must_use]
    pub fn as_deref(&self) -> Option<&str> {
        match self {
            Self::Unknown => None,
            Self::ExpiresAt(value) => Some(value),
        }
    }

    #[must_use]
    pub fn as_mut_string(&mut self) -> Option<&mut String> {
        match self {
            Self::Unknown => None,
            Self::ExpiresAt(value) => Some(value),
        }
    }

    #[must_use]
    pub fn into_option(self) -> Option<String> {
        match self {
            Self::Unknown => None,
            Self::ExpiresAt(value) => Some(value),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum StoredOAuthRemoteFileId {
    #[default]
    Unresolved,
    FileId(String),
}

impl StoredOAuthRemoteFileId {
    #[must_use]
    pub fn from_option(value: Option<String>) -> Self {
        match value {
            Some(value) => Self::FileId(value),
            None => Self::Unresolved,
        }
    }

    #[must_use]
    pub fn as_deref(&self) -> Option<&str> {
        match self {
            Self::Unresolved => None,
            Self::FileId(value) => Some(value),
        }
    }

    #[must_use]
    pub fn as_mut_string(&mut self) -> Option<&mut String> {
        match self {
            Self::Unresolved => None,
            Self::FileId(value) => Some(value),
        }
    }

    #[must_use]
    pub fn into_option(self) -> Option<String> {
        match self {
            Self::Unresolved => None,
            Self::FileId(value) => Some(value),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum StoredOAuthRemoteFileName {
    #[default]
    Unresolved,
    FileName(String),
}

impl StoredOAuthRemoteFileName {
    #[must_use]
    pub fn from_option(value: Option<String>) -> Self {
        match value {
            Some(value) => Self::FileName(value),
            None => Self::Unresolved,
        }
    }

    #[must_use]
    pub fn as_deref(&self) -> Option<&str> {
        match self {
            Self::Unresolved => None,
            Self::FileName(value) => Some(value),
        }
    }

    #[must_use]
    pub fn as_mut_string(&mut self) -> Option<&mut String> {
        match self {
            Self::Unresolved => None,
            Self::FileName(value) => Some(value),
        }
    }

    #[must_use]
    pub fn into_option(self) -> Option<String> {
        match self {
            Self::Unresolved => None,
            Self::FileName(value) => Some(value),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum StoredOAuthAccountIdentity {
    #[default]
    Unknown,
    Email(String),
}

impl StoredOAuthAccountIdentity {
    #[must_use]
    pub fn from_option(value: Option<String>) -> Self {
        match value {
            Some(value) => Self::Email(value),
            None => Self::Unknown,
        }
    }

    #[must_use]
    pub fn as_deref(&self) -> Option<&str> {
        match self {
            Self::Unknown => None,
            Self::Email(value) => Some(value),
        }
    }

    #[must_use]
    pub fn as_mut_string(&mut self) -> Option<&mut String> {
        match self {
            Self::Unknown => None,
            Self::Email(value) => Some(value),
        }
    }

    #[must_use]
    pub fn into_option(self) -> Option<String> {
        match self {
            Self::Unknown => None,
            Self::Email(value) => Some(value),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum StoredGoogleDriveFolder {
    #[default]
    Root,
    FolderId(String),
}

impl StoredGoogleDriveFolder {
    #[must_use]
    pub fn from_option(value: Option<String>) -> Self {
        match value {
            Some(value) => Self::FolderId(value),
            None => Self::Root,
        }
    }

    #[must_use]
    pub fn as_deref(&self) -> Option<&str> {
        match self {
            Self::Root => None,
            Self::FolderId(value) => Some(value),
        }
    }

    #[must_use]
    pub fn as_mut_string(&mut self) -> Option<&mut String> {
        match self {
            Self::Root => None,
            Self::FolderId(value) => Some(value),
        }
    }

    #[must_use]
    pub fn into_option(self) -> Option<String> {
        match self {
            Self::Root => None,
            Self::FolderId(value) => Some(value),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum StoredICloudShareTarget {
    #[default]
    Personal,
    SharedTarget(String),
}

impl StoredICloudShareTarget {
    #[must_use]
    pub fn from_option(value: Option<String>) -> Self {
        match value {
            Some(value) => Self::SharedTarget(value),
            None => Self::Personal,
        }
    }

    #[must_use]
    pub fn as_deref(&self) -> Option<&str> {
        match self {
            Self::Personal => None,
            Self::SharedTarget(value) => Some(value),
        }
    }

    #[must_use]
    pub fn as_mut_string(&mut self) -> Option<&mut String> {
        match self {
            Self::Personal => None,
            Self::SharedTarget(value) => Some(value),
        }
    }

    #[must_use]
    pub fn into_option(self) -> Option<String> {
        match self {
            Self::Personal => None,
            Self::SharedTarget(value) => Some(value),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum StoredLocalFolderDirectory {
    #[default]
    Unnamed,
    DirectoryName(String),
}

impl StoredLocalFolderDirectory {
    #[must_use]
    pub fn from_option(value: Option<String>) -> Self {
        match value {
            Some(value) => Self::DirectoryName(value),
            None => Self::Unnamed,
        }
    }

    #[must_use]
    pub fn as_deref(&self) -> Option<&str> {
        match self {
            Self::Unnamed => None,
            Self::DirectoryName(value) => Some(value),
        }
    }

    #[must_use]
    pub fn as_mut_string(&mut self) -> Option<&mut String> {
        match self {
            Self::Unnamed => None,
            Self::DirectoryName(value) => Some(value),
        }
    }

    #[must_use]
    pub fn into_option(self) -> Option<String> {
        match self {
            Self::Unnamed => None,
            Self::DirectoryName(value) => Some(value),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum StoredLocalFolderHandle {
    #[default]
    Unbound,
    HandleId(String),
}

impl StoredLocalFolderHandle {
    #[must_use]
    pub fn from_option(value: Option<String>) -> Self {
        match value {
            Some(value) => Self::HandleId(value),
            None => Self::Unbound,
        }
    }

    #[must_use]
    pub fn as_deref(&self) -> Option<&str> {
        match self {
            Self::Unbound => None,
            Self::HandleId(value) => Some(value),
        }
    }

    #[must_use]
    pub fn as_mut_string(&mut self) -> Option<&mut String> {
        match self {
            Self::Unbound => None,
            Self::HandleId(value) => Some(value),
        }
    }

    #[must_use]
    pub fn into_option(self) -> Option<String> {
        match self {
            Self::Unbound => None,
            Self::HandleId(value) => Some(value),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum StoredGithubPat {
    #[default]
    Missing,
    Token(String),
}

impl StoredGithubPat {
    #[must_use]
    pub fn from_option(value: Option<String>) -> Self {
        match value {
            Some(value) => Self::Token(value),
            None => Self::Missing,
        }
    }

    #[must_use]
    pub fn as_deref(&self) -> Option<&str> {
        match self {
            Self::Missing => None,
            Self::Token(value) => Some(value),
        }
    }

    #[must_use]
    pub fn as_mut_string(&mut self) -> Option<&mut String> {
        match self {
            Self::Missing => None,
            Self::Token(value) => Some(value),
        }
    }

    #[must_use]
    pub fn into_option(self) -> Option<String> {
        match self {
            Self::Missing => None,
            Self::Token(value) => Some(value),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum StoredGithubRepository {
    #[default]
    DefaultRepository,
    Repository(String),
}

impl StoredGithubRepository {
    #[must_use]
    pub fn from_option(value: Option<String>) -> Self {
        match value {
            Some(value) => Self::Repository(value),
            None => Self::DefaultRepository,
        }
    }

    #[must_use]
    pub fn as_deref(&self) -> Option<&str> {
        match self {
            Self::DefaultRepository => None,
            Self::Repository(value) => Some(value),
        }
    }

    #[must_use]
    pub fn as_mut_string(&mut self) -> Option<&mut String> {
        match self {
            Self::DefaultRepository => None,
            Self::Repository(value) => Some(value),
        }
    }

    #[must_use]
    pub fn into_option(self) -> Option<String> {
        match self {
            Self::DefaultRepository => None,
            Self::Repository(value) => Some(value),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ProviderVaultScope {
    #[default]
    Unscoped,
    StoreId(String),
}

impl ProviderVaultScope {
    #[must_use]
    pub fn from_option(value: Option<String>) -> Self {
        match value {
            Some(value) => Self::StoreId(value),
            None => Self::Unscoped,
        }
    }

    #[must_use]
    pub fn as_deref(&self) -> Option<&str> {
        match self {
            Self::Unscoped => None,
            Self::StoreId(value) => Some(value),
        }
    }

    #[must_use]
    pub fn as_mut_string(&mut self) -> Option<&mut String> {
        match self {
            Self::Unscoped => None,
            Self::StoreId(value) => Some(value),
        }
    }

    #[must_use]
    pub fn into_option(self) -> Option<String> {
        match self {
            Self::Unscoped => None,
            Self::StoreId(value) => Some(value),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ActiveVaultScope {
    #[default]
    Unselected,
    StoreId(String),
}

impl ActiveVaultScope {
    #[must_use]
    pub fn from_option(value: Option<String>) -> Self {
        match value {
            Some(value) => Self::StoreId(value),
            None => Self::Unselected,
        }
    }

    #[must_use]
    pub fn as_deref(&self) -> Option<&str> {
        match self {
            Self::Unselected => None,
            Self::StoreId(value) => Some(value),
        }
    }

    #[must_use]
    pub fn as_mut_string(&mut self) -> Option<&mut String> {
        match self {
            Self::Unselected => None,
            Self::StoreId(value) => Some(value),
        }
    }

    #[must_use]
    pub fn into_option(self) -> Option<String> {
        match self {
            Self::Unselected => None,
            Self::StoreId(value) => Some(value),
        }
    }
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

    #[must_use]
    pub fn as_ref(&self) -> Option<&OAuthFileConfig> {
        match self {
            Self::NotApplicable => None,
            Self::Configured(config) => Some(config),
        }
    }

    #[must_use]
    pub fn as_mut(&mut self) -> Option<&mut OAuthFileConfig> {
        match self {
            Self::NotApplicable => None,
            Self::Configured(config) => Some(config),
        }
    }

    #[must_use]
    pub fn into_option(self) -> Option<OAuthFileConfig> {
        match self {
            Self::NotApplicable => None,
            Self::Configured(config) => Some(config),
        }
    }

    #[must_use]
    pub fn is_some_and(&self, predicate: impl FnOnce(&OAuthFileConfig) -> bool) -> bool {
        self.as_ref().is_some_and(predicate)
    }

    #[must_use]
    pub fn map<T>(&self, transform: impl FnOnce(&OAuthFileConfig) -> T) -> Option<T> {
        self.as_ref().map(transform)
    }

    #[must_use]
    pub fn map_or<T>(&self, default: T, transform: impl FnOnce(&OAuthFileConfig) -> T) -> T {
        self.as_ref().map_or(default, transform)
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

    #[must_use]
    pub fn as_ref(&self) -> Option<&LocalFolderConfig> {
        match self {
            Self::NotApplicable => None,
            Self::Configured(config) => Some(config),
        }
    }
}
