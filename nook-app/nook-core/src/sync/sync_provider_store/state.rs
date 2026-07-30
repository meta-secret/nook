use serde::{Deserialize, Serialize};
use tsify::Tsify;

use super::{LocalFolderConfig, OAuthFileConfig};

macro_rules! semantic_string_state {
    ($name:ident, $missing:ident, $present:ident) => {
        #[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
        #[serde(tag = "state", content = "value", rename_all = "camelCase")]
        #[tsify(into_wasm_abi, from_wasm_abi)]
        pub enum $name {
            #[default]
            $missing,
            $present(String),
        }

        impl $name {
            #[must_use]
            pub fn from_option(value: Option<String>) -> Self {
                match value {
                    Some(value) => Self::$present(value),
                    None => Self::$missing,
                }
            }

            #[must_use]
            pub fn as_deref(&self) -> Option<&str> {
                match self {
                    Self::$missing => None,
                    Self::$present(value) => Some(value),
                }
            }

            #[must_use]
            pub fn as_mut_string(&mut self) -> Option<&mut String> {
                match self {
                    Self::$missing => None,
                    Self::$present(value) => Some(value),
                }
            }

            #[must_use]
            pub fn into_option(self) -> Option<String> {
                match self {
                    Self::$missing => None,
                    Self::$present(value) => Some(value),
                }
            }
        }
    };
}

semantic_string_state!(StoredOAuthRefreshCredential, NotIssued, Token);
semantic_string_state!(StoredOAuthAccessCredential, SignedOut, AccessToken);
semantic_string_state!(StoredOAuthTokenExpiry, Unknown, ExpiresAt);
semantic_string_state!(StoredOAuthRemoteFileId, Unresolved, FileId);
semantic_string_state!(StoredOAuthRemoteFileName, Unresolved, FileName);
semantic_string_state!(StoredOAuthAccountIdentity, Unknown, Email);
semantic_string_state!(StoredGoogleDriveFolder, Root, FolderId);
semantic_string_state!(StoredICloudShareTarget, Personal, SharedTarget);
semantic_string_state!(StoredLocalFolderDirectory, Unnamed, DirectoryName);
semantic_string_state!(StoredLocalFolderHandle, Unbound, HandleId);
semantic_string_state!(StoredGithubPat, Missing, Token);
semantic_string_state!(StoredGithubRepository, DefaultRepository, Repository);
semantic_string_state!(ProviderVaultScope, Unscoped, StoreId);
semantic_string_state!(ActiveVaultScope, Unselected, StoreId);

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
