//! GitHub immutable event file adapter (`put_event_if_absent`).

use crate::NookError;
use crate::storage::github::{fetch_github_vault, write_github_text_file};
use crate::storage::{event_storage_matches_expected, parse_expected_event_storage_bytes};
use nook_core::EventId;
use serde::Deserialize;

const EVENT_LOG_ROOT: &str = "nook-log/v1/events";

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

fn event_id_from_tree_path(path: &str) -> Option<String> {
    let name = path
        .strip_prefix(&format!("{EVENT_LOG_ROOT}/"))
        .filter(|relative| !relative.contains('/'))?;
    if let Some(extension) = std::path::Path::new(name).extension()
        && extension.eq_ignore_ascii_case("yaml")
        && let Some(stem) = std::path::Path::new(name).file_stem()
        && let Some(digest) = stem.to_str()
        && digest.len() == 64
        && digest.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Some(format!("sha256:{digest}"));
    }
    None
}

pub(crate) async fn list_github_event_ids(pat: &str, repo: &str) -> Result<Vec<String>, NookError> {
    let pat = pat.trim();
    let client = reqwest::Client::new();
    let mut event_ids = Vec::new();

    let repo_response = client
        .get(format!("https://api.github.com/repos/{repo}"))
        .header("Authorization", format!("Bearer {pat}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", "nook-wasm")
        .send()
        .await?;

    if repo_response.status() == reqwest::StatusCode::NOT_FOUND {
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
    let tree_url = format!("https://api.github.com/repos/{repo}/git/trees/{branch}?recursive=1");
    let tree_response = client
        .get(&tree_url)
        .header("Authorization", format!("Bearer {pat}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", "nook-wasm")
        .send()
        .await?;

    if tree_response.status() == reqwest::StatusCode::NOT_FOUND {
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
        if let Some(event_id) = event_id_from_tree_path(&entry.path) {
            event_ids.push(event_id);
        }
    }
    Ok(event_ids)
}

pub(crate) async fn fetch_github_event(
    pat: &str,
    repo: &str,
    event_id: &EventId,
) -> Result<Vec<u8>, NookError> {
    let path = event_id.storage_path();
    if let Some(file) = fetch_github_vault(pat, repo, &path, None).await? {
        return Ok(file.content.into_bytes());
    }
    Err(NookError::GitHub(format!(
        "Event file missing at {}",
        event_id.as_str()
    )))
}

/// Append-only event upload. Retries branch conflicts; never overwrites different content.
pub(crate) async fn put_github_event_if_absent(
    pat: &str,
    repo: &str,
    event_id: &EventId,
    bytes: &[u8],
) -> Result<(), NookError> {
    let expected_event = parse_expected_event_storage_bytes(bytes, event_id, "GitHub")?;
    match fetch_github_event(pat, repo, event_id).await {
        Ok(existing)
            if existing == bytes || event_storage_matches_expected(&existing, &expected_event) =>
        {
            return Ok(());
        }
        Ok(_) => {
            return Err(NookError::GitHub(
                "Event path exists with different content (corruption)".to_owned(),
            ));
        }
        Err(NookError::GitHub(message)) if message.contains("Event file missing") => {}
        Err(err) => return Err(err),
    }

    let path = event_id.storage_path();
    let content = std::str::from_utf8(bytes)
        .map_err(|e| NookError::Serialization(format!("Event YAML must be UTF-8: {e}")))?;

    for attempt in 0..3 {
        match write_github_text_file(pat, repo, &path, content, None).await {
            Ok(_) => return Ok(()),
            Err(NookError::GitHub(message)) if attempt < 2 => {
                if message.contains("422") || message.contains("409") {
                    if let Ok(Some(existing)) = fetch_github_vault(pat, repo, &path, None).await {
                        let existing_bytes = existing.content.as_bytes();
                        if existing_bytes == bytes
                            || event_storage_matches_expected(existing_bytes, &expected_event)
                        {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tree_path_filter_accepts_only_flat_event_yaml_files() {
        let digest = "a".repeat(64);
        assert_eq!(
            event_id_from_tree_path(&format!("{EVENT_LOG_ROOT}/{digest}.yaml")),
            Some(format!("sha256:{digest}"))
        );
        assert_eq!(
            event_id_from_tree_path(&format!("{EVENT_LOG_ROOT}/aa/{digest}.yaml")),
            None
        );
        assert_eq!(
            event_id_from_tree_path(&format!("{EVENT_LOG_ROOT}/{digest}.json")),
            None
        );
        assert_eq!(
            event_id_from_tree_path(
                "other/path/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.yaml"
            ),
            None
        );
    }
}
