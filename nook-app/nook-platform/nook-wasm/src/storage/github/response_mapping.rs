//! GitHub REST response decoding and status mapping.

use super::discovery::{
    GitHubDirectoryListing, GitHubFileWrite, GitHubVaultDiscovery, GitHubVaultFile,
};
use crate::NookError;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};

pub(super) struct GitHubApiResponses;

#[derive(Clone, Copy)]
pub(crate) struct GitHubStorageClientLogGithubApiFailure<'a> {
    pub(crate) operation: &'a str,
    pub(crate) repo: &'a str,
    pub(crate) path: &'a str,
    pub(crate) status: StatusCode,
}

#[derive(Clone, Copy)]
pub(crate) struct GitHubStorageClientGithubUsernameResponse<'a> {
    pub(crate) status: StatusCode,
    pub(crate) text: &'a str,
}

#[derive(Clone, Copy)]
pub(crate) struct GitHubStorageClientGithubRepoCheckResult<'a> {
    pub(crate) repo: &'a str,
    pub(crate) status: StatusCode,
}

#[derive(Clone, Copy)]
pub(crate) struct GitHubStorageClientGithubDirectoryListing<'a> {
    pub(crate) status: StatusCode,
    pub(crate) text: &'a str,
    pub(crate) repo: &'a str,
    pub(crate) path: &'a str,
}

#[derive(Clone, Copy)]
pub(crate) struct GitHubStorageClientGithubFileResponse<'a> {
    pub(crate) status: StatusCode,
    pub(crate) text: &'a str,
    pub(crate) repo: &'a str,
    pub(crate) path: &'a str,
}

#[derive(Clone, Copy)]
pub(crate) struct GitHubStorageClientGithubPutResponse<'a> {
    pub(crate) status: StatusCode,
    pub(crate) text: &'a str,
    pub(crate) repo: &'a str,
    pub(crate) path: &'a str,
}

impl GitHubApiResponses {
    pub(super) fn log_failure(request: GitHubStorageClientLogGithubApiFailure<'_>) {
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

    pub(super) fn api_failure(status: StatusCode, message: String) -> NookError {
        if status == StatusCode::UNAUTHORIZED {
            NookError::GitHubTokenRejected
        } else {
            NookError::GitHub(message)
        }
    }

    fn base64_decode(input: &str) -> Result<Vec<u8>, NookError> {
        use base64::{Engine as _, engine::general_purpose};
        general_purpose::STANDARD
            .decode(input)
            .map_err(|e| NookError::Serialization(format!("Base64 decode error: {}", e)))
    }
}

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
pub(super) struct GitHubPutBody {
    pub(super) message: String,
    pub(super) content: String,
    #[serde(skip_serializing_if = "GitHubFileWrite::is_create")]
    pub(super) sha: GitHubFileWrite,
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

impl GitHubApiResponses {
    pub(super) fn github_username_response(
        request: GitHubStorageClientGithubUsernameResponse<'_>,
    ) -> Result<String, NookError> {
        let GitHubStorageClientGithubUsernameResponse { status, text } = request;
        if status == StatusCode::UNAUTHORIZED {
            GitHubApiResponses::log_failure(GitHubStorageClientLogGithubApiFailure {
                operation: "user",
                repo: "",
                path: "",
                status,
            });
            return Err(GitHubApiResponses::api_failure(
                status,
                "GitHub authentication failed.".to_owned(),
            ));
        }

        if !status.is_success() {
            GitHubApiResponses::log_failure(GitHubStorageClientLogGithubApiFailure {
                operation: "user",
                repo: "",
                path: "",
                status,
            });
            return Err(GitHubApiResponses::api_failure(
                status,
                format!("Failed to fetch GitHub user details: status {status}"),
            ));
        }

        let parsed: GitHubUserResponse = serde_json::from_str(text)
            .map_err(|e| NookError::Serialization(format!("Failed to parse user JSON: {}", e)))?;

        Ok(parsed.login)
    }
}

impl GitHubApiResponses {
    pub(super) fn github_repo_check_result(
        request: GitHubStorageClientGithubRepoCheckResult<'_>,
    ) -> Result<bool, NookError> {
        let GitHubStorageClientGithubRepoCheckResult { repo, status } = request;
        if status.is_success() {
            return Ok(true);
        }

        if status != StatusCode::NOT_FOUND {
            GitHubApiResponses::log_failure(GitHubStorageClientLogGithubApiFailure {
                operation: "repo_check",
                repo,
                path: "",
                status,
            });
            return Err(GitHubApiResponses::api_failure(
                status,
                format!("Failed to check GitHub repository {repo}: status {status}"),
            ));
        }

        Ok(false)
    }
}

impl GitHubApiResponses {
    pub(super) fn github_directory_listing(
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
            GitHubApiResponses::log_failure(GitHubStorageClientLogGithubApiFailure {
                operation: "contents_list",
                repo,
                path,
                status,
            });
            return Err(GitHubApiResponses::api_failure(
                status,
                format!("GitHub API responded with status {status}"),
            ));
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

impl GitHubApiResponses {
    pub(super) fn github_file_response(
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
            GitHubApiResponses::log_failure(GitHubStorageClientLogGithubApiFailure {
                operation: "file_fetch",
                repo,
                path,
                status,
            });
            return Err(GitHubApiResponses::api_failure(
                status,
                format!("GitHub API responded with status {status}"),
            ));
        }

        let parsed: GitHubFileResponse = serde_json::from_str(text)
            .map_err(|e| NookError::Serialization(format!("Failed to parse JSON: {}", e)))?;

        let cleaned_content = parsed
            .content
            .replace('\n', "")
            .replace('\r', "")
            .replace(' ', "");
        let decoded_bytes = GitHubApiResponses::base64_decode(&cleaned_content)?;
        let vault_content = String::from_utf8(decoded_bytes)
            .map_err(|e| NookError::Serialization(format!("Vault file is not valid UTF-8: {e}")))?;

        Ok(GitHubVaultDiscovery::FileLoaded(GitHubVaultFile {
            content: vault_content,
        }))
    }
}

impl GitHubApiResponses {
    pub(super) fn github_put_response(
        request: GitHubStorageClientGithubPutResponse<'_>,
    ) -> Result<String, NookError> {
        let GitHubStorageClientGithubPutResponse {
            status,
            text,
            repo,
            path,
        } = request;
        if !status.is_success() {
            GitHubApiResponses::log_failure(GitHubStorageClientLogGithubApiFailure {
                operation: "file_write",
                repo,
                path,
                status,
            });
            let message = if status == StatusCode::NOT_FOUND {
                format!(
                    "Cannot write to {repo}/{path} (404). Ensure your PAT has repo scope and you can access {repo}."
                )
            } else {
                format!("GitHub API responded with status {status}")
            };
            return Err(GitHubApiResponses::api_failure(status, message));
        }

        let parsed: GitHubPutResponse = serde_json::from_str(text)
            .map_err(|e| NookError::Serialization(format!("Failed to parse JSON: {}", e)))?;

        Ok(parsed.content.sha)
    }
}

#[cfg(test)]
pub mod tests {
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
    fn base64_decode_reports_success_and_serialization_failures() -> anyhow::Result<()> {
        assert_eq!(GitHubApiResponses::base64_decode("bm9vaw==")?, b"nook");
        assert!(
            matches!(GitHubApiResponses::base64_decode("not base64!"), Err(NookError::Serialization(message)) if message.contains("Base64 decode error"))
        );
        Ok(())
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
        let [first, second] = entries.as_slice() else {
            anyhow::bail!("file and directory fixtures must be present");
        };
        assert_eq!(first.name, "vault.yaml");
        assert_eq!(first.entry_type, "file");
        assert_eq!(second.entry_type, "dir");

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
    fn github_username_response_covers_auth_statuses_and_payloads() -> anyhow::Result<()> {
        assert!(matches!(
            GitHubApiResponses::github_username_response(
                GitHubStorageClientGithubUsernameResponse {
                    status: StatusCode::UNAUTHORIZED,
                    text: "",
                },
            ),
            Err(NookError::GitHubTokenRejected)
        ));

        assert!(matches!(GitHubApiResponses::github_username_response(
            GitHubStorageClientGithubUsernameResponse {
                status: StatusCode::BAD_GATEWAY,
                text: "",
            },
        ), Err(NookError::GitHub(message)) if message.contains("status 502")
        ));

        assert_eq!(
            GitHubApiResponses::github_username_response(
                GitHubStorageClientGithubUsernameResponse {
                    status: StatusCode::OK,
                    text: r#"{"login":"nook"}"#
                }
            )?,
            "nook"
        );
        let Err(malformed) = GitHubApiResponses::github_username_response(
            GitHubStorageClientGithubUsernameResponse {
                status: StatusCode::OK,
                text: "not-json",
            },
        ) else {
            anyhow::bail!("malformed user JSON must fail closed");
        };
        assert!(matches!(
            malformed,
            NookError::Serialization(message) if message.contains("Failed to parse user JSON")
        ));
        Ok(())
    }

    #[wasm_bindgen_test]
    fn github_repo_check_result_distinguishes_existing_missing_and_failure() -> anyhow::Result<()> {
        assert!(GitHubApiResponses::github_repo_check_result(
            GitHubStorageClientGithubRepoCheckResult {
                repo: "owner/repo",
                status: StatusCode::OK
            }
        )?);
        assert!(!GitHubApiResponses::github_repo_check_result(
            GitHubStorageClientGithubRepoCheckResult {
                repo: "owner/repo",
                status: StatusCode::NOT_FOUND
            }
        )?);
        let Err(error) = GitHubApiResponses::github_repo_check_result(
            GitHubStorageClientGithubRepoCheckResult {
                repo: "owner/repo",
                status: StatusCode::FORBIDDEN,
            },
        ) else {
            anyhow::bail!("forbidden repository checks must fail closed");
        };
        assert!(matches!(
            error,
            NookError::GitHub(message) if message.contains("owner/repo") && message.contains("403")
        ));
        Ok(())
    }

    #[wasm_bindgen_test]
    fn github_directory_listing_covers_missing_errors_and_file_matching() -> anyhow::Result<()> {
        assert_eq!(
            GitHubApiResponses::github_directory_listing(
                GitHubStorageClientGithubDirectoryListing {
                    status: StatusCode::NOT_FOUND,
                    text: "",
                    repo: "owner/repo",
                    path: "vault.yaml"
                }
            )?,
            GitHubDirectoryListing::DirectoryUnavailable
        );

        let Err(unavailable) = GitHubApiResponses::github_directory_listing(
            GitHubStorageClientGithubDirectoryListing {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                text: "",
                repo: "owner/repo",
                path: "vault.yaml",
            },
        ) else {
            anyhow::bail!("directory status failures must fail closed");
        };
        assert!(matches!(
            unavailable,
            NookError::GitHub(message) if message.contains("status 500")
        ));

        let Err(malformed) = GitHubApiResponses::github_directory_listing(
            GitHubStorageClientGithubDirectoryListing {
                status: StatusCode::OK,
                text: "not-json",
                repo: "owner/repo",
                path: "vault.yaml",
            },
        ) else {
            anyhow::bail!("malformed directory JSON must fail closed");
        };
        assert!(matches!(
            malformed,
            NookError::Serialization(message) if message.contains("directory listing")
        ));

        let listing = r#"[
            {"name":"vault.yaml","type":"file"},
            {"name":"events","type":"dir"}
        ]"#;
        assert_eq!(
            GitHubApiResponses::github_directory_listing(
                GitHubStorageClientGithubDirectoryListing {
                    status: StatusCode::OK,
                    text: listing,
                    repo: "owner/repo",
                    path: "vault.yaml"
                }
            )?,
            GitHubDirectoryListing::FileListed
        );
        assert_eq!(
            GitHubApiResponses::github_directory_listing(
                GitHubStorageClientGithubDirectoryListing {
                    status: StatusCode::OK,
                    text: listing,
                    repo: "owner/repo",
                    path: "missing.yaml"
                }
            )?,
            GitHubDirectoryListing::FileUnlisted
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn github_file_response_covers_missing_protocol_decode_and_utf8_errors() -> anyhow::Result<()> {
        assert!(matches!(
            GitHubApiResponses::github_file_response(GitHubStorageClientGithubFileResponse {
                status: StatusCode::NOT_FOUND,
                text: "",
                repo: "owner/repo",
                path: "vault.yaml"
            })?,
            GitHubVaultDiscovery::FileMissing
        ));

        let unavailable =
            GitHubApiResponses::github_file_response(GitHubStorageClientGithubFileResponse {
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
            GitHubApiResponses::github_file_response(GitHubStorageClientGithubFileResponse {
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
            GitHubApiResponses::github_file_response(GitHubStorageClientGithubFileResponse {
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
            GitHubApiResponses::github_file_response(GitHubStorageClientGithubFileResponse {
                status: StatusCode::OK,
                text: r#"{"content":" b m 9 v a w = =\n"}"#,
                repo: "owner/repo",
                path: "vault.yaml",
            })?
        else {
            panic!("valid file payload must decode")
        };
        assert_eq!(file.content, "nook");
        Ok(())
    }

    #[wasm_bindgen_test]
    fn github_put_response_covers_status_and_sha_projection() -> anyhow::Result<()> {
        let Err(missing) =
            GitHubApiResponses::github_put_response(GitHubStorageClientGithubPutResponse {
                status: StatusCode::NOT_FOUND,
                text: "",
                repo: "owner/repo",
                path: "vault.yaml",
            })
        else {
            anyhow::bail!("missing write target must fail closed");
        };
        assert!(matches!(
            missing,
            NookError::GitHub(message) if message.contains("Cannot write to owner/repo/vault.yaml")
        ));

        let Err(unavailable) =
            GitHubApiResponses::github_put_response(GitHubStorageClientGithubPutResponse {
                status: StatusCode::CONFLICT,
                text: "",
                repo: "owner/repo",
                path: "vault.yaml",
            })
        else {
            anyhow::bail!("write conflicts must be reported");
        };
        assert!(matches!(
            unavailable,
            NookError::GitHub(message) if message.contains("status 409")
        ));

        let Err(malformed) =
            GitHubApiResponses::github_put_response(GitHubStorageClientGithubPutResponse {
                status: StatusCode::OK,
                text: "not-json",
                repo: "owner/repo",
                path: "vault.yaml",
            })
        else {
            anyhow::bail!("malformed write JSON must fail closed");
        };
        assert!(matches!(
            malformed,
            NookError::Serialization(message) if message.contains("Failed to parse JSON")
        ));

        assert_eq!(
            GitHubApiResponses::github_put_response(GitHubStorageClientGithubPutResponse {
                status: StatusCode::CREATED,
                text: r#"{"content":{"sha":"sha-2"}}"#,
                repo: "owner/repo",
                path: "vault.yaml"
            })?,
            "sha-2"
        );
        Ok(())
    }
}
