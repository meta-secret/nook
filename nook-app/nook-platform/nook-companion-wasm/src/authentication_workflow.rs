use nook_companion_core::WebsiteLoginOptions;
use wasm_bindgen::JsError;
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
) -> Result<nook_companion_core::WebsiteLoginMatchAvailability, JsError> {
    WebsiteLoginOptions::from_wire(response)
        .and_then(WebsiteLoginOptions::into_match_availability)
        .map_err(|error| JsError::new(&error.to_string()))
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
    candidate_present: bool,
) -> nook_companion_core::AuthenticationBackupCodesObservation {
    nook_companion_core::classify_authentication_backup_codes_observation(text, candidate_present)
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
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn classify_versioned_companion_authentication_workflow_facts(
    input: nook_companion_core::VersionedAuthenticationPageObservationFactsBatch,
) -> nook_companion_core::AuthenticationPageObservationFactsClassificationOutcome {
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

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use wasm_bindgen_test::wasm_bindgen_test;

    struct AuthenticationWorkflowMatchKindScenario;

    impl AuthenticationWorkflowMatchKindScenario {
        fn assert_every_core_variant_has_a_stable_abi_kind() {
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
                    super::authentication_enrollment_workflow_match(
                        true,
                        "Save these recovery codes",
                        false,
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

        fn assert_versioned_transport_preserves_typed_outcome() -> anyhow::Result<()> {
            let current =
                nook_companion_core::VersionedAuthenticationPageObservationFacts::current(
                    nook_companion_core::CurrentAuthenticationPageObservationFactsRequest {
                        facts: nook_companion_core::AuthenticationPageObservationFacts::default(),
                        credential_disclosure_control:
                            nook_companion_core::AuthenticationCredentialDisclosureControlObservation::Absent,
                    },
                );
            let result = super::classify_versioned_companion_authentication_workflow_facts(
                nook_companion_core::VersionedAuthenticationPageObservationFactsBatch {
                    observations: vec![current.clone()],
                },
            );
            assert_eq!(
                result,
                nook_companion_core::AuthenticationPageObservationFactsClassificationOutcome::Classified(
                    nook_companion_core::AuthenticationWorkflowMatch::NoMatch,
                )
            );
            assert_eq!(
                serde_json::to_value(result)?,
                serde_json::json!({
                    "kind": "classified",
                    "value": { "kind": "no-match" }
                })
            );

            let mut future_wire = serde_json::to_value(current)?;
            let serde_json::Value::Object(fields) = &mut future_wire else {
                anyhow::bail!("versioned page observation must encode as an object");
            };
            fields.insert("schemaVersion".to_owned(), serde_json::json!(2));
            fields.remove("credentialDisclosureControl");
            let future = serde_json::from_value(future_wire)?;
            let result = super::classify_versioned_companion_authentication_workflow_facts(
                nook_companion_core::VersionedAuthenticationPageObservationFactsBatch {
                    observations: vec![future],
                },
            );
            assert_eq!(
                serde_json::to_value(result)?,
                serde_json::json!({
                    "kind": "unsupported-version",
                    "value": { "version": 2 }
                })
            );
            Ok(())
        }
    }

    #[wasm_bindgen_test]
    fn match_kind_preserves_every_closed_workflow_variant() {
        AuthenticationWorkflowMatchKindScenario::assert_every_core_variant_has_a_stable_abi_kind();
    }

    #[wasm_bindgen_test]
    fn versioned_transport_preserves_its_typed_outcome() -> anyhow::Result<()> {
        AuthenticationWorkflowMatchKindScenario::assert_versioned_transport_preserves_typed_outcome(
        )
    }
}
