//! WASM-owned objects for portable credential-fill planning.

use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CredentialFillKind {
    Username,
    CurrentPassword,
}

impl CredentialFillKind {
    const fn from_core(value: nook_companion_core::AuthenticationCredentialKind) -> Self {
        match value {
            nook_companion_core::AuthenticationCredentialKind::Username => Self::Username,
            nook_companion_core::AuthenticationCredentialKind::CurrentPassword => {
                Self::CurrentPassword
            }
        }
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CredentialFillFieldRole {
    Username,
    CurrentPassword,
    GenericPassword,
}

impl CredentialFillFieldRole {
    const fn into_core(self) -> nook_companion_core::field::CredentialRole {
        match self {
            Self::Username => nook_companion_core::field::CredentialRole::Username,
            Self::CurrentPassword => nook_companion_core::field::CredentialRole::CurrentPassword,
            Self::GenericPassword => nook_companion_core::field::CredentialRole::GenericPassword,
        }
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CredentialFillEditability {
    Writable,
    Readonly,
}

impl CredentialFillEditability {
    const fn into_core(self) -> nook_companion_core::field::Editability {
        match self {
            Self::Writable => nook_companion_core::field::Editability::Writable,
            Self::Readonly => nook_companion_core::field::Editability::Readonly,
        }
    }
}

#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct CredentialFillFieldIndex {
    inner: nook_companion_core::field::Index,
}

impl CredentialFillFieldIndex {
    const fn from_core(value: nook_companion_core::field::Index) -> Self {
        Self { inner: value }
    }

    const fn as_core(&self) -> nook_companion_core::field::Index {
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
    inner: nook_companion_core::field::Observation,
}

impl CredentialFillObservation {
    const fn as_core(&self) -> nook_companion_core::field::Observation {
        self.inner
    }
}

#[wasm_bindgen]
impl CredentialFillObservation {
    #[wasm_bindgen]
    #[must_use]
    pub fn credential(
        field_index: &CredentialFillFieldIndex,
        role: CredentialFillFieldRole,
        editability: CredentialFillEditability,
    ) -> Self {
        Self {
            inner: nook_companion_core::field::Credential {
                field_index: field_index.as_core(),
                role: role.into_core(),
                editability: editability.into_core(),
            }
            .into(),
        }
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn new_password(field_index: &CredentialFillFieldIndex) -> Self {
        Self {
            inner: nook_companion_core::field::NewPassword::from(field_index.as_core()).into(),
        }
    }

    #[wasm_bindgen]
    #[must_use]
    pub fn one_time_code(field_index: &CredentialFillFieldIndex) -> Self {
        Self {
            inner: nook_companion_core::field::OneTimeCode::from(field_index.as_core()).into(),
        }
    }
}

#[wasm_bindgen]
pub struct CredentialFillObservations {
    inner: Vec<nook_companion_core::field::Observation>,
}

#[wasm_bindgen]
impl CredentialFillObservations {
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
    fn as_core(&self) -> &[nook_companion_core::field::Observation] {
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
    inner: nook_companion_core::AuthenticationCredentialFillAssignment,
}

impl CredentialFillAssignment {
    const fn from_core(value: nook_companion_core::AuthenticationCredentialFillAssignment) -> Self {
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
    assignments: Vec<nook_companion_core::AuthenticationCredentialFillAssignment>,
}

impl CredentialFillPlan {
    fn from_core(value: nook_companion_core::AuthenticationCredentialFillPlan) -> Self {
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
    nook_companion_core::plan_authentication_credential_fill(fields.as_core())
        .map(CredentialFillPlan::from_core)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;

    fn field(field_index: u32, role: CredentialFillFieldRole) -> CredentialFillObservation {
        CredentialFillObservation::credential(
            &CredentialFillFieldIndex::new(field_index),
            role,
            CredentialFillEditability::Writable,
        )
    }

    #[test]
    fn wasm_owned_objects_delegate_to_core_policy() -> Result<(), wasm_bindgen::JsError> {
        let mut fields = CredentialFillObservations::new();
        fields.add(&field(0, CredentialFillFieldRole::Username))?;
        fields.add(&field(1, CredentialFillFieldRole::CurrentPassword))?;

        let mut plan = plan_companion_credential_fill(&fields)?;
        let assignments = plan.take_assignments();
        assert_eq!(assignments.len(), 2);
        assert_eq!(assignments[0].field_index().value(), 0);
        assert_eq!(assignments[0].credential(), CredentialFillKind::Username);
        assert_eq!(assignments[1].field_index().value(), 1);
        assert_eq!(
            assignments[1].credential(),
            CredentialFillKind::CurrentPassword
        );
        assert!(plan.take_assignments().is_empty());
        Ok(())
    }

    #[test]
    fn wasm_owned_observation_preserves_readonly_policy() -> Result<(), wasm_bindgen::JsError> {
        let readonly = CredentialFillObservation::credential(
            &CredentialFillFieldIndex::new(0),
            CredentialFillFieldRole::CurrentPassword,
            CredentialFillEditability::Readonly,
        );
        let mut fields = CredentialFillObservations::new();
        fields.add(&readonly)?;
        assert!(plan_companion_credential_fill(&fields).is_err());
        Ok(())
    }

    #[test]
    fn wasm_owned_variant_factories_preserve_unsafe_scope_policy()
    -> Result<(), wasm_bindgen::JsError> {
        for observation in [
            CredentialFillObservation::new_password(&CredentialFillFieldIndex::new(0)),
            CredentialFillObservation::one_time_code(&CredentialFillFieldIndex::new(0)),
        ] {
            let mut fields = CredentialFillObservations::new();
            fields.add(&observation)?;
            assert!(plan_companion_credential_fill(&fields).is_err());
        }
        Ok(())
    }

    #[test]
    fn wasm_owned_batch_rejects_observations_above_the_core_limit()
    -> Result<(), wasm_bindgen::JsError> {
        let observation = field(0, CredentialFillFieldRole::Username);
        let mut fields = CredentialFillObservations::new();
        for _ in 0..nook_companion_core::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT {
            fields.add(&observation)?;
        }
        assert!(fields.add(&observation).is_err());
        Ok(())
    }
}
