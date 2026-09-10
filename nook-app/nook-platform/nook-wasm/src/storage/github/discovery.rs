//! GitHub discovery and optimistic file-write intent.
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy)]
pub(crate) enum GitHubRootDiscovery {
    Inspect,
    KnownUnavailable,
}
#[derive(Debug, PartialEq, Eq)]
pub(super) enum GitHubDirectoryListing {
    DirectoryUnavailable,
    FileListed,
    FileUnlisted,
}
#[derive(Debug)]
pub(crate) enum GitHubVaultDiscovery {
    DirectoryUnavailable,
    FileMissing,
    FileLoaded(GitHubVaultFile),
}
#[derive(Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub(crate) enum GitHubFileWrite {
    Update(String),
    #[default]
    Create,
}
impl GitHubFileWrite {
    pub(super) fn is_create(&self) -> bool {
        matches!(self, Self::Create)
    }
}
/// A YAML event file fetched from GitHub.
#[derive(Debug)]
pub(crate) struct GitHubVaultFile {
    pub(crate) content: String,
}

pub(crate) struct GitHubStorageClientFetchGithubVault<'a> {
    pub(crate) repo: &'a str,
    pub(crate) path: &'a str,
    pub(crate) root: GitHubRootDiscovery,
}
pub(crate) struct GitHubStorageClientWriteGithubTextFile<'a> {
    pub(crate) repo: &'a str,
    pub(crate) path: &'a str,
    pub(crate) content: &'a str,
    pub(crate) write: GitHubFileWrite,
}
