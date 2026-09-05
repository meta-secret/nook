use crate::AuthenticationFieldCount;
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
    pub username_field_count: AuthenticationFieldCount,
    pub current_password_field_count: AuthenticationFieldCount,
    pub new_password_field_count: AuthenticationFieldCount,
    pub generic_password_field_count: AuthenticationFieldCount,
    pub one_time_code_field_count: AuthenticationFieldCount,
    /// Password fields that remain writable and eligible for credential disclosure.
    pub actionable_password_field_count: AuthenticationFieldCount,
    /// Password fields whose current `readonly` state prevents credential disclosure.
    pub readonly_password_field_count: AuthenticationFieldCount,
}

impl AuthenticationFieldObservationFacts {
    pub(super) fn is_bounded(self) -> bool {
        let password_field_count = self
            .current_password_field_count
            .raw()
            .saturating_add(self.new_password_field_count.raw())
            .saturating_add(self.generic_password_field_count.raw());
        let counts_are_bounded = [
            self.username_field_count.raw(),
            self.current_password_field_count.raw(),
            self.new_password_field_count.raw(),
            self.generic_password_field_count.raw(),
            self.one_time_code_field_count.raw(),
            password_field_count,
            self.actionable_password_field_count.raw(),
            self.readonly_password_field_count.raw(),
        ]
        .into_iter()
        .all(|count| count <= crate::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT);
        counts_are_bounded
            && self
                .actionable_password_field_count
                .raw()
                .saturating_add(self.readonly_password_field_count.raw())
                == password_field_count
    }

    /// Validate that detailed control evidence describes these same fields and scope.
    #[must_use]
    pub fn is_compatible_with_detailed_control(
        self,
        observation: &AuthenticationAdvanceControlObservation,
    ) -> bool {
        self.current_password_field_count
            .raw()
            .saturating_add(self.generic_password_field_count.raw())
            .saturating_add(self.new_password_field_count.raw())
            == observation.password_field_count.raw()
            && self.new_password_field_count == observation.new_password_field_count
            && self.one_time_code_field_count == observation.one_time_code_field_count
            && (self.username_field_count.raw() > 0)
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
