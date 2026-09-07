//! GitHub immutable event file adapter (`put_event_if_absent`).

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use reqwest::{Client, StatusCode};
use std::path::Path;
use std::str;

use super::checked_event_write::CheckedEventWrite;
use crate::NookError;
use crate::storage::github::{fetch_github_vault, write_github_text_file};
use nook_core::EventId;
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
    fn event_id_from_tree_path(path: &str) -> Option<String> {
        let name = path
            .strip_prefix(&format!("{EVENT_LOG_ROOT}/"))
            .filter(|relative| !relative.contains('/'))?;
        if let Some(extension) = Path::new(name).extension()
            && extension.eq_ignore_ascii_case("yaml")
            && let Some(stem) = Path::new(name).file_stem()
            && let Some(digest) = stem.to_str()
            && Self::is_sha256_base64url_digest(digest)
        {
            return Some(format!("sha256u:{digest}"));
        }
        None
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

        if repo_response.status() == StatusCode::NOT_FOUND {
            return Ok(Vec::new());
        }
        if !repo_response.status().is_success() {
            return Err(NookError::GitHub(format!(
                "Failed to read GitHub repository {repo}: {}",
                repo_response.status()
            )));
        }

        let repo_info: GitHubRepoResponse = repo_response
            .json()
            .await
            .map_err(|e| NookError::Serialization(e.to_string()))?;
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

        if tree_response.status() == StatusCode::NOT_FOUND {
            return Ok(Vec::new());
        }
        if !tree_response.status().is_success() {
            return Err(NookError::GitHub(format!(
                "Failed to list GitHub tree for {EVENT_LOG_ROOT}: {}",
                tree_response.status()
            )));
        }

        let tree: GitTreeResponse = tree_response
            .json()
            .await
            .map_err(|e| NookError::Serialization(e.to_string()))?;
        if tree.truncated {
            return Err(NookError::GitHub(
                "GitHub event tree listing was truncated; sync would be incomplete.".to_owned(),
            ));
        }

        for entry in tree.tree {
            if entry.entry_type != "blob" {
                continue;
            }
            if let Some(event_id) = Self::event_id_from_tree_path(&entry.path) {
                event_ids.push(event_id);
            }
        }
        Ok(event_ids)
    }

    pub(crate) async fn fetch_github_event(
        &self,
        event_id: &EventId,
    ) -> Result<Vec<u8>, NookError> {
        let pat = self.pat;
        let repo = self.repo;
        Self::fetch_github_event_optional(pat, repo, event_id)
            .await?
            .ok_or_else(|| {
                NookError::GitHub(format!("Event file missing at {}", event_id.as_str()))
            })
    }

    async fn fetch_github_event_optional(
        pat: &str,
        repo: &str,
        event_id: &EventId,
    ) -> Result<Option<Vec<u8>>, NookError> {
        let path = event_id.storage_path();
        if let Some(file) = fetch_github_vault(pat, repo, &path, None).await? {
            return Ok(Some(file.content.into_bytes()));
        }
        Ok(None)
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
        match Self::fetch_github_event_optional(pat, repo, event_id).await? {
            Some(existing) if checked.matches(&existing) => {
                return Ok(());
            }
            Some(_) => {
                return Err(NookError::GitHub(
                    "Event path exists with different content (corruption)".to_owned(),
                ));
            }
            None => {}
        }

        let path = event_id.storage_path();
        let content = str::from_utf8(bytes)
            .map_err(|e| NookError::Serialization(format!("Event YAML must be UTF-8: {e}")))?;

        for attempt in 0..3 {
            match write_github_text_file(pat, repo, &path, content, None).await {
                Ok(_) => return Ok(()),
                Err(NookError::GitHub(message)) if attempt < 2 => {
                    if message.contains("422") || message.contains("409") {
                        if let Ok(Some(existing)) = fetch_github_vault(pat, repo, &path, None).await
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
    use nook_core::{
        GenesisImportPayload, IsoTimestamp, SigningIdentity, StoreId, build_genesis_import_event,
        serialize_event_storage_yaml,
    };
    use wasm_bindgen_test::wasm_bindgen_test;

    #[test]
    fn tree_path_filter_accepts_only_flat_event_yaml_files() {
        let digest = "ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0";
        assert_eq!(
            GitHubEventStore::event_id_from_tree_path(&format!("{EVENT_LOG_ROOT}/{digest}.yaml")),
            Some(format!("sha256u:{digest}"))
        );
        assert_eq!(
            GitHubEventStore::event_id_from_tree_path(&format!(
                "{EVENT_LOG_ROOT}/aa/{digest}.yaml"
            )),
            None
        );
        assert_eq!(
            GitHubEventStore::event_id_from_tree_path(&format!("{EVENT_LOG_ROOT}/{digest}.json")),
            None
        );
        assert_eq!(
            GitHubEventStore::event_id_from_tree_path(
                "other/path/ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0.yaml"
            ),
            None
        );
    }

    #[test]
    fn tree_path_filter_rejects_invalid_digests_and_accepts_case_insensitive_yaml() {
        let digest = "ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0";
        assert_eq!(
            GitHubEventStore::event_id_from_tree_path(&format!("{EVENT_LOG_ROOT}/{digest}.YaMl")),
            Some(format!("sha256u:{digest}"))
        );
        assert_eq!(
            GitHubEventStore::event_id_from_tree_path(&format!(
                "{EVENT_LOG_ROOT}/{}!.yaml",
                &digest[..42]
            )),
            None
        );
        assert_eq!(
            GitHubEventStore::event_id_from_tree_path(&format!(
                "{EVENT_LOG_ROOT}/{}.yaml.bak",
                digest
            )),
            None
        );
        assert!(!GitHubEventStore::is_sha256_base64url_digest("short"));
    }

    #[test]
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
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    async fn event_write_rejects_mismatched_event_id_before_network() -> anyhow::Result<()> {
        let (identity, _) = SigningIdentity::generate()?;
        let event = build_genesis_import_event(
            &StoreId::parse("store_testtoken11")?,
            &identity.actor_id()?,
            &EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?,
            GenesisImportPayload {
                source_content_hash: nook_auth2::Sha256Hex::from_trusted("deadbeef".repeat(8)),
                secrets: vec![],
                password_entries: vec![],
            },
            &IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned()),
            identity.signing_key(),
        )?;
        let bytes: Vec<u8> = serialize_event_storage_yaml(&event)?.into();
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
