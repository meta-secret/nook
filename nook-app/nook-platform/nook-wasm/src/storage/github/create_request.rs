//! GitHub repository creation wire fields. Protocol-owned booleans are fixed by GitHub.
use serde::Serialize;

#[derive(Serialize)]
pub(super) struct GithubRepositoryCreateRequest<'a> {
    pub(super) name: &'a str,
    pub(super) description: &'static str,
    pub(super) private: bool,
    pub(super) auto_init: bool,
}
