//! Typed WASM bindings for portable credential-fill planning and simulation.

use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn plan_companion_credential_fill(
    fields: Vec<nook_companion_core::AuthenticationFillFieldObservation>,
) -> Result<nook_companion_core::AuthenticationCredentialFillPlan, wasm_bindgen::JsError> {
    nook_companion_core::plan_authentication_credential_fill(&fields)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn simulate_companion_credential_fill(
    fields: Vec<nook_companion_core::AuthenticationFillFieldObservation>,
    credentials: nook_companion_core::SimulatedAuthenticationCredentials,
) -> Result<nook_companion_core::SimulatedAuthenticationFill, wasm_bindgen::JsError> {
    nook_companion_core::simulate_authentication_credential_fill(&fields, &credentials)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[wasm_bindgen]
#[must_use]
pub fn simulated_authentication_credential_fixture()
-> nook_companion_core::SimulatedAuthenticationCredentials {
    nook_companion_core::SimulatedAuthenticationCredentials::fixture()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn username_field(field_index: u32) -> nook_companion_core::AuthenticationFillFieldObservation {
        nook_companion_core::AuthenticationFillFieldObservation {
            field_index,
            username: true,
            ..Default::default()
        }
    }

    fn password_field(field_index: u32) -> nook_companion_core::AuthenticationFillFieldObservation {
        nook_companion_core::AuthenticationFillFieldObservation {
            field_index,
            current_password: true,
            ..Default::default()
        }
    }

    #[test]
    fn credential_fill_wasm_exports_match_core_policy() {
        let plan = plan_companion_credential_fill(vec![username_field(0), password_field(1)])
            .unwrap_or_else(|error| panic!("planning failed: {error:?}"));
        assert_eq!(plan.assignments.len(), 2);

        let readonly = plan_companion_credential_fill(vec![
            nook_companion_core::AuthenticationFillFieldObservation {
                field_index: 0,
                current_password: true,
                readonly: true,
                ..Default::default()
            },
        ]);
        assert!(readonly.is_err());
    }

    #[test]
    fn credential_fill_simulation_wasm_export_matches_core_policy() {
        let credentials = simulated_authentication_credential_fixture();
        let simulated = simulate_companion_credential_fill(
            vec![username_field(0), password_field(1)],
            credentials,
        )
        .unwrap_or_else(|error| panic!("simulation failed: {error:?}"));
        assert_eq!(simulated.assignments[0].filled_with, credentials.username);
        assert_eq!(simulated.assignments[1].filled_with, credentials.password);
    }
}
