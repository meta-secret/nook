//! iCloud `CloudKit` private-database adapter for immutable event records.

use crate::NookError;
use crate::storage::{event_storage_matches_expected, parse_expected_event_storage_bytes};
use nook_core::EventId;
use serde::Deserialize;
use serde_json::json;

const ICLOUD_CONTAINER_ID: &str = match option_env!("NOOK_ICLOUD_CONTAINER_ID") {
    Some(value) => value,
    None => "iCloud.metasecret.project.com",
};
const ICLOUD_API_TOKEN: &str = match option_env!("NOOK_ICLOUD_API_TOKEN") {
    Some(value) => value,
    None => "c31649c685f5f589c1c66f867ab2c013b6765d01e6bda454ec28d246ca4dc7d0",
};
const ICLOUD_ENVIRONMENT: &str = match option_env!("NOOK_ICLOUD_ENVIRONMENT") {
    Some(value) => value,
    None => "production",
};
const ICLOUD_EVENT_RECORD_TYPE: &str = "NookVaultEvent";
const ICLOUD_CONTENT_FIELD: &str = "content";
const ICLOUD_EVENT_ID_FIELD: &str = "event_id";
const SHA256_BASE64URL_LEN: usize = 43;

fn is_sha256_base64url_digest(digest: &str) -> bool {
    digest.len() == SHA256_BASE64URL_LEN
        && digest
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

#[derive(Deserialize)]
struct ICloudFieldValue {
    value: Option<String>,
}

#[derive(Deserialize)]
struct ICloudRecord {
    #[serde(rename = "recordName")]
    record_name: String,
    #[serde(default)]
    fields: Option<std::collections::HashMap<String, ICloudFieldValue>>,
}

#[derive(Deserialize)]
struct ICloudRecordsResponse {
    #[serde(default)]
    records: Vec<ICloudRecord>,
    #[serde(rename = "continuationMarker", default)]
    continuation_marker: Option<String>,
}

fn icloud_database_url(path: &str) -> String {
    format!(
        "https://api.apple-cloudkit.com/database/1/{ICLOUD_CONTAINER_ID}/{ICLOUD_ENVIRONMENT}/private/{path}"
    )
}

fn icloud_auth_query(web_auth_token: &str) -> [(&'static str, String); 2] {
    [
        ("ckAPIToken", ICLOUD_API_TOKEN.to_owned()),
        ("ckWebAuthToken", web_auth_token.trim().to_owned()),
    ]
}

fn icloud_error(status: reqwest::StatusCode, body: &str) -> NookError {
    NookError::ICloud(format!(
        "CloudKit API responded with status {status}{}",
        if body.is_empty() {
            String::new()
        } else {
            format!(" — {body}")
        }
    ))
}

fn record_content(record: &ICloudRecord) -> Option<String> {
    record
        .fields
        .as_ref()
        .and_then(|fields| fields.get(ICLOUD_CONTENT_FIELD))
        .and_then(|field| field.value.clone())
}

fn record_field(record: &ICloudRecord, field_name: &str) -> Option<String> {
    record
        .fields
        .as_ref()
        .and_then(|fields| fields.get(field_name))
        .and_then(|field| field.value.clone())
}

fn icloud_event_record_name(event_id: &EventId) -> String {
    format!("nook-event-{}", event_id.encoded_digest())
}

fn event_id_from_record(record: &ICloudRecord) -> Option<String> {
    record_field(record, ICLOUD_EVENT_ID_FIELD).or_else(|| {
        record
            .record_name
            .strip_prefix("nook-event-")
            .filter(|digest| is_sha256_base64url_digest(digest))
            .map(|digest| format!("sha256u:{digest}"))
    })
}

async fn lookup_vault_record(
    web_auth_token: &str,
    record_name: &str,
) -> Result<Option<ICloudRecord>, NookError> {
    let client = reqwest::Client::new();
    let body = json!({
        "records": [{ "recordName": record_name }]
    });
    let mut request = client
        .post(icloud_database_url("records/lookup"))
        .header("Content-Type", "application/json");
    for (name, value) in icloud_auth_query(web_auth_token) {
        request = request.query(&[(name, value)]);
    }
    let response = request.json(&body).send().await?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(icloud_error(status, &body));
    }
    let parsed: ICloudRecordsResponse = response
        .json()
        .await
        .map_err(|e| NookError::Serialization(format!("Failed to parse CloudKit lookup: {e}")))?;
    Ok(parsed.records.into_iter().next())
}

async fn lookup_record(
    web_auth_token: &str,
    record_name: &str,
) -> Result<Option<ICloudRecord>, NookError> {
    lookup_vault_record(web_auth_token, record_name).await
}

pub(crate) async fn list_icloud_event_ids(web_auth_token: &str) -> Result<Vec<String>, NookError> {
    let token = nook_core::validate_oauth_access_token(web_auth_token)?;
    let client = reqwest::Client::new();
    let mut event_ids = Vec::new();
    let mut continuation_marker: Option<String> = None;

    loop {
        let mut body = json!({
            "query": {
                "recordType": ICLOUD_EVENT_RECORD_TYPE,
            },
            "resultsLimit": 200,
        });
        if let Some(marker) = continuation_marker.as_deref() {
            body["continuationMarker"] = json!(marker);
        }

        let mut request = client
            .post(icloud_database_url("records/query"))
            .header("Content-Type", "application/json");
        for (name, value) in icloud_auth_query(token.as_ref()) {
            request = request.query(&[(name, value)]);
        }
        let response = request.json(&body).send().await?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(icloud_error(status, &body));
        }
        let parsed: ICloudRecordsResponse = response.json().await.map_err(|e| {
            NookError::Serialization(format!("Failed to parse CloudKit event query: {e}"))
        })?;
        for record in &parsed.records {
            if let Some(event_id) = event_id_from_record(record)
                && EventId::parse(&event_id).is_ok()
            {
                event_ids.push(event_id);
            }
        }
        continuation_marker = parsed.continuation_marker;
        if continuation_marker.is_none() {
            break;
        }
    }
    event_ids.sort();
    event_ids.dedup();
    Ok(event_ids)
}

pub(crate) async fn fetch_icloud_event(
    web_auth_token: &str,
    event_id: &EventId,
) -> Result<Vec<u8>, NookError> {
    let token = nook_core::validate_oauth_access_token(web_auth_token)?;
    let record_name = icloud_event_record_name(event_id);
    let record = lookup_record(token.as_ref(), &record_name)
        .await?
        .ok_or_else(|| {
            NookError::ICloud(format!("CloudKit event record {record_name} is missing."))
        })?;
    let stored_event_id = event_id_from_record(&record).ok_or_else(|| {
        NookError::ICloud(format!(
            "CloudKit event record {record_name} does not include an event id."
        ))
    })?;
    if stored_event_id != event_id.as_str() {
        return Err(NookError::ICloud(format!(
            "CloudKit event record {record_name} points at {stored_event_id}, expected {}.",
            event_id.as_str()
        )));
    }
    let content = record_content(&record).ok_or_else(|| {
        NookError::ICloud(format!(
            "CloudKit event record {record_name} does not include content."
        ))
    })?;
    Ok(content.into_bytes())
}

pub(crate) async fn put_icloud_event_if_absent(
    web_auth_token: &str,
    event_id: &EventId,
    bytes: &[u8],
) -> Result<(), NookError> {
    let token = nook_core::validate_oauth_access_token(web_auth_token)?;
    let content = std::str::from_utf8(bytes)
        .map_err(|e| NookError::Serialization(format!("Event YAML must be UTF-8: {e}")))?;
    let expected_event = parse_expected_event_storage_bytes(bytes, event_id, "CloudKit")?;
    let record_name = icloud_event_record_name(event_id);

    if let Some(existing) = lookup_record(token.as_ref(), &record_name).await? {
        let existing_content = record_content(&existing).unwrap_or_default();
        let existing_bytes = existing_content.as_bytes();
        if existing_bytes == bytes
            || event_storage_matches_expected(existing_bytes, &expected_event)
        {
            return Ok(());
        }
        return Err(NookError::ICloud(
            "Event record exists with different content (corruption).".to_owned(),
        ));
    }

    let body = json!({
        "operations": [{
            "operationType": "create",
            "record": {
                "recordType": ICLOUD_EVENT_RECORD_TYPE,
                "recordName": record_name,
                "fields": {
                    ICLOUD_EVENT_ID_FIELD: { "value": event_id.as_str() },
                    ICLOUD_CONTENT_FIELD: { "value": content }
                }
            }
        }]
    });
    let client = reqwest::Client::new();
    let mut request = client
        .post(icloud_database_url("records/modify"))
        .header("Content-Type", "application/json");
    for (name, value) in icloud_auth_query(token.as_ref()) {
        request = request.query(&[(name, value)]);
    }
    let response = request.json(&body).send().await?;
    if response.status().is_success() {
        let _parsed: serde_json::Value = response.json().await.map_err(|e| {
            NookError::Serialization(format!("Failed to parse CloudKit event create: {e}"))
        })?;
        return Ok(());
    }

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if body.contains("serverRecord") || body.contains("ALREADY_EXISTS") {
        if let Some(existing) = lookup_record(token.as_ref(), &record_name).await? {
            let existing_content = record_content(&existing).unwrap_or_default();
            let existing_bytes = existing_content.as_bytes();
            if existing_bytes == bytes
                || event_storage_matches_expected(existing_bytes, &expected_event)
            {
                return Ok(());
            }
        }
        return Err(NookError::ICloud(
            "Event record exists with different content (corruption).".to_owned(),
        ));
    }

    Err(icloud_error(status, &body))
}
