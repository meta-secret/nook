//! App-WASM adapters for the closed authentication workflow runtime response.

use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
pub fn decode_authentication_workflow_snapshot_response(
    response: nook_core::AuthenticationWorkflowSnapshotResponseWire,
) -> Result<nook_core::AuthenticationWorkflowSnapshotResponse, wasm_bindgen::JsError> {
    nook_core::decode_authentication_workflow_snapshot_response(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub fn decode_authentication_workflow_runtime_response(
    response: nook_core::AuthenticationWorkflowRuntimeResponseWire,
) -> Result<nook_core::AuthenticationWorkflowRuntimeResponse, wasm_bindgen::JsError> {
    nook_core::decode_authentication_workflow_runtime_response(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[must_use]
pub fn authentication_workflow_saved_login_capability(
    snapshot: nook_core::AuthenticationWorkflowSnapshot,
) -> nook_core::AuthenticationSavedLoginCapability {
    snapshot.saved_login_capability()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runtime_response(availability: &str) -> nook_core::AuthenticationWorkflowRuntimeResponse {
        let json = format!(r#"{{"workflow":{{"ok":true}},"loginMatches":{availability}}}"#);
        let wire =
            serde_json::from_str::<nook_core::AuthenticationWorkflowRuntimeResponseWire>(&json)
                .expect("runtime wire should deserialize");
        decode_authentication_workflow_runtime_response(wire)
            .expect("runtime response should decode")
    }

    #[test]
    fn preserves_closed_login_match_availability_variants() {
        assert!(matches!(
            runtime_response(r#"{"kind":"ready","count":2}"#).login_matches,
            nook_core::WebsiteLoginMatchAvailability::Ready { count: 2 }
        ));
        assert!(matches!(
            runtime_response(r#"{"kind":"locked"}"#).login_matches,
            nook_core::WebsiteLoginMatchAvailability::Locked
        ));
        assert!(matches!(
            runtime_response(r#"{"kind":"unavailable"}"#).login_matches,
            nook_core::WebsiteLoginMatchAvailability::Unavailable
        ));
    }

    #[test]
    fn rejects_count_on_non_ready_and_missing_ready_count() -> anyhow::Result<()> {
        for login_matches in [
            r#"{"kind":"locked","count":1}"#,
            r#"{"kind":"unavailable","count":1}"#,
            r#"{"kind":"ready"}"#,
        ] {
            let json = format!(r#"{{"workflow":{{"ok":true}},"loginMatches":{login_matches}}}"#);
            let wire = serde_json::from_str::<nook_core::AuthenticationWorkflowRuntimeResponseWire>(
                &json,
            )?;
            assert!(nook_core::decode_authentication_workflow_runtime_response(wire).is_err());
        }
        Ok(())
    }
}
