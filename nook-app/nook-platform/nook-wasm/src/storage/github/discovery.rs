//! GitHub discovery modes.
#[derive(Clone, Copy)]
pub(crate) enum GitHubRootDiscovery {
    Inspect,
    #[allow(dead_code)]
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
}
