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
use nook_core::ProviderSecretText;
use reqwest::header::{ACCEPT, CONTENT_TYPE, HeaderMap, HeaderName, HeaderValue, USER_AGENT};
use reqwest::{Client, Method, RequestBuilder, StatusCode};

use crate::NookError;
/// A GitHub API client: every request carries GitHub's API headers and this
/// browser's token as its bearer credential.
pub(crate) struct GitHubStorageClient<'a> {
    client: Client,
    token: &'a ProviderSecretText,
}

/// One GitHub API request line.
pub(crate) struct GitHubRequest<'a> {
    pub(crate) method: Method,
    pub(crate) url: &'a str,
}

impl<'a> GitHubStorageClient<'a> {
    const ACCEPT: &'static str = "application/vnd.github+json";
    const API_VERSION_HEADER: &'static str = "x-github-api-version";
    const API_VERSION: &'static str = "2022-11-28";
    const USER_AGENT: &'static str = "nook-wasm";

    pub(crate) fn new(token: &'a ProviderSecretText) -> Result<Self, NookError> {
        Ok(Self {
            client: Client::builder()
                .default_headers(Self::default_headers())
                .build()?,
            token,
        })
    }

    /// The headers every GitHub request carries.
    fn default_headers() -> HeaderMap {
        HeaderMap::from_iter([
            (ACCEPT, HeaderValue::from_static(Self::ACCEPT)),
            (
                HeaderName::from_static(Self::API_VERSION_HEADER),
                HeaderValue::from_static(Self::API_VERSION),
            ),
            (USER_AGENT, HeaderValue::from_static(Self::USER_AGENT)),
        ])
    }

    /// One request with the token as its bearer credential.
    pub(crate) fn call(&self, request: GitHubRequest<'_>) -> RequestBuilder {
        self.client
            .request(request.method, request.url)
            .bearer_auth(self.token.expose())
    }
}

pub(crate) struct GitHubStorageClientFetchGithubFileAtPath<'a> {
    pub(crate) repo: &'a str,
    pub(crate) path: &'a str,
}
mod discovery;
use discovery::GitHubDirectoryListing;
pub(crate) use discovery::{
    GitHubRootDiscovery, GitHubStorageClientFetchGithubVault,
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
    pub(crate) async fn fetch_github_username(&self) -> Result<String, NookError> {
        let response = self
            .call(GitHubRequest {
                method: Method::GET,
                url: "https://api.github.com/user",
            })
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
        let check_url = format!("https://api.github.com/repos/{repo}");
        let check = self
            .call(GitHubRequest {
                method: Method::GET,
                url: &check_url,
            })
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

        let create = self
            .call(GitHubRequest {
                method: Method::POST,
                url: "https://api.github.com/user/repos",
            })
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
        let url = GitHubStorageClient::github_cache_bust_url(&format!(
            "https://api.github.com/repos/{repo}/contents/{path}"
        ));
        let file_response = self
            .call(GitHubRequest {
                method: Method::GET,
                url: &url,
            })
            .send()
            .await?;

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
        if matches!(root, GitHubRootDiscovery::KnownUnavailable) {
            return Ok(GitHubVaultDiscovery::DirectoryUnavailable);
        }

        // Event files and other nested paths are not listed under the repo root.
        if path.contains('/') {
            return self
                .fetch_github_file_at_path(GitHubStorageClientFetchGithubFileAtPath { repo, path })
                .await;
        }

        // List repo root first so a missing vault file does not produce fetch 404
        // noise in the browser console (Chrome logs failed fetch responses).
        let list_url = GitHubStorageClient::github_cache_bust_url(&format!(
            "https://api.github.com/repos/{repo}/contents/"
        ));
        let list_response = self
            .call(GitHubRequest {
                method: Method::GET,
                url: &list_url,
            })
            .send()
            .await?;

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

        self.fetch_github_file_at_path(GitHubStorageClientFetchGithubFileAtPath { repo, path })
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
        } = request;
        use base64::{Engine as _, engine::general_purpose};

        let base64_content = general_purpose::STANDARD.encode(content.as_bytes());

        let body = GitHubPutBody {
            message: "Update secrets store via Nook WASM".to_owned(),
            content: base64_content,
        };

        let body_str = serde_json::to_string(&body)
            .map_err(|e| NookError::Serialization(format!("Failed to serialize body: {}", e)))?;

        let url = format!("https://api.github.com/repos/{}/contents/{}", repo, path);
        let response = self
            .call(GitHubRequest {
                method: Method::PUT,
                url: &url,
            })
            .header(CONTENT_TYPE, "application/json")
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
    use crate::test_fixtures::WasmFixture;
    use reqwest::header::AUTHORIZATION;
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
    fn every_request_pins_the_github_api_and_carries_the_token() -> anyhow::Result<()> {
        let headers = GitHubStorageClient::default_headers();
        assert_eq!(
            headers.get(ACCEPT).map(HeaderValue::as_bytes),
            Some(&b"application/vnd.github+json"[..])
        );
        assert_eq!(
            headers
                .get("x-github-api-version")
                .map(HeaderValue::as_bytes),
            Some(&b"2022-11-28"[..])
        );
        assert_eq!(
            headers.get(USER_AGENT).map(HeaderValue::as_bytes),
            Some(&b"nook-wasm"[..])
        );
        let token = WasmFixture::secret("TEST-ONLY-pat")?;
        let request = GitHubStorageClient::new(&token)?
            .call(GitHubRequest {
                method: Method::GET,
                url: "https://api.github.com/user",
            })
            .build()?;
        assert_eq!(
            request
                .headers()
                .get(AUTHORIZATION)
                .map(HeaderValue::as_bytes),
            Some(&b"Bearer TEST-ONLY-pat"[..])
        );
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
        let token = WasmFixture::secret("token")?;
        let result = GitHubStorageClient::new(&token)?
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
