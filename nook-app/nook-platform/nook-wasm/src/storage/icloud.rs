//! iCloud `CloudKit` private/shared-database adapter for immutable event records.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use reqwest::Client;
#[cfg(test)]
use std::collections;
use std::str;

use super::checked_event_write::CheckedEventWrite;
use crate::NookError;
use nook_core::{EventId, ICloudEventTarget, ICloudShareRole};
#[cfg(test)]
use serde::Deserialize;
use serde::Serialize;

pub(crate) struct ICloudEventStore<'a> {
    pub(crate) web_auth_token: &'a str,
    pub(crate) target: &'a ICloudEventTarget,
}

mod wire;
use wire::{
    EventIdentity, FieldText, ICloudCreate, ICloudCreateOperation, ICloudCreateRecord,
    ICloudEventFields, ICloudLookup, ICloudQuery, ICloudQueryPage, ICloudRecord,
    ICloudRecordReference, ICloudRecordsResponse, ICloudRequest, ICloudTextField, ICloudZone,
    QueryCompletion, QueryContinuation, RecordHierarchy, RecordLookup, ZoneSelection,
};
#[cfg(test)]
use wire::{ICloudFieldValue, RecordFields};

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

struct CloudKitRecordQuery<'a> {
    web_auth_token: &'a str,
    target: &'a ICloudEventTarget,
    record_name: &'a str,
}
impl ICloudEventStore<'_> {
    fn is_sha256_base64url_digest(digest: &str) -> bool {
        digest.len() == SHA256_BASE64URL_LEN
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    }
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

    fn icloud_zone_id(target: &ICloudEventTarget) -> ZoneSelection {
        match target {
            ICloudEventTarget::Private => ZoneSelection::DefaultZone,
            ICloudEventTarget::Shared(shared) => ZoneSelection::Named(ICloudZone {
                zone_name: shared.zone_name.clone(),
                owner_record_name: shared.owner_record_name.clone(),
            }),
        }
    }

    fn with_icloud_zone<T: Serialize>(payload: T, target: &ICloudEventTarget) -> ICloudRequest<T> {
        ICloudRequest {
            payload,
            zone: Self::icloud_zone_id(target),
        }
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
            let Some(remaining) = after_prefix.get(value_end..) else {
                break;
            };
            rest = remaining;
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

impl ICloudEventStore<'_> {
    fn icloud_event_record_name(event_id: &EventId) -> String {
        format!("nook-event-{}", event_id.encoded_digest())
    }
}

impl ICloudEventStore<'_> {
    async fn lookup_vault_record(
        request: CloudKitRecordQuery<'_>,
    ) -> Result<RecordLookup, NookError> {
        let CloudKitRecordQuery {
            web_auth_token,
            target,
            record_name,
        } = request;
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
            ICloudLookup {
                records: [ICloudRecordReference {
                    record_name: record_name.to_owned(),
                }],
            },
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
        Ok(match parsed.records.into_iter().next() {
            Some(record) => RecordLookup::Loaded(record),
            None => RecordLookup::Missing,
        })
    }

    async fn lookup_record(request: CloudKitRecordQuery<'_>) -> Result<RecordLookup, NookError> {
        let CloudKitRecordQuery {
            web_auth_token,
            target,
            record_name,
        } = request;
        Self::lookup_vault_record(CloudKitRecordQuery {
            web_auth_token,
            target,
            record_name,
        })
        .await
    }

    pub(crate) async fn list_icloud_event_ids(&self) -> Result<Vec<String>, NookError> {
        let web_auth_token = self.web_auth_token;
        let target = self.target;
        let token = nook_core::OauthAccessToken::parse(web_auth_token)?;
        let client = Client::new();
        let mut event_ids = Vec::new();
        let mut continuation_marker = QueryContinuation::FirstPage;
        const OPERATION: &str = "query";
        const PATH: &str = "records/query";

        loop {
            let body = Self::with_icloud_zone(
                ICloudQueryPage {
                    query: ICloudQuery {
                        record_type: ICLOUD_EVENT_RECORD_TYPE,
                    },
                    results_limit: 200,
                    continuation_marker: continuation_marker.clone(),
                },
                target,
            );

            Self::log_icloud_request_start(OPERATION, PATH, token.as_ref());
            tracing::info!(
                scope = "wasm-icloud",
                operation = OPERATION,
                path = PATH,
                record_type = ICLOUD_EVENT_RECORD_TYPE,
                results_limit = 200,
                continuation_present = !continuation_marker.is_first(),
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
                continuation_returned =
                    matches!(parsed.continuation_marker, QueryCompletion::Continue(_)),
                "CloudKit event query parsed"
            );
            for record in &parsed.records {
                if let EventIdentity::Declared(event_id) | EventIdentity::NameDerived(event_id) =
                    record.event_id()
                    && EventId::parse(&event_id).is_ok()
                {
                    event_ids.push(event_id);
                }
            }
            continuation_marker = match parsed.continuation_marker {
                QueryCompletion::Complete => break,
                QueryCompletion::Continue(marker) => QueryContinuation::Continue(marker),
            };
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
        let token = nook_core::OauthAccessToken::parse(web_auth_token)?;
        let record_name = Self::icloud_event_record_name(event_id);
        tracing::info!(
            scope = "wasm-icloud",
            event_id = event_id.as_str(),
            record_name,
            "CloudKit event fetch started"
        );
        let record = match Self::lookup_record(CloudKitRecordQuery {
            web_auth_token: token.as_ref(),
            target,
            record_name: &record_name,
        })
        .await?
        {
            RecordLookup::Loaded(record) => record,
            RecordLookup::Missing => {
                return Err(NookError::ICloud(format!(
                    "CloudKit event record {record_name} is missing."
                )));
            }
        };
        let stored_event_id = match record.event_id() {
            EventIdentity::Declared(id) | EventIdentity::NameDerived(id) => id,
            EventIdentity::Missing => {
                return Err(NookError::ICloud(format!(
                    "CloudKit event record {record_name} does not include an event id."
                )));
            }
        };
        if stored_event_id != event_id.as_str() {
            return Err(NookError::ICloud(format!(
                "CloudKit event record {record_name} points at {stored_event_id}, expected {}.",
                event_id.as_str()
            )));
        }
        let content = match record.content() {
            FieldText::Text(content) => content,
            FieldText::Unset => {
                return Err(NookError::ICloud(format!(
                    "CloudKit event record {record_name} does not include content."
                )));
            }
        };
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
        let existing_content = match record.content() {
            FieldText::Text(content) => content,
            FieldText::Unset => String::new(),
        };
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
        if let RecordLookup::Loaded(existing) = Self::lookup_record(CloudKitRecordQuery {
            web_auth_token: token,
            target,
            record_name,
        })
        .await?
        {
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
    ) -> ICloudRequest<ICloudCreate> {
        let parent = match target {
            ICloudEventTarget::Private => RecordHierarchy::Root,
            ICloudEventTarget::Shared(shared) => RecordHierarchy::Child(ICloudRecordReference {
                record_name: shared.root_record_name.clone(),
            }),
        };
        Self::with_icloud_zone(
            ICloudCreate {
                operations: [ICloudCreateOperation {
                    operation_type: "create",
                    record: ICloudCreateRecord {
                        record_type: ICLOUD_EVENT_RECORD_TYPE,
                        record_name: record_name.to_owned(),
                        fields: ICloudEventFields {
                            event_id: ICloudTextField {
                                value: event_id.to_string(),
                            },
                            content: ICloudTextField {
                                value: content.to_owned(),
                            },
                        },
                        parent,
                    },
                }],
            },
            target,
        )
    }

    pub(crate) async fn put_icloud_event_if_absent(
        &self,
        event_id: &EventId,
        bytes: &[u8],
    ) -> Result<(), NookError> {
        let web_auth_token = self.web_auth_token;
        let token = nook_core::OauthAccessToken::parse(web_auth_token)?;
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
            let _parsed: ICloudRecordsResponse = response.json().await.map_err(|e| {
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
    use wasm_bindgen_test::wasm_bindgen_test;

    #[derive(Deserialize)]
    struct CreateBody {
        #[serde(rename = "zoneID")]
        #[serde(default)]
        zone: ZoneSelection,
        operations: Vec<CreateOperation>,
    }

    #[derive(Deserialize)]
    struct CreateOperation {
        record: CreateRecord,
    }

    #[derive(Deserialize)]
    struct CreateRecord {
        #[serde(default)]
        parent: RecordHierarchy,
        fields: collections::HashMap<String, ICloudFieldValue>,
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

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
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

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn shared_event_create_is_scoped_to_the_shared_root_hierarchy() -> anyhow::Result<()> {
        let target = SharedTargetFixture::new(ICloudShareRole::Participant)?.0;
        let event_id = EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?;
        let body = ICloudEventStore::icloud_event_create_body(
            &target,
            &event_id,
            "nook-event-test",
            "encrypted-event",
        );

        let body: CreateBody = serde_json::from_str(&serde_json::to_string(&body)?)?;
        let ZoneSelection::Named(zone) = body.zone else {
            anyhow::bail!("missing shared zone")
        };
        assert_eq!(zone.zone_name, "shared-zone");
        assert_eq!(zone.owner_record_name, "owner-record");
        let record = &body.operations[0].record;
        let RecordHierarchy::Child(parent) = &record.parent else {
            anyhow::bail!("missing parent")
        };
        assert_eq!(parent.record_name, "shared-root");
        assert_eq!(
            record.fields[ICLOUD_CONTENT_FIELD].value,
            FieldText::Text("encrypted-event".to_owned())
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn private_event_create_keeps_the_existing_default_zone_shape() -> anyhow::Result<()> {
        let event_id = EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?;
        let body = ICloudEventStore::icloud_event_create_body(
            &ICloudEventTarget::Private,
            &event_id,
            "nook-event-test",
            "encrypted-event",
        );

        let body: CreateBody = serde_json::from_str(&serde_json::to_string(&body)?)?;
        assert!(matches!(body.zone, ZoneSelection::DefaultZone));
        assert!(matches!(
            body.operations[0].record.parent,
            RecordHierarchy::Root
        ));
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
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

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn icloud_helpers_cover_digest_scope_query_and_record_projection() -> anyhow::Result<()> {
        let digest = "ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0";
        assert!(ICloudEventStore::is_sha256_base64url_digest(digest));
        assert!(!ICloudEventStore::is_sha256_base64url_digest("short"));
        assert!(!ICloudEventStore::is_sha256_base64url_digest(&format!(
            "{}!",
            &digest[..42]
        )));

        let private = ICloudEventTarget::Private;
        assert_eq!(
            ICloudEventStore::icloud_zone_id(&private),
            ZoneSelection::DefaultZone
        );
        let shared = SharedTargetFixture::new(ICloudShareRole::Participant)?.0;
        let ZoneSelection::Named(zone) = ICloudEventStore::icloud_zone_id(&shared) else {
            anyhow::bail!("missing shared zone")
        };
        assert_eq!(zone.zone_name, "shared-zone");
        assert_eq!(zone.owner_record_name, "owner-record");
        let zoned = ICloudEventStore::with_icloud_zone(
            ICloudLookup {
                records: [ICloudRecordReference {
                    record_name: "record".to_owned(),
                }],
            },
            &shared,
        );
        assert_eq!(zoned.zone, ZoneSelection::Named(zone));
        let private_request = ICloudEventStore::with_icloud_zone(
            ICloudLookup {
                records: [ICloudRecordReference {
                    record_name: "record".to_owned(),
                }],
            },
            &private,
        );
        assert!(matches!(private_request.zone, ZoneSelection::DefaultZone));

        let query = ICloudEventStore::icloud_auth_query("  web-token  ");
        assert_eq!(query[0].0, "ckAPIToken");
        assert_eq!(query[1].1, "web-token");
        assert_eq!(ICloudEventStore::web_auth_token_len("  web-token  "), 9);

        let event_id = EventId::parse(&format!("sha256u:{digest}"))?;
        let record_name = ICloudEventStore::icloud_event_record_name(&event_id);
        assert_eq!(record_name, format!("nook-event-{digest}"));
        let record = ICloudRecord {
            record_name: record_name.clone(),
            fields: RecordFields::Declared(collections::HashMap::from([(
                ICLOUD_CONTENT_FIELD.to_owned(),
                ICloudFieldValue {
                    value: FieldText::Text("encrypted".to_owned()),
                },
            )])),
        };
        assert_eq!(record.content(), FieldText::Text("encrypted".to_owned()));
        assert_eq!(
            record.field(ICLOUD_CONTENT_FIELD),
            FieldText::Text("encrypted".to_owned())
        );
        assert_eq!(
            record.event_id(),
            EventIdentity::NameDerived(event_id.to_string())
        );

        let fallback = ICloudRecord {
            record_name,
            fields: RecordFields::Undisclosed,
        };
        assert_eq!(
            fallback.event_id(),
            EventIdentity::NameDerived(event_id.to_string())
        );
        let invalid = ICloudRecord {
            record_name: "nook-event-not-an-event".to_owned(),
            fields: RecordFields::Undisclosed,
        };
        assert_eq!(invalid.event_id(), EventIdentity::Missing);
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn icloud_error_and_redaction_helpers_cover_empty_and_repeated_values() {
        let empty = ICloudEventStore::icloud_error(reqwest::StatusCode::NOT_FOUND, "");
        assert!(
            matches!(empty, NookError::ICloud(message) if message == "CloudKit API responded with status 404 Not Found")
        );
        let with_body = ICloudEventStore::icloud_error(reqwest::StatusCode::BAD_REQUEST, "bad");
        assert!(matches!(with_body, NookError::ICloud(message) if message.ends_with(" — bad")));
        assert_eq!(
            CloudKitErrorBody::redact_query_param_values(
                "ckWebAuthToken=one&x=1 ckWebAuthToken=two",
                "ckWebAuthToken",
            ),
            "ckWebAuthToken=[redacted]&x=1 ckWebAuthToken=[redacted]"
        );
        assert_eq!(
            CloudKitErrorBody {
                body: "plain body",
                web_auth_token: "   ",
            }
            .sanitize(),
            "plain body"
        );
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn empty_icloud_token_is_rejected_before_network_access() -> anyhow::Result<()> {
        let target = ICloudEventTarget::Private;
        let store = ICloudEventStore {
            web_auth_token: "  ",
            target: &target,
        };
        let event_id = EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?;
        assert!(store.list_icloud_event_ids().await.is_err());
        assert!(store.fetch_icloud_event(&event_id).await.is_err());
        assert!(
            store
                .put_icloud_event_if_absent(&event_id, b"event: test")
                .await
                .is_err()
        );
        Ok(())
    }
}
