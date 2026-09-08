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
pub fn current_companion_authentication_page_observation_facts(
    request: nook_companion_core::CurrentAuthenticationPageObservationFactsRequest,
) -> nook_companion_core::CurrentAuthenticationPageObservationFactsWire {
    nook_companion_core::CurrentAuthenticationPageObservationFactsWire::new(request)
}

#[wasm_bindgen]
pub fn classify_versioned_companion_authentication_workflow_facts(
    input: wasm_bindgen::JsValue,
) -> Result<
    nook_companion_core::AuthenticationPageObservationFactsClassificationOutcome,
    wasm_bindgen::JsError,
> {
    let input = serde_wasm_bindgen::from_value::<
        nook_companion_core::VersionedAuthenticationPageObservationFactsBatch,
    >(input)
    .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))?;
    Ok(input.classify())
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
        fn js_error(error: impl std::fmt::Debug) -> wasm_bindgen::JsValue {
            wasm_bindgen::JsValue::from_str(&format!("{error:?}"))
        }

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

        fn current() -> nook_companion_core::VersionedAuthenticationPageObservationFacts {
            let current =
                super::current_companion_authentication_page_observation_facts(
                    nook_companion_core::CurrentAuthenticationPageObservationFactsRequest {
                        facts: nook_companion_core::AuthenticationPageObservationFacts::default()
                            .into(),
                        credential_disclosure_control:
                            nook_companion_core::AuthenticationCredentialDisclosureControlObservation::Absent,
                    },
                );
            current.into()
        }

        fn classify(
            observation: nook_companion_core::VersionedAuthenticationPageObservationFacts,
        ) -> Result<
            nook_companion_core::AuthenticationPageObservationFactsClassificationOutcome,
            wasm_bindgen::JsValue,
        > {
            super::classify_versioned_companion_authentication_workflow_facts(
                serde_wasm_bindgen::to_value(
                    &nook_companion_core::VersionedAuthenticationPageObservationFactsBatch {
                        observations: vec![observation],
                    },
                )
                .map_err(Self::js_error)?,
            )
            .map_err(Self::js_error)
        }

        fn assert_classified_outcome() -> Result<(), wasm_bindgen::JsValue> {
            let result = Self::classify(Self::current())?;
            assert_eq!(
                result,
                nook_companion_core::AuthenticationPageObservationFactsClassificationOutcome::Classified(
                    nook_companion_core::AuthenticationWorkflowMatch::NoMatch,
                )
            );
            assert_eq!(
                serde_json::to_value(result).map_err(Self::js_error)?,
                serde_json::json!({
                    "kind": "classified",
                    "value": { "kind": "no-match" }
                })
            );
            Ok(())
        }

        fn assert_page_version_outcome() -> Result<(), wasm_bindgen::JsValue> {
            let mut future_wire = serde_json::to_value(Self::current()).map_err(Self::js_error)?;
            let serde_json::Value::Object(fields) = &mut future_wire else {
                return Err(wasm_bindgen::JsValue::from_str(
                    "versioned page observation must encode as an object",
                ));
            };
            fields.insert("schemaVersion".to_owned(), serde_json::json!(2));
            fields.remove("credentialDisclosureControl");
            let future = serde_json::from_value(future_wire).map_err(Self::js_error)?;
            let result = Self::classify(future)?;
            assert_eq!(
                serde_json::to_value(result).map_err(Self::js_error)?,
                serde_json::json!({
                    "kind": "unsupported-version",
                    "value": {
                        "schema": "page-facts",
                        "version": 2
                    }
                })
            );
            Ok(())
        }

        fn assert_disclosure_version_outcome() -> Result<(), wasm_bindgen::JsValue> {
            let mut nested_wire =
                serde_json::to_value(Self::current()).map_err(Self::js_error)?;
            let serde_json::Value::Object(fields) = &mut nested_wire else {
                return Err(wasm_bindgen::JsValue::from_str(
                    "versioned page observation must encode as an object",
                ));
            };
            fields.insert(
                "credentialDisclosureControl".to_owned(),
                serde_json::json!({
                    "kind": "observed",
                    "observations": [{"schemaVersion": 2}]
                }),
            );
            let nested = serde_json::from_value(nested_wire).map_err(Self::js_error)?;
            let result = Self::classify(nested)?;
            assert_eq!(
                serde_json::to_value(result).map_err(Self::js_error)?,
                serde_json::json!({
                    "kind": "unsupported-version",
                    "value": {
                        "schema": "disclosure-control",
                        "version": 2
                    }
                })
            );
            Ok(())
        }

        fn assert_versioned_transport_preserves_typed_outcome(
        ) -> Result<(), wasm_bindgen::JsValue> {
            Self::assert_classified_outcome()?;
            Self::assert_page_version_outcome()?;
            Self::assert_disclosure_version_outcome()
        }
    }

    #[wasm_bindgen_test]
    fn match_kind_preserves_every_closed_workflow_variant() {
        AuthenticationWorkflowMatchKindScenario::assert_every_core_variant_has_a_stable_abi_kind();
    }

    #[wasm_bindgen_test]
    fn versioned_transport_preserves_its_typed_outcome() -> Result<(), wasm_bindgen::JsValue> {
        AuthenticationWorkflowMatchKindScenario::assert_versioned_transport_preserves_typed_outcome(
        )
    }
}
