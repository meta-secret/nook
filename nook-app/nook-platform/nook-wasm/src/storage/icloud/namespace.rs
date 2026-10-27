//! Whole-namespace `CloudKit` operations: which identities and vaults a target holds,
//! and deleting every record of one log (a vault deleted everywhere).

use reqwest::Client;

use super::wire::{
    FieldText, ICloudDelete, ICloudDeleteOperation, ICloudFilter, ICloudQuery, ICloudQueryPage,
    ICloudRecord, ICloudRecordReference, ICloudRecordsResponse, ICloudTextField, QueryCompletion,
    QueryContinuation,
};
use super::{ICLOUD_EVENT_RECORD_TYPE, ICLOUD_LOCATION_FIELD, ICloudEventStore};
use crate::NookError;
use nook_core::{EventLogNamespaceKind, ICloudSharedTarget, PlacedNamespace, StoreId};

/// Named values required by `ICloudEventStore::namespaces_tagged`.
struct TaggedNamespaces<'a> {
    web_auth_token: &'a str,
    target: &'a ICloudSharedTarget,
    prefix: &'a str,
}

/// `CloudKit` accepts at most 200 operations per modify request.
const DELETE_BATCH: usize = 200;

/// Named values required by `ICloudEventStore::query_records`.
struct RecordQuery<'a> {
    web_auth_token: &'a str,
    target: &'a ICloudSharedTarget,
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

    /// Ids of every namespace of one kind with a log on this target.
    pub(crate) async fn list_icloud_namespaces(
        web_auth_token: &str,
        target: &ICloudSharedTarget,
        kind: EventLogNamespaceKind,
    ) -> Result<Vec<PlacedNamespace>, NookError> {
        Self::namespaces_tagged(TaggedNamespaces {
            web_auth_token,
            target,
            prefix: PlacedNamespace::cloudkit_kind_prefix(kind),
        })
        .await
    }

    /// Where this target files one vault: every namespace whose tag names its
    /// store id, whichever identity filed it.
    pub(crate) async fn find_icloud_vault(
        web_auth_token: &str,
        target: &ICloudSharedTarget,
        store_id: &StoreId,
    ) -> Result<Vec<PlacedNamespace>, NookError> {
        Self::namespaces_tagged(TaggedNamespaces {
            web_auth_token,
            target,
            prefix: &PlacedNamespace::cloudkit_vault_prefix(store_id),
        })
        .await
    }

    async fn namespaces_tagged(
        request: TaggedNamespaces<'_>,
    ) -> Result<Vec<PlacedNamespace>, NookError> {
        let TaggedNamespaces {
            web_auth_token,
            target,
            prefix,
        } = request;
        let token = nook_core::OauthAccessToken::parse(web_auth_token)?;
        let records = Self::query_records(RecordQuery {
            web_auth_token: token.as_ref(),
            target,
            comparator: "BEGINS_WITH",
            location: prefix,
        })
        .await?;
        let mut placed = records
            .iter()
            .filter_map(|record| match record.location() {
                FieldText::Text(tag) => PlacedNamespace::from_cloudkit_tag(&tag),
                FieldText::Unset => None,
            })
            .collect::<Vec<_>>();
        placed.sort();
        placed.dedup();
        Ok(placed)
    }

    /// Delete every record of this store's log. Returns how many went.
    pub(crate) async fn delete_icloud_namespace(&self) -> Result<usize, NookError> {
        let token = nook_core::OauthAccessToken::parse(self.web_auth_token)?;
        let namespace = self.namespace();
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

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod fetch_tests {
    use super::*;
    use crate::storage::fetch_stub::{FetchRoute, FetchStub};
    use nook_core::{IdentityId, PlacedNamespace, StoreId};
    use wasm_bindgen_test::wasm_bindgen_test;

    const QUERY: &str = "records/query";
    const MODIFY: &str = "records/modify";

    fn record(name: &str, location: &str) -> String {
        format!(r#"{{"recordName":"{name}","fields":{{"location":{{"value":"{location}"}}}}}}"#)
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn namespaces_page_through_matching_records() -> anyhow::Result<()> {
        let first = format!(
            r#"{{"records":[{},{},{},{{"recordName":"bare"}}],"continuationMarker":"next"}}"#,
            record("r1", "vault:store_bbbbbbbbbbb:idn_bbbbbbbbbbb"),
            record("r2", "vault:store_aaaaaaaaaaa:idn_aaaaaaaaaaa"),
            record("r4", "vault:store_ccccccccccc"),
        );
        let second = format!(
            r#"{{"records":[{}]}}"#,
            record("r3", "vault:store_aaaaaaaaaaa:idn_aaaaaaaaaaa")
        );
        let stub = FetchStub::install(vec![
            FetchRoute::ok("POST", QUERY, &first),
            FetchRoute::ok("POST", QUERY, &second),
        ])?;
        let placed = ICloudEventStore::list_icloud_namespaces(
            "web-token",
            &super::super::owner_share_fixture()?,
            EventLogNamespaceKind::Vault,
        )
        .await?;
        // Each vault is read back with the identity that filed it; a tag
        // without one names no namespace.
        assert_eq!(
            placed,
            [
                PlacedNamespace::vault(
                    IdentityId::parse("idn_aaaaaaaaaaa")?,
                    StoreId::parse("store_aaaaaaaaaaa")?
                ),
                PlacedNamespace::vault(
                    IdentityId::parse("idn_bbbbbbbbbbb")?,
                    StoreId::parse("store_bbbbbbbbbbb")?
                ),
            ]
        );
        assert_eq!(stub.calls().len(), 2);
        drop(stub);

        let _stub = FetchStub::install(vec![FetchRoute::failing("POST", QUERY, 421)])?;
        assert!(
            ICloudEventStore::list_icloud_namespaces(
                "web-token",
                &super::super::owner_share_fixture()?,
                EventLogNamespaceKind::Identity,
            )
            .await
            .is_err()
        );
        assert!(
            ICloudEventStore::list_icloud_namespaces(
                "",
                &super::super::owner_share_fixture()?,
                EventLogNamespaceKind::Identity,
            )
            .await
            .is_err()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn namespace_deletion_removes_every_record_or_fails() -> anyhow::Result<()> {
        let location = nook_core::PlacedNamespace::vault(
            nook_core::IdentityId::parse("idn_abcdefghijk")?,
            nook_core::StoreId::parse("store_abcdefghijk")?,
        );
        let tag = location.cloudkit_tag();
        let store = ICloudEventStore {
            web_auth_token: "web-token",
            target: &super::super::owner_share_fixture()?,
            placed: &location,
        };
        let records = format!(
            r#"{{"records":[{},{}]}}"#,
            record("r1", &tag),
            record("r2", &tag)
        );
        let stub = FetchStub::install(vec![
            FetchRoute::ok("POST", QUERY, &records),
            FetchRoute::ok("POST", MODIFY, r#"{"records":[]}"#),
        ])?;
        assert_eq!(store.delete_icloud_namespace().await?, 2);
        assert!(stub.calls()[1].contains(MODIFY));
        drop(stub);

        let stub = FetchStub::install(vec![
            FetchRoute::ok("POST", QUERY, &records),
            FetchRoute::ok(
                "POST",
                MODIFY,
                r#"{"records":[{"recordName":"r1","serverErrorCode":"ACCESS_DENIED"}]}"#,
            ),
        ])?;
        assert!(store.delete_icloud_namespace().await.is_err());
        drop(stub);

        let stub = FetchStub::install(vec![FetchRoute::ok("POST", QUERY, r#"{"records":[]}"#)])?;
        assert_eq!(store.delete_icloud_namespace().await?, 0);
        assert_eq!(stub.calls().len(), 1);
        Ok(())
    }
}
