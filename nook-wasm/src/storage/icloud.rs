//! iCloud `CloudKit` private-database adapter.
//!
//! Each vault file is stored as a `CloudKit` record in the user's private
//! database under a user-chosen record name (default `nook-vault.yaml`).
//! Optimistic concurrency uses `CloudKit` `recordChangeTag`, mirroring Drive's
//! `md5Checksum` / GitHub blob `sha`.

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
const ICLOUD_RECORD_TYPE: &str = "NookVault";
const ICLOUD_EVENT_RECORD_TYPE: &str = "NookVaultEvent";
const ICLOUD_CONTENT_FIELD: &str = "content";
const ICLOUD_EVENT_ID_FIELD: &str = "event_id";

pub(crate) struct ICloudVaultFile {
    pub(crate) content: String,
    pub(crate) record_name: String,
    /// Used as the optimistic-lock token (`CloudKit` `recordChangeTag`).
    pub(crate) revision: String,
}

#[derive(Deserialize)]
struct ICloudFieldValue {
    value: Option<String>,
}

#[derive(Deserialize)]
struct ICloudRecord {
    #[serde(rename = "recordName")]
    record_name: String,
    #[serde(rename = "recordChangeTag", default)]
    record_change_tag: Option<String>,
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

#[derive(Deserialize)]
struct ICloudModifyResponse {
    #[serde(default)]
    records: Vec<ICloudRecord>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct ICloudUserResponse {
    #[serde(rename = "userRecordName", default)]
    user_record_name: Option<String>,
}

fn icloud_database_url(path: &str) -> String {
    format!(
        "https://api.apple-cloudkit.com/database/1/{ICLOUD_CONTAINER_ID}/{ICLOUD_ENVIRONMENT}/private/{path}"
    )
}

fn icloud_user_url(path: &str) -> String {
    format!(
        "https://api.apple-cloudkit.com/user/1/{ICLOUD_CONTAINER_ID}/{ICLOUD_ENVIRONMENT}/{path}"
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
    format!("nook-event-{}", event_id.hex_digest())
}

fn event_id_from_record(record: &ICloudRecord) -> Option<String> {
    record_field(record, ICLOUD_EVENT_ID_FIELD).or_else(|| {
        record
            .record_name
            .strip_prefix("nook-event-")
            .filter(|digest| digest.len() == 64)
            .map(|digest| format!("sha256:{digest}"))
    })
}

pub(crate) async fn verify_icloud_access(web_auth_token: &str) -> Result<(), NookError> {
    let token = nook_core::validate_oauth_access_token(web_auth_token)?;
    let client = reqwest::Client::new();
    let mut request = client.get(icloud_user_url("users/current"));
    for (name, value) in icloud_auth_query(token.as_ref()) {
        request = request.query(&[(name, value)]);
    }
    let response = request.send().await?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(NookError::ICloud(
            "iCloud rejected the web auth token (401). Sign in again.".to_owned(),
        ));
    }
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(icloud_error(status, &body));
    }
    let _parsed: ICloudUserResponse = response
        .json()
        .await
        .map_err(|e| NookError::Serialization(format!("Failed to parse CloudKit user: {e}")))?;
    Ok(())
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

pub(crate) async fn ensure_icloud_vault_record(
    web_auth_token: &str,
    record_name: &str,
) -> Result<String, NookError> {
    let token = nook_core::validate_oauth_access_token(web_auth_token)?;
    let validated_name = nook_core::validate_drive_vault_file_name(record_name)?;
    if lookup_vault_record(token.as_ref(), validated_name.as_ref())
        .await?
        .is_some()
    {
        return Ok(validated_name.into_inner());
    }
    create_icloud_vault_record(token.as_ref(), validated_name.as_ref()).await?;
    Ok(validated_name.into_inner())
}

async fn create_icloud_vault_record(
    web_auth_token: &str,
    record_name: &str,
) -> Result<(), NookError> {
    let client = reqwest::Client::new();
    let body = json!({
        "operations": [{
            "operationType": "create",
            "record": {
                "recordType": ICLOUD_RECORD_TYPE,
                "recordName": record_name,
                "fields": {
                    ICLOUD_CONTENT_FIELD: { "value": "" }
                }
            }
        }]
    });
    let mut request = client
        .post(icloud_database_url("records/modify"))
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
    let _parsed: ICloudModifyResponse = response
        .json()
        .await
        .map_err(|e| NookError::Serialization(format!("Failed to parse CloudKit create: {e}")))?;
    Ok(())
}

pub(crate) async fn fetch_icloud_vault(
    web_auth_token: &str,
    record_name: &str,
) -> Result<Option<ICloudVaultFile>, NookError> {
    let token = nook_core::validate_oauth_access_token(web_auth_token)?;
    let resolved_name = ensure_icloud_vault_record(web_auth_token, record_name).await?;
    let record = lookup_vault_record(token.as_ref(), &resolved_name)
        .await?
        .ok_or_else(|| {
            NookError::ICloud(format!(
                "CloudKit record {resolved_name} disappeared after ensure."
            ))
        })?;
    let content = record_content(&record).unwrap_or_default();
    if content.is_empty() {
        return Ok(None);
    }
    let revision = record
        .record_change_tag
        .filter(|value| !value.is_empty())
        .unwrap_or(record.record_name.clone());
    Ok(Some(ICloudVaultFile {
        content,
        record_name: resolved_name,
        revision,
    }))
}

pub(crate) async fn write_icloud_vault_with_retry(
    web_auth_token: &str,
    record_name: &str,
    content: &str,
    revision: Option<String>,
) -> Result<(String, String), NookError> {
    let token = nook_core::validate_oauth_access_token(web_auth_token)?;
    let resolved_name = ensure_icloud_vault_record(web_auth_token, record_name).await?;

    match write_icloud_vault_once(token.as_ref(), &resolved_name, content, revision).await {
        Ok(new_revision) => Ok((resolved_name, new_revision)),
        Err(NookError::ICloud(msg))
            if msg.contains("CHANGE_TOKEN") || msg.contains("serverRecord") =>
        {
            let record = lookup_vault_record(token.as_ref(), &resolved_name)
                .await?
                .ok_or_else(|| {
                    NookError::ICloud(format!(
                        "CloudKit record {resolved_name} missing during retry."
                    ))
                })?;
            let remote_revision = record
                .record_change_tag
                .clone()
                .unwrap_or(record.record_name.clone());
            if record_content(&record).unwrap_or_default().trim() == content.trim() {
                return Ok((resolved_name, remote_revision));
            }
            Err(NookError::ICloud(
                "Remote vault changed during write; sync conflict required.".to_owned(),
            ))
        }
        Err(err) => Err(err),
    }
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
        let _parsed: ICloudModifyResponse = response.json().await.map_err(|e| {
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

async fn write_icloud_vault_once(
    web_auth_token: &str,
    record_name: &str,
    content: &str,
    revision: Option<String>,
) -> Result<String, NookError> {
    let operation_type = if revision.as_ref().is_some_and(|value| !value.is_empty()) {
        "update"
    } else {
        "create"
    };
    let mut record = json!({
        "recordType": ICLOUD_RECORD_TYPE,
        "recordName": record_name,
        "fields": {
            ICLOUD_CONTENT_FIELD: { "value": content }
        }
    });
    if let Some(change_tag) = revision.filter(|value| !value.is_empty()) {
        record["recordChangeTag"] = json!(change_tag);
    }
    let body = json!({
        "operations": [{
            "operationType": operation_type,
            "record": record
        }]
    });

    let client = reqwest::Client::new();
    let mut request = client
        .post(icloud_database_url("records/modify"))
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
    let parsed: ICloudModifyResponse = response
        .json()
        .await
        .map_err(|e| NookError::Serialization(format!("Failed to parse CloudKit update: {e}")))?;
    let record = parsed.records.into_iter().next().ok_or_else(|| {
        NookError::ICloud("CloudKit modify response did not include a record.".to_owned())
    })?;
    Ok(record.record_change_tag.unwrap_or(record.record_name))
}
