use nook_companion_core::AuthenticationBackupCodesEvidence;
use nook_companion_core::AuthenticationBackupCodesObservation;
use nook_companion_core::AuthenticationEnrollmentObservation;
use nook_companion_core::AuthenticationWorkflowMatch;
use nook_companion_core::BackupCodeCandidatePresence;
use nook_companion_core::{
    AuthenticationWorkflowRuntimeResponse, AuthenticationWorkflowSnapshotResponse,
    WebsiteLoginOptions,
};
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_authentication_workflow_snapshot_response(
    response: nook_companion_core::AuthenticationWorkflowSnapshotResponseWire,
) -> Result<nook_companion_core::AuthenticationWorkflowSnapshotResponse, wasm_bindgen::JsError> {
    AuthenticationWorkflowSnapshotResponse::decode_authentication_workflow_snapshot_response(
        response,
    )
    .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_authentication_workflow_runtime_response(
    response: nook_companion_core::AuthenticationWorkflowRuntimeResponseWire,
) -> Result<nook_companion_core::AuthenticationWorkflowRuntimeResponse, wasm_bindgen::JsError> {
    AuthenticationWorkflowRuntimeResponse::decode_authentication_workflow_runtime_response(response)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_website_login_match_availability(
    response: nook_companion_core::WebsiteLoginOptionsWireValue,
) -> Result<nook_companion_core::WebsiteLoginMatchAvailability, JsError> {
    WebsiteLoginOptions::from_wire(response)
        .and_then(WebsiteLoginOptions::into_match_availability)
        .map_err(|error| JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn authentication_workflow_saved_login_capability(
    snapshot: nook_companion_core::AuthenticationWorkflowSnapshot,
) -> nook_companion_core::AuthenticationSavedLoginCapability {
    snapshot.saved_login_capability()
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn authentication_workflow_requires_login_match_availability(
    snapshot: nook_companion_core::AuthenticationWorkflowSnapshot,
) -> bool {
    snapshot.requires_login_match_availability()
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn authentication_workflow_pilot_presentation_capability(
    snapshot: nook_companion_core::AuthenticationWorkflowSnapshot,
) -> nook_companion_core::AuthenticationPilotPresentationCapability {
    snapshot.pilot_presentation_capability()
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn classify_authentication_backup_codes_observation(
    text: &str,
    candidate_present: bool,
) -> nook_companion_core::AuthenticationBackupCodesObservation {
    AuthenticationBackupCodesObservation::classify_authentication_backup_codes_observation(
        AuthenticationBackupCodesEvidence {
            text,
            // Translate the existing browser ABI into semantic core evidence.
            candidate_presence: if candidate_present {
                BackupCodeCandidatePresence::Present
            } else {
                BackupCodeCandidatePresence::Absent
            },
        },
    )
}

#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn authentication_enrollment_workflow_match(
    authenticator_setup_hint: bool,
    backup_codes_copy: &str,
    manual_checkpoint_present: bool,
) -> nook_companion_core::AuthenticationWorkflowMatch {
    AuthenticationWorkflowMatch::authentication_enrollment_workflow_match(
        AuthenticationEnrollmentObservation {
            authenticator_setup_hint: authenticator_setup_hint.into(),
            backup_codes_copy,
            manual_checkpoint_present: manual_checkpoint_present.into(),
        },
    )
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn classify_companion_authentication_workflow(
    input: nook_companion_core::AuthenticationPageObservations,
) -> nook_companion_core::AuthenticationWorkflowMatch {
    AuthenticationWorkflowMatch::classify_authentication_workflow_candidates(&input.observations)
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn classify_companion_authentication_workflow_facts(
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
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn companion_authentication_workflow_match_kind(
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

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use nook_companion_core::{AuthenticationEnrollmentObservation, AuthenticationWorkflowMatch};
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn match_kind_preserves_every_closed_workflow_variant() {
        for (workflow_match, expected) in [
            (
                nook_companion_core::AuthenticationWorkflowMatch::NoMatch,
                super::CompanionAuthenticationWorkflowMatchKind::NoMatch,
            ),
            (
                nook_companion_core::AuthenticationWorkflowMatch::Rejected,
                super::CompanionAuthenticationWorkflowMatchKind::Rejected,
            ),
            (
                AuthenticationWorkflowMatch::authentication_enrollment_workflow_match(
                    AuthenticationEnrollmentObservation {
                        authenticator_setup_hint: true.into(),
                        backup_codes_copy: "Save these recovery codes",
                        manual_checkpoint_present: false.into(),
                    },
                ),
                super::CompanionAuthenticationWorkflowMatchKind::Matched,
            ),
        ] {
            assert_eq!(
                super::companion_authentication_workflow_match_kind(workflow_match),
                expected
            );
        }
    }
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn project_password_workflow_activity(
    evidence: nook_companion_core::PasswordWorkflowActivityEvidence,
) -> nook_companion_core::PasswordWorkflowActivityPresentation {
    evidence.project()
}
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn authentication_workflow_activity_progress(
    activity: nook_companion_core::AuthenticationWorkflowActivity,
) -> nook_companion_core::AuthenticationDisplayProgress {
    activity.progress()
}
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn saved_login_action_available(
    request: nook_companion_core::SavedLoginActionPresentationRequest,
) -> bool {
    request.is_available()
}
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn authentication_control_transportable(
    request: nook_companion_core::AuthenticationControlTransportability,
) -> bool {
    request.is_transportable()
}
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn is_authentication_navigation_path(pathname: &str) -> bool {
    nook_companion_core::AuthenticationNavigationPath::from(pathname).has_authentication_segment()
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn revalidate_approved_authentication_workflow(
    request: nook_companion_core::ApprovedAuthenticationWorkflowRevalidation,
) -> nook_companion_core::ApprovedAuthenticationWorkflowDecision {
    request.revalidate()
}
