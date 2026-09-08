//! GitHub-backed storage adapter.
//!
//! Provides the small subset of the GitHub REST API the wasm session
//! needs: lookup the authenticated user's login, ensure the vault repo
//! exists, fetch the vault file (with sha for optimistic concurrency),
//! and write the vault file with retry on stale-sha conflicts.
//!
//! Network errors bubble up as `NookError::Network` (from `reqwest`) or
//! `NookError::GitHub` for protocol-shaped failures.

use js_sys::Date;
use reqwest::{Client, StatusCode};

use crate::NookError;
use serde::{Deserialize, Serialize};

fn log_github_api_failure(operation: &str, repo: &str, path: &str, status: reqwest::StatusCode) {
    tracing::warn!(
        scope = "github",
        operation,
        repo = %repo,
        path = %path,
        status = %status,
        "GitHub API request failed"
    );
}

/// A YAML event file fetched from GitHub.
pub(crate) struct GitHubVaultFile {
    pub(crate) content: String,
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
    let stamp = Date::now();
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

fn github_username_response(status: StatusCode, text: &str) -> Result<String, NookError> {
    if status == StatusCode::UNAUTHORIZED {
        log_github_api_failure("user", "", "", status);
        return Err(NookError::GitHub(
            "GitHub rejected your token (401). Check that it is valid, not expired, and has repo access.".to_owned(),
        ));
    }

    if !status.is_success() {
        log_github_api_failure("user", "", "", status);
        return Err(NookError::GitHub(format!(
            "Failed to fetch GitHub user details: status {status}"
        )));
    }

    let parsed: GitHubUserResponse = serde_json::from_str(text)
        .map_err(|e| NookError::Serialization(format!("Failed to parse user JSON: {}", e)))?;

    Ok(parsed.login)
}

fn github_repo_check_result(repo: &str, status: StatusCode) -> Result<bool, NookError> {
    if status.is_success() {
        return Ok(true);
    }

    if status != StatusCode::NOT_FOUND {
        log_github_api_failure("repo_check", repo, "", status);
        return Err(NookError::GitHub(format!(
            "Failed to check GitHub repository {repo}: status {status}"
        )));
    }

    Ok(false)
}

fn github_directory_listing(
    status: StatusCode,
    text: &str,
    repo: &str,
    path: &str,
) -> Result<Option<bool>, NookError> {
    if status == StatusCode::NOT_FOUND {
        return Ok(None);
    }

    if !status.is_success() {
        log_github_api_failure("contents_list", repo, path, status);
        return Err(NookError::GitHub(format!(
            "GitHub API responded with status {status}"
        )));
    }

    let entries: Vec<GitHubDirEntry> = serde_json::from_str(text).map_err(|e| {
        NookError::Serialization(format!("Failed to parse GitHub directory listing: {e}"))
    })?;

    Ok(Some(entries.iter().any(|item| {
        item.name == path && item.entry_type == "file"
    })))
}

fn github_file_response(
    status: StatusCode,
    text: &str,
    repo: &str,
    path: &str,
) -> Result<Option<GitHubVaultFile>, NookError> {
    if status == StatusCode::NOT_FOUND {
        return Ok(None);
    }

    if !status.is_success() {
        log_github_api_failure("file_fetch", repo, path, status);
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
    let decoded_bytes = base64_decode(&cleaned_content)?;
    let vault_content = String::from_utf8(decoded_bytes)
        .map_err(|e| NookError::Serialization(format!("Vault file is not valid UTF-8: {e}")))?;

    Ok(Some(GitHubVaultFile {
        content: vault_content,
    }))
}

fn github_put_response(
    status: StatusCode,
    text: &str,
    repo: &str,
    path: &str,
) -> Result<String, NookError> {
    if !status.is_success() {
        log_github_api_failure("file_write", repo, path, status);
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

pub(crate) async fn fetch_github_username(pat: &str) -> Result<String, NookError> {
    let pat = pat.trim();
    if pat.is_empty() {
        return Err(NookError::GitHub(
            "GitHub personal access token is required.".to_owned(),
        ));
    }

    let url = "https://api.github.com/user";
    let client = Client::new();
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
    github_username_response(status, &text)
}

pub(crate) async fn ensure_github_repo_exists(pat: &str, repo: &str) -> Result<(), NookError> {
    let pat = pat.trim();
    let client = Client::new();
    let check_url = format!("https://api.github.com/repos/{repo}");
    let check = client
        .get(&check_url)
        .header("Authorization", format!("Bearer {pat}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", "nook-wasm")
        .send()
        .await?;

    if github_repo_check_result(repo, check.status())? {
        return Ok(());
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

    if create.status().is_success() || create.status() == StatusCode::UNPROCESSABLE_ENTITY {
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
    let client = Client::new();
    let mut request = client.get(github_cache_bust_url(&format!(
        "https://api.github.com/repos/{repo}/contents/{path}"
    )));
    for (name, value) in github_get_headers(pat) {
        request = request.header(name, value);
    }
    let file_response = request.send().await?;

    let status = file_response.status();
    let text = file_response.text().await?;
    github_file_response(status, &text, repo, path)
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

    let client = Client::new();
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

    let list_status = list_response.status();
    let list_text = list_response.text().await?;
    let Some(has_file) = github_directory_listing(list_status, &list_text, repo, path)? else {
        if let Some(flag) = root_empty {
            *flag = true;
        }
        return Ok(None);
    };

    if !has_file {
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
    let client = Client::new();
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
    github_put_response(status, &text, repo, path)
}

fn base64_decode(input: &str) -> Result<Vec<u8>, NookError> {
    use base64::{Engine as _, engine::general_purpose};
    general_purpose::STANDARD
        .decode(input)
        .map_err(|e| NookError::Serialization(format!("Base64 decode error: {}", e)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[derive(Deserialize)]
    struct SerializedPutBody {
        message: String,
        content: String,
        sha: Option<String>,
    }

    #[wasm_bindgen_test]
    fn cache_busting_appends_the_right_separator() {
        let without_query = github_cache_bust_url("https://api.github.com/repos/example");
        assert!(without_query.starts_with("https://api.github.com/repos/example?_="));
        let with_query = github_cache_bust_url("https://api.github.com/repos/example?ref=main");
        assert!(with_query.starts_with("https://api.github.com/repos/example?ref=main&_="));
    }

    #[wasm_bindgen_test]
    fn request_headers_trim_tokens_and_pin_the_github_api_version() {
        assert_eq!(
            github_get_headers("  pat  "),
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
        assert_eq!(base64_decode("bm9vaw==").unwrap(), b"nook");
        let error = base64_decode("not base64!").expect_err("invalid base64 must fail closed");
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
            sha: None,
        })?;
        let without_sha: SerializedPutBody = serde_json::from_value(without_sha)?;
        assert_eq!(without_sha.message, "Update");
        assert_eq!(without_sha.content, "bm9vaw==");
        assert!(without_sha.sha.is_none());
        let with_sha = serde_json::to_value(GitHubPutBody {
            message: "Update".to_owned(),
            content: "bm9vaw==".to_owned(),
            sha: Some("sha-1".to_owned()),
        })?;
        let with_sha: SerializedPutBody = serde_json::from_value(with_sha)?;
        assert_eq!(with_sha.sha.as_deref(), Some("sha-1"));
        Ok(())
    }

    #[wasm_bindgen_test]
    fn github_username_response_covers_auth_statuses_and_payloads() {
        let unauthorized = github_username_response(StatusCode::UNAUTHORIZED, "")
            .expect_err("401 must be reported as a GitHub error");
        assert!(matches!(
            unauthorized,
            NookError::GitHub(message) if message.contains("rejected your token")
        ));

        let unavailable = github_username_response(StatusCode::BAD_GATEWAY, "")
            .expect_err("non-success status must be reported");
        assert!(matches!(
            unavailable,
            NookError::GitHub(message) if message.contains("status 502")
        ));

        assert_eq!(
            github_username_response(StatusCode::OK, r#"{"login":"nook"}"#).unwrap(),
            "nook"
        );
        let malformed = github_username_response(StatusCode::OK, "not-json")
            .expect_err("malformed user JSON must fail closed");
        assert!(matches!(
            malformed,
            NookError::Serialization(message) if message.contains("Failed to parse user JSON")
        ));
    }

    #[wasm_bindgen_test]
    fn github_repo_check_result_distinguishes_existing_missing_and_failure() {
        assert!(github_repo_check_result("owner/repo", StatusCode::OK).unwrap());
        assert!(!github_repo_check_result("owner/repo", StatusCode::NOT_FOUND).unwrap());
        let error = github_repo_check_result("owner/repo", StatusCode::FORBIDDEN)
            .expect_err("forbidden repository checks must fail closed");
        assert!(matches!(
            error,
            NookError::GitHub(message) if message.contains("owner/repo") && message.contains("403")
        ));
    }

    #[wasm_bindgen_test]
    fn github_directory_listing_covers_missing_errors_and_file_matching() {
        assert!(
            github_directory_listing(StatusCode::NOT_FOUND, "", "owner/repo", "vault.yaml")
                .unwrap()
                .is_none()
        );

        let unavailable = github_directory_listing(
            StatusCode::INTERNAL_SERVER_ERROR,
            "",
            "owner/repo",
            "vault.yaml",
        )
        .expect_err("directory status failures must fail closed");
        assert!(matches!(
            unavailable,
            NookError::GitHub(message) if message.contains("status 500")
        ));

        let malformed =
            github_directory_listing(StatusCode::OK, "not-json", "owner/repo", "vault.yaml")
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
            github_directory_listing(StatusCode::OK, listing, "owner/repo", "vault.yaml").unwrap(),
            Some(true)
        );
        assert_eq!(
            github_directory_listing(StatusCode::OK, listing, "owner/repo", "missing.yaml")
                .unwrap(),
            Some(false)
        );
    }

    #[wasm_bindgen_test]
    fn github_file_response_covers_missing_protocol_decode_and_utf8_errors() {
        assert!(
            github_file_response(StatusCode::NOT_FOUND, "", "owner/repo", "vault.yaml")
                .unwrap()
                .is_none()
        );

        let unavailable = github_file_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "",
            "owner/repo",
            "vault.yaml",
        );
        assert!(matches!(
            unavailable,
            Err(NookError::GitHub(message)) if message.contains("status 503")
        ));

        let malformed =
            github_file_response(StatusCode::OK, "not-json", "owner/repo", "vault.yaml");
        assert!(matches!(
            malformed,
            Err(NookError::Serialization(message)) if message.contains("Failed to parse JSON")
        ));

        let invalid_utf8 = github_file_response(
            StatusCode::OK,
            r#"{"content":"/w=="}"#,
            "owner/repo",
            "vault.yaml",
        );
        assert!(matches!(
            invalid_utf8,
            Err(NookError::Serialization(message)) if message.contains("not valid UTF-8")
        ));

        let file = github_file_response(
            StatusCode::OK,
            r#"{"content":" b m 9 v a w = =\n"}"#,
            "owner/repo",
            "vault.yaml",
        )
        .unwrap()
        .expect("valid file payload must decode");
        assert_eq!(file.content, "nook");
    }

    #[wasm_bindgen_test]
    fn github_put_response_covers_status_and_sha_projection() {
        let missing = github_put_response(StatusCode::NOT_FOUND, "", "owner/repo", "vault.yaml")
            .expect_err("missing write target must fail closed");
        assert!(matches!(
            missing,
            NookError::GitHub(message) if message.contains("Cannot write to owner/repo/vault.yaml")
        ));

        let unavailable = github_put_response(StatusCode::CONFLICT, "", "owner/repo", "vault.yaml")
            .expect_err("write conflicts must be reported");
        assert!(matches!(
            unavailable,
            NookError::GitHub(message) if message.contains("status 409")
        ));

        let malformed = github_put_response(StatusCode::OK, "not-json", "owner/repo", "vault.yaml")
            .expect_err("malformed write JSON must fail closed");
        assert!(matches!(
            malformed,
            NookError::Serialization(message) if message.contains("Failed to parse JSON")
        ));

        assert_eq!(
            github_put_response(
                StatusCode::CREATED,
                r#"{"content":{"sha":"sha-2"}}"#,
                "owner/repo",
                "vault.yaml"
            )
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
        let error = fetch_github_username("  ")
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
        let mut root_empty = true;
        let result =
            fetch_github_vault("token", "owner/repo", "vault.yaml", Some(&mut root_empty)).await?;
        assert!(result.is_none());
        assert!(root_empty);
        Ok(())
    }
}
