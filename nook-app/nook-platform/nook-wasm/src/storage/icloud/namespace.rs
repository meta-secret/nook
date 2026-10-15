//! Whole-namespace `CloudKit` operations: which identities a target holds,
//! and deleting every record of one log (a vault deleted everywhere).

use reqwest::Client;

use super::wire::{
    FieldText, ICloudDelete, ICloudDeleteOperation, ICloudFilter, ICloudQuery, ICloudQueryPage,
    ICloudRecord, ICloudRecordReference, ICloudRecordsResponse, ICloudTextField, QueryCompletion,
    QueryContinuation,
};
use super::{ICLOUD_EVENT_RECORD_TYPE, ICLOUD_LOCATION_FIELD, ICloudEventStore};
use crate::NookError;
use nook_core::ICloudEventTarget;

const IDENTITY_TAG_PREFIX: &str = "identity:";
/// `CloudKit` accepts at most 200 operations per modify request.
const DELETE_BATCH: usize = 200;

/// Named values required by `ICloudEventStore::query_records`.
struct RecordQuery<'a> {
    web_auth_token: &'a str,
    target: &'a ICloudEventTarget,
    comparator: &'static str,
    location: &'a str,
}

impl ICloudEventStore<'_> {
    /// Every `NookLogEvent` record whose location matches, across pages.
    async fn query_records(request: RecordQuery<'_>) -> Result<Vec<ICloudRecord>, NookError> {
        let RecordQuery {
            web_auth_token,
            target,
            comparator,
            location,
        } = request;
        const OPERATION: &str = "query";
        const PATH: &str = "records/query";
        let client = Client::new();
        let mut records = Vec::new();
        let mut continuation_marker = QueryContinuation::FirstPage;
        loop {
            let body = Self::with_icloud_zone(
                ICloudQueryPage {
                    query: ICloudQuery {
                        record_type: ICLOUD_EVENT_RECORD_TYPE,
                        filter_by: vec![ICloudFilter {
                            comparator,
                            field_name: ICLOUD_LOCATION_FIELD,
                            field_value: ICloudTextField {
                                value: location.to_owned(),
                            },
                        }],
                    },
                    results_limit: 200,
                    continuation_marker: continuation_marker.clone(),
                },
                target,
            );
            Self::log_icloud_request_start(OPERATION, PATH, web_auth_token);
            let mut request = client
                .post(Self::icloud_database_url(target, PATH))
                .header("Content-Type", "application/json");
            for (name, value) in Self::icloud_auth_query(web_auth_token) {
                request = request.query(&[(name, value)]);
            }
            let response = request.json(&body).send().await?;
            let status = response.status();
            Self::log_icloud_response(OPERATION, PATH, status);
            if !status.is_success() {
                let body = response.text().await.unwrap_or_default();
                Self::log_icloud_error_body(OPERATION, PATH, status, &body, web_auth_token);
                return Err(Self::icloud_error(status, &body));
            }
            let parsed: ICloudRecordsResponse = response.json().await.map_err(|e| {
                NookError::Serialization(format!("Failed to parse CloudKit query: {e}"))
            })?;
            records.extend(parsed.records);
            continuation_marker = match parsed.continuation_marker {
                QueryCompletion::Complete => break,
                QueryCompletion::Continue(marker) => QueryContinuation::Continue(marker),
            };
        }
        Ok(records)
    }

    /// Identity ids with a log on this target.
    pub(crate) async fn list_icloud_identity_ids(
        web_auth_token: &str,
        target: &ICloudEventTarget,
    ) -> Result<Vec<String>, NookError> {
        let token = nook_core::OauthAccessToken::parse(web_auth_token)?;
        let records = Self::query_records(RecordQuery {
            web_auth_token: token.as_ref(),
            target,
            comparator: "BEGINS_WITH",
            location: IDENTITY_TAG_PREFIX,
        })
        .await?;
        let mut ids = records
            .iter()
            .filter_map(|record| match record.location() {
                FieldText::Text(location) => location
                    .strip_prefix(IDENTITY_TAG_PREFIX)
                    .map(str::to_owned),
                FieldText::Unset => None,
            })
            .collect::<Vec<_>>();
        ids.sort();
        ids.dedup();
        Ok(ids)
    }

    /// Delete every record of this store's log. Returns how many went.
    pub(crate) async fn delete_icloud_namespace(&self) -> Result<usize, NookError> {
        let token = nook_core::OauthAccessToken::parse(self.web_auth_token)?;
        let namespace = self.namespace()?;
        let records = Self::query_records(RecordQuery {
            web_auth_token: token.as_ref(),
            target: self.target,
            comparator: "EQUALS",
            location: &namespace,
        })
        .await?;
        const OPERATION: &str = "modify";
        const PATH: &str = "records/modify";
        let client = Client::new();
        for batch in records.chunks(DELETE_BATCH) {
            let body = Self::with_icloud_zone(
                ICloudDelete {
                    operations: batch
                        .iter()
                        .map(|record| ICloudDeleteOperation {
                            operation_type: "forceDelete",
                            record: ICloudRecordReference {
                                record_name: record.record_name.clone(),
                            },
                        })
                        .collect(),
                },
                self.target,
            );
            Self::log_icloud_request_start(OPERATION, PATH, token.as_ref());
            let mut request = client
                .post(Self::icloud_database_url(self.target, PATH))
                .header("Content-Type", "application/json");
            for (name, value) in Self::icloud_auth_query(token.as_ref()) {
                request = request.query(&[(name, value)]);
            }
            let response = request.json(&body).send().await?;
            let status = response.status();
            Self::log_icloud_response(OPERATION, PATH, status);
            let body = response.text().await.unwrap_or_default();
            // A batch answers 200 even when single records fail; any failed
            // record fails the deletion.
            if !status.is_success() || body.contains("serverErrorCode") {
                Self::log_icloud_error_body(OPERATION, PATH, status, &body, token.as_ref());
                return Err(Self::icloud_error(status, &body));
            }
        }
        tracing::info!(
            scope = "wasm-icloud",
            namespace,
            deleted = records.len(),
            "CloudKit namespace deleted"
        );
        Ok(records.len())
    }
}
