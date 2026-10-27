//! Writing immutable event records to `CloudKit`: an existing record must
//! match the event byte for byte, and a create conflict is re-checked.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use reqwest::Client;
use std::str;

use super::wire::{
    FieldText, ICloudCreate, ICloudCreateOperation, ICloudCreateRecord, ICloudEventFields,
    ICloudRecord, ICloudRecordReference, ICloudRecordsResponse, ICloudRequest, ICloudTextField,
    RecordLookup,
};
use super::{CloudKitRecordQuery, ICLOUD_EVENT_RECORD_TYPE, ICloudEventStore};
use crate::NookError;
use crate::storage::checked_event_write::{CheckedEventWrite, CheckedEventWriteRequest};
use nook_core::{EventId, ICloudSharedTarget};

impl ICloudEventStore<'_> {
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
        target: &ICloudSharedTarget,
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
        target: &ICloudSharedTarget,
        namespace: &str,
        event_id: &EventId,
        record_name: &str,
        content: &str,
    ) -> ICloudRequest<ICloudCreate> {
        let parent = ICloudRecordReference {
            record_name: target.root_record_name.clone(),
        };
        Self::with_icloud_zone(
            ICloudCreate {
                operations: [ICloudCreateOperation {
                    operation_type: "create",
                    record: ICloudCreateRecord {
                        record_type: ICLOUD_EVENT_RECORD_TYPE,
                        record_name: record_name.to_owned(),
                        fields: ICloudEventFields {
                            location: ICloudTextField {
                                value: namespace.to_owned(),
                            },
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
        let checked = CheckedEventWrite::parse(CheckedEventWriteRequest {
            bytes,
            event_id,
            location: self.placed.location(),
            provider: "CloudKit",
        })?;
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
        let namespace = self.namespace();
        let record_name = Self::icloud_event_record_name(&namespace, event_id);
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

        let body =
            Self::icloud_event_create_body(target, &namespace, event_id, &record_name, content);
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
    use super::super::wire::{ICloudFieldValue, ICloudRecordReference, ICloudZone};
    use super::super::{ICLOUD_CONTENT_FIELD, ICLOUD_LOCATION_FIELD};
    use super::*;
    use nook_core::{ICloudShareRole, ICloudSharedTarget};
    use serde::Deserialize;
    use std::collections;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[derive(Deserialize)]
    struct CreateBody {
        #[serde(rename = "zoneID")]
        zone: ICloudZone,
        operations: Vec<CreateOperation>,
    }

    #[derive(Deserialize)]
    struct CreateOperation {
        record: CreateRecord,
    }

    #[derive(Deserialize)]
    struct CreateRecord {
        parent: ICloudRecordReference,
        fields: collections::HashMap<String, ICloudFieldValue>,
    }

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
    fn shared_event_create_is_scoped_to_the_shared_root_hierarchy() -> anyhow::Result<()> {
        let target = SharedTargetFixture::new(ICloudShareRole::Participant)?.0;
        let event_id = EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?;
        let body = ICloudEventStore::icloud_event_create_body(
            &target,
            "vault:store_abcdefghijk",
            &event_id,
            "nook-event-test",
            "encrypted-event",
        );

        let body: CreateBody = serde_json::from_str(&serde_json::to_string(&body)?)?;
        let zone = body.zone;
        assert_eq!(zone.zone_name, "shared-zone");
        assert_eq!(zone.owner_record_name, "owner-record");
        let record = &body
            .operations
            .first()
            .ok_or_else(|| anyhow::anyhow!("shared event operation must be present"))?
            .record;
        let parent = &record.parent;
        assert_eq!(parent.record_name, "shared-root");
        assert_eq!(
            record
                .fields
                .get(ICLOUD_CONTENT_FIELD)
                .ok_or_else(|| anyhow::anyhow!("content field must be present"))?
                .value,
            FieldText::Text("encrypted-event".to_owned())
        );
        // The record names the log it belongs to, so a vault can be listed and
        // deleted on its own.
        assert_eq!(
            record
                .fields
                .get(ICLOUD_LOCATION_FIELD)
                .ok_or_else(|| anyhow::anyhow!("location field must be present"))?
                .value,
            FieldText::Text("vault:store_abcdefghijk".to_owned())
        );
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod fetch_tests {
    use super::*;
    use crate::storage::checked_event_write::tests::EventFixture;
    use crate::storage::fetch_stub::{FetchRoute, FetchStub};
    use wasm_bindgen_test::wasm_bindgen_test;

    const LOOKUP: &str = "records/lookup";
    const MODIFY: &str = "records/modify";

    fn existing(fixture: &EventFixture, content: &str) -> anyhow::Result<String> {
        let record = serde_json::json!({
            "records": [{
                "recordName": "existing",
                "fields": {
                    "event_id": {"value": fixture.event_id.as_str()},
                    "content": {"value": content},
                },
            }],
        });
        Ok(record.to_string())
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn put_creates_absent_events_and_accepts_identical_ones() -> anyhow::Result<()> {
        let fixture = EventFixture::new()?;
        let location = nook_core::PlacedNamespace::vault(
            nook_core::IdentityId::parse("idn_abcdefghijk")?,
            nook_core::StoreId::parse("store_testtoken11")?,
        );
        let store = ICloudEventStore {
            web_auth_token: "web-token",
            target: &super::super::owner_share_fixture()?,
            placed: &location,
        };
        let stub = FetchStub::install(vec![
            FetchRoute::ok("POST", LOOKUP, r#"{"records":[]}"#),
            FetchRoute::ok("POST", MODIFY, r#"{"records":[]}"#),
        ])?;
        store
            .put_icloud_event_if_absent(&fixture.event_id, &fixture.bytes)
            .await?;
        assert_eq!(stub.calls().len(), 2);
        drop(stub);

        let content = str::from_utf8(&fixture.bytes)?;
        let stub = FetchStub::install(vec![FetchRoute::ok(
            "POST",
            LOOKUP,
            &existing(&fixture, content)?,
        )])?;
        store
            .put_icloud_event_if_absent(&fixture.event_id, &fixture.bytes)
            .await?;
        assert_eq!(stub.calls().len(), 1);
        drop(stub);

        let _stub = FetchStub::install(vec![FetchRoute::ok(
            "POST",
            LOOKUP,
            &existing(&fixture, "different")?,
        )])?;
        assert!(
            store
                .put_icloud_event_if_absent(&fixture.event_id, &fixture.bytes)
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
    async fn create_conflicts_recheck_the_stored_record() -> anyhow::Result<()> {
        let fixture = EventFixture::new()?;
        let location = nook_core::PlacedNamespace::vault(
            nook_core::IdentityId::parse("idn_abcdefghijk")?,
            nook_core::StoreId::parse("store_testtoken11")?,
        );
        let store = ICloudEventStore {
            web_auth_token: "web-token",
            target: &super::super::owner_share_fixture()?,
            placed: &location,
        };
        let content = str::from_utf8(&fixture.bytes)?;
        let conflict = FetchRoute {
            method: "POST",
            url_contains: MODIFY.to_owned(),
            status: 409,
            body: r#"{"serverErrorCode":"ALREADY_EXISTS"}"#.to_owned(),
        };
        let stub = FetchStub::install(vec![
            FetchRoute::ok("POST", LOOKUP, r#"{"records":[]}"#),
            conflict,
            FetchRoute::ok("POST", LOOKUP, &existing(&fixture, content)?),
        ])?;
        store
            .put_icloud_event_if_absent(&fixture.event_id, &fixture.bytes)
            .await?;
        assert_eq!(stub.calls().len(), 3);
        drop(stub);

        let conflict = FetchRoute {
            method: "POST",
            url_contains: MODIFY.to_owned(),
            status: 409,
            body: r#"{"serverErrorCode":"ALREADY_EXISTS"}"#.to_owned(),
        };
        let stub = FetchStub::install(vec![
            FetchRoute::ok("POST", LOOKUP, r#"{"records":[]}"#),
            conflict,
            FetchRoute::ok("POST", LOOKUP, &existing(&fixture, "different")?),
        ])?;
        assert!(
            store
                .put_icloud_event_if_absent(&fixture.event_id, &fixture.bytes)
                .await
                .is_err()
        );
        drop(stub);

        let _stub = FetchStub::install(vec![
            FetchRoute::ok("POST", LOOKUP, r#"{"records":[]}"#),
            FetchRoute::failing("POST", MODIFY, 500),
        ])?;
        assert!(
            store
                .put_icloud_event_if_absent(&fixture.event_id, &fixture.bytes)
                .await
                .is_err()
        );
        assert!(
            store
                .put_icloud_event_if_absent(&fixture.event_id, b"not an event")
                .await
                .is_err()
        );
        Ok(())
    }
}
