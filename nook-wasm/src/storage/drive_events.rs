//! Google Drive immutable event file adapter.

use crate::NookError;
use crate::storage::drive::fetch_drive_vault;
use nook_core::EventId;

pub(crate) async fn list_drive_event_ids(
    token: &str,
    file_name_prefix: &str,
) -> Result<Vec<String>, NookError> {
    let token = token.trim();
    let query = format!(
        "name contains '{file_name_prefix}' and 'appDataFolder' in parents and trashed=false"
    );
    let url = format!(
        "https://www.googleapis.com/drive/v3/files?q={}&spaces=appDataFolder&fields=nextPageToken,files(id,name)&pageSize=1000",
        urlencoding::encode(&query)
    );
    let client = reqwest::Client::new();
    let mut event_ids = Vec::new();
    let mut page_token: Option<String> = None;

    loop {
        let mut request_url = url.clone();
        if let Some(page) = &page_token {
            request_url.push_str(&format!("&pageToken={}", urlencoding::encode(page)));
        }
        let response = client
            .get(&request_url)
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(NookError::Drive(format!(
                "Drive list events failed: {}",
                response.status()
            )));
        }
        let body: serde_json::Value = response
            .json()
            .await
            .map_err(|e| NookError::Serialization(e.to_string()))?;
        if let Some(files) = body.get("files").and_then(|v| v.as_array()) {
            for file in files {
                if let Some(name) = file.get("name").and_then(|v| v.as_str()) {
                    if let Some(digest) = name.strip_suffix(".event") {
                        if digest.len() == 64 {
                            event_ids.push(format!("sha256:{digest}"));
                        }
                    }
                }
            }
        }
        page_token = body
            .get("nextPageToken")
            .and_then(|v| v.as_str())
            .map(str::to_owned);
        if page_token.is_none() {
            break;
        }
    }
    Ok(event_ids)
}

pub(crate) async fn fetch_drive_event(
    token: &str,
    file_id: &str,
    file_name: &str,
) -> Result<Vec<u8>, NookError> {
    if let Some(file) = fetch_drive_vault(token, file_id, file_name).await? {
        Ok(file.content.into_bytes())
    } else {
        Err(NookError::Drive("Drive event file missing.".to_owned()))
    }
}

pub(crate) async fn put_drive_event_if_absent(
    token: &str,
    event_id: &EventId,
    bytes: &[u8],
) -> Result<String, NookError> {
    let token = token.trim();
    let file_name = format!("{}.event", event_id.hex_digest());
    let metadata = serde_json::json!({
        "name": file_name,
        "parents": ["appDataFolder"],
        "appProperties": {
            "event_id": event_id.as_str(),
        }
    });
    let content = std::str::from_utf8(bytes)
        .map_err(|e| NookError::Serialization(format!("Event JSON must be UTF-8: {e}")))?;

    let boundary = "nook_event_boundary";
    let mut body = String::new();
    body.push_str(&format!("--{boundary}\r\n"));
    body.push_str("Content-Type: application/json; charset=UTF-8\r\n\r\n");
    body.push_str(&metadata.to_string());
    body.push_str("\r\n");
    body.push_str(&format!("--{boundary}\r\n"));
    body.push_str("Content-Type: application/json\r\n\r\n");
    body.push_str(content);
    body.push_str(&format!("\r\n--{boundary}--"));

    let client = reqwest::Client::new();
    let response = client
        .post("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart")
        .header("Authorization", format!("Bearer {token}"))
        .header(
            "Content-Type",
            format!("multipart/related; boundary={boundary}"),
        )
        .body(body)
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(NookError::Drive(format!(
            "Drive event create failed: {}",
            response.status()
        )));
    }
    let parsed: serde_json::Value = response
        .json()
        .await
        .map_err(|e| NookError::Serialization(e.to_string()))?;
    Ok(parsed
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_owned())
}
