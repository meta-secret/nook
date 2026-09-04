//! Typed WASM bindings for portable credential-fill planning and simulation.

use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn plan_companion_credential_fill(
    fields: Vec<nook_companion_core::AuthenticationFillFieldObservation>,
) -> Result<nook_companion_core::AuthenticationCredentialFillPlan, wasm_bindgen::JsError> {
    nook_companion_core::plan_authentication_credential_fill(&fields)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn simulate_companion_credential_fill(
    fields: Vec<nook_companion_core::AuthenticationFillFieldObservation>,
    credentials: nook_companion_core::SimulatedAuthenticationCredentials,
) -> Result<nook_companion_core::SimulatedAuthenticationFill, wasm_bindgen::JsError> {
    nook_companion_core::simulate_authentication_credential_fill(&fields, &credentials)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;

    fn field(
        field_index: u32,
        role: nook_companion_core::AuthenticationFillFieldRole,
    ) -> nook_companion_core::AuthenticationFillFieldObservation {
        nook_companion_core::AuthenticationFillFieldObservation {
            field_index,
            role,
            editability: nook_companion_core::AuthenticationFillFieldEditability::Writable,
        }
    }

    #[test]
    fn credential_fill_wasm_exports_match_core_policy() -> Result<(), wasm_bindgen::JsError> {
        let plan = plan_companion_credential_fill(vec![
            field(
                0,
                nook_companion_core::AuthenticationFillFieldRole::Username,
            ),
            field(
                1,
                nook_companion_core::AuthenticationFillFieldRole::CurrentPassword,
            ),
        ])?;
        assert_eq!(plan.assignments.len(), 2);

        let readonly = plan_companion_credential_fill(vec![
            nook_companion_core::AuthenticationFillFieldObservation {
                field_index: 0,
                role: nook_companion_core::AuthenticationFillFieldRole::CurrentPassword,
                editability: nook_companion_core::AuthenticationFillFieldEditability::Readonly,
            },
        ]);
        assert!(readonly.is_err());
        Ok(())
    }

    #[test]
    fn credential_fill_simulation_wasm_export_matches_core_policy()
    -> Result<(), wasm_bindgen::JsError> {
        let credentials = nook_companion_core::SimulatedAuthenticationCredentials {
            username: "test-user@example.test".to_owned(),
            password: "correct-horse-battery-staple-1".to_owned(),
        };
        let expected_username = credentials.username.clone();
        let expected_password = credentials.password.clone();
        let simulated = simulate_companion_credential_fill(
            vec![
                field(
                    0,
                    nook_companion_core::AuthenticationFillFieldRole::Username,
                ),
                field(
                    1,
                    nook_companion_core::AuthenticationFillFieldRole::CurrentPassword,
                ),
            ],
            credentials,
        )?;
        assert_eq!(simulated.assignments[0].filled_with, expected_username);
        assert_eq!(simulated.assignments[1].filled_with, expected_password);
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use serde::{Deserialize, Serialize};
    use wasm_bindgen_test::wasm_bindgen_test;

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct FieldFixture {
        field_index: u32,
        role: &'static str,
        editability: &'static str,
    }

    #[derive(Serialize)]
    struct CredentialsFixture {
        username: &'static str,
        password: &'static str,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct AssignmentResult {
        field_index: u32,
        credential: String,
    }

    #[derive(Deserialize)]
    struct PlanResult {
        assignments: Vec<AssignmentResult>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct SimulatedFieldResult {
        field_index: u32,
        filled_with: String,
    }

    #[derive(Deserialize)]
    struct SimulationResult {
        assignments: Vec<SimulatedFieldResult>,
    }

    fn js_error(error: impl std::fmt::Display) -> wasm_bindgen::JsError {
        wasm_bindgen::JsError::new(&error.to_string())
    }

    fn field(field_index: u32, role: &'static str) -> FieldFixture {
        FieldFixture {
            field_index,
            role,
            editability: "writable",
        }
    }

    #[wasm_bindgen_test]
    fn bridge_round_trips_js_inputs_outputs_and_errors() -> Result<(), wasm_bindgen::JsError> {
        let fields_js =
            serde_wasm_bindgen::to_value(&vec![field(0, "username"), field(1, "generic-password")])
                .map_err(js_error)?;
        let fields = serde_wasm_bindgen::from_value(fields_js).map_err(js_error)?;
        let plan = super::plan_companion_credential_fill(fields)?;
        let plan_js = serde_wasm_bindgen::to_value(&plan).map_err(js_error)?;
        let result: PlanResult = serde_wasm_bindgen::from_value(plan_js).map_err(js_error)?;
        assert_eq!(result.assignments.len(), 2);
        assert_eq!(result.assignments[0].field_index, 0);
        assert_eq!(result.assignments[0].credential, "username");
        assert_eq!(result.assignments[1].field_index, 1);
        assert_eq!(result.assignments[1].credential, "current-password");

        let unsafe_fields_js =
            serde_wasm_bindgen::to_value(&vec![field(0, "username"), field(1, "new-password")])
                .map_err(js_error)?;
        let unsafe_fields = serde_wasm_bindgen::from_value(unsafe_fields_js).map_err(js_error)?;
        assert!(super::plan_companion_credential_fill(unsafe_fields).is_err());
        Ok(())
    }

    #[wasm_bindgen_test]
    fn simulation_round_trips_test_credentials_through_js_value()
    -> Result<(), wasm_bindgen::JsError> {
        let fields_js =
            serde_wasm_bindgen::to_value(&vec![field(0, "username"), field(1, "current-password")])
                .map_err(js_error)?;
        let fields = serde_wasm_bindgen::from_value(fields_js).map_err(js_error)?;
        let credentials_js = serde_wasm_bindgen::to_value(&CredentialsFixture {
            username: "test-user@example.test",
            password: "correct-horse-battery-staple-1",
        })
        .map_err(js_error)?;
        let credentials = serde_wasm_bindgen::from_value(credentials_js).map_err(js_error)?;
        let simulation = super::simulate_companion_credential_fill(fields, credentials)?;
        let simulation_js = serde_wasm_bindgen::to_value(&simulation).map_err(js_error)?;
        let result: SimulationResult =
            serde_wasm_bindgen::from_value(simulation_js).map_err(js_error)?;

        assert_eq!(result.assignments.len(), 2);
        assert_eq!(result.assignments[0].field_index, 0);
        assert_eq!(result.assignments[0].filled_with, "test-user@example.test");
        assert_eq!(result.assignments[1].field_index, 1);
        assert_eq!(
            result.assignments[1].filled_with,
            "correct-horse-battery-staple-1"
        );
        Ok(())
    }
}
