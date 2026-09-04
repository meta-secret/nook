//! WASM-owned objects for portable credential-fill planning.

use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthenticationCredentialKind {
    Username,
    CurrentPassword,
}

impl AuthenticationCredentialKind {
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
pub enum AuthenticationFillFieldRole {
    Username,
    CurrentPassword,
    GenericPassword,
    NewPassword,
    OneTimeCode,
}

impl AuthenticationFillFieldRole {
    const fn into_core(self) -> nook_companion_core::AuthenticationFillFieldRole {
        match self {
            Self::Username => nook_companion_core::AuthenticationFillFieldRole::Username,
            Self::CurrentPassword => {
                nook_companion_core::AuthenticationFillFieldRole::CurrentPassword
            }
            Self::GenericPassword => {
                nook_companion_core::AuthenticationFillFieldRole::GenericPassword
            }
            Self::NewPassword => nook_companion_core::AuthenticationFillFieldRole::NewPassword,
            Self::OneTimeCode => nook_companion_core::AuthenticationFillFieldRole::OneTimeCode,
        }
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthenticationFillFieldEditability {
    Writable,
    Readonly,
}

impl AuthenticationFillFieldEditability {
    const fn into_core(self) -> nook_companion_core::AuthenticationFillFieldEditability {
        match self {
            Self::Writable => nook_companion_core::AuthenticationFillFieldEditability::Writable,
            Self::Readonly => nook_companion_core::AuthenticationFillFieldEditability::Readonly,
        }
    }
}

#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct AuthenticationFillFieldIndex {
    inner: nook_companion_core::AuthenticationFillFieldIndex,
}

impl AuthenticationFillFieldIndex {
    const fn from_core(value: nook_companion_core::AuthenticationFillFieldIndex) -> Self {
        Self { inner: value }
    }

    const fn as_core(&self) -> nook_companion_core::AuthenticationFillFieldIndex {
        self.inner
    }
}

#[wasm_bindgen]
impl AuthenticationFillFieldIndex {
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new(value: u32) -> Self {
        Self {
            inner: nook_companion_core::AuthenticationFillFieldIndex::new(value),
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
pub struct AuthenticationFillFieldObservation {
    inner: nook_companion_core::AuthenticationFillFieldObservation,
}

impl AuthenticationFillFieldObservation {
    const fn as_core(&self) -> nook_companion_core::AuthenticationFillFieldObservation {
        self.inner
    }
}

#[wasm_bindgen]
impl AuthenticationFillFieldObservation {
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new(
        field_index: &AuthenticationFillFieldIndex,
        role: AuthenticationFillFieldRole,
        editability: AuthenticationFillFieldEditability,
    ) -> Self {
        Self {
            inner: nook_companion_core::AuthenticationFillFieldObservation {
                field_index: field_index.as_core(),
                role: role.into_core(),
                editability: editability.into_core(),
            },
        }
    }
}

#[wasm_bindgen]
pub struct AuthenticationFillFieldObservations {
    inner: Vec<nook_companion_core::AuthenticationFillFieldObservation>,
}

#[wasm_bindgen]
impl AuthenticationFillFieldObservations {
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new() -> Self {
        Self { inner: Vec::new() }
    }

    pub fn add(
        &mut self,
        observation: &AuthenticationFillFieldObservation,
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

impl AuthenticationFillFieldObservations {
    fn as_core(&self) -> &[nook_companion_core::AuthenticationFillFieldObservation] {
        &self.inner
    }
}

impl Default for AuthenticationFillFieldObservations {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
pub struct AuthenticationCredentialFillAssignment {
    inner: nook_companion_core::AuthenticationCredentialFillAssignment,
}

impl AuthenticationCredentialFillAssignment {
    const fn from_core(value: nook_companion_core::AuthenticationCredentialFillAssignment) -> Self {
        Self { inner: value }
    }
}

#[wasm_bindgen]
impl AuthenticationCredentialFillAssignment {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn field_index(&self) -> AuthenticationFillFieldIndex {
        AuthenticationFillFieldIndex::from_core(self.inner.field_index)
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn credential(&self) -> AuthenticationCredentialKind {
        AuthenticationCredentialKind::from_core(self.inner.credential)
    }
}

#[wasm_bindgen]
pub struct AuthenticationCredentialFillPlan {
    assignments: Vec<nook_companion_core::AuthenticationCredentialFillAssignment>,
}

impl AuthenticationCredentialFillPlan {
    fn from_core(value: nook_companion_core::AuthenticationCredentialFillPlan) -> Self {
        Self {
            assignments: value.assignments,
        }
    }
}

#[wasm_bindgen]
impl AuthenticationCredentialFillPlan {
    #[must_use]
    pub fn take_assignments(&mut self) -> Vec<AuthenticationCredentialFillAssignment> {
        std::mem::take(&mut self.assignments)
            .into_iter()
            .map(AuthenticationCredentialFillAssignment::from_core)
            .collect()
    }
}

#[wasm_bindgen]
pub fn plan_companion_credential_fill(
    fields: &AuthenticationFillFieldObservations,
) -> Result<AuthenticationCredentialFillPlan, wasm_bindgen::JsError> {
    nook_companion_core::plan_authentication_credential_fill(fields.as_core())
        .map(AuthenticationCredentialFillPlan::from_core)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;

    fn field(
        field_index: u32,
        role: AuthenticationFillFieldRole,
    ) -> AuthenticationFillFieldObservation {
        AuthenticationFillFieldObservation::new(
            &AuthenticationFillFieldIndex::new(field_index),
            role,
            AuthenticationFillFieldEditability::Writable,
        )
    }

    #[test]
    fn wasm_owned_objects_delegate_to_core_policy() -> Result<(), wasm_bindgen::JsError> {
        let mut fields = AuthenticationFillFieldObservations::new();
        fields.add(&field(0, AuthenticationFillFieldRole::Username))?;
        fields.add(&field(1, AuthenticationFillFieldRole::CurrentPassword))?;

        let mut plan = plan_companion_credential_fill(&fields)?;
        let assignments = plan.take_assignments();
        assert_eq!(assignments.len(), 2);
        assert_eq!(assignments[0].field_index().value(), 0);
        assert_eq!(
            assignments[0].credential(),
            AuthenticationCredentialKind::Username
        );
        assert_eq!(assignments[1].field_index().value(), 1);
        assert_eq!(
            assignments[1].credential(),
            AuthenticationCredentialKind::CurrentPassword
        );
        assert!(plan.take_assignments().is_empty());
        Ok(())
    }

    #[test]
    fn wasm_owned_observation_preserves_readonly_policy() -> Result<(), wasm_bindgen::JsError> {
        let readonly = AuthenticationFillFieldObservation::new(
            &AuthenticationFillFieldIndex::new(0),
            AuthenticationFillFieldRole::CurrentPassword,
            AuthenticationFillFieldEditability::Readonly,
        );
        let mut fields = AuthenticationFillFieldObservations::new();
        fields.add(&readonly)?;
        assert!(plan_companion_credential_fill(&fields).is_err());
        Ok(())
    }

    #[test]
    fn wasm_owned_batch_rejects_observations_above_the_core_limit()
    -> Result<(), wasm_bindgen::JsError> {
        let observation = field(0, AuthenticationFillFieldRole::Username);
        let mut fields = AuthenticationFillFieldObservations::new();
        for _ in 0..nook_companion_core::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT {
            fields.add(&observation)?;
        }
        assert!(fields.add(&observation).is_err());
        Ok(())
    }
}
