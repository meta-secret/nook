//! Typed WASM boundary for portable authentication workflow policy.

use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
pub fn decode_authentication_workflow_snapshot_response(
    response: nook_companion_core::AuthenticationWorkflowSnapshotResponseWire,
) -> Result<nook_companion_core::AuthenticationWorkflowSnapshotResponse, wasm_bindgen::JsError> {
    nook_companion_core::decode_authentication_workflow_snapshot_response(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub fn decode_authentication_workflow_runtime_response(
    response: nook_companion_core::AuthenticationWorkflowRuntimeResponseWire,
) -> Result<nook_companion_core::AuthenticationWorkflowRuntimeResponse, wasm_bindgen::JsError> {
    nook_companion_core::decode_authentication_workflow_runtime_response(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
pub fn decode_website_login_match_availability(
    response: nook_companion_core::WebsiteLoginOptionsWireValue,
) -> Result<nook_companion_core::WebsiteLoginMatchAvailability, wasm_bindgen::JsError> {
    nook_companion_core::decode_website_login_match_availability(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[must_use]
pub fn authentication_workflow_saved_login_capability(
    snapshot: nook_companion_core::AuthenticationWorkflowSnapshot,
) -> nook_companion_core::AuthenticationSavedLoginCapability {
    snapshot.saved_login_capability()
}

#[wasm_bindgen]
#[must_use]
pub fn authentication_workflow_requires_login_match_availability(
    snapshot: nook_companion_core::AuthenticationWorkflowSnapshot,
) -> bool {
    snapshot.requires_login_match_availability()
}

#[wasm_bindgen]
#[must_use]
pub fn authentication_workflow_pilot_presentation_capability(
    snapshot: nook_companion_core::AuthenticationWorkflowSnapshot,
) -> nook_companion_core::AuthenticationPilotPresentationCapability {
    snapshot.pilot_presentation_capability()
}

#[wasm_bindgen]
#[must_use]
pub fn classify_authentication_backup_codes_observation(
    text: &str,
) -> nook_companion_core::AuthenticationBackupCodesObservation {
    nook_companion_core::classify_authentication_backup_codes_observation(text)
}

#[wasm_bindgen]
#[must_use]
pub fn authentication_enrollment_pilot_presentation_capability(
    authenticator_setup_hint: bool,
    backup_codes_copy: &str,
    manual_checkpoint_present: bool,
) -> nook_companion_core::AuthenticationPilotPresentationCapability {
    nook_companion_core::authentication_enrollment_pilot_presentation_capability(
        authenticator_setup_hint,
        backup_codes_copy,
        manual_checkpoint_present,
    )
}

#[wasm_bindgen]
#[must_use]
pub fn authentication_enrollment_workflow_match(
    authenticator_setup_hint: bool,
    backup_codes_copy: &str,
    manual_checkpoint_present: bool,
) -> nook_companion_core::AuthenticationWorkflowMatch {
    nook_companion_core::authentication_enrollment_workflow_match(
        authenticator_setup_hint,
        backup_codes_copy,
        manual_checkpoint_present,
    )
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn classify_companion_authentication_workflow(
    input: nook_companion_core::AuthenticationPageObservations,
) -> nook_companion_core::AuthenticationWorkflowMatch {
    nook_companion_core::classify_authentication_workflow_candidates(&input.observations)
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn classify_companion_authentication_workflow_facts(
    input: nook_companion_core::AuthenticationPageObservationFactsBatch,
) -> nook_companion_core::AuthenticationWorkflowMatch {
    input.classify()
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompanionAuthenticationWorkflowMatchKind {
    NoMatch,
    Rejected,
    Matched,
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn companion_authentication_workflow_match_kind(
    workflow_match: nook_companion_core::AuthenticationWorkflowMatch,
) -> CompanionAuthenticationWorkflowMatchKind {
    match workflow_match {
        nook_companion_core::AuthenticationWorkflowMatch::NoMatch => {
            CompanionAuthenticationWorkflowMatchKind::NoMatch
        }
        nook_companion_core::AuthenticationWorkflowMatch::Rejected => {
            CompanionAuthenticationWorkflowMatchKind::Rejected
        }
        nook_companion_core::AuthenticationWorkflowMatch::Matched(_) => {
            CompanionAuthenticationWorkflowMatchKind::Matched
        }
    }
}
