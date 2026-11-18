use std::env;
use std::ops::Deref;
use std::path::{Path, PathBuf};

pub(crate) struct RepositoryFixture(PathBuf);

impl RepositoryFixture {
    pub(crate) fn repository_root() -> Self {
        Self(env::var_os("NOOK_REPO_ROOT").map_or_else(
            || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
            PathBuf::from,
        ))
    }
}

impl Deref for RepositoryFixture {
    type Target = Path;

    fn deref(&self) -> &Path {
        &self.0
    }
}

impl AsRef<Path> for RepositoryFixture {
    fn as_ref(&self) -> &Path {
        self
    }
}
