//! Google Drive immutable event file adapter.

use crate::NookError;
use nook_core::{EventId, VaultEvent};

const DRIVE_EVENT_MISSING: &str = "Drive event file missing.";

pub(crate) async fn list_drive_event_ids(token: &str) -> Result<Vec<String>, NookError> {
    let token = token.trim();
    let query = "name contains '.event' and 'appDataFolder' in parents and trashed=false";
    let url = format!(
        "https://www.googleapis.com/drive/v3/files?q={}&spaces=appDataFolder&fields=nextPageToken,files(id,name)&pageSize=1000",
        urlencoding::encode(query)
    );
    let client = reqwest::Client::new();
    let mut event_ids = Vec::new();
    let mut page_token: Option<String> = None;

    loop {
        let mut request_url = url.clone();
        if let Some(page) = &page_token {
            request_url.push_str("&pageToken=");
            request_url.push_str(&urlencoding::encode(page));
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
                let Some(name) = file.get("name").and_then(|v| v.as_str()) else {
                    continue;
                };
                if let Some(digest) = name.strip_suffix(".event")
                    && digest.len() == 64
                {
                    event_ids.push(format!("sha256:{digest}"));
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
    event_id: &EventId,
) -> Result<Vec<u8>, NookError> {
    let token = token.trim();
    let file_name = format!("{}.event", event_id.hex_digest());
    let query = format!(
        "name = '{}' and 'appDataFolder' in parents and trashed=false",
        file_name.replace('\'', "\\'")
    );
    let list_url = format!(
        "https://www.googleapis.com/drive/v3/files?q={}&spaces=appDataFolder&fields=files(id)",
        urlencoding::encode(&query)
    );
    let client = reqwest::Client::new();
    let response = client
        .get(&list_url)
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(NookError::Drive(format!(
            "Drive lookup event failed: {}",
            response.status()
        )));
    }
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| NookError::Serialization(e.to_string()))?;
    let file_ids: Vec<String> = body
        .get("files")
        .and_then(|v| v.as_array())
        .map(|files| {
            files
                .iter()
                .filter_map(|file| file.get("id").and_then(|v| v.as_str()).map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    if file_ids.is_empty() {
        return Err(NookError::Drive(DRIVE_EVENT_MISSING.to_owned()));
    }

    let mut accepted: Option<Vec<u8>> = None;
    for file_id in file_ids {
        let bytes = download_drive_event_file(&client, token, &file_id).await?;
        let event: VaultEvent = serde_json::from_slice(&bytes)
            .map_err(|e| NookError::Serialization(format!("Drive event parse: {e}")))?;
        if event.id()? != *event_id {
            continue;
        }
        if let Some(existing) = &accepted {
            if existing != &bytes {
                return Err(NookError::Drive(
                    "Drive duplicate event files contain different bytes.".to_owned(),
                ));
            }
        } else {
            accepted = Some(bytes);
        }
    }
    accepted.ok_or_else(|| {
        NookError::Drive(
            "Drive event file name exists but no file content matches the requested id.".to_owned(),
        )
    })
}

async fn download_drive_event_file(
    client: &reqwest::Client,
    token: &str,
    file_id: &str,
) -> Result<Vec<u8>, NookError> {
    let download_url = format!("https://www.googleapis.com/drive/v3/files/{file_id}?alt=media");
    let download = client
        .get(&download_url)
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await?;
    if !download.status().is_success() {
        return Err(NookError::Drive(format!(
            "Drive download event failed: {}",
            download.status()
        )));
    }
    let bytes = download
        .bytes()
        .await
        .map_err(|e| NookError::Drive(format!("Drive read event body: {e}")))?;
    Ok(bytes.to_vec())
}

pub(crate) async fn put_drive_event_if_absent(
    token: &str,
    event_id: &EventId,
    bytes: &[u8],
) -> Result<String, NookError> {
    let token = token.trim();
    match fetch_drive_event(token, event_id).await {
        Ok(existing) if existing == bytes => return Ok(String::new()),
        Ok(_) => {
            return Err(NookError::Drive(
                "Drive event path already exists with different bytes.".to_owned(),
            ));
        }
        Err(NookError::Drive(message)) if message == DRIVE_EVENT_MISSING => {}
        Err(err) => return Err(err),
    }
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
    body.push_str("--");
    body.push_str(boundary);
    body.push_str("\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n");
    body.push_str(&metadata.to_string());
    body.push_str("\r\n--");
    body.push_str(boundary);
    body.push_str("\r\nContent-Type: application/json\r\n\r\n");
    body.push_str(content);
    body.push_str("\r\n--");
    body.push_str(boundary);
    body.push_str("--");

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
