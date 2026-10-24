//! WASM exports for portable personal-field classification and fill planning.
//!
//! The extension's offscreen document reports page-input observations through
//! the same [`NookPageInputFieldObservation`] used by focused credential
//! recognition and receives Rust-owned structural results.

use crate::page_form_policy::NookPageInputFieldObservation;
use nook_companion_core::{
    PersonalFieldClassification, PersonalFillOpportunity, PersonalFillScope,
};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

pub use nook_companion_core::{PersonalFieldGroup, PersonalFieldKind};

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        unowned_function,
        reason = "FFI boundary: wasm-bindgen personal field classification export"
    )
)]
pub fn classify_companion_personal_field(
    field: &NookPageInputFieldObservation,
) -> Result<tsify::Ts<PersonalFieldClassification>, wasm_bindgen::JsError> {
    PersonalFieldClassification::from_page_input(field.as_core())
        .into_ts()
        .map_err(Into::into)
}

/// Observed inputs of the focused field's form scope, added in document order.
///
/// The position of each addition is the field index returned in the plan.
#[wasm_bindgen]
pub struct PersonalFillScopeObservations {
    inner: PersonalFillScope,
}

impl PersonalFillScopeObservations {
    const fn as_core(&self) -> &PersonalFillScope {
        &self.inner
    }
}

#[wasm_bindgen]
impl PersonalFillScopeObservations {
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new() -> Self {
        Self {
            inner: PersonalFillScope::new(),
        }
    }

    #[must_use]
    pub fn add_field(self, field: &NookPageInputFieldObservation) -> Self {
        Self {
            inner: self.inner.with_field(field.as_core().clone()),
        }
    }

    #[must_use]
    pub fn add_focused_field(self, field: &NookPageInputFieldObservation) -> Self {
        Self {
            inner: self.inner.with_focused_field(field.as_core().clone()),
        }
    }
}

impl Default for PersonalFillScopeObservations {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        unowned_function,
        reason = "FFI boundary: wasm-bindgen personal fill planning export"
    )
)]
pub fn plan_companion_personal_fill(
    scope: &PersonalFillScopeObservations,
) -> Result<tsify::Ts<PersonalFillOpportunity>, wasm_bindgen::JsError> {
    scope.as_core().plan().into_ts().map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_companion_core::credential_fill::field;
    use nook_companion_core::{
        PageInputType, PageSecondFactorRoute, PersonalFillField, PersonalFillPlan,
        PersonalFillUnavailability,
    };

    struct ObservationFixture<'a> {
        input_type: PageInputType,
        tokens: &'a [&'a str],
        identity_text: &'a str,
    }

    impl ObservationFixture<'_> {
        fn observation(&self) -> NookPageInputFieldObservation {
            NookPageInputFieldObservation::new(
                self.input_type,
                false,
                false,
                self.tokens
                    .iter()
                    .map(|token| (*token).to_owned())
                    .collect(),
                self.identity_text.to_owned(),
                false,
                PageSecondFactorRoute::Unrelated,
                String::new(),
                -1,
                String::new(),
            )
        }
    }

    fn address_scope() -> PersonalFillScopeObservations {
        let line1 = ObservationFixture {
            input_type: PageInputType::Text,
            tokens: &["shipping", "address-line1"],
            identity_text: "Address",
        }
        .observation();
        let city = ObservationFixture {
            input_type: PageInputType::Text,
            tokens: &[],
            identity_text: "City",
        }
        .observation();
        let password = ObservationFixture {
            input_type: PageInputType::Password,
            tokens: &["new-password"],
            identity_text: "Password",
        }
        .observation();
        PersonalFillScopeObservations::new()
            .add_focused_field(&line1)
            .add_field(&password)
            .add_field(&city)
    }

    fn address_plan() -> PersonalFillOpportunity {
        PersonalFillOpportunity::Available(PersonalFillPlan {
            group: PersonalFieldGroup::Address,
            fields: vec![
                PersonalFillField {
                    index: field::Index::ZERO,
                    kind: PersonalFieldKind::AddressLine1,
                },
                PersonalFillField {
                    index: field::Index::TWO,
                    kind: PersonalFieldKind::AddressLevel2,
                },
            ],
        })
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn scope_builder_borrows_observations_and_preserves_document_order() {
        let scope = address_scope();
        assert_eq!(scope.as_core().plan(), address_plan());
        assert_eq!(
            PersonalFillScopeObservations::default().as_core().plan(),
            PersonalFillOpportunity::Unavailable(PersonalFillUnavailability::FocusedFieldMissing)
        );
    }

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test::wasm_bindgen_test]
    fn exports_return_typed_structural_results() -> Result<(), wasm_bindgen::JsError> {
        let email = ObservationFixture {
            input_type: PageInputType::Email,
            tokens: &["email"],
            identity_text: "Email",
        }
        .observation();
        assert_eq!(
            classify_companion_personal_field(&email)?.to_rust()?,
            PersonalFieldClassification::from_page_input(email.as_core())
        );
        let PersonalFieldClassification::Classified(classified) =
            classify_companion_personal_field(&email)?.to_rust()?
        else {
            return Err(wasm_bindgen::JsError::new("email was not classified"));
        };
        assert_eq!(classified.kind, PersonalFieldKind::Email);
        assert_eq!(classified.group, PersonalFieldGroup::Person);
        assert_eq!(
            plan_companion_personal_fill(&address_scope())?.to_rust()?,
            address_plan()
        );
        let unfocused = PersonalFillScopeObservations::new().add_field(&email);
        assert_eq!(
            plan_companion_personal_fill(&unfocused)?.to_rust()?,
            PersonalFillOpportunity::Unavailable(PersonalFillUnavailability::FocusedFieldMissing)
        );
        Ok(())
    }
}
