//! Typed WASM bindings for portable credential-fill planning.

use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn plan_companion_credential_fill(
    fields: Vec<nook_companion_core::AuthenticationFillFieldObservation>,
) -> Result<nook_companion_core::AuthenticationCredentialFillPlan, wasm_bindgen::JsError> {
    nook_companion_core::plan_authentication_credential_fill(&fields)
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
    fn credential_fill_wrapper_delegates_to_core_policy() -> Result<(), wasm_bindgen::JsError> {
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
}
