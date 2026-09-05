//! WASM-owned objects for portable credential-fill planning.

use std::mem;

use crate::page_form_policy::NookPageInputFieldObservation;
use nook_companion_core::credential_fill::{self, field};
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct CredentialFillFieldRole {
    inner: field::CredentialRole,
}

#[wasm_bindgen]
impl CredentialFillFieldRole {
    #[must_use]
    pub fn username() -> Self {
        Self {
            inner: field::CredentialRole::Username,
        }
    }

    #[must_use]
    pub fn current_password() -> Self {
        Self {
            inner: field::CredentialRole::Password(field::Password::Current),
        }
    }

    #[must_use]
    pub fn generic_password() -> Self {
        Self {
            inner: field::CredentialRole::Password(field::Password::Generic),
        }
    }
}

#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct CredentialFillEditability {
    inner: field::Editability,
}

#[wasm_bindgen]
impl CredentialFillEditability {
    #[must_use]
    pub fn writable() -> Self {
        Self {
            inner: field::Editability::Writable,
        }
    }

    #[must_use]
    pub fn readonly() -> Self {
        Self {
            inner: field::Editability::Readonly,
        }
    }
}

#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct CredentialFillFieldIndex {
    inner: field::Index,
}

impl CredentialFillFieldIndex {
    const fn from_core(value: field::Index) -> Self {
        Self { inner: value }
    }

    const fn as_core(&self) -> field::Index {
        self.inner
    }
}

#[wasm_bindgen]
impl CredentialFillFieldIndex {
    #[must_use]
    pub fn zero() -> Self {
        Self::from_core(field::Index::ZERO)
    }

    #[must_use]
    pub fn one() -> Self {
        Self::from_core(field::Index::ONE)
    }

    #[must_use]
    pub fn two() -> Self {
        Self::from_core(field::Index::TWO)
    }

    #[must_use]
    pub fn three() -> Self {
        Self::from_core(field::Index::THREE)
    }

    #[wasm_bindgen(constructor)]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: converts a JavaScript field index into its Rust domain type"
        )
    )]
    pub fn new(value: u32) -> Self {
        Self {
            inner: value.into(),
        }
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: exposes the typed field index to JavaScript"
        )
    )]
    pub fn value(&self) -> u32 {
        self.inner.value
    }
}

#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct CredentialFillObservationCount {
    inner: field::Count,
}

impl CredentialFillObservationCount {
    const fn from_core(value: field::Count) -> Self {
        Self { inner: value }
    }
}

#[wasm_bindgen]
impl CredentialFillObservationCount {
    #[wasm_bindgen(getter)]
    #[must_use]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: exposes the typed observation count to JavaScript"
        )
    )]
    pub fn value(&self) -> u32 {
        self.inner.value
    }
}

#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct CredentialFillObservation {
    inner: field::Observation,
}

impl CredentialFillObservation {
    const fn as_core(&self) -> field::Observation {
        self.inner
    }
}

#[wasm_bindgen]
pub struct CredentialFillFieldClassification {
    inner: field::Classification,
}

impl CredentialFillFieldClassification {
    const fn from_core(value: field::Classification) -> Self {
        Self { inner: value }
    }
}

#[wasm_bindgen]
impl CredentialFillFieldClassification {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn kind(&self) -> credential_fill::CredentialFillFieldClassificationOutcome {
        self.inner.outcome()
    }

    pub fn observation(&self) -> Result<CredentialFillObservation, wasm_bindgen::JsError> {
        let field::Classification::Observed(observed) = self.inner else {
            return Err(wasm_bindgen::JsError::new(
                "an ignored credential-fill field classification has no observation",
            ));
        };
        Ok(CredentialFillObservation {
            inner: observed.observation,
        })
    }
}

#[wasm_bindgen]
#[must_use]
pub fn classify_companion_credential_fill_field(
    field_index: &CredentialFillFieldIndex,
    field: &NookPageInputFieldObservation,
) -> CredentialFillFieldClassification {
    CredentialFillFieldClassification::from_core(field::Classification::from_page_input(
        field_index.as_core(),
        field.as_core(),
    ))
}

#[wasm_bindgen]
impl CredentialFillObservation {
    #[wasm_bindgen]
    #[must_use]
    pub fn credential(
        field_index: &CredentialFillFieldIndex,
        role: &CredentialFillFieldRole,
        editability: &CredentialFillEditability,
    ) -> Self {
        Self {
            inner: field::Credential {
                field_index: field_index.as_core(),
                role: role.inner,
                editability: editability.inner,
            }
            .into(),
        }
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn new_password(field_index: &CredentialFillFieldIndex) -> Self {
        Self {
            inner: field::NewPassword::from(field_index.as_core()).into(),
        }
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn one_time_code(field_index: &CredentialFillFieldIndex) -> Self {
        Self {
            inner: field::OneTimeCode::from(field_index.as_core()).into(),
        }
    }
}

#[wasm_bindgen]
pub struct CredentialFillObservations {
    inner: Result<Vec<field::Observation>, credential_fill::CredentialFillRejection>,
}

#[wasm_bindgen]
impl CredentialFillObservations {
    #[must_use]
    pub fn max_count() -> CredentialFillObservationCount {
        CredentialFillObservationCount::from_core(Self::maximum_count())
    }

    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new() -> Self {
        Self {
            inner: Ok(Vec::new()),
        }
    }

    pub fn add(&mut self, observation: &CredentialFillObservation) {
        let Ok(fields) = &mut self.inner else {
            return;
        };
        if fields.len() >= Self::maximum_count().value as usize {
            self.inner = Err(credential_fill::CredentialFillRejection::TooManyObservedFields);
            return;
        }
        fields.push(observation.as_core());
    }
}

impl CredentialFillObservations {
    const fn maximum_count() -> field::Count {
        field::Count::MAXIMUM
    }

    fn as_core(&self) -> Result<&[field::Observation], credential_fill::CredentialFillRejection> {
        self.inner.as_deref().map_err(|rejection| *rejection)
    }
}

impl Default for CredentialFillObservations {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
pub struct CredentialFillAssignment {
    inner: credential_fill::Assignment,
}

impl CredentialFillAssignment {
    const fn from_core(value: credential_fill::Assignment) -> Self {
        Self { inner: value }
    }
}

#[wasm_bindgen]
impl CredentialFillAssignment {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn field_index(&self) -> CredentialFillFieldIndex {
        CredentialFillFieldIndex::from_core(self.inner.field_index)
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn credential(&self) -> credential_fill::CredentialKind {
        self.inner.credential
    }
}

#[wasm_bindgen]
pub struct CredentialFillPlan {
    assignments: Vec<credential_fill::Assignment>,
}

impl CredentialFillPlan {
    fn from_core(value: credential_fill::Plan) -> Self {
        Self {
            assignments: value.assignments,
        }
    }
}

#[wasm_bindgen]
impl CredentialFillPlan {
    #[must_use]
    pub fn take_assignments(&mut self) -> Vec<CredentialFillAssignment> {
        mem::take(&mut self.assignments)
            .into_iter()
            .map(CredentialFillAssignment::from_core)
            .collect()
    }
}

enum CredentialFillResultState {
    Planned(credential_fill::Plan),
    Rejected(credential_fill::CredentialFillRejection),
}

#[wasm_bindgen]
pub struct CredentialFillResult {
    inner: CredentialFillResultState,
}

impl CredentialFillResult {
    fn from_core(
        value: Result<credential_fill::Plan, credential_fill::CredentialFillRejection>,
    ) -> Self {
        let inner = match value {
            Ok(plan) => CredentialFillResultState::Planned(plan),
            Err(rejection) => CredentialFillResultState::Rejected(rejection),
        };
        Self { inner }
    }
}

#[wasm_bindgen]
impl CredentialFillResult {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn kind(&self) -> credential_fill::CredentialFillPlanningOutcome {
        match &self.inner {
            CredentialFillResultState::Planned(_) => {
                credential_fill::CredentialFillPlanningOutcome::Planned
            }
            CredentialFillResultState::Rejected(_) => {
                credential_fill::CredentialFillPlanningOutcome::Rejected
            }
        }
    }

    pub fn plan(&self) -> Result<CredentialFillPlan, wasm_bindgen::JsError> {
        let CredentialFillResultState::Planned(plan) = &self.inner else {
            return Err(wasm_bindgen::JsError::new(
                "a rejected credential-fill result has no plan",
            ));
        };
        Ok(CredentialFillPlan::from_core(plan.clone()))
    }

    pub fn rejection(
        &self,
    ) -> Result<credential_fill::CredentialFillRejection, wasm_bindgen::JsError> {
        let CredentialFillResultState::Rejected(rejection) = &self.inner else {
            return Err(wasm_bindgen::JsError::new(
                "a planned credential-fill result has no rejection",
            ));
        };
        Ok(*rejection)
    }
}

#[wasm_bindgen]
pub fn plan_companion_credential_fill(fields: &CredentialFillObservations) -> CredentialFillResult {
    CredentialFillResult::from_core(
        fields
            .as_core()
            .and_then(credential_fill::Plan::from_fields),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn field(
        field_index: field::Index,
        role: &CredentialFillFieldRole,
    ) -> CredentialFillObservation {
        CredentialFillObservation::credential(
            &CredentialFillFieldIndex::from_core(field_index),
            role,
            &CredentialFillEditability::writable(),
        )
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn field_index_factories_match_the_core_constants() {
        for (field_index, expected) in [
            (CredentialFillFieldIndex::zero(), field::Index::ZERO),
            (CredentialFillFieldIndex::one(), field::Index::ONE),
            (CredentialFillFieldIndex::two(), field::Index::TWO),
            (CredentialFillFieldIndex::three(), field::Index::THREE),
        ] {
            assert_eq!(field_index.as_core(), expected);
        }
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn classifier_returns_an_owned_observation_from_borrowed_inputs()
    -> Result<(), wasm_bindgen::JsError> {
        let field_index = CredentialFillFieldIndex::two();
        let page_field = NookPageInputFieldObservation::new(
            nook_companion_core::PageInputType::Password,
            false,
            true,
            vec!["current-password".to_owned()],
            "password".to_owned(),
            true,
        );

        let classification = classify_companion_credential_fill_field(&field_index, &page_field);
        assert_eq!(
            classification.kind(),
            credential_fill::CredentialFillFieldClassificationOutcome::Observed
        );
        let observation = classification.observation()?;
        assert_eq!(
            observation.as_core(),
            field::Observation::from(field::Credential {
                field_index: field::Index::TWO,
                role: field::CredentialRole::Password(field::Password::Current,),
                editability: field::Editability::Readonly,
            },)
        );
        assert_eq!(field_index.as_core(), field::Index::TWO);
        assert_eq!(
            page_field.as_core().input_type,
            nook_companion_core::PageInputType::Password
        );
        Ok(())
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn classifier_returns_typed_ignored_for_an_unrelated_input() {
        let field_index = CredentialFillFieldIndex::three();
        let page_field = NookPageInputFieldObservation::new(
            nook_companion_core::PageInputType::Text,
            false,
            false,
            Vec::new(),
            "search".to_owned(),
            false,
        );

        let classification = classify_companion_credential_fill_field(&field_index, &page_field);
        assert_eq!(
            classification.kind(),
            credential_fill::CredentialFillFieldClassificationOutcome::Ignored
        );
        assert!(matches!(
            classification.inner,
            field::Classification::Ignored(field::Ignored {
                field_index: field::Index::THREE
            })
        ));
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn wasm_owned_objects_delegate_to_core_policy() -> Result<(), wasm_bindgen::JsError> {
        let mut fields = CredentialFillObservations::new();
        fields.add(&field(
            field::Index::ZERO,
            &CredentialFillFieldRole::username(),
        ));
        fields.add(&field(
            field::Index::ONE,
            &CredentialFillFieldRole::current_password(),
        ));

        let result = plan_companion_credential_fill(&fields);
        assert_eq!(
            result.kind(),
            credential_fill::CredentialFillPlanningOutcome::Planned
        );
        let mut plan = result.plan()?;
        let assignments = plan.take_assignments();
        assert_eq!(assignments.len(), 2);
        assert_eq!(assignments[0].field_index().as_core(), field::Index::ZERO);
        assert_eq!(
            assignments[0].credential(),
            credential_fill::CredentialKind::Username
        );
        assert_eq!(assignments[1].field_index().as_core(), field::Index::ONE);
        assert_eq!(
            assignments[1].credential(),
            credential_fill::CredentialKind::CurrentPassword
        );
        assert!(plan.take_assignments().is_empty());
        Ok(())
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn rejected_result_exposes_the_typed_core_rejection() -> Result<(), wasm_bindgen::JsError> {
        let field_index = CredentialFillFieldIndex::zero();
        let observation = CredentialFillObservation::credential(
            &field_index,
            &CredentialFillFieldRole::current_password(),
            &CredentialFillEditability::readonly(),
        );
        let mut fields = CredentialFillObservations::new();
        fields.add(&observation);

        let result = plan_companion_credential_fill(&fields);
        assert_eq!(
            result.kind(),
            credential_fill::CredentialFillPlanningOutcome::Rejected
        );
        assert_eq!(
            result.rejection()?,
            credential_fill::CredentialFillRejection::PasswordFieldsReadonly
        );
        Ok(())
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn observation_overflow_is_typed_terminal_and_keeps_the_input_borrowed()
    -> Result<(), wasm_bindgen::JsError> {
        let observation = field(field::Index::ZERO, &CredentialFillFieldRole::username());
        let expected_observation = observation.as_core();
        let mut fields = CredentialFillObservations::new();
        for _ in 0..CredentialFillObservations::maximum_count().value {
            fields.add(&observation);
        }

        fields.add(&observation);
        fields.add(&observation);
        assert_eq!(observation.as_core(), expected_observation);

        for _ in 0..2 {
            let result = plan_companion_credential_fill(&fields);
            assert_eq!(
                result.kind(),
                credential_fill::CredentialFillPlanningOutcome::Rejected
            );
            assert_eq!(
                result.rejection()?,
                credential_fill::CredentialFillRejection::TooManyObservedFields
            );
        }

        let mut reusable_fields = CredentialFillObservations::new();
        reusable_fields.add(&observation);
        let result = plan_companion_credential_fill(&reusable_fields);
        assert_eq!(
            result.kind(),
            credential_fill::CredentialFillPlanningOutcome::Planned
        );
        Ok(())
    }
}
