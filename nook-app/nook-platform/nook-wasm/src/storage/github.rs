//! GitHub-backed storage adapter.
//!
//! Provides the small subset of the GitHub REST API the wasm session
//! needs: lookup the authenticated user's login, ensure the vault repo
//! exists, fetch the vault file (with sha for optimistic concurrency),
//! and write the vault file with retry on stale-sha conflicts.
//!
//! Network errors bubble up as `NookError::Network` (from `reqwest`) or
//! `NookError::GitHub` for protocol-shaped failures.

mod create_request;
use create_request::GithubRepositoryCreateRequest;
mod response_mapping;
use response_mapping::{GitHubApiResponses, GitHubPutBody};
pub(crate) use response_mapping::{
    GitHubStorageClientGithubDirectoryListing, GitHubStorageClientGithubFileResponse,
    GitHubStorageClientGithubPutResponse, GitHubStorageClientGithubRepoCheckResult,
    GitHubStorageClientGithubUsernameResponse, GitHubStorageClientLogGithubApiFailure,
};

use js_sys::Date;
use reqwest::{Client, StatusCode};

use crate::NookError;
pub(crate) struct GitHubStorageClient<'a> {
    client: Client,
    credential: &'a str,
}
impl<'a> GitHubStorageClient<'a> {
    pub(crate) fn new(credential: &'a str) -> Self {
        Self {
            client: Client::new(),
            credential,
        }
    }
    fn as_str(&self) -> &'a str {
        self.credential
    }
}

pub(crate) struct GitHubStorageClientFetchGithubFileAtPath<'a> {
    pub(crate) repo: &'a str,
    pub(crate) path: &'a str,
}
mod discovery;
use discovery::GitHubDirectoryListing;
pub(crate) use discovery::{
    GitHubFileWrite, GitHubRootDiscovery, GitHubStorageClientFetchGithubVault,
    GitHubStorageClientWriteGithubTextFile, GitHubVaultDiscovery,
};
// -------------------------------------------------------------
// GitHub API Storage Functions (via reqwest Client)
// -------------------------------------------------------------

impl GitHubStorageClient<'_> {
    pub(crate) fn github_api_failure(status: StatusCode, message: String) -> NookError {
        GitHubApiResponses::api_failure(status, message)
    }
}

impl GitHubStorageClient<'_> {
    fn github_cache_bust_url(url: &str) -> String {
        let stamp = Date::now();
        if url.contains('?') {
            format!("{url}&_={stamp}")
        } else {
            format!("{url}?_={stamp}")
        }
    }
}

impl GitHubStorageClient<'_> {
    fn github_get_headers(&self) -> [(&'static str, String); 4] {
        let pat = self.as_str();
        [
            ("Authorization", format!("Bearer {}", pat.trim())),
            ("Accept", "application/vnd.github+json".to_owned()),
            ("X-GitHub-Api-Version", "2022-11-28".to_owned()),
            ("User-Agent", "nook-wasm".to_owned()),
        ]
    }
}

impl GitHubStorageClient<'_> {
    pub(crate) async fn fetch_github_username(&self) -> Result<String, NookError> {
        let pat = self.as_str();
        let pat = pat.trim();
        if pat.is_empty() {
            return Err(NookError::GitHub(
                "GitHub personal access token is required.".to_owned(),
            ));
        }

        let url = "https://api.github.com/user";
        let client = &self.client;
        let response = client
            .get(url)
            .header("Authorization", format!("Bearer {pat}"))
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header("User-Agent", "nook-wasm")
            .send()
            .await?;

        let status = response.status();
        let text = response.text().await?;
        GitHubApiResponses::github_username_response(GitHubStorageClientGithubUsernameResponse {
            status,
            text: &text,
        })
    }
}

impl GitHubStorageClient<'_> {
    pub(crate) async fn ensure_github_repo_exists(&self, repo: &str) -> Result<(), NookError> {
        let pat = self.as_str();
        let pat = pat.trim();
        let client = &self.client;
        let check_url = format!("https://api.github.com/repos/{repo}");
        let check = client
            .get(&check_url)
            .header("Authorization", format!("Bearer {pat}"))
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header("User-Agent", "nook-wasm")
            .send()
            .await?;

        if GitHubApiResponses::github_repo_check_result(GitHubStorageClientGithubRepoCheckResult {
            repo,
            status: check.status(),
        })? {
            return Ok(());
        }

        let repo_name = repo
            .split('/')
            .nth(1)
            .ok_or_else(|| NookError::GitHub(format!("Invalid repository name: {repo}")))?;

        let body = GithubRepositoryCreateRequest {
            name: repo_name,
            description: "Nook encrypted vault",
            private: true,
            auto_init: true,
        };

        let create = client
            .post("https://api.github.com/user/repos")
            .header("Authorization", format!("Bearer {pat}"))
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header("User-Agent", "nook-wasm")
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;

        if create.status().is_success() || create.status() == StatusCode::UNPROCESSABLE_ENTITY {
            // 422 = repo already exists (race) or name taken under another account
            return Ok(());
        }

        let status = create.status();
        GitHubApiResponses::log_failure(GitHubStorageClientLogGithubApiFailure {
            operation: "repo_create",
            repo,
            path: "",
            status,
        });
        Err(GitHubApiResponses::api_failure(
            status,
            format!("Failed to create GitHub repository {repo}: status {status}"),
        ))
    }
}

impl GitHubStorageClient<'_> {
    async fn fetch_github_file_at_path(
        &self,
        request: GitHubStorageClientFetchGithubFileAtPath<'_>,
    ) -> Result<GitHubVaultDiscovery, NookError> {
        let GitHubStorageClientFetchGithubFileAtPath { repo, path } = request;
        let pat = self.as_str();
        let client = &self.client;
        let mut request = client.get(GitHubStorageClient::github_cache_bust_url(&format!(
            "https://api.github.com/repos/{repo}/contents/{path}"
        )));
        for (name, value) in GitHubStorageClient::new(pat).github_get_headers() {
            request = request.header(name, value);
        }
        let file_response = request.send().await?;

        let status = file_response.status();
        let text = file_response.text().await?;
        GitHubApiResponses::github_file_response(GitHubStorageClientGithubFileResponse {
            status,
            text: &text,
            repo,
            path,
        })
    }
}

impl GitHubStorageClient<'_> {
    pub(crate) async fn fetch_github_vault(
        &self,
        request: GitHubStorageClientFetchGithubVault<'_>,
    ) -> Result<GitHubVaultDiscovery, NookError> {
        let GitHubStorageClientFetchGithubVault { repo, path, root } = request;
        let pat = self.as_str();
        if matches!(root, GitHubRootDiscovery::KnownUnavailable) {
            return Ok(GitHubVaultDiscovery::DirectoryUnavailable);
        }

        let pat = pat.trim();

        // Event files and other nested paths are not listed under the repo root.
        if path.contains('/') {
            return GitHubStorageClient::new(pat)
                .fetch_github_file_at_path(GitHubStorageClientFetchGithubFileAtPath { repo, path })
                .await;
        }

        let client = &self.client;
        let apply_headers = |request: reqwest::RequestBuilder| {
            let mut request = request;
            for (name, value) in GitHubStorageClient::new(pat).github_get_headers() {
                request = request.header(name, value);
            }
            request
        };

        // List repo root first so a missing vault file does not produce fetch 404
        // noise in the browser console (Chrome logs failed fetch responses).
        let list_url = GitHubStorageClient::github_cache_bust_url(&format!(
            "https://api.github.com/repos/{repo}/contents/"
        ));
        let list_response = apply_headers(client.get(&list_url)).send().await?;

        let list_status = list_response.status();
        let list_text = list_response.text().await?;
        let listing = GitHubApiResponses::github_directory_listing(
            GitHubStorageClientGithubDirectoryListing {
                status: list_status,
                text: &list_text,
                repo,
                path,
            },
        )?;
        match listing {
            GitHubDirectoryListing::DirectoryUnavailable => {
                return Ok(GitHubVaultDiscovery::DirectoryUnavailable);
            }
            GitHubDirectoryListing::FileUnlisted => return Ok(GitHubVaultDiscovery::FileMissing),
            GitHubDirectoryListing::FileListed => {}
        }

        GitHubStorageClient::new(pat)
            .fetch_github_file_at_path(GitHubStorageClientFetchGithubFileAtPath { repo, path })
            .await
    }
}

impl GitHubStorageClient<'_> {
    pub(crate) async fn write_github_text_file(
        &self,
        request: GitHubStorageClientWriteGithubTextFile<'_>,
    ) -> Result<String, NookError> {
        let GitHubStorageClientWriteGithubTextFile {
            repo,
            path,
            content,
            write,
        } = request;
        let pat = self.as_str();
        use base64::{Engine as _, engine::general_purpose};

        let base64_content = general_purpose::STANDARD.encode(content.as_bytes());

        let body = GitHubPutBody {
            message: "Update secrets store via Nook WASM".to_owned(),
            content: base64_content,
            sha: write,
        };

        let body_str = serde_json::to_string(&body)
            .map_err(|e| NookError::Serialization(format!("Failed to serialize body: {}", e)))?;

        let url = format!("https://api.github.com/repos/{}/contents/{}", repo, path);
        let client = &self.client;
        let response = client
            .put(&url)
            .header("Authorization", format!("Bearer {}", pat.trim()))
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header("User-Agent", "nook-wasm")
            .header("Content-Type", "application/json")
            .body(body_str)
            .send()
            .await?;

        let status = response.status();
        let text = response.text().await?;
        GitHubApiResponses::github_put_response(GitHubStorageClientGithubPutResponse {
            status,
            text: &text,
            repo,
            path,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn cache_busting_appends_the_right_separator() {
        let without_query =
            GitHubStorageClient::github_cache_bust_url("https://api.github.com/repos/example");
        assert!(without_query.starts_with("https://api.github.com/repos/example?_="));
        let with_query = GitHubStorageClient::github_cache_bust_url(
            "https://api.github.com/repos/example?ref=main",
        );
        assert!(with_query.starts_with("https://api.github.com/repos/example?ref=main&_="));
    }

    #[wasm_bindgen_test]
    fn request_headers_trim_tokens_and_pin_the_github_api_version() {
        assert_eq!(
            GitHubStorageClient::new("  pat  ").github_get_headers(),
            [
                ("Authorization", "Bearer pat".to_owned()),
                ("Accept", "application/vnd.github+json".to_owned()),
                ("X-GitHub-Api-Version", "2022-11-28".to_owned()),
                ("User-Agent", "nook-wasm".to_owned()),
            ]
        );
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn username_lookup_rejects_empty_token_before_network() -> anyhow::Result<()> {
        let Err(error) = GitHubStorageClient::new("  ").fetch_github_username().await else {
            anyhow::bail!("empty token must fail closed");
        };
        assert!(matches!(
            error,
            NookError::GitHub(message) if message == "GitHub personal access token is required."
        ));
        Ok(())
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn root_empty_short_circuits_vault_lookup() -> anyhow::Result<()> {
        let result = GitHubStorageClient::new("token")
            .fetch_github_vault(GitHubStorageClientFetchGithubVault {
                repo: "owner/repo",
                path: "vault.yaml",
                root: GitHubRootDiscovery::KnownUnavailable,
            })
            .await?;
        assert!(matches!(result, GitHubVaultDiscovery::DirectoryUnavailable));

        Ok(())
    }
}
