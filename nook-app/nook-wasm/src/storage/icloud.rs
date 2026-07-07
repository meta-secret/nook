//! iCloud `CloudKit` private-database adapter for immutable event records.

use crate::NookError;
use crate::storage::{event_storage_matches_expected, parse_expected_event_storage_bytes};
use nook_core::{EventId, VaultEvent};
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
const ICLOUD_LOG_BODY_PREVIEW_CHARS: usize = 2000;

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

fn web_auth_token_len(web_auth_token: &str) -> usize {
    web_auth_token.trim().len()
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let truncated = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else {
        truncated
    }
}

fn redact_query_param_values(input: &str, name: &str) -> String {
    let needle = format!("{name}=");
    let mut output = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(index) = rest.find(&needle) {
        let (prefix, after_prefix) = rest.split_at(index + needle.len());
        output.push_str(prefix);
        output.push_str("[redacted]");
        let value_end = after_prefix
            .find(['&', '"', '\'', ' ', '\n', '\r', '\t'])
            .unwrap_or(after_prefix.len());
        rest = &after_prefix[value_end..];
    }
    output.push_str(rest);
    output
}

fn sanitize_icloud_body(body: &str, web_auth_token: &str) -> String {
    let mut sanitized = body.replace(ICLOUD_API_TOKEN, "[redacted-ck-api-token]");
    let trimmed_token = web_auth_token.trim();
    if !trimmed_token.is_empty() {
        sanitized = sanitized.replace(trimmed_token, "[redacted-ck-web-auth-token]");
    }
    sanitized = redact_query_param_values(&sanitized, "ckAPIToken");
    sanitized = redact_query_param_values(&sanitized, "ckWebAuthToken");
    truncate_chars(&sanitized, ICLOUD_LOG_BODY_PREVIEW_CHARS)
}

fn log_icloud_request_start(operation: &str, path: &str, web_auth_token: &str) {
    tracing::info!(
        scope = "wasm-icloud",
        operation,
        path,
        container = ICLOUD_CONTAINER_ID,
        environment = ICLOUD_ENVIRONMENT,
        api_token_len = ICLOUD_API_TOKEN.len(),
        web_auth_token_len = web_auth_token_len(web_auth_token),
        "CloudKit request started"
    );
}

fn log_icloud_response(operation: &str, path: &str, status: reqwest::StatusCode) {
    tracing::info!(
        scope = "wasm-icloud",
        operation,
        path,
        status = %status,
        "CloudKit response received"
    );
}

fn log_icloud_error_body(
    operation: &str,
    path: &str,
    status: reqwest::StatusCode,
    body: &str,
    web_auth_token: &str,
) {
    tracing::warn!(
        scope = "wasm-icloud",
        operation,
        path,
        status = %status,
        body_len = body.len(),
        body_preview = %sanitize_icloud_body(body, web_auth_token),
        "CloudKit request failed"
    );
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
    const OPERATION: &str = "lookup";
    const PATH: &str = "records/lookup";
    log_icloud_request_start(OPERATION, PATH, web_auth_token);
    tracing::info!(
        scope = "wasm-icloud",
        operation = OPERATION,
        path = PATH,
        record_name,
        "CloudKit lookup prepared"
    );
    let client = reqwest::Client::new();
    let body = json!({
        "records": [{ "recordName": record_name }]
    });
    let mut request = client
        .post(icloud_database_url(PATH))
        .header("Content-Type", "application/json");
    for (name, value) in icloud_auth_query(web_auth_token) {
        request = request.query(&[(name, value)]);
    }
    let response = request.json(&body).send().await?;
    let status = response.status();
    log_icloud_response(OPERATION, PATH, status);
    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        log_icloud_error_body(OPERATION, PATH, status, &body, web_auth_token);
        return Err(icloud_error(status, &body));
    }
    let parsed: ICloudRecordsResponse = response
        .json()
        .await
        .map_err(|e| NookError::Serialization(format!("Failed to parse CloudKit lookup: {e}")))?;
    tracing::info!(
        scope = "wasm-icloud",
        operation = OPERATION,
        path = PATH,
        record_name,
        returned_records = parsed.records.len(),
        "CloudKit lookup parsed"
    );
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
    const OPERATION: &str = "query";
    const PATH: &str = "records/query";

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

        log_icloud_request_start(OPERATION, PATH, token.as_ref());
        tracing::info!(
            scope = "wasm-icloud",
            operation = OPERATION,
            path = PATH,
            record_type = ICLOUD_EVENT_RECORD_TYPE,
            results_limit = 200,
            continuation_present = continuation_marker.is_some(),
            "CloudKit event query prepared"
        );
        let mut request = client
            .post(icloud_database_url(PATH))
            .header("Content-Type", "application/json");
        for (name, value) in icloud_auth_query(token.as_ref()) {
            request = request.query(&[(name, value)]);
        }
        let response = request.json(&body).send().await?;
        let status = response.status();
        log_icloud_response(OPERATION, PATH, status);
        if !response.status().is_success() {
            let body = response.text().await.unwrap_or_default();
            log_icloud_error_body(OPERATION, PATH, status, &body, token.as_ref());
            return Err(icloud_error(status, &body));
        }
        let parsed: ICloudRecordsResponse = response.json().await.map_err(|e| {
            NookError::Serialization(format!("Failed to parse CloudKit event query: {e}"))
        })?;
        tracing::info!(
            scope = "wasm-icloud",
            operation = OPERATION,
            path = PATH,
            returned_records = parsed.records.len(),
            continuation_returned = parsed.continuation_marker.is_some(),
            "CloudKit event query parsed"
        );
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
    tracing::info!(
        scope = "wasm-icloud",
        event_count = event_ids.len(),
        "CloudKit event ids listed"
    );
    Ok(event_ids)
}

pub(crate) async fn fetch_icloud_event(
    web_auth_token: &str,
    event_id: &EventId,
) -> Result<Vec<u8>, NookError> {
    let token = nook_core::validate_oauth_access_token(web_auth_token)?;
    let record_name = icloud_event_record_name(event_id);
    tracing::info!(
        scope = "wasm-icloud",
        event_id = event_id.as_str(),
        record_name,
        "CloudKit event fetch started"
    );
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
    tracing::info!(
        scope = "wasm-icloud",
        event_id = event_id.as_str(),
        record_name,
        content_len = content.len(),
        "CloudKit event fetch completed"
    );
    Ok(content.into_bytes())
}

fn existing_icloud_event_matches(
    record: &ICloudRecord,
    bytes: &[u8],
    expected_event: &VaultEvent,
) -> (bool, usize) {
    let existing_content = record_content(record).unwrap_or_default();
    let existing_bytes = existing_content.as_bytes();
    (
        existing_bytes == bytes || event_storage_matches_expected(existing_bytes, expected_event),
        existing_bytes.len(),
    )
}

async fn confirm_icloud_create_conflict_matches(
    token: &str,
    event_id: &EventId,
    record_name: &str,
    bytes: &[u8],
    expected_event: &VaultEvent,
) -> Result<bool, NookError> {
    if let Some(existing) = lookup_record(token, record_name).await? {
        let (matches, existing_len) =
            existing_icloud_event_matches(&existing, bytes, expected_event);
        if matches {
            tracing::info!(
                scope = "wasm-icloud",
                event_id = event_id.as_str(),
                record_name,
                existing_len,
                "CloudKit create conflict matched existing content"
            );
            return Ok(true);
        }
    }
    tracing::warn!(
        scope = "wasm-icloud",
        event_id = event_id.as_str(),
        record_name,
        "CloudKit create conflict did not match existing content"
    );
    Ok(false)
}

async fn return_if_existing_icloud_event_matches(
    token: &str,
    event_id: &EventId,
    record_name: &str,
    bytes: &[u8],
    expected_event: &VaultEvent,
) -> Result<bool, NookError> {
    if let Some(existing) = lookup_record(token, record_name).await? {
        let (matches, existing_len) =
            existing_icloud_event_matches(&existing, bytes, expected_event);
        if matches {
            tracing::info!(
                scope = "wasm-icloud",
                event_id = event_id.as_str(),
                record_name,
                existing_len,
                "CloudKit event already exists with matching content"
            );
            return Ok(true);
        }
        tracing::warn!(
            scope = "wasm-icloud",
            event_id = event_id.as_str(),
            record_name,
            existing_len,
            expected_len = bytes.len(),
            "CloudKit event exists with different content"
        );
        return Err(NookError::ICloud(
            "Event record exists with different content (corruption).".to_owned(),
        ));
    }
    Ok(false)
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
    tracing::info!(
        scope = "wasm-icloud",
        event_id = event_id.as_str(),
        record_name,
        content_len = bytes.len(),
        "CloudKit event put-if-absent started"
    );

    if return_if_existing_icloud_event_matches(
        token.as_ref(),
        event_id,
        &record_name,
        bytes,
        &expected_event,
    )
    .await?
    {
        return Ok(());
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
    const OPERATION: &str = "modify";
    const PATH: &str = "records/modify";
    log_icloud_request_start(OPERATION, PATH, token.as_ref());
    tracing::info!(
        scope = "wasm-icloud",
        operation = OPERATION,
        path = PATH,
        event_id = event_id.as_str(),
        record_name,
        operation_type = "create",
        "CloudKit event create prepared"
    );
    let mut request = client
        .post(icloud_database_url(PATH))
        .header("Content-Type", "application/json");
    for (name, value) in icloud_auth_query(token.as_ref()) {
        request = request.query(&[(name, value)]);
    }
    let response = request.json(&body).send().await?;
    let status = response.status();
    log_icloud_response(OPERATION, PATH, status);
    if response.status().is_success() {
        let _parsed: serde_json::Value = response.json().await.map_err(|e| {
            NookError::Serialization(format!("Failed to parse CloudKit event create: {e}"))
        })?;
        tracing::info!(
            scope = "wasm-icloud",
            event_id = event_id.as_str(),
            record_name,
            "CloudKit event created"
        );
        return Ok(());
    }

    let body = response.text().await.unwrap_or_default();
    log_icloud_error_body(OPERATION, PATH, status, &body, token.as_ref());
    if body.contains("serverRecord") || body.contains("ALREADY_EXISTS") {
        tracing::info!(
            scope = "wasm-icloud",
            event_id = event_id.as_str(),
            record_name,
            "CloudKit create conflict detected; checking existing record"
        );
        if confirm_icloud_create_conflict_matches(
            token.as_ref(),
            event_id,
            &record_name,
            bytes,
            &expected_event,
        )
        .await?
        {
            return Ok(());
        }
        return Err(NookError::ICloud(
            "Event record exists with different content (corruption).".to_owned(),
        ));
    }

    Err(icloud_error(status, &body))
}
