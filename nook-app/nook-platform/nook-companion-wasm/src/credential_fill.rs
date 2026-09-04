//! WASM-owned objects for portable credential-fill planning.

use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct CredentialFillFieldRole {
    inner: nook_companion_core::credential_fill::field::CredentialRole,
}

#[wasm_bindgen]
impl CredentialFillFieldRole {
    #[must_use]
    pub fn username() -> Self {
        Self {
            inner: nook_companion_core::credential_fill::field::CredentialRole::Username,
        }
    }

    #[must_use]
    pub fn current_password() -> Self {
        Self {
            inner: nook_companion_core::credential_fill::field::CredentialRole::Password(
                nook_companion_core::credential_fill::field::Password::Current,
            ),
        }
    }

    #[must_use]
    pub fn generic_password() -> Self {
        Self {
            inner: nook_companion_core::credential_fill::field::CredentialRole::Password(
                nook_companion_core::credential_fill::field::Password::Generic,
            ),
        }
    }
}

#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct CredentialFillEditability {
    inner: nook_companion_core::credential_fill::field::Editability,
}

#[wasm_bindgen]
impl CredentialFillEditability {
    #[must_use]
    pub fn writable() -> Self {
        Self {
            inner: nook_companion_core::credential_fill::field::Editability::Writable,
        }
    }

    #[must_use]
    pub fn readonly() -> Self {
        Self {
            inner: nook_companion_core::credential_fill::field::Editability::Readonly,
        }
    }
}

#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct CredentialFillFieldIndex {
    inner: nook_companion_core::credential_fill::field::Index,
}

impl CredentialFillFieldIndex {
    const fn from_core(value: nook_companion_core::credential_fill::field::Index) -> Self {
        Self { inner: value }
    }

    const fn as_core(&self) -> nook_companion_core::credential_fill::field::Index {
        self.inner
    }
}

#[wasm_bindgen]
impl CredentialFillFieldIndex {
    #[must_use]
    pub fn zero() -> Self {
        Self::from_core(nook_companion_core::credential_fill::field::Index::ZERO)
    }

    #[must_use]
    pub fn one() -> Self {
        Self::from_core(nook_companion_core::credential_fill::field::Index::ONE)
    }

    #[must_use]
    pub fn two() -> Self {
        Self::from_core(nook_companion_core::credential_fill::field::Index::TWO)
    }

    #[must_use]
    pub fn three() -> Self {
        Self::from_core(nook_companion_core::credential_fill::field::Index::THREE)
    }

    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new(value: u32) -> Self {
        Self {
            inner: value.into(),
        }
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn value(&self) -> u32 {
        self.inner.value
    }
}

#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct CredentialFillObservationCount {
    inner: nook_companion_core::credential_fill::field::Count,
}

impl CredentialFillObservationCount {
    const fn from_core(value: nook_companion_core::credential_fill::field::Count) -> Self {
        Self { inner: value }
    }
}

#[wasm_bindgen]
impl CredentialFillObservationCount {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn value(&self) -> u32 {
        self.inner.value
    }
}

#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct CredentialFillObservation {
    inner: nook_companion_core::credential_fill::field::Observation,
}

impl CredentialFillObservation {
    const fn as_core(&self) -> nook_companion_core::credential_fill::field::Observation {
        self.inner
    }
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
            inner: nook_companion_core::credential_fill::field::Credential {
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
            inner: nook_companion_core::credential_fill::field::NewPassword::from(
                field_index.as_core(),
            )
            .into(),
        }
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn one_time_code(field_index: &CredentialFillFieldIndex) -> Self {
        Self {
            inner: nook_companion_core::credential_fill::field::OneTimeCode::from(
                field_index.as_core(),
            )
            .into(),
        }
    }
}

#[wasm_bindgen]
pub struct CredentialFillObservations {
    inner: Result<
        Vec<nook_companion_core::credential_fill::field::Observation>,
        nook_companion_core::credential_fill::CredentialFillRejection,
    >,
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
            self.inner = Err(
                nook_companion_core::credential_fill::CredentialFillRejection::TooManyObservedFields,
            );
            return;
        }
        fields.push(observation.as_core());
    }
}

impl CredentialFillObservations {
    const fn maximum_count() -> nook_companion_core::credential_fill::field::Count {
        nook_companion_core::credential_fill::field::Count::MAXIMUM
    }

    fn as_core(
        &self,
    ) -> Result<
        &[nook_companion_core::credential_fill::field::Observation],
        nook_companion_core::credential_fill::CredentialFillRejection,
    > {
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
    inner: nook_companion_core::credential_fill::Assignment,
}

impl CredentialFillAssignment {
    const fn from_core(value: nook_companion_core::credential_fill::Assignment) -> Self {
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
    pub fn credential(&self) -> nook_companion_core::credential_fill::CredentialKind {
        self.inner.credential
    }
}

#[wasm_bindgen]
pub struct CredentialFillPlan {
    assignments: Vec<nook_companion_core::credential_fill::Assignment>,
}

impl CredentialFillPlan {
    fn from_core(value: nook_companion_core::credential_fill::Plan) -> Self {
        Self {
            assignments: value.assignments,
        }
    }
}

#[wasm_bindgen]
impl CredentialFillPlan {
    #[must_use]
    pub fn take_assignments(&mut self) -> Vec<CredentialFillAssignment> {
        std::mem::take(&mut self.assignments)
            .into_iter()
            .map(CredentialFillAssignment::from_core)
            .collect()
    }
}

enum CredentialFillResultState {
    Planned(nook_companion_core::credential_fill::Plan),
    Rejected(nook_companion_core::credential_fill::CredentialFillRejection),
}

#[wasm_bindgen]
pub struct CredentialFillResult {
    inner: CredentialFillResultState,
}

impl CredentialFillResult {
    fn from_core(
        value: Result<
            nook_companion_core::credential_fill::Plan,
            nook_companion_core::credential_fill::CredentialFillRejection,
        >,
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
    pub fn kind(&self) -> nook_companion_core::credential_fill::CredentialFillPlanningOutcome {
        match &self.inner {
            CredentialFillResultState::Planned(_) => {
                nook_companion_core::credential_fill::CredentialFillPlanningOutcome::Planned
            }
            CredentialFillResultState::Rejected(_) => {
                nook_companion_core::credential_fill::CredentialFillPlanningOutcome::Rejected
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
    ) -> Result<nook_companion_core::credential_fill::CredentialFillRejection, wasm_bindgen::JsError>
    {
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
            .and_then(nook_companion_core::credential_fill::plan),
    )
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;

    fn field(
        field_index: nook_companion_core::credential_fill::field::Index,
        role: &CredentialFillFieldRole,
    ) -> CredentialFillObservation {
        CredentialFillObservation::credential(
            &CredentialFillFieldIndex::from_core(field_index),
            role,
            &CredentialFillEditability::writable(),
        )
    }

    #[test]
    fn field_index_factories_match_the_core_constants() {
        for (field_index, expected) in [
            (
                CredentialFillFieldIndex::zero(),
                nook_companion_core::credential_fill::field::Index::ZERO,
            ),
            (
                CredentialFillFieldIndex::one(),
                nook_companion_core::credential_fill::field::Index::ONE,
            ),
            (
                CredentialFillFieldIndex::two(),
                nook_companion_core::credential_fill::field::Index::TWO,
            ),
            (
                CredentialFillFieldIndex::three(),
                nook_companion_core::credential_fill::field::Index::THREE,
            ),
        ] {
            assert_eq!(field_index.as_core(), expected);
        }
    }

    #[test]
    fn wasm_owned_objects_delegate_to_core_policy() -> Result<(), wasm_bindgen::JsError> {
        let mut fields = CredentialFillObservations::new();
        fields.add(&field(
            nook_companion_core::credential_fill::field::Index::ZERO,
            &CredentialFillFieldRole::username(),
        ));
        fields.add(&field(
            nook_companion_core::credential_fill::field::Index::ONE,
            &CredentialFillFieldRole::current_password(),
        ));

        let result = plan_companion_credential_fill(&fields);
        assert_eq!(
            result.kind(),
            nook_companion_core::credential_fill::CredentialFillPlanningOutcome::Planned
        );
        let mut plan = result.plan()?;
        let assignments = plan.take_assignments();
        assert_eq!(assignments.len(), 2);
        assert_eq!(
            assignments[0].field_index().as_core(),
            nook_companion_core::credential_fill::field::Index::ZERO
        );
        assert_eq!(
            assignments[0].credential(),
            nook_companion_core::credential_fill::CredentialKind::Username
        );
        assert_eq!(
            assignments[1].field_index().as_core(),
            nook_companion_core::credential_fill::field::Index::ONE
        );
        assert_eq!(
            assignments[1].credential(),
            nook_companion_core::credential_fill::CredentialKind::CurrentPassword
        );
        assert!(plan.take_assignments().is_empty());
        Ok(())
    }

    #[test]
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
            nook_companion_core::credential_fill::CredentialFillPlanningOutcome::Rejected
        );
        assert_eq!(
            result.rejection()?,
            nook_companion_core::credential_fill::CredentialFillRejection::PasswordFieldsReadonly
        );
        Ok(())
    }

    #[test]
    fn observation_overflow_is_typed_terminal_and_keeps_the_input_borrowed()
    -> Result<(), wasm_bindgen::JsError> {
        let observation = field(
            nook_companion_core::credential_fill::field::Index::ZERO,
            &CredentialFillFieldRole::username(),
        );
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
                nook_companion_core::credential_fill::CredentialFillPlanningOutcome::Rejected
            );
            assert_eq!(
                result.rejection()?,
                nook_companion_core::credential_fill::CredentialFillRejection::TooManyObservedFields
            );
        }

        let mut reusable_fields = CredentialFillObservations::new();
        reusable_fields.add(&observation);
        let result = plan_companion_credential_fill(&reusable_fields);
        assert_eq!(
            result.kind(),
            nook_companion_core::credential_fill::CredentialFillPlanningOutcome::Planned
        );
        Ok(())
    }
}
