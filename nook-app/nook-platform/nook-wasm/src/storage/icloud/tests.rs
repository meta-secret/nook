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
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )
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
    let ZoneSelection::Named(zone) = body.zone else {
        anyhow::bail!("missing shared zone")
    };
    assert_eq!(zone.zone_name, "shared-zone");
    assert_eq!(zone.owner_record_name, "owner-record");
    let record = &body
        .operations
        .first()
        .ok_or_else(|| anyhow::anyhow!("shared event operation must be present"))?
        .record;
    let RecordHierarchy::Child(parent) = &record.parent else {
        anyhow::bail!("missing parent")
    };
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

#[wasm_bindgen_test]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )
)]
fn private_event_create_keeps_the_existing_default_zone_shape() -> anyhow::Result<()> {
    let event_id = EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?;
    let body = ICloudEventStore::icloud_event_create_body(
        &ICloudEventTarget::Private,
        "identity:idn_abcdefghijk",
        &event_id,
        "nook-event-test",
        "encrypted-event",
    );

    let body: CreateBody = serde_json::from_str(&serde_json::to_string(&body)?)?;
    assert!(matches!(body.zone, ZoneSelection::DefaultZone));
    let operation = body
        .operations
        .first()
        .ok_or_else(|| anyhow::anyhow!("private event operation must be present"))?;
    assert!(matches!(operation.record.parent, RecordHierarchy::Root));
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
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )
)]
fn icloud_helpers_cover_digest_scope_query_and_record_projection() -> anyhow::Result<()> {
    let digest = "ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0";

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

#[wasm_bindgen_test]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )
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
