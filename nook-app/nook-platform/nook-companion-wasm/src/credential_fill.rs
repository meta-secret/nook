//! WASM-owned objects for portable credential-fill planning.

use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct CredentialFillKind {
    inner: nook_companion_core::credential_fill::CredentialKind,
}

impl CredentialFillKind {
    const fn from_core(value: nook_companion_core::credential_fill::CredentialKind) -> Self {
        Self { inner: value }
    }
}

#[wasm_bindgen]
impl CredentialFillKind {
    #[must_use]
    pub fn is_username(&self) -> bool {
        self.inner == nook_companion_core::credential_fill::CredentialKind::Username
    }

    #[must_use]
    pub fn is_current_password(&self) -> bool {
        self.inner == nook_companion_core::credential_fill::CredentialKind::CurrentPassword
    }
}

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
            inner: nook_companion_core::credential_fill::field::CredentialRole::CurrentPassword,
        }
    }

    #[must_use]
    pub fn generic_password() -> Self {
        Self {
            inner: nook_companion_core::credential_fill::field::CredentialRole::GenericPassword,
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
    pub fn max_count() -> u32 {
        nook_companion_core::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT
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
        if self.inner.len() >= nook_companion_core::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT as usize
        {
            return Err(wasm_bindgen::JsError::new(
                "the observed scope exceeds the field-count limit",
            ));
        }
        self.inner.push(observation.as_core());
        Ok(())
    }
}

impl CredentialFillObservations {
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
    pub fn credential(&self) -> CredentialFillKind {
        CredentialFillKind::from_core(self.inner.credential)
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

#[wasm_bindgen]
pub fn plan_companion_credential_fill(
    fields: &CredentialFillObservations,
) -> Result<CredentialFillPlan, wasm_bindgen::JsError> {
    nook_companion_core::credential_fill::plan(fields.as_core())
        .map(CredentialFillPlan::from_core)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
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

        let mut plan = plan_companion_credential_fill(&fields)?;
        let assignments = plan.take_assignments();
        assert_eq!(assignments.len(), 2);
        assert_eq!(assignments[0].field_index().value(), 0);
        assert!(assignments[0].credential().is_username());
        assert_eq!(assignments[1].field_index().value(), 1);
        assert!(assignments[1].credential().is_current_password());
        assert!(plan.take_assignments().is_empty());
        Ok(())
    }
}
