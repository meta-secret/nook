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

use serde::{Deserialize, Serialize};

pub(crate) struct GitHubStorageClientFetchGithubFileAtPath<'a> {
    pub(crate) repo: &'a str,
    pub(crate) path: &'a str,
}
mod discovery;
use discovery::GitHubDirectoryListing;
pub(crate) use discovery::{
    GitHubFileWrite, GitHubRootDiscovery, GitHubStorageClientFetchGithubVault,
    GitHubStorageClientWriteGithubTextFile, GitHubVaultDiscovery, GitHubVaultFile,
};
impl GitHubStorageClient<'_> {
    fn log_github_api_failure(request: GitHubStorageClientLogGithubApiFailure<'_>) {
        let GitHubStorageClientLogGithubApiFailure {
            operation,
            repo,
            path,
            status,
        } = request;
        tracing::warn!(
            scope = "github",
            operation,
            repo = %repo,
            path = %path,
            status = %status,
            "GitHub API request failed"
        );
    }
}

// -------------------------------------------------------------
// GitHub API Storage Functions (via reqwest Client)
// -------------------------------------------------------------

#[derive(Deserialize)]
struct GitHubFileResponse {
    content: String,
}

#[derive(Deserialize)]
struct GitHubDirEntry {
    name: String,
    #[serde(rename = "type")]
    entry_type: String,
}

#[derive(Serialize)]
struct GitHubPutBody {
    message: String,
    content: String,
    #[serde(skip_serializing_if = "GitHubFileWrite::is_create")]
    sha: GitHubFileWrite,
}

#[derive(Deserialize)]
struct GitHubPutResponse {
    content: GitHubPutResponseContent,
}

#[derive(Deserialize)]
struct GitHubPutResponseContent {
    sha: String,
}

#[derive(Deserialize)]
struct GitHubUserResponse {
    login: String,
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
    fn github_username_response(
        request: GitHubStorageClientGithubUsernameResponse<'_>,
    ) -> Result<String, NookError> {
        let GitHubStorageClientGithubUsernameResponse { status, text } = request;
        if status == StatusCode::UNAUTHORIZED {
            GitHubStorageClient::log_github_api_failure(GitHubStorageClientLogGithubApiFailure {
                operation: "user",
                repo: "",
                path: "",
                status: status,
            });
            return Err(NookError::GitHub(
            "GitHub rejected your token (401). Check that it is valid, not expired, and has repo access.".to_owned(),
        ));
        }

        if !status.is_success() {
            GitHubStorageClient::log_github_api_failure(GitHubStorageClientLogGithubApiFailure {
                operation: "user",
                repo: "",
                path: "",
                status: status,
            });
            return Err(NookError::GitHub(format!(
                "Failed to fetch GitHub user details: status {status}"
            )));
        }

        let parsed: GitHubUserResponse = serde_json::from_str(text)
            .map_err(|e| NookError::Serialization(format!("Failed to parse user JSON: {}", e)))?;

        Ok(parsed.login)
    }
}

impl GitHubStorageClient<'_> {
    fn github_repo_check_result(
        request: GitHubStorageClientGithubRepoCheckResult<'_>,
    ) -> Result<bool, NookError> {
        let GitHubStorageClientGithubRepoCheckResult { repo, status } = request;
        if status.is_success() {
            return Ok(true);
        }

        if status != StatusCode::NOT_FOUND {
            GitHubStorageClient::log_github_api_failure(GitHubStorageClientLogGithubApiFailure {
                operation: "repo_check",
                repo: repo,
                path: "",
                status: status,
            });
            return Err(NookError::GitHub(format!(
                "Failed to check GitHub repository {repo}: status {status}"
            )));
        }

        Ok(false)
    }
}

impl GitHubStorageClient<'_> {
    fn github_directory_listing(
        request: GitHubStorageClientGithubDirectoryListing<'_>,
    ) -> Result<GitHubDirectoryListing, NookError> {
        let GitHubStorageClientGithubDirectoryListing {
            status,
            text,
            repo,
            path,
        } = request;
        if status == StatusCode::NOT_FOUND {
            return Ok(GitHubDirectoryListing::DirectoryUnavailable);
        }

        if !status.is_success() {
            GitHubStorageClient::log_github_api_failure(GitHubStorageClientLogGithubApiFailure {
                operation: "contents_list",
                repo: repo,
                path: path,
                status: status,
            });
            return Err(NookError::GitHub(format!(
                "GitHub API responded with status {status}"
            )));
        }

        let entries: Vec<GitHubDirEntry> = serde_json::from_str(text).map_err(|e| {
            NookError::Serialization(format!("Failed to parse GitHub directory listing: {e}"))
        })?;

        Ok(
            if entries
                .iter()
                .any(|item| item.name == path && item.entry_type == "file")
            {
                GitHubDirectoryListing::FileListed
            } else {
                GitHubDirectoryListing::FileUnlisted
            },
        )
    }
}

impl GitHubStorageClient<'_> {
    fn github_file_response(
        request: GitHubStorageClientGithubFileResponse<'_>,
    ) -> Result<GitHubVaultDiscovery, NookError> {
        let GitHubStorageClientGithubFileResponse {
            status,
            text,
            repo,
            path,
        } = request;
        if status == StatusCode::NOT_FOUND {
            return Ok(GitHubVaultDiscovery::FileMissing);
        }

        if !status.is_success() {
            GitHubStorageClient::log_github_api_failure(GitHubStorageClientLogGithubApiFailure {
                operation: "file_fetch",
                repo: repo,
                path: path,
                status: status,
            });
            return Err(NookError::GitHub(format!(
                "GitHub API responded with status {status}"
            )));
        }

        let parsed: GitHubFileResponse = serde_json::from_str(text)
            .map_err(|e| NookError::Serialization(format!("Failed to parse JSON: {}", e)))?;

        let cleaned_content = parsed
            .content
            .replace('\n', "")
            .replace('\r', "")
            .replace(' ', "");
        let decoded_bytes = GitHubStorageClient::base64_decode(&cleaned_content)?;
        let vault_content = String::from_utf8(decoded_bytes)
            .map_err(|e| NookError::Serialization(format!("Vault file is not valid UTF-8: {e}")))?;

        Ok(GitHubVaultDiscovery::FileLoaded(GitHubVaultFile {
            content: vault_content,
        }))
    }
}

impl GitHubStorageClient<'_> {
    fn github_put_response(
        request: GitHubStorageClientGithubPutResponse<'_>,
    ) -> Result<String, NookError> {
        let GitHubStorageClientGithubPutResponse {
            status,
            text,
            repo,
            path,
        } = request;
        if !status.is_success() {
            GitHubStorageClient::log_github_api_failure(GitHubStorageClientLogGithubApiFailure {
                operation: "file_write",
                repo: repo,
                path: path,
                status: status,
            });
            let message = if status == StatusCode::NOT_FOUND {
                format!(
                    "Cannot write to {repo}/{path} (404). Ensure your PAT has repo scope and you can access {repo}."
                )
            } else {
                format!("GitHub API responded with status {status}")
            };
            return Err(NookError::GitHub(message));
        }

        let parsed: GitHubPutResponse = serde_json::from_str(text)
            .map_err(|e| NookError::Serialization(format!("Failed to parse JSON: {}", e)))?;

        Ok(parsed.content.sha)
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
        GitHubStorageClient::github_username_response(GitHubStorageClientGithubUsernameResponse {
            status: status,
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

        if GitHubStorageClient::github_repo_check_result(
            GitHubStorageClientGithubRepoCheckResult {
                repo: repo,
                status: check.status(),
            },
        )? {
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
        GitHubStorageClient::log_github_api_failure(GitHubStorageClientLogGithubApiFailure {
            operation: "repo_create",
            repo: repo,
            path: "",
            status: status,
        });
        Err(NookError::GitHub(format!(
            "Failed to create GitHub repository {repo}: status {status}"
        )))
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
        GitHubStorageClient::github_file_response(GitHubStorageClientGithubFileResponse {
            status: status,
            text: &text,
            repo: repo,
            path: path,
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
                .fetch_github_file_at_path(GitHubStorageClientFetchGithubFileAtPath {
                    repo: repo,
                    path: path,
                })
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
        let listing = GitHubStorageClient::github_directory_listing(
            GitHubStorageClientGithubDirectoryListing {
                status: list_status,
                text: &list_text,
                repo: repo,
                path: path,
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
            .fetch_github_file_at_path(GitHubStorageClientFetchGithubFileAtPath {
                repo: repo,
                path: path,
            })
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
        GitHubStorageClient::github_put_response(GitHubStorageClientGithubPutResponse {
            status: status,
            text: &text,
            repo: repo,
            path: path,
        })
    }
}

impl GitHubStorageClient<'_> {
    fn base64_decode(input: &str) -> Result<Vec<u8>, NookError> {
        use base64::{Engine as _, engine::general_purpose};
        general_purpose::STANDARD
            .decode(input)
            .map_err(|e| NookError::Serialization(format!("Base64 decode error: {}", e)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[derive(Deserialize)]
    struct SerializedPutBody {
        message: String,
        content: String,
        #[serde(default)]
        sha: GitHubFileWrite,
    }

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
    fn base64_decode_reports_success_and_serialization_failures() {
        assert_eq!(
            GitHubStorageClient::base64_decode("bm9vaw==").unwrap(),
            b"nook"
        );
        let error = GitHubStorageClient::base64_decode("not base64!")
            .expect_err("invalid base64 must fail closed");
        assert!(
            matches!(error, NookError::Serialization(message) if message.contains("Base64 decode error"))
        );
    }

    #[wasm_bindgen_test]
    fn github_response_shapes_decode_expected_file_and_write_fields() -> anyhow::Result<()> {
        let file: GitHubFileResponse = serde_json::from_str(r#"{"content":"bm9vaw=="}"#)?;
        assert_eq!(file.content, "bm9vaw==");
        let put: GitHubPutResponse = serde_json::from_str(r#"{"content":{"sha":"abc123"}}"#)?;
        assert_eq!(put.content.sha, "abc123");
        let user: GitHubUserResponse = serde_json::from_str(r#"{"login":"nook"}"#)?;
        assert_eq!(user.login, "nook");
        Ok(())
    }

    #[wasm_bindgen_test]
    fn github_directory_entries_and_put_body_preserve_wire_shape() -> anyhow::Result<()> {
        let entries: Vec<GitHubDirEntry> = serde_json::from_str(
            r#"[{"name":"vault.yaml","type":"file"},{"name":"events","type":"dir"}]"#,
        )?;
        assert_eq!(entries[0].name, "vault.yaml");
        assert_eq!(entries[0].entry_type, "file");
        assert_eq!(entries[1].entry_type, "dir");

        let without_sha = serde_json::to_value(GitHubPutBody {
            message: "Update".to_owned(),
            content: "bm9vaw==".to_owned(),
            sha: GitHubFileWrite::Create,
        })?;
        let without_sha: SerializedPutBody = serde_json::from_value(without_sha)?;
        assert_eq!(without_sha.message, "Update");
        assert_eq!(without_sha.content, "bm9vaw==");
        assert!(matches!(without_sha.sha, GitHubFileWrite::Create));
        let with_sha = serde_json::to_value(GitHubPutBody {
            message: "Update".to_owned(),
            content: "bm9vaw==".to_owned(),
            sha: GitHubFileWrite::Update("sha-1".to_owned()),
        })?;
        let with_sha: SerializedPutBody = serde_json::from_value(with_sha)?;
        assert_eq!(with_sha.sha, GitHubFileWrite::Update("sha-1".to_owned()));
        Ok(())
    }

    #[wasm_bindgen_test]
    fn github_username_response_covers_auth_statuses_and_payloads() {
        let unauthorized = GitHubStorageClient::github_username_response(
            GitHubStorageClientGithubUsernameResponse {
                status: StatusCode::UNAUTHORIZED,
                text: "",
            },
        )
        .expect_err("401 must be reported as a GitHub error");
        assert!(matches!(
            unauthorized,
            NookError::GitHub(message) if message.contains("rejected your token")
        ));

        let unavailable = GitHubStorageClient::github_username_response(
            GitHubStorageClientGithubUsernameResponse {
                status: StatusCode::BAD_GATEWAY,
                text: "",
            },
        )
        .expect_err("non-success status must be reported");
        assert!(matches!(
            unavailable,
            NookError::GitHub(message) if message.contains("status 502")
        ));

        assert_eq!(
            GitHubStorageClient::github_username_response(
                GitHubStorageClientGithubUsernameResponse {
                    status: StatusCode::OK,
                    text: r#"{"login":"nook"}"#
                }
            )
            .unwrap(),
            "nook"
        );
        let malformed = GitHubStorageClient::github_username_response(
            GitHubStorageClientGithubUsernameResponse {
                status: StatusCode::OK,
                text: "not-json",
            },
        )
        .expect_err("malformed user JSON must fail closed");
        assert!(matches!(
            malformed,
            NookError::Serialization(message) if message.contains("Failed to parse user JSON")
        ));
    }

    #[wasm_bindgen_test]
    fn github_repo_check_result_distinguishes_existing_missing_and_failure() {
        assert!(
            GitHubStorageClient::github_repo_check_result(
                GitHubStorageClientGithubRepoCheckResult {
                    repo: "owner/repo",
                    status: StatusCode::OK
                }
            )
            .unwrap()
        );
        assert!(
            !GitHubStorageClient::github_repo_check_result(
                GitHubStorageClientGithubRepoCheckResult {
                    repo: "owner/repo",
                    status: StatusCode::NOT_FOUND
                }
            )
            .unwrap()
        );
        let error = GitHubStorageClient::github_repo_check_result(
            GitHubStorageClientGithubRepoCheckResult {
                repo: "owner/repo",
                status: StatusCode::FORBIDDEN,
            },
        )
        .expect_err("forbidden repository checks must fail closed");
        assert!(matches!(
            error,
            NookError::GitHub(message) if message.contains("owner/repo") && message.contains("403")
        ));
    }

    #[wasm_bindgen_test]
    fn github_directory_listing_covers_missing_errors_and_file_matching() {
        assert_eq!(
            GitHubStorageClient::github_directory_listing(
                GitHubStorageClientGithubDirectoryListing {
                    status: StatusCode::NOT_FOUND,
                    text: "",
                    repo: "owner/repo",
                    path: "vault.yaml"
                }
            )
            .unwrap(),
            GitHubDirectoryListing::DirectoryUnavailable
        );

        let unavailable = GitHubStorageClient::github_directory_listing(
            GitHubStorageClientGithubDirectoryListing {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                text: "",
                repo: "owner/repo",
                path: "vault.yaml",
            },
        )
        .expect_err("directory status failures must fail closed");
        assert!(matches!(
            unavailable,
            NookError::GitHub(message) if message.contains("status 500")
        ));

        let malformed = GitHubStorageClient::github_directory_listing(
            GitHubStorageClientGithubDirectoryListing {
                status: StatusCode::OK,
                text: "not-json",
                repo: "owner/repo",
                path: "vault.yaml",
            },
        )
        .expect_err("malformed directory JSON must fail closed");
        assert!(matches!(
            malformed,
            NookError::Serialization(message) if message.contains("directory listing")
        ));

        let listing = r#"[
            {"name":"vault.yaml","type":"file"},
            {"name":"events","type":"dir"}
        ]"#;
        assert_eq!(
            GitHubStorageClient::github_directory_listing(
                GitHubStorageClientGithubDirectoryListing {
                    status: StatusCode::OK,
                    text: listing,
                    repo: "owner/repo",
                    path: "vault.yaml"
                }
            )
            .unwrap(),
            GitHubDirectoryListing::FileListed
        );
        assert_eq!(
            GitHubStorageClient::github_directory_listing(
                GitHubStorageClientGithubDirectoryListing {
                    status: StatusCode::OK,
                    text: listing,
                    repo: "owner/repo",
                    path: "missing.yaml"
                }
            )
            .unwrap(),
            GitHubDirectoryListing::FileUnlisted
        );
    }

    #[wasm_bindgen_test]
    fn github_file_response_covers_missing_protocol_decode_and_utf8_errors() {
        assert!(matches!(
            GitHubStorageClient::github_file_response(GitHubStorageClientGithubFileResponse {
                status: StatusCode::NOT_FOUND,
                text: "",
                repo: "owner/repo",
                path: "vault.yaml"
            })
            .unwrap(),
            GitHubVaultDiscovery::FileMissing
        ));

        let unavailable =
            GitHubStorageClient::github_file_response(GitHubStorageClientGithubFileResponse {
                status: StatusCode::SERVICE_UNAVAILABLE,
                text: "",
                repo: "owner/repo",
                path: "vault.yaml",
            });
        assert!(matches!(
            unavailable,
            Err(NookError::GitHub(message)) if message.contains("status 503")
        ));

        let malformed =
            GitHubStorageClient::github_file_response(GitHubStorageClientGithubFileResponse {
                status: StatusCode::OK,
                text: "not-json",
                repo: "owner/repo",
                path: "vault.yaml",
            });
        assert!(matches!(
            malformed,
            Err(NookError::Serialization(message)) if message.contains("Failed to parse JSON")
        ));

        let invalid_utf8 =
            GitHubStorageClient::github_file_response(GitHubStorageClientGithubFileResponse {
                status: StatusCode::OK,
                text: r#"{"content":"/w=="}"#,
                repo: "owner/repo",
                path: "vault.yaml",
            });
        assert!(matches!(
            invalid_utf8,
            Err(NookError::Serialization(message)) if message.contains("not valid UTF-8")
        ));

        let GitHubVaultDiscovery::FileLoaded(file) =
            GitHubStorageClient::github_file_response(GitHubStorageClientGithubFileResponse {
                status: StatusCode::OK,
                text: r#"{"content":" b m 9 v a w = =\n"}"#,
                repo: "owner/repo",
                path: "vault.yaml",
            })
            .unwrap()
        else {
            panic!("valid file payload must decode")
        };
        assert_eq!(file.content, "nook");
    }

    #[wasm_bindgen_test]
    fn github_put_response_covers_status_and_sha_projection() {
        let missing =
            GitHubStorageClient::github_put_response(GitHubStorageClientGithubPutResponse {
                status: StatusCode::NOT_FOUND,
                text: "",
                repo: "owner/repo",
                path: "vault.yaml",
            })
            .expect_err("missing write target must fail closed");
        assert!(matches!(
            missing,
            NookError::GitHub(message) if message.contains("Cannot write to owner/repo/vault.yaml")
        ));

        let unavailable =
            GitHubStorageClient::github_put_response(GitHubStorageClientGithubPutResponse {
                status: StatusCode::CONFLICT,
                text: "",
                repo: "owner/repo",
                path: "vault.yaml",
            })
            .expect_err("write conflicts must be reported");
        assert!(matches!(
            unavailable,
            NookError::GitHub(message) if message.contains("status 409")
        ));

        let malformed =
            GitHubStorageClient::github_put_response(GitHubStorageClientGithubPutResponse {
                status: StatusCode::OK,
                text: "not-json",
                repo: "owner/repo",
                path: "vault.yaml",
            })
            .expect_err("malformed write JSON must fail closed");
        assert!(matches!(
            malformed,
            NookError::Serialization(message) if message.contains("Failed to parse JSON")
        ));

        assert_eq!(
            GitHubStorageClient::github_put_response(GitHubStorageClientGithubPutResponse {
                status: StatusCode::CREATED,
                text: r#"{"content":{"sha":"sha-2"}}"#,
                repo: "owner/repo",
                path: "vault.yaml"
            })
            .unwrap(),
            "sha-2"
        );
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    async fn username_lookup_rejects_empty_token_before_network() {
        let error = GitHubStorageClient::new("  ")
            .fetch_github_username()
            .await
            .expect_err("empty token must fail closed");
        assert!(matches!(
            error,
            NookError::GitHub(message) if message == "GitHub personal access token is required."
        ));
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
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
/// Named values required by GitHubStorageClient::log_github_api_failure.
pub(crate) struct GitHubStorageClientLogGithubApiFailure<'a> {
    pub(crate) operation: &'a str,
    pub(crate) repo: &'a str,
    pub(crate) path: &'a str,
    pub(crate) status: reqwest::StatusCode,
}

/// Named values required by GitHubStorageClient::github_username_response.
pub(crate) struct GitHubStorageClientGithubUsernameResponse<'a> {
    pub(crate) status: StatusCode,
    pub(crate) text: &'a str,
}

/// Named values required by GitHubStorageClient::github_repo_check_result.
pub(crate) struct GitHubStorageClientGithubRepoCheckResult<'a> {
    pub(crate) repo: &'a str,
    pub(crate) status: StatusCode,
}

/// Named values required by GitHubStorageClient::github_directory_listing.
pub(crate) struct GitHubStorageClientGithubDirectoryListing<'a> {
    pub(crate) status: StatusCode,
    pub(crate) text: &'a str,
    pub(crate) repo: &'a str,
    pub(crate) path: &'a str,
}

/// Named values required by GitHubStorageClient::github_file_response.
pub(crate) struct GitHubStorageClientGithubFileResponse<'a> {
    pub(crate) status: StatusCode,
    pub(crate) text: &'a str,
    pub(crate) repo: &'a str,
    pub(crate) path: &'a str,
}

/// Named values required by GitHubStorageClient::github_put_response.
pub(crate) struct GitHubStorageClientGithubPutResponse<'a> {
    pub(crate) status: StatusCode,
    pub(crate) text: &'a str,
    pub(crate) repo: &'a str,
    pub(crate) path: &'a str,
}
