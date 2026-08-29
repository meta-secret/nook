use crate::page_field_classification::{
    AuthenticationAdvanceControlObservation, AuthenticationUsernameEvidence, PageControlOwnership,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

/// Raw, non-secret field facts observed inside one authentication scope.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthenticationFieldObservationFacts {
    pub username_field_count: u32,
    pub current_password_field_count: u32,
    pub new_password_field_count: u32,
    pub generic_password_field_count: u32,
    pub one_time_code_field_count: u32,
}

impl AuthenticationFieldObservationFacts {
    /// Validate that detailed control evidence describes these same fields and scope.
    #[must_use]
    pub fn is_compatible_with_detailed_control(
        self,
        observation: &AuthenticationAdvanceControlObservation,
    ) -> bool {
        self.current_password_field_count
            .saturating_add(self.generic_password_field_count)
            .saturating_add(self.new_password_field_count)
            == observation.password_field_count
            && self.new_password_field_count == observation.new_password_field_count
            && self.one_time_code_field_count == observation.one_time_code_field_count
            && (self.username_field_count > 0)
                != matches!(
                    observation.authentication_username,
                    AuthenticationUsernameEvidence::Absent
                )
            && matches!(
                observation.ownership,
                PageControlOwnership::OwnedForm | PageControlOwnership::LocallyScoped
            )
    }
}
