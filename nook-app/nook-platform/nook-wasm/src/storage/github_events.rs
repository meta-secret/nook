//! GitHub immutable event file adapter (`put_event_if_absent`).

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::GitHubStorageClient;
use crate::GitHubStorageClientFetchGithubVault;
use crate::GitHubStorageClientWriteGithubTextFile;
use nook_core::EventId;
#[cfg(test)]
use nook_core::{GenesisImportRequest, VaultEvent};
use reqwest::{Client, StatusCode};
use std::path::Path;
use std::str;

use super::checked_event_write::CheckedEventWrite;
use super::github::{GitHubFileWrite, GitHubRootDiscovery, GitHubVaultDiscovery};
use super::remote_event::RemoteEventRead;
use crate::NookError;
#[derive(Clone, Copy)]
struct RepositoryResponse<'a> {
    status: StatusCode,
    text: &'a str,
    repo: &'a str,
}
enum RepositoryDiscovery {
    Missing,
    Loaded(GitHubRepoResponse),
}
enum TreeDiscovery {
    Missing,
    Loaded(GitTreeResponse),
}
#[derive(Debug, PartialEq, Eq)]
enum TreeEvent {
    Unrelated,
    Event(String),
}

use serde::Deserialize;

pub(crate) struct GitHubEventStore<'a> {
    pub(crate) pat: &'a str,
    pub(crate) repo: &'a str,
}

const EVENT_LOG_ROOT: &str = "nook-log/v1/events";
const SHA256_BASE64URL_LEN: usize = 43;

impl GitHubEventStore<'_> {
    fn is_sha256_base64url_digest(digest: &str) -> bool {
        digest.len() == SHA256_BASE64URL_LEN
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    }

    fn github_repo_response(
        request: RepositoryResponse<'_>,
    ) -> Result<RepositoryDiscovery, NookError> {
        let RepositoryResponse { status, text, repo } = request;
        if status == StatusCode::NOT_FOUND {
            return Ok(RepositoryDiscovery::Missing);
        }
        if !status.is_success() {
            return Err(NookError::GitHub(format!(
                "Failed to read GitHub repository {repo}: {status}"
            )));
        }

        serde_json::from_str(text)
            .map(RepositoryDiscovery::Loaded)
            .map_err(|e| NookError::Serialization(e.to_string()))
    }

    fn github_tree_response(status: StatusCode, text: &str) -> Result<TreeDiscovery, NookError> {
        if status == StatusCode::NOT_FOUND {
            return Ok(TreeDiscovery::Missing);
        }
        if !status.is_success() {
            return Err(NookError::GitHub(format!(
                "Failed to list GitHub tree for {EVENT_LOG_ROOT}: {status}"
            )));
        }

        let tree: GitTreeResponse =
            serde_json::from_str(text).map_err(|e| NookError::Serialization(e.to_string()))?;
        if tree.truncated {
            return Err(NookError::GitHub(
                "GitHub event tree listing was truncated; sync would be incomplete.".to_owned(),
            ));
        }

        Ok(TreeDiscovery::Loaded(tree))
    }

    fn event_ids_from_tree(entries: &[GitTreeEntry]) -> Vec<String> {
        entries
            .iter()
            .filter(|entry| entry.entry_type == "blob")
            .filter_map(|entry| match Self::event_id_from_tree_path(&entry.path) {
                TreeEvent::Event(id) => Some(id),
                TreeEvent::Unrelated => None,
            })
            .collect()
    }

    fn event_content(bytes: &[u8]) -> Result<&str, NookError> {
        str::from_utf8(bytes)
            .map_err(|e| NookError::Serialization(format!("Event YAML must be UTF-8: {e}")))
    }

    fn is_retryable_event_write_error(message: &str) -> bool {
        message.contains("422") || message.contains("409")
    }
}

#[derive(Deserialize)]
struct GitHubRepoResponse {
    default_branch: String,
}

#[derive(Deserialize)]
struct GitTreeResponse {
    tree: Vec<GitTreeEntry>,
    truncated: bool,
}

#[derive(Deserialize)]
struct GitTreeEntry {
    path: String,
    #[serde(rename = "type")]
    entry_type: String,
}

impl GitHubEventStore<'_> {
    fn event_id_from_tree_path(path: &str) -> TreeEvent {
        let Some(name) = path
            .strip_prefix(&format!("{EVENT_LOG_ROOT}/"))
            .filter(|relative| !relative.contains('/'))
        else {
            return TreeEvent::Unrelated;
        };
        if let Some(extension) = Path::new(name).extension()
            && extension.eq_ignore_ascii_case("yaml")
            && let Some(stem) = Path::new(name).file_stem()
            && let Some(digest) = stem.to_str()
            && Self::is_sha256_base64url_digest(digest)
        {
            return TreeEvent::Event(format!("sha256u:{digest}"));
        }
        TreeEvent::Unrelated
    }

    pub(crate) async fn list_github_event_ids(&self) -> Result<Vec<String>, NookError> {
        let pat = self.pat;
        let repo = self.repo;
        let pat = pat.trim();
        let client = Client::new();
        let mut event_ids = Vec::new();

        let repo_response = client
            .get(format!("https://api.github.com/repos/{repo}"))
            .header("Authorization", format!("Bearer {pat}"))
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header("User-Agent", "nook-wasm")
            .send()
            .await?;

        let repo_status = repo_response.status();
        let repo_text = repo_response
            .text()
            .await
            .map_err(|e| NookError::Serialization(e.to_string()))?;
        let RepositoryDiscovery::Loaded(repo_info) =
            Self::github_repo_response(RepositoryResponse {
                status: repo_status,
                text: &repo_text,
                repo: repo,
            })?
        else {
            return Ok(Vec::new());
        };
        let branch = urlencoding::encode(&repo_info.default_branch);
        let tree_url =
            format!("https://api.github.com/repos/{repo}/git/trees/{branch}?recursive=1");
        let tree_response = client
            .get(&tree_url)
            .header("Authorization", format!("Bearer {pat}"))
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header("User-Agent", "nook-wasm")
            .send()
            .await?;

        let tree_status = tree_response.status();
        let tree_text = tree_response
            .text()
            .await
            .map_err(|e| NookError::Serialization(e.to_string()))?;
        let TreeDiscovery::Loaded(tree) = Self::github_tree_response(tree_status, &tree_text)?
        else {
            return Ok(Vec::new());
        };

        event_ids.extend(Self::event_ids_from_tree(&tree.tree));
        Ok(event_ids)
    }

    pub(crate) async fn fetch_github_event(
        &self,
        event_id: &EventId,
    ) -> Result<Vec<u8>, NookError> {
        match self.read_github_event(event_id).await? {
            RemoteEventRead::Retrieved(bytes) => Ok(bytes.into()),
            RemoteEventRead::Unavailable => Err(NookError::GitHub(format!(
                "Event file missing at {}",
                event_id.as_str()
            ))),
        }
    }

    async fn read_github_event(&self, event_id: &EventId) -> Result<RemoteEventRead, NookError> {
        let pat = self.pat;
        let repo = self.repo;
        let path = event_id.storage_path();
        if let GitHubVaultDiscovery::FileLoaded(file) = GitHubStorageClient::new(pat)
            .fetch_github_vault(GitHubStorageClientFetchGithubVault {
                repo: repo,
                path: &path,
                root: GitHubRootDiscovery::Inspect,
            })
            .await?
        {
            return Ok(RemoteEventRead::Retrieved(file.content.into_bytes().into()));
        }
        Ok(RemoteEventRead::Unavailable)
    }
}

/// Append-only event upload. Retries branch conflicts; never overwrites different content.
impl GitHubEventStore<'_> {
    pub(crate) async fn put_github_event_if_absent(
        &self,
        event_id: &EventId,
        bytes: &[u8],
    ) -> Result<(), NookError> {
        let checked = CheckedEventWrite::parse(bytes, event_id, "GitHub")?;
        self.put_checked(checked).await
    }

    async fn put_checked(&self, checked: CheckedEventWrite<'_>) -> Result<(), NookError> {
        let pat = self.pat;
        let repo = self.repo;
        let event_id = checked.event_id();
        let bytes = checked.bytes();
        match self.read_github_event(event_id).await? {
            RemoteEventRead::Retrieved(existing) if checked.matches(existing.as_ref()) => {
                return Ok(());
            }
            RemoteEventRead::Retrieved(_) => {
                return Err(NookError::GitHub(
                    "Event path exists with different content (corruption)".to_owned(),
                ));
            }
            RemoteEventRead::Unavailable => {}
        }

        let path = event_id.storage_path();
        let content = Self::event_content(bytes)?;

        for attempt in 0..3 {
            match GitHubStorageClient::new(pat)
                .write_github_text_file(GitHubStorageClientWriteGithubTextFile {
                    repo: repo,
                    path: &path,
                    content: content,
                    write: GitHubFileWrite::Create,
                })
                .await
            {
                Ok(_) => return Ok(()),
                Err(NookError::GitHub(message)) if attempt < 2 => {
                    if Self::is_retryable_event_write_error(&message) {
                        if let Ok(GitHubVaultDiscovery::FileLoaded(existing)) =
                            GitHubStorageClient::new(pat)
                                .fetch_github_vault(GitHubStorageClientFetchGithubVault {
                                    repo: repo,
                                    path: &path,
                                    root: GitHubRootDiscovery::Inspect,
                                })
                                .await
                        {
                            let existing_bytes = existing.content.as_bytes();
                            if checked.matches(existing_bytes) {
                                return Ok(());
                            }
                            return Err(NookError::GitHub(
                                "Event path exists with different content (corruption)".to_owned(),
                            ));
                        }
                        continue;
                    }
                    return Err(NookError::GitHub(message));
                }
                Err(err) => return Err(err),
            }
        }
        Err(NookError::GitHub(
            "GitHub event upload failed after retries.".to_owned(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_core::{GenesisImportPayload, IsoTimestamp, SigningIdentity, StoreId};
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn tree_path_filter_accepts_only_flat_event_yaml_files() {
        let digest = "ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0";
        assert_eq!(
            GitHubEventStore::event_id_from_tree_path(&format!("{EVENT_LOG_ROOT}/{digest}.yaml")),
            TreeEvent::Event(format!("sha256u:{digest}"))
        );
        assert_eq!(
            GitHubEventStore::event_id_from_tree_path(&format!(
                "{EVENT_LOG_ROOT}/aa/{digest}.yaml"
            )),
            TreeEvent::Unrelated
        );
        assert_eq!(
            GitHubEventStore::event_id_from_tree_path(&format!("{EVENT_LOG_ROOT}/{digest}.json")),
            TreeEvent::Unrelated
        );
        assert_eq!(
            GitHubEventStore::event_id_from_tree_path(
                "other/path/ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0.yaml"
            ),
            TreeEvent::Unrelated
        );
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn tree_path_filter_rejects_invalid_digests_and_accepts_case_insensitive_yaml() {
        let digest = "ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0";
        assert_eq!(
            GitHubEventStore::event_id_from_tree_path(&format!("{EVENT_LOG_ROOT}/{digest}.YaMl")),
            TreeEvent::Event(format!("sha256u:{digest}"))
        );
        assert_eq!(
            GitHubEventStore::event_id_from_tree_path(&format!(
                "{EVENT_LOG_ROOT}/{}!.yaml",
                &digest[..42]
            )),
            TreeEvent::Unrelated
        );
        assert_eq!(
            GitHubEventStore::event_id_from_tree_path(&format!(
                "{EVENT_LOG_ROOT}/{}.yaml.bak",
                digest
            )),
            TreeEvent::Unrelated
        );
        assert!(!GitHubEventStore::is_sha256_base64url_digest("short"));
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn github_tree_response_decodes_entries_and_truncation() -> anyhow::Result<()> {
        let response: GitTreeResponse = serde_json::from_str(
            r#"{"truncated":true,"tree":[{"path":"nook-log/v1/events/event.yaml","type":"blob"}]}"#,
        )?;
        assert!(response.truncated);
        assert_eq!(response.tree.len(), 1);
        assert_eq!(response.tree[0].path, "nook-log/v1/events/event.yaml");
        assert_eq!(response.tree[0].entry_type, "blob");
        let repo: GitHubRepoResponse = serde_json::from_str(r#"{"default_branch":"main"}"#)?;
        assert_eq!(repo.default_branch, "main");
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn github_repo_response_projects_missing_errors_and_json() {
        assert!(matches!(
            GitHubEventStore::github_repo_response(RepositoryResponse {
                status: StatusCode::NOT_FOUND,
                text: "",
                repo: "owner/repo"
            })
            .unwrap(),
            RepositoryDiscovery::Missing
        ));

        let unavailable = GitHubEventStore::github_repo_response(RepositoryResponse {
            status: StatusCode::FORBIDDEN,
            text: "",
            repo: "owner/repo",
        });
        assert!(matches!(
            unavailable,
            Err(NookError::GitHub(message))
                if message.contains("owner/repo") && message.contains("403")
        ));

        let malformed = GitHubEventStore::github_repo_response(RepositoryResponse {
            status: StatusCode::OK,
            text: "not-json",
            repo: "owner/repo",
        });
        assert!(matches!(malformed, Err(NookError::Serialization(_))));

        let RepositoryDiscovery::Loaded(repo) =
            GitHubEventStore::github_repo_response(RepositoryResponse {
                status: StatusCode::OK,
                text: r#"{"default_branch":"release"}"#,
                repo: "owner/repo",
            })
            .unwrap()
        else {
            panic!("successful repository response must decode")
        };
        assert_eq!(repo.default_branch, "release");
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn github_tree_response_projects_missing_errors_truncation_and_entries() {
        assert!(matches!(
            GitHubEventStore::github_tree_response(StatusCode::NOT_FOUND, "").unwrap(),
            TreeDiscovery::Missing
        ));

        let unavailable = GitHubEventStore::github_tree_response(StatusCode::BAD_GATEWAY, "");
        assert!(matches!(
            unavailable,
            Err(NookError::GitHub(message)) if message.contains(EVENT_LOG_ROOT) && message.contains("502")
        ));

        let malformed = GitHubEventStore::github_tree_response(StatusCode::OK, "not-json");
        assert!(matches!(malformed, Err(NookError::Serialization(_))));

        let truncated = GitHubEventStore::github_tree_response(
            StatusCode::OK,
            r#"{"truncated":true,"tree":[]}"#,
        );
        assert!(matches!(
            truncated,
            Err(NookError::GitHub(message)) if message.contains("truncated")
        ));

        let TreeDiscovery::Loaded(tree) = GitHubEventStore::github_tree_response(
            StatusCode::OK,
            r#"{"truncated":false,"tree":[{"path":"event.yaml","type":"blob"}]}"#,
        )
        .unwrap() else {
            panic!("complete tree response must decode")
        };
        assert_eq!(tree.tree.len(), 1);
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn event_tree_projection_filters_non_event_entries_and_retries() -> anyhow::Result<()> {
        let digest = "ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0";
        let entries: Vec<GitTreeEntry> = serde_json::from_str(&format!(
            r#"[
                {{"path":"{EVENT_LOG_ROOT}/{digest}.yaml","type":"blob"}},
                {{"path":"{EVENT_LOG_ROOT}/{digest}.yaml","type":"tree"}},
                {{"path":"{EVENT_LOG_ROOT}/nested/{digest}.yaml","type":"blob"}},
                {{"path":"other/{digest}.yaml","type":"blob"}}
            ]"#
        ))?;
        assert_eq!(
            GitHubEventStore::event_ids_from_tree(&entries),
            vec![format!("sha256u:{digest}")]
        );
        assert!(GitHubEventStore::is_retryable_event_write_error(
            "status 422"
        ));
        assert!(GitHubEventStore::is_retryable_event_write_error(
            "status 409"
        ));
        assert!(!GitHubEventStore::is_retryable_event_write_error(
            "status 500"
        ));
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn event_content_accepts_utf8_and_rejects_binary_payloads() {
        assert_eq!(
            GitHubEventStore::event_content(b"event: yaml").unwrap(),
            "event: yaml"
        );
        let invalid = GitHubEventStore::event_content(&[0xff, 0xfe]);
        assert!(matches!(
            invalid,
            Err(NookError::Serialization(message)) if message.contains("Event YAML must be UTF-8")
        ));
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    async fn event_write_rejects_mismatched_event_id_before_network() -> anyhow::Result<()> {
        let (identity, _) = SigningIdentity::generate()?;
        let event = VaultEvent::build_genesis_import_event(GenesisImportRequest {
            store_id: &StoreId::parse("store_testtoken11")?,
            actor_id: &identity.actor_id()?,
            key_epoch: &EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?,
            payload: GenesisImportPayload {
                source_content_hash: nook_auth2::Sha256Hex::from_trusted("deadbeef".repeat(8)),
                secrets: vec![],
                password_entries: vec![],
            },
            created_at: &IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned()),
            signing_key: identity.signing_key(),
        })?;
        let bytes: Vec<u8> = VaultEvent::serialize_event_storage_yaml(&event)?.into();
        let requested_id = EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?;
        let store = GitHubEventStore { pat: "", repo: "" };
        let error = store
            .put_github_event_if_absent(&requested_id, &bytes)
            .await
            .expect_err("mismatched event id must fail before network");
        assert!(matches!(
            error,
            NookError::Serialization(message) if message.contains("GitHub event id mismatch")
        ));
        Ok(())
    }
}
