//! iCloud `CloudKit` private/shared-database adapter for immutable event records.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use reqwest::Client;
use std::{collections, str};

use super::checked_event_write::CheckedEventWrite;
use crate::NookError;
use nook_core::{EventId, ICloudEventTarget, ICloudShareRole};
use serde::Deserialize;
use serde_json::json;

pub(crate) struct ICloudEventStore<'a> {
    pub(crate) web_auth_token: &'a str,
    pub(crate) target: &'a ICloudEventTarget,
}

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

impl ICloudEventStore<'_> {
    fn is_sha256_base64url_digest(digest: &str) -> bool {
        digest.len() == SHA256_BASE64URL_LEN
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    }
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
    fields: Option<collections::HashMap<String, ICloudFieldValue>>,
}

#[derive(Deserialize)]
struct ICloudRecordsResponse {
    #[serde(default)]
    records: Vec<ICloudRecord>,
    #[serde(rename = "continuationMarker", default)]
    continuation_marker: Option<String>,
}

impl ICloudEventStore<'_> {
    fn icloud_database_url(target: &ICloudEventTarget, path: &str) -> String {
        let database = match target {
            ICloudEventTarget::Private
            | ICloudEventTarget::Shared(nook_core::ICloudSharedTarget {
                role: ICloudShareRole::Owner,
                ..
            }) => "private",
            ICloudEventTarget::Shared(nook_core::ICloudSharedTarget {
                role: ICloudShareRole::Participant,
                ..
            }) => "shared",
        };
        format!(
            "https://api.apple-cloudkit.com/database/1/{ICLOUD_CONTAINER_ID}/{ICLOUD_ENVIRONMENT}/{database}/{path}"
        )
    }

    fn icloud_zone_id(target: &ICloudEventTarget) -> Option<serde_json::Value> {
        match target {
            ICloudEventTarget::Private => None,
            ICloudEventTarget::Shared(shared) => Some(json!({
                "zoneName": shared.zone_name,
                "ownerRecordName": shared.owner_record_name,
            })),
        }
    }

    fn with_icloud_zone(
        mut body: serde_json::Value,
        target: &ICloudEventTarget,
    ) -> serde_json::Value {
        if let Some(zone_id) = Self::icloud_zone_id(target) {
            body["zoneID"] = zone_id;
        }
        body
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

    fn log_icloud_request_start(operation: &str, path: &str, web_auth_token: &str) {
        tracing::info!(
            scope = "wasm-icloud",
            operation,
            path,
            container = ICLOUD_CONTAINER_ID,
            environment = ICLOUD_ENVIRONMENT,
            api_token_len = ICLOUD_API_TOKEN.len(),
            web_auth_token_len = Self::web_auth_token_len(web_auth_token),
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
        let body_preview = CloudKitErrorBody {
            body,
            web_auth_token,
        }
        .sanitize();
        tracing::warn!(
            scope = "wasm-icloud",
            operation,
            path,
            status = %status,
            body_len = body.len(),
            body_preview = %body_preview,
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
}

struct CloudKitErrorBody<'a> {
    body: &'a str,
    web_auth_token: &'a str,
}

impl CloudKitErrorBody<'_> {
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

    fn sanitize(self) -> String {
        let mut sanitized = self
            .body
            .replace(ICLOUD_API_TOKEN, "[redacted-ck-api-token]");
        let trimmed_token = self.web_auth_token.trim();
        if !trimmed_token.is_empty() {
            sanitized = sanitized.replace(trimmed_token, "[redacted-ck-web-auth-token]");
        }
        sanitized = Self::redact_query_param_values(&sanitized, "ckAPIToken");
        sanitized = Self::redact_query_param_values(&sanitized, "ckWebAuthToken");
        Self::truncate_chars(&sanitized, ICLOUD_LOG_BODY_PREVIEW_CHARS)
    }
}

impl ICloudRecord {
    fn content(&self) -> Option<String> {
        self.fields
            .as_ref()
            .and_then(|fields| fields.get(ICLOUD_CONTENT_FIELD))
            .and_then(|field| field.value.clone())
    }
}

impl ICloudRecord {
    fn field(&self, field_name: &str) -> Option<String> {
        self.fields
            .as_ref()
            .and_then(|fields| fields.get(field_name))
            .and_then(|field| field.value.clone())
    }
}

impl ICloudEventStore<'_> {
    fn icloud_event_record_name(event_id: &EventId) -> String {
        format!("nook-event-{}", event_id.encoded_digest())
    }
}

impl ICloudRecord {
    fn event_id(&self) -> Option<String> {
        self.field(ICLOUD_EVENT_ID_FIELD).or_else(|| {
            self.record_name
                .strip_prefix("nook-event-")
                .filter(|digest| ICloudEventStore::is_sha256_base64url_digest(digest))
                .map(|digest| format!("sha256u:{digest}"))
        })
    }
}

impl ICloudEventStore<'_> {
    async fn lookup_vault_record(
        web_auth_token: &str,
        target: &ICloudEventTarget,
        record_name: &str,
    ) -> Result<Option<ICloudRecord>, NookError> {
        const OPERATION: &str = "lookup";
        const PATH: &str = "records/lookup";
        Self::log_icloud_request_start(OPERATION, PATH, web_auth_token);
        tracing::info!(
            scope = "wasm-icloud",
            operation = OPERATION,
            path = PATH,
            record_name,
            "CloudKit lookup prepared"
        );
        let client = Client::new();
        let body = Self::with_icloud_zone(
            json!({
                "records": [{ "recordName": record_name }]
            }),
            target,
        );
        let mut request = client
            .post(Self::icloud_database_url(target, PATH))
            .header("Content-Type", "application/json");
        for (name, value) in Self::icloud_auth_query(web_auth_token) {
            request = request.query(&[(name, value)]);
        }
        let response = request.json(&body).send().await?;
        let status = response.status();
        Self::log_icloud_response(OPERATION, PATH, status);
        if !response.status().is_success() {
            let body = response.text().await.unwrap_or_default();
            Self::log_icloud_error_body(OPERATION, PATH, status, &body, web_auth_token);
            return Err(Self::icloud_error(status, &body));
        }
        let parsed: ICloudRecordsResponse = response.json().await.map_err(|e| {
            NookError::Serialization(format!("Failed to parse CloudKit lookup: {e}"))
        })?;
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
        target: &ICloudEventTarget,
        record_name: &str,
    ) -> Result<Option<ICloudRecord>, NookError> {
        Self::lookup_vault_record(web_auth_token, target, record_name).await
    }

    pub(crate) async fn list_icloud_event_ids(&self) -> Result<Vec<String>, NookError> {
        let web_auth_token = self.web_auth_token;
        let target = self.target;
        let token = nook_core::validate_oauth_access_token(web_auth_token)?;
        let client = Client::new();
        let mut event_ids = Vec::new();
        let mut continuation_marker: Option<String> = None;
        const OPERATION: &str = "query";
        const PATH: &str = "records/query";

        loop {
            let mut body = Self::with_icloud_zone(
                json!({
                    "query": {
                        "recordType": ICLOUD_EVENT_RECORD_TYPE,
                    },
                    "resultsLimit": 200,
                }),
                target,
            );
            if let Some(marker) = continuation_marker.as_deref() {
                body["continuationMarker"] = json!(marker);
            }

            Self::log_icloud_request_start(OPERATION, PATH, token.as_ref());
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
                .post(Self::icloud_database_url(target, PATH))
                .header("Content-Type", "application/json");
            for (name, value) in Self::icloud_auth_query(token.as_ref()) {
                request = request.query(&[(name, value)]);
            }
            let response = request.json(&body).send().await?;
            let status = response.status();
            Self::log_icloud_response(OPERATION, PATH, status);
            if !response.status().is_success() {
                let body = response.text().await.unwrap_or_default();
                Self::log_icloud_error_body(OPERATION, PATH, status, &body, token.as_ref());
                return Err(Self::icloud_error(status, &body));
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
                if let Some(event_id) = record.event_id()
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
        &self,
        event_id: &EventId,
    ) -> Result<Vec<u8>, NookError> {
        let web_auth_token = self.web_auth_token;
        let target = self.target;
        let token = nook_core::validate_oauth_access_token(web_auth_token)?;
        let record_name = Self::icloud_event_record_name(event_id);
        tracing::info!(
            scope = "wasm-icloud",
            event_id = event_id.as_str(),
            record_name,
            "CloudKit event fetch started"
        );
        let record = Self::lookup_record(token.as_ref(), target, &record_name)
            .await?
            .ok_or_else(|| {
                NookError::ICloud(format!("CloudKit event record {record_name} is missing."))
            })?;
        let stored_event_id = record.event_id().ok_or_else(|| {
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
        let content = record.content().ok_or_else(|| {
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
        checked: &CheckedEventWrite<'_>,
    ) -> (bool, usize) {
        let existing_content = record.content().unwrap_or_default();
        let existing_bytes = existing_content.as_bytes();
        (checked.matches(existing_bytes), existing_bytes.len())
    }
}

#[derive(Clone, Copy)]
enum ExistingEventPolicy {
    ConfirmCreateConflict,
    RejectMismatch,
}

impl ICloudEventStore<'_> {
    async fn resolve_existing_icloud_event(
        token: &str,
        target: &ICloudEventTarget,
        event_id: &EventId,
        record_name: &str,
        checked: &CheckedEventWrite<'_>,
        policy: ExistingEventPolicy,
    ) -> Result<bool, NookError> {
        if let Some(existing) = Self::lookup_record(token, target, record_name).await? {
            let (matches, existing_len) = Self::existing_icloud_event_matches(&existing, checked);
            if matches {
                match policy {
                    ExistingEventPolicy::ConfirmCreateConflict => tracing::info!(
                        scope = "wasm-icloud",
                        event_id = event_id.as_str(),
                        record_name,
                        existing_len,
                        "CloudKit create conflict matched existing content"
                    ),
                    ExistingEventPolicy::RejectMismatch => tracing::info!(
                        scope = "wasm-icloud",
                        event_id = event_id.as_str(),
                        record_name,
                        existing_len,
                        "CloudKit event already exists with matching content"
                    ),
                }
                return Ok(true);
            }
            match policy {
                ExistingEventPolicy::ConfirmCreateConflict => tracing::warn!(
                    scope = "wasm-icloud",
                    event_id = event_id.as_str(),
                    record_name,
                    "CloudKit create conflict did not match existing content"
                ),
                ExistingEventPolicy::RejectMismatch => {
                    tracing::warn!(
                        scope = "wasm-icloud",
                        event_id = event_id.as_str(),
                        record_name,
                        existing_len,
                        expected_len = checked.bytes().len(),
                        "CloudKit event exists with different content"
                    );
                    return Err(NookError::ICloud(
                        "Event record exists with different content (corruption).".to_owned(),
                    ));
                }
            }
        }
        Ok(false)
    }

    fn icloud_event_create_body(
        target: &ICloudEventTarget,
        event_id: &EventId,
        record_name: &str,
        content: &str,
    ) -> serde_json::Value {
        let mut record = json!({
            "recordType": ICLOUD_EVENT_RECORD_TYPE,
            "recordName": record_name,
            "fields": {
                ICLOUD_EVENT_ID_FIELD: { "value": event_id.as_str() },
                ICLOUD_CONTENT_FIELD: { "value": content }
            }
        });
        if let ICloudEventTarget::Shared(shared) = target {
            record["parent"] = json!({ "recordName": shared.root_record_name });
        }
        Self::with_icloud_zone(
            json!({
                "operations": [{
                    "operationType": "create",
                    "record": record
                }]
            }),
            target,
        )
    }

    pub(crate) async fn put_icloud_event_if_absent(
        &self,
        event_id: &EventId,
        bytes: &[u8],
    ) -> Result<(), NookError> {
        let web_auth_token = self.web_auth_token;
        let token = nook_core::validate_oauth_access_token(web_auth_token)?;
        let content = str::from_utf8(bytes)
            .map_err(|e| NookError::Serialization(format!("Event YAML must be UTF-8: {e}")))?;
        let checked = CheckedEventWrite::parse(bytes, event_id, "CloudKit")?;
        self.put_checked(checked, token.as_ref(), content).await
    }

    async fn put_checked(
        &self,
        checked: CheckedEventWrite<'_>,
        token: &str,
        content: &str,
    ) -> Result<(), NookError> {
        let target = self.target;
        let event_id = checked.event_id();
        let bytes = checked.bytes();
        let record_name = Self::icloud_event_record_name(event_id);
        tracing::info!(
            scope = "wasm-icloud",
            event_id = event_id.as_str(),
            record_name,
            content_len = bytes.len(),
            "CloudKit event put-if-absent started"
        );

        if Self::resolve_existing_icloud_event(
            token,
            target,
            event_id,
            &record_name,
            &checked,
            ExistingEventPolicy::RejectMismatch,
        )
        .await?
        {
            return Ok(());
        }

        let body = Self::icloud_event_create_body(target, event_id, &record_name, content);
        let client = Client::new();
        const OPERATION: &str = "modify";
        const PATH: &str = "records/modify";
        Self::log_icloud_request_start(OPERATION, PATH, token);
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
            .post(Self::icloud_database_url(target, PATH))
            .header("Content-Type", "application/json");
        for (name, value) in Self::icloud_auth_query(token) {
            request = request.query(&[(name, value)]);
        }
        let response = request.json(&body).send().await?;
        let status = response.status();
        Self::log_icloud_response(OPERATION, PATH, status);
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
        Self::log_icloud_error_body(OPERATION, PATH, status, &body, token);
        if body.contains("serverRecord") || body.contains("ALREADY_EXISTS") {
            tracing::info!(
                scope = "wasm-icloud",
                event_id = event_id.as_str(),
                record_name,
                "CloudKit create conflict detected; checking existing record"
            );
            if Self::resolve_existing_icloud_event(
                token,
                target,
                event_id,
                &record_name,
                &checked,
                ExistingEventPolicy::ConfirmCreateConflict,
            )
            .await?
            {
                return Ok(());
            }
            return Err(NookError::ICloud(
                "Event record exists with different content (corruption).".to_owned(),
            ));
        }

        Err(Self::icloud_error(status, &body))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_core::ICloudSharedTarget;

    #[derive(Deserialize)]
    struct CreateBody {
        #[serde(rename = "zoneID")]
        zone: Option<Zone>,
        operations: Vec<CreateOperation>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Zone {
        zone_name: String,
        owner_record_name: String,
    }

    #[derive(Deserialize)]
    struct CreateOperation {
        record: CreateRecord,
    }

    #[derive(Deserialize)]
    struct CreateRecord {
        parent: Option<ParentRecord>,
        fields: collections::HashMap<String, ICloudFieldValue>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ParentRecord {
        record_name: String,
    }

    struct SharedTargetFixture(ICloudEventTarget);

    impl SharedTargetFixture {
        fn new(role: ICloudShareRole) -> anyhow::Result<Self> {
            Ok(Self(ICloudEventTarget::Shared(ICloudSharedTarget::new(
                role,
                "shared-zone",
                "owner-record",
                "shared-root",
                "share-guid",
            )?)))
        }
    }

    #[test]
    fn shared_database_scope_depends_on_account_role() -> anyhow::Result<()> {
        assert!(
            ICloudEventStore::icloud_database_url(&ICloudEventTarget::Private, "records/query")
                .contains("/private/records/query")
        );
        assert!(
            ICloudEventStore::icloud_database_url(
                &SharedTargetFixture::new(ICloudShareRole::Owner)?.0,
                "records/query"
            )
            .contains("/private/records/query")
        );
        assert!(
            ICloudEventStore::icloud_database_url(
                &SharedTargetFixture::new(ICloudShareRole::Participant)?.0,
                "records/query"
            )
            .contains("/shared/records/query")
        );
        Ok(())
    }

    #[test]
    fn shared_event_create_is_scoped_to_the_shared_root_hierarchy() -> anyhow::Result<()> {
        let target = SharedTargetFixture::new(ICloudShareRole::Participant)?.0;
        let event_id = EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?;
        let body = ICloudEventStore::icloud_event_create_body(
            &target,
            &event_id,
            "nook-event-test",
            "encrypted-event",
        );

        let body: CreateBody = serde_json::from_value(body)?;
        let zone = body
            .zone
            .ok_or_else(|| anyhow::anyhow!("missing shared zone"))?;
        assert_eq!(zone.zone_name, "shared-zone");
        assert_eq!(zone.owner_record_name, "owner-record");
        let record = &body.operations[0].record;
        let parent = record
            .parent
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("missing parent"))?;
        assert_eq!(parent.record_name, "shared-root");
        assert_eq!(
            record.fields[ICLOUD_CONTENT_FIELD].value.as_deref(),
            Some("encrypted-event")
        );
        Ok(())
    }

    #[test]
    fn private_event_create_keeps_the_existing_default_zone_shape() -> anyhow::Result<()> {
        let event_id = EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?;
        let body = ICloudEventStore::icloud_event_create_body(
            &ICloudEventTarget::Private,
            &event_id,
            "nook-event-test",
            "encrypted-event",
        );

        let body: CreateBody = serde_json::from_value(body)?;
        assert!(body.zone.is_none());
        assert!(body.operations[0].record.parent.is_none());
        Ok(())
    }

    #[test]
    fn error_body_redaction_preserves_unicode_and_removes_credentials() {
        let body = format!("é ckAPIToken={ICLOUD_API_TOKEN}&ckWebAuthToken=secret-token next");
        let sanitized = CloudKitErrorBody {
            body: &body,
            web_auth_token: " secret-token ",
        }
        .sanitize();
        assert_eq!(
            sanitized,
            "é ckAPIToken=[redacted]&ckWebAuthToken=[redacted] next"
        );
        assert_eq!(CloudKitErrorBody::truncate_chars("é水😀x", 3), "é水😀...");
        assert_eq!(CloudKitErrorBody::truncate_chars("é水😀", 3), "é水😀");
    }
}
