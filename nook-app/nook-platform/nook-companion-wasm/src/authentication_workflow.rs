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
    use nook_companion_core::AuthenticationBackupCodesObservation;
    use nook_companion_core::AuthenticationWorkflowActivity;
    use nook_companion_core::AuthenticationWorkflowSnapshotResponseKind;
    use nook_companion_core::{
        AuthenticationPageObservationFacts, AuthenticationPageObservationFactsBatch,
    };
    use nook_companion_core::{
        AuthenticationWorkflowCurrentStep, AuthenticationWorkflowKind,
        AuthenticationWorkflowTotalSteps,
    };

    use nook_companion_core::AuthenticationWorkflowSnapshotResponseWire;
    use nook_companion_core::{
        ApprovedAuthenticationWorkflowDecision, AuthenticationWorkflowSelectedFactsWire,
        WebsiteLoginMatchAvailabilityKind,
    };
    use nook_companion_core::{
        AuthenticationApprovalRequirement, AuthenticationPageObservations,
        AuthenticationPilotPresentationCapability, AuthenticationSavedLoginCapability,
        AuthenticationWorkflowAction, AuthenticationWorkflowSnapshot, AuthenticationWorkflowStage,
    };
    use nook_companion_core::{AuthenticationEnrollmentObservation, AuthenticationWorkflowMatch};
    use serde::de::Error as DeserializeError;
    use serde::{Deserialize, Deserializer, Serialize};
    use serde_wasm_bindgen::Serializer;
    use std::fmt;
    use tsify::{Ts, Tsify};
    use wasm_bindgen::JsError;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[derive(Deserialize)]
    struct SnapshotKindProjection {
        #[serde(deserialize_with = "WorkflowBridgeFixture::snapshot_kind")]
        kind: AuthenticationWorkflowSnapshotResponseKind,
    }
    #[derive(Deserialize)]
    struct LoginAvailabilityProjection {
        kind: WebsiteLoginMatchAvailabilityKind,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RoutingProjection {
        workflow: SnapshotKindProjection,
        login_matches: LoginAvailabilityProjection,
        selected_facts: AuthenticationWorkflowSelectedFactsWire,
    }
    #[derive(Deserialize)]
    struct PasswordKindProjection {
        kind: AuthenticationWorkflowKind,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct DisplayProgressProjection {
        current_step: AuthenticationWorkflowCurrentStep,
        total_steps: AuthenticationWorkflowTotalSteps,
    }
    #[derive(Deserialize)]
    struct RevalidationProjection {
        #[serde(deserialize_with = "WorkflowBridgeFixture::rejected_decision")]
        kind: ApprovedAuthenticationWorkflowDecision,
    }
    struct WorkflowBridgeFixture;
    impl WorkflowBridgeFixture {
        fn snapshot_kind<'de, Decoder: Deserializer<'de>>(
            decoder: Decoder,
        ) -> Result<AuthenticationWorkflowSnapshotResponseKind, Decoder::Error> {
            match u8::deserialize(decoder)? {
                0 => Ok(AuthenticationWorkflowSnapshotResponseKind::Matched),
                1 => Ok(AuthenticationWorkflowSnapshotResponseKind::NoMatch),
                2 => Ok(AuthenticationWorkflowSnapshotResponseKind::Rejected),
                _ => Err(DeserializeError::custom("Unknown snapshot response kind.")),
            }
        }
        fn rejected_decision<'de, Decoder: Deserializer<'de>>(
            decoder: Decoder,
        ) -> Result<ApprovedAuthenticationWorkflowDecision, Decoder::Error> {
            match String::deserialize(decoder)?.as_str() {
                "rejected" => Ok(ApprovedAuthenticationWorkflowDecision::Rejected),
                _ => Err(DeserializeError::custom(
                    "Expected rejected revalidation projection.",
                )),
            }
        }

        fn js_error(_error: impl fmt::Display) -> JsError {
            JsError::new("Workflow fixture conversion failed.")
        }

        fn js_wire(
            value: serde_json::Value,
        ) -> Result<Ts<AuthenticationWorkflowSnapshotResponseWire>, JsError> {
            let value = value
                .serialize(&Serializer::json_compatible())
                .map_err(WorkflowBridgeFixture::js_error)?;
            Ok(Ts::new_unchecked(value))
        }
    }

    impl WorkflowBridgeFixture {
        fn external<T: Tsify>(value: serde_json::Value) -> Result<Ts<T>, JsError> {
            Ok(Ts::new_unchecked(
                value
                    .serialize(&Serializer::json_compatible())
                    .map_err(Self::js_error)?,
            ))
        }

        fn login_snapshot() -> AuthenticationWorkflowSnapshot {
            AuthenticationWorkflowSnapshot {
                kind: AuthenticationWorkflowKind::Login,
                stage: AuthenticationWorkflowStage::Credentials,
                action: AuthenticationWorkflowAction::ContinueWithNook,
                current_step: 1.into(),
                total_steps: 3.into(),
                approval_requirement: AuthenticationApprovalRequirement::ExplicitUserApproval,
                saved_login_capability: AuthenticationSavedLoginCapability::FillSavedLogin,
                observation_index: 0.into(),
            }
        }
    }

    #[wasm_bindgen_test]
    fn login_snapshot_projects_saved_login_and_pilot_capabilities() -> Result<(), JsError> {
        let snapshot = WorkflowBridgeFixture::login_snapshot()
            .into_ts()
            .map_err(WorkflowBridgeFixture::js_error)?;
        assert_eq!(
            super::authentication_workflow_saved_login_capability(&snapshot)?
                .to_rust()
                .map_err(WorkflowBridgeFixture::js_error)?,
            AuthenticationSavedLoginCapability::FillSavedLogin
        );
        assert!(super::authentication_workflow_requires_login_match_availability(&snapshot)?);
        assert_eq!(
            super::authentication_workflow_pilot_presentation_capability(&snapshot)?
                .to_rust()
                .map_err(WorkflowBridgeFixture::js_error)?,
            AuthenticationPilotPresentationCapability::ProposeAction
        );
        let mut inconsistent = WorkflowBridgeFixture::login_snapshot();
        inconsistent.approval_requirement = AuthenticationApprovalRequirement::TakeoverRequired;
        let inconsistent = inconsistent
            .into_ts()
            .map_err(WorkflowBridgeFixture::js_error)?;
        assert_eq!(
            super::authentication_workflow_saved_login_capability(&inconsistent)?
                .to_rust()
                .map_err(WorkflowBridgeFixture::js_error)?,
            AuthenticationSavedLoginCapability::Unavailable
        );
        assert!(!super::authentication_workflow_requires_login_match_availability(&inconsistent)?);
        assert_eq!(
            super::authentication_workflow_pilot_presentation_capability(&inconsistent)?
                .to_rust()
                .map_err(WorkflowBridgeFixture::js_error)?,
            AuthenticationPilotPresentationCapability::Hidden
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn absent_workflows_and_login_availability_project_released_statuses() -> Result<(), JsError> {
        let observations = AuthenticationPageObservations {
            observations: vec![],
        }
        .into_ts()
        .map_err(WorkflowBridgeFixture::js_error)?;
        assert_eq!(
            super::classify_companion_authentication_workflow(&observations)?
                .to_rust()
                .map_err(WorkflowBridgeFixture::js_error)?,
            AuthenticationWorkflowMatch::Rejected
        );
        let facts = AuthenticationPageObservationFactsBatch {
            observations: vec![],
        }
        .into_ts()
        .map_err(WorkflowBridgeFixture::js_error)?;
        assert_eq!(
            super::classify_companion_authentication_workflow_facts(&facts)?
                .to_rust()
                .map_err(WorkflowBridgeFixture::js_error)?,
            AuthenticationWorkflowMatch::Rejected
        );
        let default_facts = AuthenticationPageObservationFacts::default()
            .into_ts()
            .map_err(WorkflowBridgeFixture::js_error)?;
        assert!(super::authentication_page_observation_facts_is_admissible(
            &default_facts
        )?);
        let routing = super::decode_authentication_workflow_runtime_response(
            &WorkflowBridgeFixture::external(
                serde_json::json!({"workflow":{"ok":true},"loginMatches":{"kind":"unavailable"},"selectedFacts":{"state":"notApplicable"}}),
            )?,
        )?;
        let routing: RoutingProjection = serde_wasm_bindgen::from_value(routing.js_value())
            .map_err(WorkflowBridgeFixture::js_error)?;
        assert_eq!(
            routing.workflow.kind,
            AuthenticationWorkflowSnapshotResponseKind::NoMatch
        );
        assert_eq!(
            routing.login_matches.kind,
            WebsiteLoginMatchAvailabilityKind::Unavailable
        );
        assert!(matches!(
            routing.selected_facts,
            AuthenticationWorkflowSelectedFactsWire::NotApplicable
        ));
        let locked = super::decode_website_login_match_availability(
            &WorkflowBridgeFixture::external(serde_json::json!({"ok":true,"status":"locked"}))?,
        )?;
        let locked: LoginAvailabilityProjection = serde_wasm_bindgen::from_value(locked.js_value())
            .map_err(WorkflowBridgeFixture::js_error)?;
        assert_eq!(locked.kind, WebsiteLoginMatchAvailabilityKind::Locked);
        let unavailable = super::unavailable_website_login_match_availability()?;
        let unavailable: LoginAvailabilityProjection =
            serde_wasm_bindgen::from_value(unavailable.js_value())
                .map_err(WorkflowBridgeFixture::js_error)?;
        assert_eq!(
            unavailable.kind,
            WebsiteLoginMatchAvailabilityKind::Unavailable
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn malformed_external_workflow_values_fail_closed() -> Result<(), JsError> {
        let malformed = serde_json::json!({"unexpected":true});
        assert!(
            super::decode_authentication_workflow_snapshot_response(
                &WorkflowBridgeFixture::external(malformed.clone())?
            )
            .is_err()
        );
        assert!(
            super::decode_authentication_workflow_runtime_response(
                &WorkflowBridgeFixture::external(malformed.clone())?
            )
            .is_err()
        );
        assert!(
            super::decode_website_login_match_availability(&WorkflowBridgeFixture::external(
                malformed.clone()
            )?)
            .is_err()
        );
        assert!(
            super::authentication_workflow_saved_login_capability(
                &WorkflowBridgeFixture::external(malformed.clone())?
            )
            .is_err()
        );
        assert!(
            super::authentication_workflow_requires_login_match_availability(
                &WorkflowBridgeFixture::external(malformed.clone())?
            )
            .is_err()
        );
        assert!(
            super::authentication_workflow_pilot_presentation_capability(
                &WorkflowBridgeFixture::external(malformed.clone())?
            )
            .is_err()
        );
        assert!(
            super::classify_companion_authentication_workflow(&WorkflowBridgeFixture::external(
                malformed.clone()
            )?)
            .is_err()
        );
        assert!(
            super::classify_companion_authentication_workflow_facts(
                &WorkflowBridgeFixture::external(malformed.clone())?
            )
            .is_err()
        );
        assert!(
            super::authentication_page_observation_facts_is_admissible(
                &WorkflowBridgeFixture::external(malformed.clone())?
            )
            .is_err()
        );
        assert!(
            super::companion_authentication_workflow_match_kind(&WorkflowBridgeFixture::external(
                malformed.clone()
            )?)
            .is_err()
        );
        assert!(
            super::project_password_workflow_activity(&WorkflowBridgeFixture::external(
                malformed.clone()
            )?)
            .is_err()
        );
        assert!(
            super::saved_login_action_available(&WorkflowBridgeFixture::external(
                malformed.clone()
            )?)
            .is_err()
        );
        assert!(
            super::authentication_control_transportable(&WorkflowBridgeFixture::external(
                malformed.clone()
            )?)
            .is_err()
        );
        assert!(
            super::revalidate_approved_authentication_workflow(&WorkflowBridgeFixture::external(
                malformed
            )?)
            .is_err()
        );
        Ok(())
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
                ),
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
            let evidence = serde_json::json!({
                "currentPasswordFieldCount": current_password_field_count,
                "newPasswordFieldCount": new_password_field_count,
            })
            .serialize(&Serializer::json_compatible())
            .map_err(WorkflowBridgeFixture::js_error)?;
            let presentation =
                super::project_password_workflow_activity(&Ts::new_unchecked(evidence))?;
            let presentation: PasswordKindProjection =
                serde_wasm_bindgen::from_value(presentation.js_value())
                    .map_err(WorkflowBridgeFixture::js_error)?;
            assert_eq!(presentation.kind, expected);
        }
        for activity in [
            AuthenticationWorkflowActivity::ReadyLogin,
            AuthenticationWorkflowActivity::FillingLogin,
            AuthenticationWorkflowActivity::VerifyingLogin,
            AuthenticationWorkflowActivity::FillingAuthenticator,
            AuthenticationWorkflowActivity::SaveOffer,
        ] {
            let progress = super::authentication_workflow_activity_progress(activity)?;
            let progress: DisplayProgressProjection =
                serde_wasm_bindgen::from_value(progress.js_value())
                    .map_err(WorkflowBridgeFixture::js_error)?;
            assert!(u8::from(progress.current_step) <= u8::from(progress.total_steps));
        }
        let post = serde_json::json!({"submissionMethod":"post","usernameFieldCount":0,"passwordFieldCount":0})
            .serialize(&Serializer::json_compatible()).map_err(WorkflowBridgeFixture::js_error)?;
        assert!(super::authentication_control_transportable(
            &Ts::new_unchecked(post)
        )?);
        let dialog = serde_json::json!({"submissionMethod":"dialog","usernameFieldCount":1,"passwordFieldCount":0})
            .serialize(&Serializer::json_compatible()).map_err(WorkflowBridgeFixture::js_error)?;
        assert!(!super::authentication_control_transportable(
            &Ts::new_unchecked(dialog)
        )?);
        assert!(super::is_authentication_navigation_path("/account/login"));
        assert!(!super::is_authentication_navigation_path(
            "/settings/profile"
        ));
        let request = serde_json::json!({
            "approved": AuthenticationPageObservationFacts::default(),
            "live": AuthenticationPageObservationFactsBatch { observations: vec![] },
        })
        .serialize(&Serializer::json_compatible())
        .map_err(WorkflowBridgeFixture::js_error)?;
        let rejected =
            super::revalidate_approved_authentication_workflow(&Ts::new_unchecked(request))?;
        let rejected: RevalidationProjection = serde_wasm_bindgen::from_value(rejected.js_value())
            .map_err(WorkflowBridgeFixture::js_error)?;
        assert!(matches!(
            rejected.kind,
            ApprovedAuthenticationWorkflowDecision::Rejected
        ));

        Ok(())
    }

    #[wasm_bindgen_test]
    fn snapshot_decoder_and_saved_login_availability_preserve_typed_boundaries()
    -> Result<(), JsError> {
        let matched = super::decode_authentication_workflow_snapshot_response(
            &WorkflowBridgeFixture::js_wire(serde_json::json!({
                "ok": true,
                "snapshot": {
                    "kind": 0, "stage": 0, "action": 0, "currentStep": 1, "totalSteps": 3,
                    "approvalRequirement": "explicit-user-approval", "savedLoginCapability": "fill-saved-login", "observationIndex": 0,
                }
            }))?,
        )?;
        let matched: SnapshotKindProjection = serde_wasm_bindgen::from_value(matched.js_value())
            .map_err(WorkflowBridgeFixture::js_error)?;
        assert_eq!(
            matched.kind,
            AuthenticationWorkflowSnapshotResponseKind::Matched
        );
        let no_match = super::decode_authentication_workflow_snapshot_response(
            &WorkflowBridgeFixture::js_wire(serde_json::json!({"ok": true}))?,
        )?;
        let no_match: SnapshotKindProjection = serde_wasm_bindgen::from_value(no_match.js_value())
            .map_err(WorkflowBridgeFixture::js_error)?;
        assert_eq!(
            no_match.kind,
            AuthenticationWorkflowSnapshotResponseKind::NoMatch
        );
        let rejected = super::decode_authentication_workflow_snapshot_response(
            &WorkflowBridgeFixture::js_wire(
                serde_json::json!({"ok": false, "reason": "rejected"}),
            )?,
        )?;
        let rejected: SnapshotKindProjection = serde_wasm_bindgen::from_value(rejected.js_value())
            .map_err(WorkflowBridgeFixture::js_error)?;
        assert_eq!(
            rejected.kind,
            AuthenticationWorkflowSnapshotResponseKind::Rejected
        );

        let ready = serde_json::json!({"action": 4, "loginMatches": {"kind": "ready", "count": 1}})
            .serialize(&Serializer::json_compatible())
            .map_err(WorkflowBridgeFixture::js_error)?;
        assert!(super::saved_login_action_available(&Ts::new_unchecked(
            ready
        ))?);
        let unavailable =
            serde_json::json!({"action": 0, "loginMatches": {"kind": "ready", "count": 1}})
                .serialize(&Serializer::json_compatible())
                .map_err(WorkflowBridgeFixture::js_error)?;
        assert!(!super::saved_login_action_available(&Ts::new_unchecked(
            unavailable
        ))?);
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
