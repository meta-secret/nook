//! Google Drive immutable event file adapter.

use crate::NookError;
use crate::storage::{event_storage_matches_expected, parse_expected_event_storage_bytes};
use nook_core::{DriveEventParent, EventId, VaultEvent, parse_remote_event_storage_bytes};

const DRIVE_EVENT_MISSING: &str = "Drive event file missing.";
const SHA256_BASE64URL_LEN: usize = 43;

fn is_sha256_base64url_digest(digest: &str) -> bool {
    digest.len() == SHA256_BASE64URL_LEN
        && digest
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn parent_query_fragment(parent: &DriveEventParent) -> String {
    match parent {
        DriveEventParent::AppDataFolder => "'appDataFolder' in parents".to_owned(),
        DriveEventParent::SharedFolder { folder_id } => {
            format!("'{}' in parents", folder_id.replace('\'', "\\'"))
        }
    }
}

fn list_spaces_query(parent: &DriveEventParent) -> Option<&'static str> {
    match parent {
        DriveEventParent::AppDataFolder => Some("appDataFolder"),
        DriveEventParent::SharedFolder { .. } => None,
    }
}

fn parent_id_for_create(parent: &DriveEventParent) -> &str {
    match parent {
        DriveEventParent::AppDataFolder => "appDataFolder",
        DriveEventParent::SharedFolder { folder_id } => folder_id.as_str(),
    }
}

pub(crate) async fn list_drive_event_ids(
    token: &str,
    parent: &DriveEventParent,
) -> Result<Vec<String>, NookError> {
    let token = token.trim();
    let query = format!(
        "name contains '.yaml' and {} and trashed=false",
        parent_query_fragment(parent)
    );
    let mut url = format!(
        "https://www.googleapis.com/drive/v3/files?q={}&fields=nextPageToken,files(id,name)&pageSize=1000",
        urlencoding::encode(&query)
    );
    if let Some(spaces) = list_spaces_query(parent) {
        url.push_str("&spaces=");
        url.push_str(spaces);
    }
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
                if let Some(digest) = name.strip_suffix(".yaml")
                    && is_sha256_base64url_digest(digest)
                {
                    event_ids.push(format!("sha256u:{digest}"));
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
    parent: &DriveEventParent,
    event_id: &EventId,
) -> Result<Vec<u8>, NookError> {
    let token = token.trim();
    let file_ids = lookup_drive_event_file_ids(
        token,
        parent,
        &format!("{}.yaml", event_id.encoded_digest()),
    )
    .await?;
    if file_ids.is_empty() {
        return Err(NookError::Drive(DRIVE_EVENT_MISSING.to_owned()));
    }

    let client = reqwest::Client::new();
    let mut accepted: Option<(VaultEvent, Vec<u8>)> = None;
    for file_id in file_ids {
        let bytes = download_drive_event_file(&client, token, &file_id).await?;
        let event = parse_remote_event_storage_bytes(&bytes)
            .map_err(|e| NookError::Serialization(format!("Drive event parse: {e}")))?;
        if event.id()? != *event_id {
            continue;
        }
        if let Some((existing_event, _)) = &accepted {
            if existing_event == &event {
                continue;
            }
            return Err(NookError::Drive(
                "Drive duplicate event files contain different events.".to_owned(),
            ));
        }
        accepted = Some((event, bytes));
    }
    accepted.map(|(_, bytes)| bytes).ok_or_else(|| {
        NookError::Drive(
            "Drive event file name exists but no file content matches the requested id.".to_owned(),
        )
    })
}

async fn lookup_drive_event_file_ids(
    token: &str,
    parent: &DriveEventParent,
    file_name: &str,
) -> Result<Vec<String>, NookError> {
    let query = format!(
        "name = '{}' and {} and trashed=false",
        file_name.replace('\'', "\\'"),
        parent_query_fragment(parent)
    );
    let mut list_url = format!(
        "https://www.googleapis.com/drive/v3/files?q={}&fields=files(id)",
        urlencoding::encode(&query)
    );
    if let Some(spaces) = list_spaces_query(parent) {
        list_url.push_str("&spaces=");
        list_url.push_str(spaces);
    }
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
    let Some(files) = body.get("files").and_then(|v| v.as_array()) else {
        return Ok(Vec::new());
    };
    Ok(files
        .iter()
        .filter_map(|file| file.get("id").and_then(|v| v.as_str()).map(str::to_owned))
        .collect())
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
    parent: &DriveEventParent,
    event_id: &EventId,
    bytes: &[u8],
) -> Result<String, NookError> {
    let token = token.trim();
    let expected_event = parse_expected_event_storage_bytes(bytes, event_id, "Drive")?;
    match fetch_drive_event(token, parent, event_id).await {
        Ok(existing)
            if existing == bytes || event_storage_matches_expected(&existing, &expected_event) =>
        {
            return Ok(String::new());
        }
        Ok(_) => {
            return Err(NookError::Drive(
                "Drive event path already exists with different bytes.".to_owned(),
            ));
        }
        Err(NookError::Drive(message)) if message == DRIVE_EVENT_MISSING => {}
        Err(err) => return Err(err),
    }
    let file_name = format!("{}.yaml", event_id.encoded_digest());
    let metadata = serde_json::json!({
        "name": file_name,
        "parents": [parent_id_for_create(parent)],
        "appProperties": {
            "event_id": event_id.as_str(),
        }
    });
    let content = std::str::from_utf8(bytes)
        .map_err(|e| NookError::Serialization(format!("Event YAML must be UTF-8: {e}")))?;

    let boundary = "nook_event_boundary";
    let mut body = String::new();
    body.push_str("--");
    body.push_str(boundary);
    body.push_str("\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n");
    body.push_str(&metadata.to_string());
    body.push_str("\r\n--");
    body.push_str(boundary);
    body.push_str("\r\nContent-Type: application/x-yaml\r\n\r\n");
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
    parsed
        .get("id")
        .and_then(|v| v.as_str())
        .map(str::to_owned)
        .ok_or_else(|| NookError::Drive("Drive event create response missing file id.".to_owned()))
}
