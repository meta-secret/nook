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
    inner: Vec<nook_companion_core::credential_fill::field::Observation>,
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
        Self { inner: Vec::new() }
    }

    pub fn add(
        &mut self,
        observation: &CredentialFillObservation,
    ) -> Result<(), wasm_bindgen::JsError> {
        if self.inner.len() >= Self::maximum_count().value as usize {
            return Err(wasm_bindgen::JsError::new(
                "the observed scope exceeds the field-count limit",
            ));
        }
        self.inner.push(observation.as_core());
        Ok(())
    }
}

impl CredentialFillObservations {
    fn maximum_count() -> nook_companion_core::credential_fill::field::Count {
        nook_companion_core::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT.into()
    }

    fn as_core(&self) -> &[nook_companion_core::credential_fill::field::Observation] {
        &self.inner
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
    Rejected(nook_companion_core::credential_fill::Rejection),
}

#[wasm_bindgen]
pub struct CredentialFillResult {
    inner: CredentialFillResultState,
}

impl CredentialFillResult {
    fn from_core(
        value: Result<
            nook_companion_core::credential_fill::Plan,
            nook_companion_core::credential_fill::Rejection,
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
    pub fn kind(&self) -> nook_companion_core::credential_fill::PlanningOutcome {
        match &self.inner {
            CredentialFillResultState::Planned(_) => {
                nook_companion_core::credential_fill::PlanningOutcome::Planned
            }
            CredentialFillResultState::Rejected(_) => {
                nook_companion_core::credential_fill::PlanningOutcome::Rejected
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
    ) -> Result<nook_companion_core::credential_fill::Rejection, wasm_bindgen::JsError> {
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
    CredentialFillResult::from_core(nook_companion_core::credential_fill::plan(fields.as_core()))
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;

    fn field(field_index: u32, role: &CredentialFillFieldRole) -> CredentialFillObservation {
        CredentialFillObservation::credential(
            &CredentialFillFieldIndex::new(field_index),
            role,
            &CredentialFillEditability::writable(),
        )
    }

    #[test]
    fn wasm_owned_objects_delegate_to_core_policy() -> Result<(), wasm_bindgen::JsError> {
        let mut fields = CredentialFillObservations::new();
        fields.add(&field(0, &CredentialFillFieldRole::username()))?;
        fields.add(&field(1, &CredentialFillFieldRole::current_password()))?;

        let result = plan_companion_credential_fill(&fields);
        assert_eq!(
            result.kind(),
            nook_companion_core::credential_fill::PlanningOutcome::Planned
        );
        let mut plan = result.plan()?;
        let assignments = plan.take_assignments();
        assert_eq!(assignments.len(), 2);
        assert_eq!(assignments[0].field_index().value(), 0);
        assert_eq!(
            assignments[0].credential(),
            nook_companion_core::credential_fill::CredentialKind::Username
        );
        assert_eq!(assignments[1].field_index().value(), 1);
        assert_eq!(
            assignments[1].credential(),
            nook_companion_core::credential_fill::CredentialKind::CurrentPassword
        );
        assert!(plan.take_assignments().is_empty());
        Ok(())
    }

    #[test]
    fn rejected_result_exposes_the_typed_core_rejection() -> Result<(), wasm_bindgen::JsError> {
        let field_index = CredentialFillFieldIndex::new(0);
        let observation = CredentialFillObservation::credential(
            &field_index,
            &CredentialFillFieldRole::current_password(),
            &CredentialFillEditability::readonly(),
        );
        let mut fields = CredentialFillObservations::new();
        fields.add(&observation)?;

        let result = plan_companion_credential_fill(&fields);
        assert_eq!(
            result.kind(),
            nook_companion_core::credential_fill::PlanningOutcome::Rejected
        );
        assert_eq!(
            result.rejection()?,
            nook_companion_core::credential_fill::Rejection::PasswordFieldsReadonly
        );
        Ok(())
    }
}
