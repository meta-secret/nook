#[path = "repository.rs"]
mod repository;

pub(crate) use repository::RepositoryFixture;
use std::{fs, path::Path};

pub(crate) trait RepositoryPathRead {
    fn read(&self, relative_path: &str) -> String;
}

impl RepositoryPathRead for Path {
    fn read(&self, relative_path: &str) -> String {
        fs::read_to_string(self.join(relative_path))
            .unwrap_or_else(|error| panic!("failed to read {relative_path}: {error}"))
    }
}
