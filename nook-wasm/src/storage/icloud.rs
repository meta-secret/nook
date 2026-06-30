//! iCloud `CloudKit` private-database adapter.
//!
//! Each vault file is stored as a `CloudKit` record in the user's private
//! database under a user-chosen record name (default `nook-vault.yaml`).
//! Optimistic concurrency uses `CloudKit` `recordChangeTag`, mirroring Drive's
//! `md5Checksum` / GitHub blob `sha`.

use crate::NookError;
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
const ICLOUD_CONTENT_FIELD: &str = "content";

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
    let mut current_revision = revision;

    for attempt in 0..3 {
        match write_icloud_vault_once(
            token.as_ref(),
            &resolved_name,
            content,
            current_revision.clone(),
        )
        .await
        {
            Ok(new_revision) => return Ok((resolved_name, new_revision)),
            Err(NookError::ICloud(msg))
                if msg.contains("CHANGE_TOKEN") || msg.contains("serverRecord") =>
            {
                if attempt == 2 {
                    return Err(NookError::ICloud(msg));
                }
                let record = lookup_vault_record(token.as_ref(), &resolved_name)
                    .await?
                    .ok_or_else(|| {
                        NookError::ICloud(format!(
                            "CloudKit record {resolved_name} missing during retry."
                        ))
                    })?;
                current_revision = record.record_change_tag;
            }
            Err(err) => return Err(err),
        }
    }

    Err(NookError::ICloud(
        "Failed to write vault record to iCloud after retries.".to_owned(),
    ))
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
