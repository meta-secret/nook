//! iCloud `CloudKit` shared-zone adapter for immutable event records.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use reqwest::Client;
#[cfg(test)]
use std::collections;
use std::str;

use crate::NookError;
use nook_core::{EventId, ICloudShareRole, ICloudSharedTarget, PlacedNamespace};
use serde::Serialize;

pub(crate) struct ICloudEventStore<'a> {
    pub(crate) web_auth_token: &'a str,
    pub(crate) target: &'a ICloudSharedTarget,
    /// The identity log or vault these records belong to.
    pub(crate) placed: &'a PlacedNamespace,
}

mod diagnostics;
mod event_write;
mod namespace;
mod wire;
use wire::{
    EventIdentity, FieldText, ICloudFilter, ICloudLookup, ICloudQuery, ICloudQueryPage,
    ICloudRecordReference, ICloudRecordsResponse, ICloudRequest, ICloudTextField, ICloudZone,
    QueryCompletion, QueryContinuation, RecordLookup,
};
#[cfg(test)]
use wire::{ICloudFieldValue, ICloudRecord, RecordFields};

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
const ICLOUD_EVENT_RECORD_TYPE: &str = "NookLogEvent";
const ICLOUD_CONTENT_FIELD: &str = "content";
const ICLOUD_EVENT_ID_FIELD: &str = "event_id";
/// Queryable field naming the log a record belongs to: `vault:<store>` or
/// `identity:<id>` (the location's namespace tag).
const ICLOUD_LOCATION_FIELD: &str = "location";
const ICLOUD_LOG_BODY_PREVIEW_CHARS: usize = 2000;

/// An owner share every adapter test routes through.
#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
fn owner_share_fixture() -> Result<ICloudSharedTarget, nook_core::ValidationError> {
    ICloudSharedTarget::new(ICloudShareRole::Owner, "zone", "owner", "root", "guid")
}

struct CloudKitRecordQuery<'a> {
    web_auth_token: &'a str,
    target: &'a ICloudSharedTarget,
    record_name: &'a str,
}
impl ICloudEventStore<'_> {
    /// The share owner reaches its zone through its private database; every
    /// participant reaches it through its shared database.
    fn icloud_database_url(target: &ICloudSharedTarget, path: &str) -> String {
        let database = match target.role {
            ICloudShareRole::Owner => "private",
            ICloudShareRole::Participant => "shared",
        };
        format!(
            "https://api.apple-cloudkit.com/database/1/{ICLOUD_CONTAINER_ID}/{ICLOUD_ENVIRONMENT}/{database}/{path}"
        )
    }

    fn icloud_zone_id(target: &ICloudSharedTarget) -> ICloudZone {
        ICloudZone {
            zone_name: target.zone_name.clone(),
            owner_record_name: target.owner_record_name.clone(),
        }
    }

    fn with_icloud_zone<T: Serialize>(payload: T, target: &ICloudSharedTarget) -> ICloudRequest<T> {
        ICloudRequest {
            payload,
            zone: Self::icloud_zone_id(target),
        }
    }
}

impl ICloudEventStore<'_> {
    /// The namespace tag every record of this store carries.
    fn namespace(&self) -> String {
        self.placed.cloudkit_tag()
    }

    /// One record per event and log: the same event id never collides
    /// across namespaces.
    fn icloud_event_record_name(namespace: &str, event_id: &EventId) -> String {
        format!(
            "nook.{}.{}",
            namespace.replace(':', "."),
            event_id.encoded_digest()
        )
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
        let namespace = self.namespace();
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
                        filter_by: vec![ICloudFilter {
                            comparator: "EQUALS",
                            field_name: ICLOUD_LOCATION_FIELD,
                            field_value: ICloudTextField {
                                value: namespace.clone(),
                            },
                        }],
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
                if let EventIdentity::Declared(event_id) = record.event_id()
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
        let record_name = Self::icloud_event_record_name(&self.namespace(), event_id);
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
            EventIdentity::Declared(id) => id,
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_core::ICloudSharedTarget;
    use wasm_bindgen_test::wasm_bindgen_test;

    struct SharedTargetFixture(ICloudSharedTarget);

    impl SharedTargetFixture {
        fn new(role: ICloudShareRole) -> anyhow::Result<Self> {
            Ok(Self(ICloudSharedTarget::new(
                role,
                "shared-zone",
                "owner-record",
                "shared-root",
                "share-guid",
            )?))
        }
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
    )]
    fn shared_database_scope_depends_on_account_role() -> anyhow::Result<()> {
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
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
    )]
    fn icloud_helpers_cover_digest_scope_query_and_record_projection() -> anyhow::Result<()> {
        let digest = "ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0";

        let shared = SharedTargetFixture::new(ICloudShareRole::Participant)?.0;
        let zone = ICloudEventStore::icloud_zone_id(&shared);
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
        assert_eq!(zoned.zone, zone);

        let query = ICloudEventStore::icloud_auth_query("  web-token  ");
        assert_eq!(query[0].0, "ckAPIToken");
        assert_eq!(query[1].1, "web-token");
        assert_eq!(ICloudEventStore::web_auth_token_len("  web-token  "), 9);

        let event_id = EventId::parse(&format!("sha256u:{digest}"))?;
        // The same event in two logs gets two records.
        let record_name =
            ICloudEventStore::icloud_event_record_name("vault:store_abcdefghijk", &event_id);
        assert_eq!(
            record_name,
            format!("nook.vault.store_abcdefghijk.{digest}")
        );
        assert_ne!(
            record_name,
            ICloudEventStore::icloud_event_record_name("identity:idn_abcdefghijk", &event_id)
        );
        let record = ICloudRecord {
            record_name: record_name.clone(),
            fields: RecordFields::Declared(collections::HashMap::from([
                (
                    ICLOUD_CONTENT_FIELD.to_owned(),
                    ICloudFieldValue {
                        value: FieldText::Text("encrypted".to_owned()),
                    },
                ),
                (
                    ICLOUD_EVENT_ID_FIELD.to_owned(),
                    ICloudFieldValue {
                        value: FieldText::Text(event_id.to_string()),
                    },
                ),
                (
                    ICLOUD_LOCATION_FIELD.to_owned(),
                    ICloudFieldValue {
                        value: FieldText::Text("vault:store_abcdefghijk".to_owned()),
                    },
                ),
            ])),
        };
        assert_eq!(record.content(), FieldText::Text("encrypted".to_owned()));
        assert_eq!(
            record.location(),
            FieldText::Text("vault:store_abcdefghijk".to_owned())
        );
        assert_eq!(
            record.event_id(),
            EventIdentity::Declared(event_id.to_string())
        );

        // An event id is only ever read from its field, never from the name.
        let undisclosed = ICloudRecord {
            record_name,
            fields: RecordFields::Undisclosed,
        };
        assert_eq!(undisclosed.event_id(), EventIdentity::Missing);
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn empty_icloud_token_is_rejected_before_network_access() -> anyhow::Result<()> {
        let target = super::owner_share_fixture()?;
        let location = nook_core::PlacedNamespace::vault(
            nook_core::IdentityId::parse("idn_abcdefghijk")?,
            nook_core::StoreId::parse("store_abcdefghijk")?,
        );
        let store = ICloudEventStore {
            web_auth_token: "  ",
            target: &target,
            placed: &location,
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

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod fetch_tests {
    use super::*;
    use crate::storage::fetch_stub::{FetchRoute, FetchStub};
    use wasm_bindgen_test::wasm_bindgen_test;

    const QUERY: &str = "records/query";
    const LOOKUP: &str = "records/lookup";

    fn event_record(event_id: &str, content: &str) -> String {
        format!(
            r#"{{"recordName":"r-{event_id}","fields":{{"event_id":{{"value":"{event_id}"}},"content":{{"value":"{content}"}}}}}}"#
        )
    }

    fn event_id(fill: char) -> anyhow::Result<EventId> {
        Ok(EventId::parse(&format!(
            "sha256u:{}",
            fill.to_string().repeat(43)
        ))?)
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn event_ids_page_and_skip_undeclared_records() -> anyhow::Result<()> {
        let location = nook_core::PlacedNamespace::vault(
            nook_core::IdentityId::parse("idn_abcdefghijk")?,
            nook_core::StoreId::parse("store_abcdefghijk")?,
        );
        let (a, b) = (event_id('A')?, event_id('E')?);
        let first = format!(
            r#"{{"records":[{},{},{{"recordName":"bare"}}],"continuationMarker":"more"}}"#,
            event_record(b.as_str(), "b"),
            event_record("not-an-event", "x"),
        );
        let second = format!(
            r#"{{"records":[{},{}]}}"#,
            event_record(a.as_str(), "a"),
            event_record(b.as_str(), "b")
        );
        let stub = FetchStub::install(vec![
            FetchRoute::ok("POST", QUERY, &first),
            FetchRoute::ok("POST", QUERY, &second),
        ])?;
        let store = ICloudEventStore {
            web_auth_token: "web-token",
            target: &super::owner_share_fixture()?,
            placed: &location,
        };
        assert_eq!(
            store.list_icloud_event_ids().await?,
            [a.to_string(), b.to_string()]
        );
        assert_eq!(stub.calls().len(), 2);
        drop(stub);

        let _stub = FetchStub::install(vec![FetchRoute::failing("POST", QUERY, 503)])?;
        assert!(store.list_icloud_event_ids().await.is_err());
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
    async fn fetch_returns_content_only_for_the_named_event() -> anyhow::Result<()> {
        let location = nook_core::PlacedNamespace::vault(
            nook_core::IdentityId::parse("idn_abcdefghijk")?,
            nook_core::StoreId::parse("store_abcdefghijk")?,
        );
        let store = ICloudEventStore {
            web_auth_token: "web-token",
            target: &super::owner_share_fixture()?,
            placed: &location,
        };
        let wanted = event_id('A')?;
        let other = event_id('E')?;
        let found = format!(
            r#"{{"records":[{}]}}"#,
            event_record(wanted.as_str(), "body")
        );
        let stub = FetchStub::install(vec![FetchRoute::ok("POST", LOOKUP, &found)])?;
        assert_eq!(store.fetch_icloud_event(&wanted).await?, b"body");
        drop(stub);

        for response in [
            r#"{"records":[]}"#.to_owned(),
            format!(
                r#"{{"records":[{}]}}"#,
                event_record(other.as_str(), "body")
            ),
            r#"{"records":[{"recordName":"r","fields":{}}]}"#.to_owned(),
            format!(
                r#"{{"records":[{{"recordName":"r","fields":{{"event_id":{{"value":"{}"}}}}}}]}}"#,
                wanted.as_str()
            ),
        ] {
            let _stub = FetchStub::install(vec![FetchRoute::ok("POST", LOOKUP, &response)])?;
            assert!(store.fetch_icloud_event(&wanted).await.is_err());
        }
        let _stub = FetchStub::install(vec![FetchRoute::failing("POST", LOOKUP, 500)])?;
        assert!(store.fetch_icloud_event(&wanted).await.is_err());
        Ok(())
    }
}
