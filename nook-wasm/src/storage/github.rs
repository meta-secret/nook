//! GitHub-backed storage adapter.
//!
//! Provides the small subset of the GitHub REST API the wasm session
//! needs: lookup the authenticated user's login, ensure the vault repo
//! exists, fetch the vault file (with sha for optimistic concurrency),
//! and write the vault file with retry on stale-sha conflicts.
//!
//! Network errors bubble up as `NookError::Network` (from `reqwest`) or
//! `NookError::GitHub` for protocol-shaped failures.

use crate::NookError;
use serde::{Deserialize, Serialize};

fn log_github_api_failure(
    operation: &str,
    repo: &str,
    path: &str,
    status: reqwest::StatusCode,
) {
    tracing::warn!(
        scope = "github",
        operation,
        repo = %repo,
        path = %path,
        status = %status,
        "GitHub API request failed"
    );
}

/// A vault file fetched from GitHub: its UTF-8 contents plus the blob `sha`
/// the API returned so subsequent writes can submit it for optimistic
/// concurrency.
pub(crate) struct GitHubVaultFile {
    pub(crate) content: String,
    pub(crate) sha: String,
}

// -------------------------------------------------------------
// GitHub API Storage Functions (via reqwest Client)
// -------------------------------------------------------------

#[derive(Deserialize)]
struct GitHubFileResponse {
    content: String,
    sha: String,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    sha: Option<String>,
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

fn github_cache_bust_url(url: &str) -> String {
    let stamp = js_sys::Date::now();
    if url.contains('?') {
        format!("{url}&_={stamp}")
    } else {
        format!("{url}?_={stamp}")
    }
}

fn github_get_headers(pat: &str) -> [(&'static str, String); 4] {
    [
        ("Authorization", format!("Bearer {}", pat.trim())),
        ("Accept", "application/vnd.github+json".to_owned()),
        ("X-GitHub-Api-Version", "2022-11-28".to_owned()),
        ("User-Agent", "nook-wasm".to_owned()),
    ]
}

pub(crate) async fn fetch_github_username(pat: &str) -> Result<String, NookError> {
    let pat = pat.trim();
    if pat.is_empty() {
        return Err(NookError::GitHub(
            "GitHub personal access token is required.".to_owned(),
        ));
    }

    let url = "https://api.github.com/user";
    let client = reqwest::Client::new();
    let response = client
        .get(url)
        .header("Authorization", format!("Bearer {pat}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", "nook-wasm")
        .send()
        .await?;

    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        log_github_api_failure("user", "", "", response.status());
        return Err(NookError::GitHub(
            "GitHub rejected your token (401). Check that it is valid, not expired, and has repo access.".to_owned(),
        ));
    }

    if !response.status().is_success() {
        let status = response.status();
        log_github_api_failure("user", "", "", status);
        return Err(NookError::GitHub(format!(
            "Failed to fetch GitHub user details: status {status}"
        )));
    }

    let text = response.text().await?;
    let parsed: GitHubUserResponse = serde_json::from_str(&text)
        .map_err(|e| NookError::Serialization(format!("Failed to parse user JSON: {}", e)))?;

    Ok(parsed.login)
}

pub(crate) async fn ensure_github_repo_exists(pat: &str, repo: &str) -> Result<(), NookError> {
    let pat = pat.trim();
    let client = reqwest::Client::new();
    let check_url = format!("https://api.github.com/repos/{repo}");
    let check = client
        .get(&check_url)
        .header("Authorization", format!("Bearer {pat}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", "nook-wasm")
        .send()
        .await?;

    if check.status().is_success() {
        return Ok(());
    }

    if check.status() != reqwest::StatusCode::NOT_FOUND {
        let status = check.status();
        log_github_api_failure("repo_check", repo, "", status);
        return Err(NookError::GitHub(format!(
            "Failed to check GitHub repository {repo}: status {status}"
        )));
    }

    let repo_name = repo
        .split('/')
        .nth(1)
        .ok_or_else(|| NookError::GitHub(format!("Invalid repository name: {repo}")))?;

    let body = serde_json::json!({
        "name": repo_name,
        "description": "Nook encrypted vault",
        "private": true,
        "auto_init": true
    });

    let create = client
        .post("https://api.github.com/user/repos")
        .header("Authorization", format!("Bearer {pat}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", "nook-wasm")
        .header("Content-Type", "application/json")
        .body(body.to_string())
        .send()
        .await?;

    if create.status().is_success() || create.status() == reqwest::StatusCode::UNPROCESSABLE_ENTITY
    {
        // 422 = repo already exists (race) or name taken under another account
        return Ok(());
    }

    let status = create.status();
    log_github_api_failure("repo_create", repo, "", status);
    Err(NookError::GitHub(format!(
        "Failed to create GitHub repository {repo}: status {status}"
    )))
}

async fn fetch_github_file_at_path(
    pat: &str,
    repo: &str,
    path: &str,
) -> Result<Option<GitHubVaultFile>, NookError> {
    let client = reqwest::Client::new();
    let mut request = client.get(github_cache_bust_url(&format!(
        "https://api.github.com/repos/{repo}/contents/{path}"
    )));
    for (name, value) in github_get_headers(pat) {
        request = request.header(name, value);
    }
    let file_response = request.send().await?;

    if file_response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }

    if !file_response.status().is_success() {
        let status = file_response.status();
        log_github_api_failure("file_fetch", repo, path, status);
        return Err(NookError::GitHub(format!(
            "GitHub API responded with status {status}"
        )));
    }

    let text = file_response.text().await?;

    let parsed: GitHubFileResponse = serde_json::from_str(&text)
        .map_err(|e| NookError::Serialization(format!("Failed to parse JSON: {}", e)))?;

    let cleaned_content = parsed
        .content
        .replace('\n', "")
        .replace('\r', "")
        .replace(' ', "");
    let decoded_bytes = base64_decode(&cleaned_content)?;
    let vault_content = String::from_utf8(decoded_bytes)
        .map_err(|e| NookError::Serialization(format!("Vault file is not valid UTF-8: {e}")))?;

    Ok(Some(GitHubVaultFile {
        content: vault_content,
        sha: parsed.sha,
    }))
}

pub(crate) async fn fetch_github_vault(
    pat: &str,
    repo: &str,
    path: &str,
    root_empty: Option<&mut bool>,
) -> Result<Option<GitHubVaultFile>, NookError> {
    if root_empty.as_ref().is_some_and(|flag| **flag) {
        return Ok(None);
    }

    let pat = pat.trim();

    // Event files and other nested paths are not listed under the repo root.
    if path.contains('/') {
        return fetch_github_file_at_path(pat, repo, path).await;
    }

    let client = reqwest::Client::new();
    let apply_headers = |request: reqwest::RequestBuilder| {
        let mut request = request;
        for (name, value) in github_get_headers(pat) {
            request = request.header(name, value);
        }
        request
    };

    // List repo root first so a missing vault file does not produce fetch 404
    // noise in the browser console (Chrome logs failed fetch responses).
    let list_url = github_cache_bust_url(&format!("https://api.github.com/repos/{repo}/contents/"));
    let list_response = apply_headers(client.get(&list_url)).send().await?;

    if list_response.status() == reqwest::StatusCode::NOT_FOUND {
        if let Some(flag) = root_empty {
            *flag = true;
        }
        return Ok(None);
    }

    if !list_response.status().is_success() {
        let status = list_response.status();
        log_github_api_failure("contents_list", repo, path, status);
        return Err(NookError::GitHub(format!(
            "GitHub API responded with status {status}"
        )));
    }

    let list_text = list_response.text().await?;
    let entries: Vec<GitHubDirEntry> = serde_json::from_str(&list_text).map_err(|e| {
        NookError::Serialization(format!("Failed to parse GitHub directory listing: {e}"))
    })?;

    if !entries
        .iter()
        .any(|item| item.name == path && item.entry_type == "file")
    {
        return Ok(None);
    }

    fetch_github_file_at_path(pat, repo, path).await
}

pub(crate) async fn write_github_text_file(
    pat: &str,
    repo: &str,
    path: &str,
    content: &str,
    sha: Option<&str>,
) -> Result<String, NookError> {
    use base64::{Engine as _, engine::general_purpose};

    let base64_content = general_purpose::STANDARD.encode(content.as_bytes());

    let body = GitHubPutBody {
        message: "Update secrets store via Nook WASM".to_owned(),
        content: base64_content,
        sha: sha.map(String::from),
    };

    let body_str = serde_json::to_string(&body)
        .map_err(|e| NookError::Serialization(format!("Failed to serialize body: {}", e)))?;

    let url = format!("https://api.github.com/repos/{}/contents/{}", repo, path);
    let client = reqwest::Client::new();
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

    if !response.status().is_success() {
        let status = response.status();
        log_github_api_failure("file_write", repo, path, status);
        let message = if status == reqwest::StatusCode::NOT_FOUND {
            format!(
                "Cannot write to {repo}/{path} (404). Ensure your PAT has repo scope and you can access {repo}."
            )
        } else {
            format!("GitHub API responded with status {status}")
        };
        return Err(NookError::GitHub(message));
    }

    let text = response.text().await?;

    let parsed: GitHubPutResponse = serde_json::from_str(&text)
        .map_err(|e| NookError::Serialization(format!("Failed to parse JSON: {}", e)))?;

    Ok(parsed.content.sha)
}

pub(crate) async fn write_github_text_file_with_retry(
    pat: &str,
    repo: &str,
    path: &str,
    content: &str,
    mut sha: Option<String>,
) -> Result<String, NookError> {
    for attempt in 0..3 {
        match write_github_text_file(pat, repo, path, content, sha.as_deref()).await {
            Ok(new_sha) => return Ok(new_sha),
            Err(NookError::GitHub(message))
                if attempt < 2 && (message.contains("422") || message.contains("409")) =>
            {
                if let Ok(Some(file)) = fetch_github_vault(pat, repo, path, None).await {
                    sha = Some(file.sha);
                }
            }
            Err(err) => return Err(err),
        }
    }
    Err(NookError::GitHub(
        "GitHub vault write failed after retries.".to_owned(),
    ))
}

fn base64_decode(input: &str) -> Result<Vec<u8>, NookError> {
    use base64::{Engine as _, engine::general_purpose};
    general_purpose::STANDARD
        .decode(input)
        .map_err(|e| NookError::Serialization(format!("Base64 decode error: {}", e)))
}
