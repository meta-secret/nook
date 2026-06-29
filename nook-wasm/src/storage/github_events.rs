//! GitHub immutable event file adapter (`put_event_if_absent`).

use crate::NookError;
use crate::storage::github::{fetch_github_vault, write_github_text_file};
use nook_core::EventId;

const EVENT_LOG_ROOT: &str = "nook-log/v1/events";

pub(crate) async fn list_github_event_ids(pat: &str, repo: &str) -> Result<Vec<String>, NookError> {
    let pat = pat.trim();
    let client = reqwest::Client::new();
    let mut event_ids = Vec::new();
    let mut stack = vec![EVENT_LOG_ROOT.to_owned()];
    while let Some(path) = stack.pop() {
        list_github_event_dir(pat, repo, &path, &client, &mut stack, &mut event_ids).await?;
    }
    Ok(event_ids)
}

async fn list_github_event_dir(
    pat: &str,
    repo: &str,
    path: &str,
    client: &reqwest::Client,
    stack: &mut Vec<String>,
    out: &mut Vec<String>,
) -> Result<(), NookError> {
    let url = format!("https://api.github.com/repos/{repo}/contents/{path}");
    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {pat}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", "nook-wasm")
        .send()
        .await?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(());
    }
    if !response.status().is_success() {
        return Err(NookError::GitHub(format!(
            "Failed to list GitHub path {path}: {}",
            response.status()
        )));
    }

    let entries: Vec<serde_json::Value> = response
        .json()
        .await
        .map_err(|e| NookError::Serialization(e.to_string()))?;

    for entry in entries {
        let name = entry
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        let entry_type = entry
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        let subpath = format!("{path}/{name}");
        if entry_type == "dir" {
            stack.push(subpath);
        } else if std::path::Path::new(name)
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("event"))
        {
            let digest = name.trim_end_matches(".event");
            if digest.len() == 64 {
                out.push(format!("sha256:{digest}"));
            }
        }
    }
    Ok(())
}

pub(crate) async fn fetch_github_event(
    pat: &str,
    repo: &str,
    event_id: &EventId,
) -> Result<Vec<u8>, NookError> {
    let path = event_id.storage_path();
    if let Some(file) = fetch_github_vault(pat, repo, &path, None).await? {
        Ok(file.content.into_bytes())
    } else {
        Err(NookError::GitHub(format!(
            "Event file missing at {}",
            event_id.as_str()
        )))
    }
}

/// Append-only event upload. Retries branch conflicts; never overwrites different content.
pub(crate) async fn put_github_event_if_absent(
    pat: &str,
    repo: &str,
    event_id: &EventId,
    bytes: &[u8],
) -> Result<(), NookError> {
    let path = event_id.storage_path();
    let content = std::str::from_utf8(bytes)
        .map_err(|e| NookError::Serialization(format!("Event JSON must be UTF-8: {e}")))?;

    for attempt in 0..3 {
        match write_github_text_file(pat, repo, &path, content, None).await {
            Ok(_) => return Ok(()),
            Err(NookError::GitHub(message)) if attempt < 2 => {
                if message.contains("422") || message.contains("409") {
                    if let Ok(Some(existing)) = fetch_github_vault(pat, repo, &path, None).await {
                        if existing.content.as_bytes() == bytes {
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
