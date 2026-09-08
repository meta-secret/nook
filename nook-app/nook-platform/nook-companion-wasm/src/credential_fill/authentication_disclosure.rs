#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::{CredentialFillAssignment, CredentialFillObservations};
use nook_companion_core::credential_fill::{self, field};
use wasm_bindgen::prelude::wasm_bindgen;

/// One owned request binds field observations to exact full-page planning facts.
#[wasm_bindgen]
pub struct AuthenticationCredentialDisclosurePlanningRequest {
    fields: Result<Vec<field::Observation>, credential_fill::CredentialFillRejection>,
    facts: nook_companion_core::AuthenticationPageObservationFacts,
}

#[wasm_bindgen]
impl CredentialFillObservations {
    /// Bind these exact field observations to one full-page disclosure request.
    #[must_use]
    pub fn authentication_credential_disclosure_planning_request(
        &self,
        facts: &nook_companion_core::AuthenticationPageObservationFacts,
    ) -> AuthenticationCredentialDisclosurePlanningRequest {
        AuthenticationCredentialDisclosurePlanningRequest {
            fields: self.inner.clone(),
            facts: facts.clone(),
        }
    }
}

enum AuthenticationCredentialDisclosurePlanningResultState {
    Planned(Option<nook_companion_core::AuthenticationCredentialDisclosureCapability>),
    Rejected(credential_fill::CredentialFillRejection),
}

/// Opaque exhaustive result of Core-owned disclosure planning.
#[wasm_bindgen]
pub struct AuthenticationCredentialDisclosurePlanningResult {
    inner: AuthenticationCredentialDisclosurePlanningResultState,
}

impl AuthenticationCredentialDisclosurePlanningResult {
    fn from_core(
        value: Result<
            nook_companion_core::AuthenticationCredentialDisclosureCapability,
            credential_fill::CredentialFillRejection,
        >,
    ) -> Self {
        let inner = match value {
            Ok(capability) => {
                AuthenticationCredentialDisclosurePlanningResultState::Planned(Some(capability))
            }
            Err(rejection) => {
                AuthenticationCredentialDisclosurePlanningResultState::Rejected(rejection)
            }
        };
        Self { inner }
    }
}

#[wasm_bindgen]
impl AuthenticationCredentialDisclosurePlanningResult {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn kind(&self) -> credential_fill::CredentialFillPlanningOutcome {
        match &self.inner {
            AuthenticationCredentialDisclosurePlanningResultState::Planned(_) => {
                credential_fill::CredentialFillPlanningOutcome::Planned
            }
            AuthenticationCredentialDisclosurePlanningResultState::Rejected(_) => {
                credential_fill::CredentialFillPlanningOutcome::Rejected
            }
        }
    }

    pub fn take_capability(
        &mut self,
    ) -> Result<AuthenticationCredentialDisclosureCapability, wasm_bindgen::JsError> {
        let AuthenticationCredentialDisclosurePlanningResultState::Planned(capability) =
            &mut self.inner
        else {
            return Err(wasm_bindgen::JsError::new(
                "a rejected disclosure-planning result has no capability",
            ));
        };
        let Some(capability) = capability.take() else {
            return Err(wasm_bindgen::JsError::new(
                "the disclosure-planning capability was already taken",
            ));
        };
        Ok(AuthenticationCredentialDisclosureCapability { inner: capability })
    }

    pub fn rejection(
        &self,
    ) -> Result<credential_fill::CredentialFillRejection, wasm_bindgen::JsError> {
        let AuthenticationCredentialDisclosurePlanningResultState::Rejected(rejection) =
            &self.inner
        else {
            return Err(wasm_bindgen::JsError::new(
                "an approved disclosure-planning result has no rejection",
            ));
        };
        Ok(*rejection)
    }
}

/// Non-constructible authority requiring fresh validation before username disclosure.
#[wasm_bindgen]
pub struct AuthenticationCredentialDisclosureCapability {
    inner: nook_companion_core::AuthenticationCredentialDisclosureCapability,
}

/// Named fresh-facts request for pre-username authorization.
#[wasm_bindgen]
pub struct AuthenticationCredentialDisclosurePreflightRequest {
    facts: nook_companion_core::AuthenticationPageObservationFacts,
}

#[wasm_bindgen]
impl AuthenticationCredentialDisclosurePreflightRequest {
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new(facts: &nook_companion_core::AuthenticationPageObservationFacts) -> Self {
        Self {
            facts: facts.clone(),
        }
    }
}

/// Exhaustive pre-username authorization state.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthenticationCredentialDisclosurePreflightOutcome {
    Authorized,
    Rejected,
}

enum AuthenticationCredentialDisclosurePreflightResultState {
    Authorized(Option<nook_companion_core::AuthorizedAuthenticationUsernameDisclosure>),
    Rejected(credential_fill::CredentialFillRejection),
}

/// Typed pre-username result preserving Core rejection semantics.
#[wasm_bindgen]
pub struct AuthenticationCredentialDisclosurePreflightResult {
    inner: AuthenticationCredentialDisclosurePreflightResultState,
}

impl AuthenticationCredentialDisclosurePreflightResult {
    fn from_core(
        value: Result<
            nook_companion_core::AuthorizedAuthenticationUsernameDisclosure,
            credential_fill::CredentialFillRejection,
        >,
    ) -> Self {
        let inner = match value {
            Ok(authorization) => {
                AuthenticationCredentialDisclosurePreflightResultState::Authorized(Some(
                    authorization,
                ))
            }
            Err(rejection) => {
                AuthenticationCredentialDisclosurePreflightResultState::Rejected(rejection)
            }
        };
        Self { inner }
    }
}

#[wasm_bindgen]
impl AuthenticationCredentialDisclosureCapability {
    /// Consume planning authority into a typed pre-username decision.
    #[must_use]
    pub fn preflight(
        self,
        request: &AuthenticationCredentialDisclosurePreflightRequest,
    ) -> AuthenticationCredentialDisclosurePreflightResult {
        AuthenticationCredentialDisclosurePreflightResult::from_core(self.inner.preflight(
            nook_companion_core::AuthenticationCredentialDisclosurePreflightRequest {
                fresh_facts: &request.facts,
            },
        ))
    }
}

#[wasm_bindgen]
impl AuthenticationCredentialDisclosurePreflightResult {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn kind(&self) -> AuthenticationCredentialDisclosurePreflightOutcome {
        match &self.inner {
            AuthenticationCredentialDisclosurePreflightResultState::Authorized(_) => {
                AuthenticationCredentialDisclosurePreflightOutcome::Authorized
            }
            AuthenticationCredentialDisclosurePreflightResultState::Rejected(_) => {
                AuthenticationCredentialDisclosurePreflightOutcome::Rejected
            }
        }
    }

    pub fn take_authorization(
        &mut self,
    ) -> Result<AuthorizedAuthenticationUsernameDisclosure, wasm_bindgen::JsError> {
        let AuthenticationCredentialDisclosurePreflightResultState::Authorized(authorization) =
            &mut self.inner
        else {
            return Err(wasm_bindgen::JsError::new(
                "a rejected preflight result has no authorization",
            ));
        };
        let Some(inner) = authorization.take() else {
            return Err(wasm_bindgen::JsError::new(
                "the username disclosure authorization was already taken",
            ));
        };
        Ok(AuthorizedAuthenticationUsernameDisclosure { inner })
    }

    pub fn rejection(
        &self,
    ) -> Result<credential_fill::CredentialFillRejection, wasm_bindgen::JsError> {
        let AuthenticationCredentialDisclosurePreflightResultState::Rejected(rejection) =
            &self.inner
        else {
            return Err(wasm_bindgen::JsError::new(
                "an authorized preflight result has no rejection",
            ));
        };
        Ok(*rejection)
    }
}

/// Core-authorized username assignment paired with its password continuation.
#[wasm_bindgen]
pub struct AuthorizedAuthenticationUsernameDisclosure {
    inner: nook_companion_core::AuthorizedAuthenticationUsernameDisclosure,
}

#[wasm_bindgen]
impl AuthorizedAuthenticationUsernameDisclosure {
    #[must_use]
    pub fn username_assignment(&self) -> CredentialFillAssignment {
        CredentialFillAssignment::from_core(self.inner.username_assignment.clone())
    }

    #[must_use]
    pub fn password_continuation(self) -> AuthenticationPasswordDisclosureContinuation {
        AuthenticationPasswordDisclosureContinuation {
            inner: self.inner.password_continuation,
        }
    }
}

/// Non-constructible one-shot authority for fresh password disclosure validation.
#[wasm_bindgen]
pub struct AuthenticationPasswordDisclosureContinuation {
    inner: nook_companion_core::AuthenticationPasswordDisclosureContinuation,
}

/// Named fresh-facts request for password disclosure consumption.
#[wasm_bindgen]
pub struct AuthenticationCredentialDisclosureConsumptionRequest {
    facts: nook_companion_core::AuthenticationPageObservationFacts,
}

#[wasm_bindgen]
impl AuthenticationCredentialDisclosureConsumptionRequest {
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new(facts: &nook_companion_core::AuthenticationPageObservationFacts) -> Self {
        Self {
            facts: facts.clone(),
        }
    }
}

/// Exhaustive password-consumption state.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthenticationCredentialDisclosureConsumptionOutcome {
    Approved,
    Rejected,
}

enum AuthenticationCredentialDisclosureConsumptionResultState {
    Approved(Option<credential_fill::Assignment>),
    Rejected(credential_fill::CredentialFillRejection),
}

/// Typed password-consumption result preserving Core rejection semantics.
#[wasm_bindgen]
pub struct AuthenticationCredentialDisclosureConsumptionResult {
    inner: AuthenticationCredentialDisclosureConsumptionResultState,
}

impl AuthenticationCredentialDisclosureConsumptionResult {
    fn from_core(
        value: Result<credential_fill::Assignment, credential_fill::CredentialFillRejection>,
    ) -> Self {
        let inner = match value {
            Ok(assignment) => {
                AuthenticationCredentialDisclosureConsumptionResultState::Approved(Some(assignment))
            }
            Err(rejection) => {
                AuthenticationCredentialDisclosureConsumptionResultState::Rejected(rejection)
            }
        };
        Self { inner }
    }
}

#[wasm_bindgen]
impl AuthenticationPasswordDisclosureContinuation {
    /// Atomically consume this authority against fresh post-username facts.
    #[must_use]
    pub fn consume(
        self,
        request: &AuthenticationCredentialDisclosureConsumptionRequest,
    ) -> AuthenticationCredentialDisclosureConsumptionResult {
        AuthenticationCredentialDisclosureConsumptionResult::from_core(self.inner.consume(
            nook_companion_core::AuthenticationPasswordDisclosureRequest {
                fresh_facts: &request.facts,
            },
        ))
    }
}

#[wasm_bindgen]
impl AuthenticationCredentialDisclosureConsumptionResult {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn kind(&self) -> AuthenticationCredentialDisclosureConsumptionOutcome {
        match &self.inner {
            AuthenticationCredentialDisclosureConsumptionResultState::Approved(_) => {
                AuthenticationCredentialDisclosureConsumptionOutcome::Approved
            }
            AuthenticationCredentialDisclosureConsumptionResultState::Rejected(_) => {
                AuthenticationCredentialDisclosureConsumptionOutcome::Rejected
            }
        }
    }

    pub fn take_assignment(&mut self) -> Result<CredentialFillAssignment, wasm_bindgen::JsError> {
        let AuthenticationCredentialDisclosureConsumptionResultState::Approved(assignment) =
            &mut self.inner
        else {
            return Err(wasm_bindgen::JsError::new(
                "a rejected consumption result has no assignment",
            ));
        };
        let Some(assignment) = assignment.take() else {
            return Err(wasm_bindgen::JsError::new(
                "the approved password assignment was already taken",
            ));
        };
        Ok(CredentialFillAssignment::from_core(assignment))
    }

    pub fn rejection(
        &self,
    ) -> Result<credential_fill::CredentialFillRejection, wasm_bindgen::JsError> {
        let AuthenticationCredentialDisclosureConsumptionResultState::Rejected(rejection) =
            &self.inner
        else {
            return Err(wasm_bindgen::JsError::new(
                "an approved consumption result has no rejection",
            ));
        };
        Ok(*rejection)
    }
}

/// Current writer version for the additive disclosure observation contract.
#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        unowned_function,
        reason = "FFI boundary: exports the current Rust writer version to JavaScript"
    )
)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        raw_numeric_public_api,
        reason = "FFI boundary: exposes the current disclosure observation writer version"
    )
)]
pub fn authentication_disclosure_observation_current_schema_version() -> u32 {
    nook_companion_core::AuthenticationDisclosureObservationSchemaVersion::CURRENT.into()
}

/// Classify one versioned disclosure control without erasing unsupported versions.
#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        unowned_function,
        reason = "FFI boundary: classifies a generated versioned observation from JavaScript"
    )
)]
pub fn classify_authentication_disclosure_control(
    observation: &nook_companion_core::VersionedAuthenticationDisclosureControlObservation,
) -> nook_companion_core::AuthenticationDisclosureControlDecision {
    observation.classify()
}

/// Plan exceptional disclosure from one named Core-owned request.
#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        unowned_function,
        reason = "FFI boundary: accepts the generated planning request from JavaScript"
    )
)]
pub fn plan_companion_authentication_credential_disclosure(
    request: &AuthenticationCredentialDisclosurePlanningRequest,
) -> AuthenticationCredentialDisclosurePlanningResult {
    let decision = request.facts.credential_disclosure_planning_decision();
    AuthenticationCredentialDisclosurePlanningResult::from_core(
        request
            .fields
            .as_deref()
            .map_err(|rejection| *rejection)
            .and_then(|fields| {
                decision.plan(
                    nook_companion_core::AuthenticationCredentialDisclosurePlanningRequest {
                        fields,
                    },
                )
            }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::credential_fill::{
        CredentialFillEditability, CredentialFillFieldIndex, CredentialFillFieldRole,
        CredentialFillObservation,
    };
    use nook_companion_core::{
        AuthenticationAdvanceControlObservation,
        AuthenticationCredentialDisclosureControlObservation, AuthenticationFieldObservationFacts,
        AuthenticationPageObservationFacts, AuthenticationUsernameEvidence,
        CurrentAuthenticationDisclosureControlRequest, PageControlActionability,
        PageControlOwnership, PageControlSemantics, PageControlSubmissionDestinationSource,
        PageControlSubmissionMethod, VersionedAuthenticationDisclosureControlObservation,
    };

    struct AuthenticationDisclosureWasmScenario;

    impl AuthenticationDisclosureWasmScenario {
        fn facts(actionability: PageControlActionability) -> AuthenticationPageObservationFacts {
            let control = VersionedAuthenticationDisclosureControlObservation::current(
                CurrentAuthenticationDisclosureControlRequest {
                    observation: AuthenticationAdvanceControlObservation {
                        actionability,
                        ownership: PageControlOwnership::OwnedForm,
                        semantics: PageControlSemantics::Activation,
                        authentication_username: AuthenticationUsernameEvidence::Explicit,
                        password_field_count: 1.into(),
                        new_password_field_count: 0.into(),
                        one_time_code_field_count: 0.into(),
                        semantic_submit_control_count: 0.into(),
                        source_origin: "https://login.example.test".to_owned(),
                        form_identity: String::new(),
                        destination_identity: "https://login.example.test/login".to_owned(),
                        label: "Sign in".to_owned(),
                        machine_identity: String::new(),
                        submission_method: PageControlSubmissionMethod::Absent,
                        submission_destination_source:
                            PageControlSubmissionDestinationSource::Omitted,
                    },
                    generic_password_field_count: 0.into(),
                },
            );
            AuthenticationPageObservationFacts {
                fields: AuthenticationFieldObservationFacts {
                    username_field_count: 1.into(),
                    current_password_field_count: 1.into(),
                    actionable_password_field_count: 1.into(),
                    ..Default::default()
                },
                credential_disclosure_control:
                    AuthenticationCredentialDisclosureControlObservation::Observed(vec![control]),
                ..Default::default()
            }
        }

        fn fields() -> CredentialFillObservations {
            let mut fields = CredentialFillObservations::new();
            fields.add(&CredentialFillObservation::credential(
                &CredentialFillFieldIndex::zero(),
                &CredentialFillFieldRole::username(),
                &CredentialFillEditability::writable(),
            ));
            fields.add(&CredentialFillObservation::credential(
                &CredentialFillFieldIndex::one(),
                &CredentialFillFieldRole::current_password(),
                &CredentialFillEditability::writable(),
            ));
            fields
        }

        fn planning_result() -> AuthenticationCredentialDisclosurePlanningResult {
            let fields = Self::fields();
            let facts = Self::facts(PageControlActionability::Inert);
            let request = fields.authentication_credential_disclosure_planning_request(&facts);
            plan_companion_authentication_credential_disclosure(&request)
        }

        fn authorization()
        -> Result<AuthorizedAuthenticationUsernameDisclosure, wasm_bindgen::JsError> {
            let mut planning = Self::planning_result();
            let capability = planning.take_capability()?;
            let facts = Self::facts(PageControlActionability::Inert);
            let request = AuthenticationCredentialDisclosurePreflightRequest::new(&facts);
            let mut result = capability.preflight(&request);
            result.take_authorization()
        }
    }

    #[test]
    fn typed_two_stage_contract_returns_authoritative_assignments()
    -> Result<(), wasm_bindgen::JsError> {
        let mut planning = AuthenticationDisclosureWasmScenario::planning_result();
        assert_eq!(
            planning.kind(),
            credential_fill::CredentialFillPlanningOutcome::Planned
        );
        let capability = planning.take_capability()?;
        match planning.take_capability() {
            Ok(_) => return Err(wasm_bindgen::JsError::new("planning capability replayed")),
            Err(_) => {}
        }
        let initial = AuthenticationDisclosureWasmScenario::facts(PageControlActionability::Inert);
        let request = AuthenticationCredentialDisclosurePreflightRequest::new(&initial);
        let mut preflight = capability.preflight(&request);
        assert_eq!(
            preflight.kind(),
            AuthenticationCredentialDisclosurePreflightOutcome::Authorized
        );
        let authorization = preflight.take_authorization()?;
        match preflight.take_authorization() {
            Ok(_) => {
                return Err(wasm_bindgen::JsError::new(
                    "username authorization replayed",
                ));
            }
            Err(_) => {}
        }
        let username = authorization.username_assignment();
        assert_eq!(username.field_index().value(), 0);
        assert_eq!(
            username.credential(),
            credential_fill::CredentialKind::Username
        );
        let continuation = authorization.password_continuation();
        let fresh =
            AuthenticationDisclosureWasmScenario::facts(PageControlActionability::Actionable);
        let request = AuthenticationCredentialDisclosureConsumptionRequest::new(&fresh);
        let mut consumption = continuation.consume(&request);
        assert_eq!(
            consumption.kind(),
            AuthenticationCredentialDisclosureConsumptionOutcome::Approved
        );
        let password = consumption.take_assignment()?;
        assert_eq!(password.field_index().value(), 1);
        assert_eq!(
            password.credential(),
            credential_fill::CredentialKind::CurrentPassword
        );
        match consumption.take_assignment() {
            Ok(_) => return Err(wasm_bindgen::JsError::new("password assignment replayed")),
            Err(_) => {}
        }
        Ok(())
    }

    #[test]
    fn typed_preflight_and_consumption_rejections_survive_the_wasm_boundary()
    -> Result<(), wasm_bindgen::JsError> {
        let mut planning = AuthenticationDisclosureWasmScenario::planning_result();
        let capability = planning.take_capability()?;
        let mut drift =
            AuthenticationDisclosureWasmScenario::facts(PageControlActionability::Inert);
        drift.fields.username_field_count = 2.into();
        let request = AuthenticationCredentialDisclosurePreflightRequest::new(&drift);
        let preflight = capability.preflight(&request);
        assert_eq!(
            preflight.kind(),
            AuthenticationCredentialDisclosurePreflightOutcome::Rejected
        );
        assert_eq!(
            preflight.rejection()?,
            credential_fill::CredentialFillRejection::AuthenticationContextRejected
        );

        let authorization = AuthenticationDisclosureWasmScenario::authorization()?;
        let mut drift =
            AuthenticationDisclosureWasmScenario::facts(PageControlActionability::Actionable);
        drift.fields.current_password_field_count = 0.into();
        drift.fields.generic_password_field_count = 1.into();
        let request = AuthenticationCredentialDisclosureConsumptionRequest::new(&drift);
        let consumption = authorization.password_continuation().consume(&request);
        assert_eq!(
            consumption.kind(),
            AuthenticationCredentialDisclosureConsumptionOutcome::Rejected
        );
        assert_eq!(
            consumption.rejection()?,
            credential_fill::CredentialFillRejection::AuthenticationContextRejected
        );
        Ok(())
    }

    #[test]
    fn current_writer_version_is_explicit_and_unsupported_version_rejects_planning()
    -> Result<(), wasm_bindgen::JsError> {
        assert_eq!(
            authentication_disclosure_observation_current_schema_version(),
            1
        );
        let fields = AuthenticationDisclosureWasmScenario::fields();
        let mut facts =
            AuthenticationDisclosureWasmScenario::facts(PageControlActionability::Inert);
        let AuthenticationCredentialDisclosureControlObservation::Observed(controls) =
            &mut facts.credential_disclosure_control
        else {
            return Err(wasm_bindgen::JsError::new(
                "scenario lacks disclosure control",
            ));
        };
        controls[0].schema_version = 2.into();
        assert_eq!(
            classify_authentication_disclosure_control(&controls[0]),
            nook_companion_core::AuthenticationDisclosureControlDecision::UnsupportedVersion
        );
        let request = fields.authentication_credential_disclosure_planning_request(&facts);
        let result = plan_companion_authentication_credential_disclosure(&request);
        assert_eq!(
            result.kind(),
            credential_fill::CredentialFillPlanningOutcome::Rejected
        );
        assert_eq!(
            result.rejection()?,
            credential_fill::CredentialFillRejection::AuthenticationContextRejected
        );
        Ok(())
    }
}
