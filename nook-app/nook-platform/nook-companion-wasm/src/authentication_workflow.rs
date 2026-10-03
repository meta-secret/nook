use nook_companion_core::AuthenticationBackupCodesEvidence;
use nook_companion_core::AuthenticationBackupCodesObservation;
use nook_companion_core::AuthenticationEnrollmentObservation;
use nook_companion_core::AuthenticationNavigationPath;
use nook_companion_core::AuthenticationWorkflowMatch;
use nook_companion_core::BackupCodeCandidatePresence;
use nook_companion_core::WebsiteLoginMatchAvailability;
use nook_companion_core::{
    AuthenticationWorkflowRoutingResponse, AuthenticationWorkflowSnapshotResponse,
    WebsiteLoginOptions,
};
use serde::Deserialize;
use tsify::Tsify;
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct AuthenticationWorkflowRoutingAdmission(
    nook_companion_core::AuthenticationWorkflowRoutingResponseWire,
);

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_authentication_workflow_snapshot_response(
    response: &tsify::Ts<nook_companion_core::AuthenticationWorkflowSnapshotResponseWire>,
) -> Result<
    tsify::Ts<nook_companion_core::AuthenticationWorkflowSnapshotResponse>,
    wasm_bindgen::JsError,
> {
    let response = response
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    let result =
        AuthenticationWorkflowSnapshotResponse::decode_authentication_workflow_snapshot_response(
            response,
        )
        .map_err(|error| JsError::new(&error.to_string()))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_authentication_workflow_runtime_response(
    response: &tsify::Ts<AuthenticationWorkflowRoutingAdmission>,
) -> Result<
    tsify::Ts<nook_companion_core::AuthenticationWorkflowRoutingResponse>,
    wasm_bindgen::JsError,
> {
    let response = response
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    let AuthenticationWorkflowRoutingAdmission(response) = response;
    let result =
        AuthenticationWorkflowRoutingResponse::decode_authentication_workflow_routing_response(
            response,
        )
        .map_err(|error| JsError::new(&error.to_string()))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[cfg(test)]
mod routing_admission_tests {
    use super::*;

    #[test]
    fn routing_admission_declares_unknown_and_rejects_non_contract_values() {
        assert!(AuthenticationWorkflowRoutingAdmission::DECL.ends_with(" = unknown;"));
        assert!(serde_json::from_str::<AuthenticationWorkflowRoutingAdmission>("null").is_err());
    }
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_website_login_match_availability(
    response: &tsify::Ts<crate::WebsiteLoginOptionsAdmission>,
) -> Result<tsify::Ts<nook_companion_core::WebsiteLoginMatchAvailability>, wasm_bindgen::JsError> {
    let response = response
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

    let crate::WebsiteLoginOptionsAdmission(response) = response;
    let result = WebsiteLoginOptions::from_wire(response)
        .and_then(WebsiteLoginOptions::into_match_availability)
        .map_err(|error| JsError::new(&error.to_string()))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn unavailable_website_login_match_availability(
) -> Result<tsify::Ts<nook_companion_core::WebsiteLoginMatchAvailability>, wasm_bindgen::JsError> {

let result = {
    WebsiteLoginMatchAvailability::unavailable()
};
Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn authentication_workflow_saved_login_capability(
    snapshot: &tsify::Ts<nook_companion_core::AuthenticationWorkflowSnapshot>,
) -> Result<tsify::Ts<nook_companion_core::AuthenticationSavedLoginCapability>, wasm_bindgen::JsError>
{
    let snapshot = snapshot
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = { snapshot.saved_login_capability() };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn authentication_workflow_requires_login_match_availability(
    snapshot: &tsify::Ts<nook_companion_core::AuthenticationWorkflowSnapshot>,
) -> Result<bool, wasm_bindgen::JsError> {
    let snapshot = snapshot
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = { snapshot.requires_login_match_availability() };
    Ok(result)
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn authentication_workflow_pilot_presentation_capability(
    snapshot: &tsify::Ts<nook_companion_core::AuthenticationWorkflowSnapshot>,
) -> Result<
    tsify::Ts<nook_companion_core::AuthenticationPilotPresentationCapability>,
    wasm_bindgen::JsError,
> {
    let snapshot = snapshot
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = { snapshot.pilot_presentation_capability() };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]

#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn classify_authentication_backup_codes_observation(text: &str,
candidate_present: bool) -> Result<tsify::Ts<nook_companion_core::AuthenticationBackupCodesObservation>, wasm_bindgen::JsError> {

let result = {
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
};
Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]

#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn authentication_enrollment_workflow_match(authenticator_setup_hint: bool,
backup_codes_copy: &str,
manual_checkpoint_present: bool) -> Result<tsify::Ts<nook_companion_core::AuthenticationWorkflowMatch>, wasm_bindgen::JsError> {

let result = {
    AuthenticationWorkflowMatch::authentication_enrollment_workflow_match(
        AuthenticationEnrollmentObservation {
            authenticator_setup_hint: authenticator_setup_hint.into(),
            backup_codes_copy,
            manual_checkpoint_present: manual_checkpoint_present.into(),
        },
    )
};
Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn classify_companion_authentication_workflow(
    input: &tsify::Ts<nook_companion_core::AuthenticationPageObservations>,
) -> Result<tsify::Ts<nook_companion_core::AuthenticationWorkflowMatch>, wasm_bindgen::JsError> {
    let input = input
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = {
        AuthenticationWorkflowMatch::classify_authentication_workflow_candidates(
            &input.observations,
        )
    };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn classify_companion_authentication_workflow_facts(
    input: &tsify::Ts<nook_companion_core::AuthenticationPageObservationFactsBatch>,
) -> Result<tsify::Ts<nook_companion_core::AuthenticationWorkflowMatch>, wasm_bindgen::JsError> {
    let input = input
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = { input.classify() };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn authentication_page_observation_facts_is_admissible(
    input: &tsify::Ts<nook_companion_core::AuthenticationPageObservationFacts>,
) -> Result<bool, wasm_bindgen::JsError> {
    let input = input
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = { input.authentication_page_observation_facts_is_admissible() };
    Ok(result)
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompanionAuthenticationWorkflowMatchKind {
    NoMatch,
    Rejected,
    Matched,
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn companion_authentication_workflow_match_kind(
    workflow_match: &tsify::Ts<nook_companion_core::AuthenticationWorkflowMatch>,
) -> Result<CompanionAuthenticationWorkflowMatchKind, wasm_bindgen::JsError> {
    let workflow_match = workflow_match
        .to_rust()
        .map_err(|_| JsError::new("Invalid typed WASM input."))?;
    let result = {
        match workflow_match {
            AuthenticationWorkflowMatch::NoMatch => {
                CompanionAuthenticationWorkflowMatchKind::NoMatch
            }
            AuthenticationWorkflowMatch::Rejected => {
                CompanionAuthenticationWorkflowMatchKind::Rejected
            }
            AuthenticationWorkflowMatch::Matched(_) => {
                CompanionAuthenticationWorkflowMatchKind::Matched
            }
        }
    };
    Ok(result)
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    #[cfg(all(test, target_arch = "wasm32"))]
    #[cfg(all(test, target_arch = "wasm32"))]
    use nook_companion_core::ApprovedAuthenticationWorkflowDecision;
    use nook_companion_core::AuthenticationBackupCodesObservation;
    #[cfg(all(test, target_arch = "wasm32"))]
    #[cfg(all(test, target_arch = "wasm32"))]
    use nook_companion_core::AuthenticationWorkflowActivity;
    #[cfg(all(test, target_arch = "wasm32"))]
    #[cfg(all(test, target_arch = "wasm32"))]
    use nook_companion_core::AuthenticationWorkflowKind;
    use nook_companion_core::AuthenticationWorkflowSnapshotResponse;
    #[cfg(all(test, target_arch = "wasm32"))]
    #[cfg(all(test, target_arch = "wasm32"))]
    use nook_companion_core::PageControlSubmissionMethod;
    use nook_companion_core::{AuthenticationEnrollmentObservation, AuthenticationWorkflowMatch};
    use serde::Serialize;
    use tsify::{Ts, Tsify};
    use wasm_bindgen::{JsError, JsValue};
    use wasm_bindgen_test::wasm_bindgen_test;

    fn js_error(error: impl std::fmt::Display) -> JsError {
        JsError::new(&error.to_string())
    }

    fn js_wire(
        value: serde_json::Value,
    ) -> Result<Ts<nook_companion_core::AuthenticationWorkflowSnapshotResponseWire>, JsError> {
        let value = value
            .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
            .map_err(js_error)?;
        Ok(Ts::new_unchecked(value))
    }

    fn js_value(value: serde_json::Value) -> Result<JsValue, JsError> {
        value
            .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
            .map_err(js_error)
    }

    #[wasm_bindgen_test]
    fn match_kind_preserves_every_closed_workflow_variant() -> Result<(), JsError> {
        for (workflow_match, expected) in [
            (
                AuthenticationWorkflowMatch::NoMatch,
                super::CompanionAuthenticationWorkflowMatchKind::NoMatch,
            ),
            (
                AuthenticationWorkflowMatch::Rejected,
                super::CompanionAuthenticationWorkflowMatchKind::Rejected,
            ),
            (
                AuthenticationWorkflowMatch::authentication_enrollment_workflow_match(
                    AuthenticationEnrollmentObservation {
                        authenticator_setup_hint: true.into(),
                        backup_codes_copy: "Save these recovery codes",
                        manual_checkpoint_present: false.into(),
                    },
                )
                .map_err(|_| JsError::new("Typed test operation failed."))?
                .to_rust()
                .map_err(|_| JsError::new("Typed test output could not be decoded."))?,
                super::CompanionAuthenticationWorkflowMatchKind::Matched,
            ),
        ] {
            assert_eq!(
                super::companion_authentication_workflow_match_kind(
                    &(workflow_match)
                        .into_ts()
                        .map_err(|_| JsError::new("Typed test input could not be encoded."))?
                )
                .map_err(|_| JsError::new("Typed test operation failed."))?,
                expected
            );
        }

        Ok(())
    }

    #[wasm_bindgen_test]
    fn workflow_bridge_preserves_recovery_activity_and_transport_policy() -> Result<(), JsError> {
        assert_eq!(
            super::classify_authentication_backup_codes_observation(
                "Save your recovery codes",
                false,
            )
            .map_err(|_| JsError::new("Typed test operation failed."))?
            .to_rust()
            .map_err(|_| JsError::new("Typed test output could not be decoded."))?,
            AuthenticationBackupCodesObservation::Present
        );
        assert!(matches!(
            super::authentication_enrollment_workflow_match(
                true,
                "Save your recovery codes",
                false,
            )
            .map_err(|_| JsError::new("Typed test operation failed."))?
            .to_rust()
            .map_err(|_| JsError::new("Typed test output could not be decoded."))?,
            AuthenticationWorkflowMatch::Matched(_)
        ));
        for (current_password_field_count, new_password_field_count, expected) in [
            (0, 0, AuthenticationWorkflowKind::Login),
            (0, 1, AuthenticationWorkflowKind::Signup),
            (1, 1, AuthenticationWorkflowKind::PasswordChange),
        ] {
            assert_eq!(
                super::project_password_workflow_activity(
                    &(nook_companion_core::PasswordWorkflowActivityEvidence {
                        current_password_field_count: current_password_field_count.into(),
                        new_password_field_count: new_password_field_count.into(),
                    })
                    .into_ts()
                    .map_err(|_| JsError::new("Typed test input could not be encoded."))?,
                )
                .map_err(|_| JsError::new("Typed test operation failed."))?
                .to_rust()
                .map_err(|_| JsError::new("Typed test output could not be decoded."))?
                .kind,
                expected
            );
        }
        for activity in [
            AuthenticationWorkflowActivity::ReadyLogin,
            AuthenticationWorkflowActivity::FillingLogin,
            AuthenticationWorkflowActivity::VerifyingLogin,
            AuthenticationWorkflowActivity::FillingAuthenticator,
            AuthenticationWorkflowActivity::SaveOffer,
        ] {
            let progress = super::authentication_workflow_activity_progress(activity)?;
            let progress: serde_json::Value =
                serde_wasm_bindgen::from_value(progress.js_value()).map_err(js_error)?;
            assert!(progress["currentStep"].as_u64() <= progress["totalSteps"].as_u64());
        }
        assert!(
            super::authentication_control_transportable(
                &(nook_companion_core::AuthenticationControlTransportability {
                    submission_method: PageControlSubmissionMethod::Post,
                    username_field_count: 0.into(),
                    password_field_count: 0.into(),
                })
                .into_ts()
                .map_err(|_| JsError::new("Typed test input could not be encoded."))?
            )
            .map_err(|_| JsError::new("Typed test operation failed."))?
        );
        assert!(
            !super::authentication_control_transportable(
                &(nook_companion_core::AuthenticationControlTransportability {
                    submission_method: PageControlSubmissionMethod::Dialog,
                    username_field_count: 1.into(),
                    password_field_count: 0.into(),
                })
                .into_ts()
                .map_err(|_| JsError::new("Typed test input could not be encoded."))?
            )
            .map_err(|_| JsError::new("Typed test operation failed."))?
        );
        assert!(super::is_authentication_navigation_path("/account/login"));
        assert!(!super::is_authentication_navigation_path(
            "/settings/profile"
        ));
        assert!(matches!(
            super::revalidate_approved_authentication_workflow(&Ts::new_unchecked(js_value(
                serde_json::json!({"approved":{"observations":[]},"live":{"observations":[]}})
            )?))
            .map_err(|_| JsError::new("Typed test operation failed."))?
            .to_rust()
            .map_err(|_| JsError::new("Typed test output could not be decoded."))?,
            ApprovedAuthenticationWorkflowDecision::Rejected
        ));

        Ok(())
    }

    #[wasm_bindgen_test]
    fn snapshot_decoder_and_saved_login_availability_preserve_typed_boundaries()
    -> Result<(), JsError> {
        let matched =
            super::decode_authentication_workflow_snapshot_response(&js_wire(serde_json::json!({
                "ok": true,
                "snapshot": {
                    "kind": 0,
                    "stage": 0,
                    "action": 0,
                    "currentStep": 1,
                    "totalSteps": 3,
                    "approvalRequirement": "explicit-user-approval",
                    "savedLoginCapability": "fill-saved-login",
                    "observationIndex": 0
                }
            }))?)
            .map_err(|_| JsError::new("Typed test operation failed."))?
            .to_rust()
            .map_err(|_| JsError::new("Typed test output could not be decoded."))?;
        assert!(matches!(
            matched,
            AuthenticationWorkflowSnapshotResponse::Matched { .. }
        ));
        assert!(matches!(
            super::decode_authentication_workflow_snapshot_response(&js_wire(
                serde_json::json!({"ok": true}),
            )?)
            .map_err(|_| JsError::new("Typed test operation failed."))?
            .to_rust()
            .map_err(|_| JsError::new("Typed test output could not be decoded."))?,
            AuthenticationWorkflowSnapshotResponse::NoMatch { .. }
        ));
        assert!(matches!(
            super::decode_authentication_workflow_snapshot_response(&js_wire(
                serde_json::json!({"ok": false, "reason": "rejected"}),
            )?)
            .map_err(|_| JsError::new("Typed test operation failed."))?
            .to_rust()
            .map_err(|_| JsError::new("Typed test output could not be decoded."))?,
            AuthenticationWorkflowSnapshotResponse::Rejected { .. }
        ));

        let ready: nook_companion_core::SavedLoginActionPresentationRequest =
            serde_wasm_bindgen::from_value(js_value(serde_json::json!({
                "action": 4,
                "loginMatches": {"kind": "ready", "count": 1}
            }))?)
            .map_err(js_error)?;
        assert!(
            super::saved_login_action_available(
                &(ready)
                    .into_ts()
                    .map_err(|_| JsError::new("Typed test input could not be encoded."))?
            )
            .map_err(|_| JsError::new("Typed test operation failed."))?
        );
        let unavailable: nook_companion_core::SavedLoginActionPresentationRequest =
            serde_wasm_bindgen::from_value(js_value(serde_json::json!({
                "action": 0,
                "loginMatches": {"kind": "ready", "count": 1}
            }))?)
            .map_err(js_error)?;
        assert!(
            !super::saved_login_action_available(
                &(unavailable)
                    .into_ts()
                    .map_err(|_| JsError::new("Typed test input could not be encoded."))?
            )
            .map_err(|_| JsError::new("Typed test operation failed."))?
        );
        Ok(())
    }
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn project_password_workflow_activity(
    evidence: &tsify::Ts<nook_companion_core::PasswordWorkflowActivityEvidence>,
) -> Result<
    tsify::Ts<nook_companion_core::PasswordWorkflowActivityPresentation>,
    wasm_bindgen::JsError,
> {
    let evidence = evidence
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = { evidence.project() };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn authentication_workflow_activity_progress(
    activity: nook_companion_core::AuthenticationWorkflowActivity,
) -> Result<tsify::Ts<nook_companion_core::AuthenticationDisplayProgress>, wasm_bindgen::JsError> {
    let result = { activity.progress() };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn saved_login_action_available(
    request: &tsify::Ts<nook_companion_core::SavedLoginActionPresentationRequest>,
) -> Result<bool, wasm_bindgen::JsError> {
    let request = request
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = { request.is_available() };
    Ok(result)
}
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn authentication_control_transportable(
    request: &tsify::Ts<nook_companion_core::AuthenticationControlTransportability>,
) -> Result<bool, wasm_bindgen::JsError> {
    let request = request
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = { request.is_transportable() };
    Ok(result)
}
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn is_authentication_navigation_path(pathname: &str) -> bool {
    AuthenticationNavigationPath::from(pathname).has_authentication_segment()
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn revalidate_approved_authentication_workflow(
    request: &tsify::Ts<nook_companion_core::ApprovedAuthenticationWorkflowRevalidation>,
) -> Result<
    tsify::Ts<nook_companion_core::ApprovedAuthenticationWorkflowDecision>,
    wasm_bindgen::JsError,
> {
    let request = request
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = { request.revalidate() };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

mod setup_context;
pub use setup_context::{
    AuthenticationAuthenticatorSetupRequest, AuthenticationQrMediaObservation,
    classify_authentication_authenticator_setup_batch,
};
