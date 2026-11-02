//! The named states of a provider row's common fields.
use serde::{Deserialize, Serialize};
use tsify::Tsify;

/// The repository a GitHub provider uses: its own name, or the default one.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
pub enum StoredGithubRepository {
    DefaultRepository,
    Repository(String),
}

/// The vault a row belongs to. Only this browser's own store belongs to one;
/// every remote row is an identity mount that keeps each vault apart.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
pub enum ProviderVaultScope {
    Unscoped,
    StoreId(String),
}

/// The vault the snapshot's browser has selected, if one is.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
pub enum ActiveVaultScope {
    #[default]
    Unselected,
    StoreId(String),
}
