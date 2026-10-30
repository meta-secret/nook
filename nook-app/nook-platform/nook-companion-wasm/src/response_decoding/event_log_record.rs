//! Admission for one vault event-log record crossing the extension's
//! message boundaries.

use serde::Deserialize;
use tsify::Tsify;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct ExtensionEventLogRecordAdmission(nook_companion_core::ExtensionEventLogRecord);

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_extension_event_log_record(
    record: &tsify::Ts<ExtensionEventLogRecordAdmission>,
) -> Result<tsify::Ts<nook_companion_core::ExtensionEventLogRecord>, wasm_bindgen::JsError> {
    let record = record
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let ExtensionEventLogRecordAdmission(record) = record;
    // JSON-compatible: the event flattens its body, which the default
    // serializer would hand over as a `Map`, and Chrome messaging carries a
    // `Map` as `{}`. The record must reach the offscreen session intact.
    let value =
        serde::Serialize::serialize(&record, &serde_wasm_bindgen::Serializer::json_compatible())
            .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    Ok(tsify::Ts::new_unchecked(value))
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_companion_core::ExtensionEventLogRecord;

    #[test]
    fn event_log_record_admission_decodes_the_complete_vault_event() -> Result<(), serde_json::Error>
    {
        assert!(ExtensionEventLogRecordAdmission::DECL.ends_with(" = unknown;"));
        assert!(ExtensionEventLogRecord::DECL.contains("eventId"));
        let valid = serde_json::json!({
            "eventId": "event-1",
            "event": {
                "schema_version": 2,
                "store_id": "store_testtoken11",
                "actor_id": format!("key_{}", "0".repeat(64)),
                "actor_signing_public_key": "0".repeat(64),
                "parents": [],
                "created_at": "2026-08-10T00:00:00Z",
                "key_epoch": "sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo",
                "operations": [{"type":"vault-cleared"}],
                "signature": format!("ed25519:{}", "0".repeat(128))
            }
        });
        let admission: ExtensionEventLogRecordAdmission = serde_json::from_value(valid)?;
        let decoded = admission.0;
        assert_eq!(decoded.event_id, "event-1");
        assert!(
            serde_json::from_str::<ExtensionEventLogRecordAdmission>(
                r#"{"eventId":"event-1","event":{"schema_version":2}}"#
            )
            .is_err()
        );
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use super::*;
    use serde::Serialize;
    use serde_wasm_bindgen::Serializer;
    use wasm_bindgen::JsValue;
    use wasm_bindgen_test::wasm_bindgen_test;

    fn js_error(error: impl std::fmt::Display) -> JsError {
        JsError::new(&error.to_string())
    }

    /// The record as a page hands it over: a plain JavaScript value.
    fn wire_record(
        serialized: &str,
    ) -> Result<tsify::Ts<ExtensionEventLogRecordAdmission>, JsError> {
        let value: serde_json::Value = serde_json::from_str(serialized).map_err(js_error)?;
        let value = value
            .serialize(&Serializer::json_compatible())
            .map_err(js_error)?;
        Ok(tsify::Ts::new_unchecked(value))
    }

    #[wasm_bindgen::prelude::wasm_bindgen]
    extern "C" {
        /// How Chrome messaging carries a value: JSON.
        #[wasm_bindgen(js_namespace = JSON, js_name = stringify)]
        fn json_stringify(value: &JsValue) -> String;
    }

    #[wasm_bindgen_test]
    fn decoded_event_log_records_reach_the_session_whole() -> Result<(), JsError> {
        let wire = format!(
            r#"{{"eventId":"event-1","event":{{"schema_version":2,"store_id":"store_testtoken11","actor_id":"key_{actor}","actor_signing_public_key":"{signing}","parents":[],"created_at":"2026-08-10T00:00:00Z","key_epoch":"sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo","operations":[{{"type":"vault-cleared"}}],"signature":"ed25519:{signature}"}}}}"#,
            actor = "0".repeat(64),
            signing = "0".repeat(64),
            signature = "0".repeat(128),
        );
        let expected: nook_companion_core::ExtensionEventLogRecord =
            serde_json::from_str(&wire).map_err(js_error)?;
        let record = wire_record(&wire)?;

        let decoded = decode_extension_event_log_record(&record)?;

        // The event flattens its body: carried as JSON it must decode back to
        // the same record, not lose its body to the `{}` a `Map` becomes.
        let carried: nook_companion_core::ExtensionEventLogRecord =
            serde_json::from_str(&json_stringify(&decoded.js_value())).map_err(js_error)?;
        assert_eq!(carried, expected);
        Ok(())
    }
}
