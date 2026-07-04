//! Google Drive app-data folder adapter.
//!
//! Each vault file lives in the user's hidden `appDataFolder` under a
//! user-chosen name (default `nook-vault.yaml`). Optimistic concurrency
//! mirrors GitHub's blob `sha`: we capture `md5Checksum` from metadata and
//! send `If-Match` on update.

use crate::NookError;
use serde::Deserialize;

pub(crate) struct DriveVaultFile {
    pub(crate) content: String,
    pub(crate) file_id: String,
    /// Used as the optimistic-lock token (Drive `md5Checksum`).
    pub(crate) revision: String,
}

#[derive(Deserialize)]
struct DriveFileList {
    files: Vec<DriveFileMeta>,
}

#[derive(Deserialize)]
struct DriveFileMeta {
    id: String,
    #[serde(rename = "md5Checksum", default)]
    md5_checksum: Option<String>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct DriveAboutUser {
    #[serde(rename = "emailAddress")]
    email_address: Option<String>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct DriveAboutResponse {
    user: Option<DriveAboutUser>,
}

fn drive_headers(access_token: &str) -> [(&'static str, String); 2] {
    [
        ("Authorization", format!("Bearer {}", access_token.trim())),
        ("User-Agent", "nook-wasm".to_owned()),
    ]
}

fn drive_error(status: reqwest::StatusCode, body: &str) -> NookError {
    NookError::Drive(format!(
        "Google Drive API responded with status {status}{}",
        if body.is_empty() {
            String::new()
        } else {
            format!(" — {body}")
        }
    ))
}

fn escape_drive_query_literal(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "\\'")
}

pub(crate) async fn verify_drive_access(access_token: &str) -> Result<(), NookError> {
    let token = nook_core::validate_oauth_access_token(access_token)?;
    let client = reqwest::Client::new();
    let mut request = client
        .get("https://www.googleapis.com/drive/v3/about")
        .query(&[("fields", "user")]);
    for (name, value) in drive_headers(token.as_ref()) {
        request = request.header(name, value);
    }
    let response = request.send().await?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(NookError::Drive(
            "Google Drive rejected the access token (401). Sign in again.".to_owned(),
        ));
    }
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(drive_error(status, &body));
    }
    let _parsed: DriveAboutResponse = response
        .json()
        .await
        .map_err(|e| NookError::Serialization(format!("Failed to parse Drive about: {e}")))?;
    Ok(())
}

async fn list_vault_file_meta(
    access_token: &str,
    file_name: &str,
) -> Result<Option<DriveFileMeta>, NookError> {
    let client = reqwest::Client::new();
    let escaped = escape_drive_query_literal(file_name);
    let query = format!("name='{escaped}' and trashed=false");
    let mut request = client
        .get("https://www.googleapis.com/drive/v3/files")
        .query(&[
            ("spaces", "appDataFolder"),
            ("q", &query),
            ("fields", "files(id,md5Checksum)"),
            ("pageSize", "1"),
        ]);
    for (name, value) in drive_headers(access_token) {
        request = request.header(name, value);
    }
    let response = request.send().await?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(drive_error(status, &body));
    }
    let parsed: DriveFileList = response
        .json()
        .await
        .map_err(|e| NookError::Serialization(format!("Failed to parse Drive list: {e}")))?;
    Ok(parsed.files.into_iter().next())
}

async fn fetch_file_metadata(
    access_token: &str,
    file_id: &str,
) -> Result<DriveFileMeta, NookError> {
    let client = reqwest::Client::new();
    let url = format!("https://www.googleapis.com/drive/v3/files/{file_id}");
    let mut request = client.get(&url).query(&[("fields", "id,md5Checksum")]);
    for (name, value) in drive_headers(access_token) {
        request = request.header(name, value);
    }
    let response = request.send().await?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(drive_error(status, &body));
    }
    response
        .json()
        .await
        .map_err(|e| NookError::Serialization(format!("Failed to parse Drive metadata: {e}")))
}

async fn read_file_content(access_token: &str, file_id: &str) -> Result<String, NookError> {
    let client = reqwest::Client::new();
    let url = format!("https://www.googleapis.com/drive/v3/files/{file_id}");
    let mut request = client.get(&url).query(&[("alt", "media")]);
    for (name, value) in drive_headers(access_token) {
        request = request.header(name, value);
    }
    let response = request.send().await?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(drive_error(status, &body));
    }
    response.text().await.map_err(NookError::Network)
}

pub(crate) async fn ensure_drive_vault_file(
    access_token: &str,
    known_file_id: &str,
    file_name: &str,
) -> Result<String, NookError> {
    let token = nook_core::validate_oauth_access_token(access_token)?;
    let validated_name = nook_core::validate_drive_vault_file_name(file_name)?;
    let trimmed_id = known_file_id.trim();
    if !trimmed_id.is_empty()
        && fetch_file_metadata(token.as_ref(), trimmed_id)
            .await
            .is_ok()
    {
        return Ok(trimmed_id.to_owned());
    }
    if let Some(meta) = list_vault_file_meta(token.as_ref(), validated_name.as_ref()).await? {
        return Ok(meta.id);
    }
    create_drive_vault_file(token.as_ref(), validated_name.as_ref()).await
}

async fn create_drive_vault_file(access_token: &str, file_name: &str) -> Result<String, NookError> {
    let client = reqwest::Client::new();
    let metadata = serde_json::json!({
        "name": file_name,
        "parents": ["appDataFolder"],
    });
    let body = format!(
        "--nook-drive-boundary\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n--nook-drive-boundary--\r\n"
    );
    let mut request = client
        .post("https://www.googleapis.com/upload/drive/v3/files")
        .query(&[("uploadType", "multipart")])
        .header(
            "Content-Type",
            "multipart/related; boundary=nook-drive-boundary",
        );
    for (name, value) in drive_headers(access_token) {
        request = request.header(name, value);
    }
    let response = request.body(body).send().await?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(drive_error(status, &body));
    }
    let meta: DriveFileMeta = response
        .json()
        .await
        .map_err(|e| NookError::Serialization(format!("Failed to parse Drive create: {e}")))?;
    Ok(meta.id)
}

pub(crate) async fn fetch_drive_vault(
    access_token: &str,
    file_id: &str,
    file_name: &str,
) -> Result<Option<DriveVaultFile>, NookError> {
    let token = nook_core::validate_oauth_access_token(access_token)?;
    let resolved_id = ensure_drive_vault_file(access_token, file_id, file_name).await?;
    let meta = fetch_file_metadata(token.as_ref(), &resolved_id).await?;
    let content = read_file_content(token.as_ref(), &resolved_id).await?;
    if content.is_empty() {
        return Ok(None);
    }
    let revision = meta
        .md5_checksum
        .filter(|value| !value.is_empty())
        .unwrap_or(meta.id);
    Ok(Some(DriveVaultFile {
        content,
        file_id: resolved_id,
        revision,
    }))
}

pub(crate) async fn write_drive_vault_with_retry(
    access_token: &str,
    file_id: &str,
    file_name: &str,
    content: &str,
    revision: Option<String>,
) -> Result<(String, String), NookError> {
    let token = nook_core::validate_oauth_access_token(access_token)?;
    let resolved_id = ensure_drive_vault_file(access_token, file_id, file_name).await?;

    match write_drive_vault_once(token.as_ref(), &resolved_id, content, revision).await {
        Ok(new_revision) => Ok((resolved_id, new_revision)),
        Err(NookError::Drive(msg)) if msg.contains("412") || msg.contains("Precondition") => {
            let current_content = read_file_content(token.as_ref(), &resolved_id).await?;
            let meta = fetch_file_metadata(token.as_ref(), &resolved_id).await?;
            let remote_revision = meta.md5_checksum.or(Some(meta.id));
            if current_content.trim() == content.trim() {
                return Ok((resolved_id, remote_revision.unwrap_or_default()));
            }
            Err(NookError::Drive(
                "Remote vault changed during write; sync conflict required.".to_owned(),
            ))
        }
        Err(err) => Err(err),
    }
}

async fn write_drive_vault_once(
    access_token: &str,
    file_id: &str,
    content: &str,
    revision: Option<String>,
) -> Result<String, NookError> {
    let client = reqwest::Client::new();
    let url = format!("https://www.googleapis.com/upload/drive/v3/files/{file_id}");
    let mut request = client
        .patch(&url)
        .query(&[("uploadType", "media")])
        .header("Content-Type", "application/octet-stream");
    if let Some(rev) = revision.filter(|value| !value.is_empty()) {
        request = request.header("If-Match", rev);
    }
    for (name, value) in drive_headers(access_token) {
        request = request.header(name, value);
    }
    let response = request.body(content.to_owned()).send().await?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(drive_error(status, &body));
    }
    let meta: DriveFileMeta = response
        .json()
        .await
        .map_err(|e| NookError::Serialization(format!("Failed to parse Drive update: {e}")))?;
    Ok(meta.md5_checksum.unwrap_or(meta.id))
}
