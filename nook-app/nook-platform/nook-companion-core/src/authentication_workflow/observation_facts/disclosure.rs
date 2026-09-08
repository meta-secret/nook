#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::{AuthenticationFieldObservationFacts, AuthenticationPageObservationFacts};
use crate::credential_fill::{self, field};
use crate::page_field_classification::{
    AuthenticationAdvanceControlObservation, AuthenticationUsernameEvidence,
    PageControlActionability, PageControlOwnership, PageControlSemantics,
    PageControlSubmissionDestinationSource, PageControlSubmissionMethod,
    canonicalize_control_destination, expand_identity_text,
};
use crate::{AuthenticationFieldCount, MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

/// Version of the security-sensitive authentication-disclosure observation wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "number")]
pub struct AuthenticationDisclosureObservationSchemaVersion(u32);

impl AuthenticationDisclosureObservationSchemaVersion {
    pub const CURRENT: Self = Self(1);

    #[must_use]
    pub const fn is_supported(self) -> bool {
        self.0 == Self::CURRENT.0
    }
}

impl From<u32> for AuthenticationDisclosureObservationSchemaVersion {
    fn from(value: u32) -> Self {
        Self(value)
    }
}

impl From<AuthenticationDisclosureObservationSchemaVersion> for u32 {
    fn from(value: AuthenticationDisclosureObservationSchemaVersion) -> Self {
        value.0
    }
}

/// Inputs owned by the current disclosure-observation writer.
pub struct CurrentAuthenticationDisclosureControlRequest {
    pub observation: AuthenticationAdvanceControlObservation,
    pub generic_password_field_count: AuthenticationFieldCount,
}

/// Versioned control facts used only by exceptional credential disclosure.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct VersionedAuthenticationDisclosureControlObservation {
    pub schema_version: AuthenticationDisclosureObservationSchemaVersion,
    pub observation: AuthenticationAdvanceControlObservation,
    pub generic_password_field_count: AuthenticationFieldCount,
}

/// Typed classification of a versioned disclosure-control observation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationDisclosureControlDecision {
    AdvancesAuthentication,
    DoesNotAdvanceAuthentication,
    UnsupportedVersion,
}

impl VersionedAuthenticationDisclosureControlObservation {
    #[must_use]
    pub fn current(request: CurrentAuthenticationDisclosureControlRequest) -> Self {
        Self {
            schema_version: AuthenticationDisclosureObservationSchemaVersion::CURRENT,
            observation: request.observation,
            generic_password_field_count: request.generic_password_field_count,
        }
    }

    #[must_use]
    pub fn classify(&self) -> AuthenticationDisclosureControlDecision {
        if !self.schema_version.is_supported() {
            return AuthenticationDisclosureControlDecision::UnsupportedVersion;
        }
        if !self.is_bounded() {
            return AuthenticationDisclosureControlDecision::DoesNotAdvanceAuthentication;
        }
        if self.is_exact_owned_omitted_method_login_activation() {
            return AuthenticationDisclosureControlDecision::AdvancesAuthentication;
        }
        AuthenticationDisclosureControlDecision::DoesNotAdvanceAuthentication
    }

    fn is_bounded(&self) -> bool {
        self.observation.is_bounded()
            && self.generic_password_field_count.raw() <= MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT
            && self.generic_password_field_count.raw()
                <= self.observation.password_field_count.raw()
    }

    fn is_exact_owned_omitted_method_login_activation(&self) -> bool {
        let control = &self.observation;
        if !self.schema_version.is_supported()
            || !matches!(control.actionability, PageControlActionability::Actionable)
            || !matches!(control.ownership, PageControlOwnership::OwnedForm)
            || !matches!(control.semantics, PageControlSemantics::Activation)
            || !matches!(
                control.authentication_username,
                AuthenticationUsernameEvidence::Explicit
            )
            || control.password_field_count.raw() != 1
            || self.generic_password_field_count.raw() != 0
            || control.new_password_field_count.raw() != 0
            || control.one_time_code_field_count.raw() != 0
            || control.semantic_submit_control_count.raw() != 0
            || !control.form_identity.is_empty()
            || !control.machine_identity.is_empty()
            || expand_identity_text(&control.label) != "sign in"
            || !matches!(
                control.submission_method,
                PageControlSubmissionMethod::Absent
            )
            || !matches!(
                control.submission_destination_source,
                PageControlSubmissionDestinationSource::Omitted
            )
        {
            return false;
        }
        canonicalize_control_destination(&control.source_origin, &control.destination_identity)
            .is_some_and(|destination| {
                destination.path_identity == "/login" && destination.route_identity == "/login"
            })
    }

    fn is_exact_inert_planning_control(&self) -> bool {
        if !matches!(
            self.observation.actionability,
            PageControlActionability::Inert
        ) {
            return false;
        }
        let mut actionable = self.clone();
        actionable.observation.actionability = PageControlActionability::Actionable;
        actionable.is_exact_owned_omitted_method_login_activation()
    }

    fn fields_match(&self, fields: AuthenticationFieldObservationFacts) -> bool {
        fields.is_compatible_with_detailed_control(&self.observation)
            && fields.generic_password_field_count == self.generic_password_field_count
            && fields.current_password_field_count.raw() == 1
            && fields.actionable_password_field_count.raw() == 1
            && fields.readonly_password_field_count.raw() == 0
    }
}

/// Optional versioned evidence dedicated to exceptional disclosure planning.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", content = "observations", rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationCredentialDisclosureControlObservation {
    #[default]
    Absent,
    Observed(Vec<VersionedAuthenticationDisclosureControlObservation>),
}

impl AuthenticationCredentialDisclosureControlObservation {
    pub(super) fn is_bounded(&self) -> bool {
        matches!(self, Self::Absent)
            || matches!(self, Self::Observed(observations)
            if !observations.is_empty()
                && observations.len() <= MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT as usize
                && observations.iter().all(
                    VersionedAuthenticationDisclosureControlObservation::is_bounded
                ))
    }

    pub(super) fn has_planning_evidence(
        &self,
        fields: AuthenticationFieldObservationFacts,
    ) -> bool {
        matches!(self, Self::Observed(observations)
            if observations.len() == 1
                && observations[0].fields_match(fields)
                && observations[0].is_exact_inert_planning_control())
    }

    fn reader_rejection(&self) -> Option<AuthenticationCredentialDisclosureRejection> {
        let Self::Observed(observations) = self else {
            return Some(AuthenticationCredentialDisclosureRejection::ControlObservationAbsent);
        };
        let [observation] = observations.as_slice() else {
            return Some(AuthenticationCredentialDisclosureRejection::MalformedControlObservation);
        };
        if !observation.schema_version.is_supported() {
            return Some(
                AuthenticationCredentialDisclosureRejection::UnsupportedVersion(
                    observation.schema_version,
                ),
            );
        }
        (!observation.is_bounded())
            .then_some(AuthenticationCredentialDisclosureRejection::MalformedControlObservation)
    }

    fn has_actionable_consumption_evidence(
        &self,
        fields: AuthenticationFieldObservationFacts,
    ) -> bool {
        matches!(self, Self::Observed(observations)
            if observations.len() == 1
                && observations[0].fields_match(fields)
                && observations[0].is_exact_owned_omitted_method_login_activation())
    }

    fn normalize_expected_actionability(&mut self) {
        if let Self::Observed(observations) = self {
            for observation in observations {
                observation.observation.actionability = PageControlActionability::Inert;
            }
        }
    }
}

/// One named request binds exact field identities to a disclosure plan.
pub struct AuthenticationCredentialDisclosurePlanningRequest<'a> {
    pub fields: &'a [field::Observation],
}

/// Core-issued planning authority for one exact inert login observation.
#[derive(Debug)]
pub struct AuthenticationCredentialDisclosurePlanningCapability {
    approved_facts: AuthenticationPageObservationFacts,
}

/// Typed failure produced by the exceptional disclosure transaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", content = "detail", rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationCredentialDisclosureRejection {
    #[error("the disclosure control observation is absent")]
    ControlObservationAbsent,
    #[error("the disclosure control observation is malformed")]
    MalformedControlObservation,
    #[error("the disclosure control observation version is unsupported")]
    UnsupportedVersion(AuthenticationDisclosureObservationSchemaVersion),
    #[error("the authentication context does not authorize credential disclosure")]
    AuthenticationContextRejected,
    #[error("the credential fields do not authorize disclosure: {0}")]
    CredentialFieldsRejected(credential_fill::CredentialFillRejection),
    #[error("the credential fields do not have the exact disclosure shape")]
    CredentialFieldsNotExact,
    #[error("the credential field assignments changed after planning")]
    CredentialAssignmentsChanged,
}

/// Typed result of validating full-page evidence for exceptional disclosure planning.
#[derive(Debug)]
pub enum AuthenticationCredentialDisclosurePlanningDecision {
    Rejected(AuthenticationCredentialDisclosureRejection),
    Approved(Box<AuthenticationCredentialDisclosurePlanningCapability>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ExactAuthenticationCredentialDisclosureAssignments {
    username: credential_fill::Assignment,
    password: credential_fill::Assignment,
}

impl ExactAuthenticationCredentialDisclosureAssignments {
    fn from_fields(
        fields: &[field::Observation],
    ) -> Result<Self, AuthenticationCredentialDisclosureRejection> {
        let plan = credential_fill::Plan::from_fields(fields)
            .map_err(AuthenticationCredentialDisclosureRejection::CredentialFieldsRejected)?;
        let [username, password] = plan.assignments.as_slice() else {
            return Err(AuthenticationCredentialDisclosureRejection::CredentialFieldsNotExact);
        };
        let exact_fields = fields.len() == 2
            && fields.iter().any(|field| {
                matches!(
                    field,
                    field::Observation::Credential(field::Credential {
                        role: field::CredentialRole::Username,
                        editability: field::Editability::Writable,
                        ..
                    })
                )
            })
            && fields.iter().any(|field| {
                matches!(
                    field,
                    field::Observation::Credential(field::Credential {
                        role: field::CredentialRole::Password(field::Password::Current),
                        editability: field::Editability::Writable,
                        ..
                    })
                )
            })
            && matches!(
                username.credential,
                credential_fill::CredentialKind::Username
            )
            && matches!(
                password.credential,
                credential_fill::CredentialKind::CurrentPassword
            );
        if !exact_fields {
            return Err(AuthenticationCredentialDisclosureRejection::CredentialFieldsNotExact);
        }
        Ok(Self {
            username: username.clone(),
            password: password.clone(),
        })
    }
}

/// Opaque authority that must be checked before the username is written.
#[derive(Debug)]
pub struct AuthenticationCredentialDisclosureCapability {
    approved_facts: AuthenticationPageObservationFacts,
    assignments: ExactAuthenticationCredentialDisclosureAssignments,
}

/// Named fresh-facts request for the pre-username effect boundary.
pub struct AuthenticationCredentialDisclosurePreflightRequest<'a> {
    pub fresh_facts: &'a AuthenticationPageObservationFacts,
    pub fields: &'a [field::Observation],
}

/// Exact username assignment plus the one-shot authority for the password stage.
#[derive(Debug)]
pub struct AuthorizedAuthenticationUsernameDisclosure {
    pub username_assignment: credential_fill::Assignment,
    pub password_continuation: AuthenticationPasswordDisclosureContinuation,
}

/// One-shot authority that requires a fresh actionable observation before password disclosure.
///
/// ```compile_fail,E0382
/// use nook_companion_core::{AuthenticationPasswordDisclosureContinuation,
///     AuthenticationPasswordDisclosureRequest};
/// fn replay(
///     continuation: AuthenticationPasswordDisclosureContinuation,
///     first: AuthenticationPasswordDisclosureRequest<'_>,
///     second: AuthenticationPasswordDisclosureRequest<'_>,
/// ) {
///     let _ = continuation.consume(&first);
///     let _ = continuation.consume(&second);
/// }
/// ```
#[derive(Debug)]
pub struct AuthenticationPasswordDisclosureContinuation {
    approved_facts: AuthenticationPageObservationFacts,
    assignments: ExactAuthenticationCredentialDisclosureAssignments,
}

/// Named fresh-facts request for the password effect boundary.
pub struct AuthenticationPasswordDisclosureRequest<'a> {
    pub fresh_facts: &'a AuthenticationPageObservationFacts,
    pub fields: &'a [field::Observation],
}

impl AuthenticationCredentialDisclosurePlanningDecision {
    pub fn plan(
        self,
        request: &AuthenticationCredentialDisclosurePlanningRequest<'_>,
    ) -> Result<
        AuthenticationCredentialDisclosureCapability,
        AuthenticationCredentialDisclosureRejection,
    > {
        let approval = match self {
            Self::Approved(approval) => approval,
            Self::Rejected(rejection) => return Err(rejection),
        };
        let assignments =
            ExactAuthenticationCredentialDisclosureAssignments::from_fields(request.fields)?;
        Ok(AuthenticationCredentialDisclosureCapability {
            approved_facts: approval.approved_facts,
            assignments,
        })
    }
}

impl AuthenticationCredentialDisclosureCapability {
    pub fn preflight(
        self,
        request: &AuthenticationCredentialDisclosurePreflightRequest<'_>,
    ) -> Result<
        AuthorizedAuthenticationUsernameDisclosure,
        AuthenticationCredentialDisclosureRejection,
    > {
        let fresh_facts = request.fresh_facts;
        if let Some(rejection) = fresh_facts.credential_disclosure_control.reader_rejection() {
            return Err(rejection);
        }
        if fresh_facts != &self.approved_facts
            || !fresh_facts.is_bounded()
            || !fresh_facts
                .credential_disclosure_control
                .has_planning_evidence(fresh_facts.fields)
        {
            return Err(AuthenticationCredentialDisclosureRejection::AuthenticationContextRejected);
        }
        let assignments =
            ExactAuthenticationCredentialDisclosureAssignments::from_fields(request.fields)?;
        if assignments != self.assignments {
            return Err(AuthenticationCredentialDisclosureRejection::CredentialAssignmentsChanged);
        }
        Ok(AuthorizedAuthenticationUsernameDisclosure {
            username_assignment: assignments.username.clone(),
            password_continuation: AuthenticationPasswordDisclosureContinuation {
                approved_facts: self.approved_facts,
                assignments,
            },
        })
    }
}

impl AuthenticationPasswordDisclosureContinuation {
    pub fn consume(
        self,
        request: &AuthenticationPasswordDisclosureRequest<'_>,
    ) -> Result<credential_fill::Assignment, AuthenticationCredentialDisclosureRejection> {
        let fresh_facts = request.fresh_facts;
        if let Some(rejection) = fresh_facts.credential_disclosure_control.reader_rejection() {
            return Err(rejection);
        }
        if !fresh_facts.is_bounded()
            || !fresh_facts
                .credential_disclosure_control
                .has_actionable_consumption_evidence(fresh_facts.fields)
        {
            return Err(AuthenticationCredentialDisclosureRejection::AuthenticationContextRejected);
        }
        let mut normalized = fresh_facts.clone();
        normalized
            .credential_disclosure_control
            .normalize_expected_actionability();
        if normalized != self.approved_facts {
            return Err(AuthenticationCredentialDisclosureRejection::AuthenticationContextRejected);
        }
        let assignments =
            ExactAuthenticationCredentialDisclosureAssignments::from_fields(request.fields)?;
        if assignments != self.assignments {
            return Err(AuthenticationCredentialDisclosureRejection::CredentialAssignmentsChanged);
        }
        Ok(assignments.password)
    }
}

impl AuthenticationPageObservationFacts {
    /// Decide whether this exact full-page observation may plan exceptional disclosure.
    #[must_use]
    pub fn credential_disclosure_planning_decision(
        &self,
    ) -> AuthenticationCredentialDisclosurePlanningDecision {
        if let Some(rejection) = self.credential_disclosure_control.reader_rejection() {
            return AuthenticationCredentialDisclosurePlanningDecision::Rejected(rejection);
        }
        if self.is_bounded()
            && self
                .credential_disclosure_control
                .has_planning_evidence(self.fields)
        {
            AuthenticationCredentialDisclosurePlanningDecision::Approved(Box::new(
                AuthenticationCredentialDisclosurePlanningCapability {
                    approved_facts: self.clone(),
                },
            ))
        } else {
            AuthenticationCredentialDisclosurePlanningDecision::Rejected(
                AuthenticationCredentialDisclosureRejection::AuthenticationContextRejected,
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::page_field_classification::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES;

    mod fresh_field_drift;

    struct OmittedMethodDisclosureScenario;

    impl OmittedMethodDisclosureScenario {
        fn control(
            actionability: PageControlActionability,
        ) -> VersionedAuthenticationDisclosureControlObservation {
            VersionedAuthenticationDisclosureControlObservation::current(
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
            )
        }

        fn facts(actionability: PageControlActionability) -> AuthenticationPageObservationFacts {
            AuthenticationPageObservationFacts {
                fields: AuthenticationFieldObservationFacts {
                    username_field_count: 1.into(),
                    current_password_field_count: 1.into(),
                    actionable_password_field_count: 1.into(),
                    ..Default::default()
                },
                credential_disclosure_control:
                    AuthenticationCredentialDisclosureControlObservation::Observed(vec![
                        Self::control(actionability),
                    ]),
                ..Default::default()
            }
        }

        fn readonly_facts(
            actionability: PageControlActionability,
        ) -> AuthenticationPageObservationFacts {
            let mut facts = Self::facts(actionability);
            facts.fields.actionable_password_field_count = 0.into();
            facts.fields.readonly_password_field_count = 1.into();
            facts
        }

        fn versioned_facts(
            actionability: PageControlActionability,
            schema_version: u32,
        ) -> AuthenticationPageObservationFacts {
            let mut facts = Self::facts(actionability);
            let AuthenticationCredentialDisclosureControlObservation::Observed(controls) =
                &mut facts.credential_disclosure_control
            else {
                unreachable!("fixture always owns one disclosure control");
            };
            controls[0].schema_version = schema_version.into();
            facts
        }

        fn field(
            field_index: field::Index,
            role: field::CredentialRole,
            editability: field::Editability,
        ) -> field::Observation {
            field::Credential {
                field_index,
                role,
                editability,
            }
            .into()
        }

        fn fields() -> [field::Observation; 2] {
            [
                Self::field(
                    field::Index::ZERO,
                    field::CredentialRole::Username,
                    field::Editability::Writable,
                ),
                Self::field(
                    field::Index::ONE,
                    field::CredentialRole::Password(field::Password::Current),
                    field::Editability::Writable,
                ),
            ]
        }

        fn planned() -> Result<
            AuthenticationCredentialDisclosureCapability,
            AuthenticationCredentialDisclosureRejection,
        > {
            let facts = Self::facts(PageControlActionability::Inert);
            facts.credential_disclosure_planning_decision().plan(
                &AuthenticationCredentialDisclosurePlanningRequest {
                    fields: &Self::fields(),
                },
            )
        }

        fn authorized() -> Result<
            AuthorizedAuthenticationUsernameDisclosure,
            AuthenticationCredentialDisclosureRejection,
        > {
            let facts = Self::facts(PageControlActionability::Inert);
            let fields = Self::fields();
            Self::planned()?.preflight(&AuthenticationCredentialDisclosurePreflightRequest {
                fresh_facts: &facts,
                fields: &fields,
            })
        }
    }

    #[test]
    fn unsupported_version_survives_every_disclosure_stage() -> anyhow::Result<()> {
        let mut control =
            OmittedMethodDisclosureScenario::control(PageControlActionability::Actionable);
        control.schema_version = 2.into();
        assert_eq!(
            control.classify(),
            AuthenticationDisclosureControlDecision::UnsupportedVersion
        );
        let serialized = serde_json::to_string(&control)?;
        assert_eq!(
            serde_json::from_str::<VersionedAuthenticationDisclosureControlObservation>(
                &serialized
            )?,
            control
        );
        let inert =
            OmittedMethodDisclosureScenario::versioned_facts(PageControlActionability::Inert, 2);
        assert!(matches!(
            inert.credential_disclosure_planning_decision(),
            AuthenticationCredentialDisclosurePlanningDecision::Rejected(
                AuthenticationCredentialDisclosureRejection::UnsupportedVersion(version)
            ) if u32::from(version) == 2
        ));
        assert!(matches!(
            inert.credential_disclosure_planning_decision().plan(
                &AuthenticationCredentialDisclosurePlanningRequest {
                    fields: &OmittedMethodDisclosureScenario::fields(),
                }
            ),
            Err(AuthenticationCredentialDisclosureRejection::UnsupportedVersion(version))
                if u32::from(version) == 2
        ));
        let fields = OmittedMethodDisclosureScenario::fields();
        assert!(matches!(
            OmittedMethodDisclosureScenario::planned()?.preflight(
                &AuthenticationCredentialDisclosurePreflightRequest {
                    fresh_facts: &inert,
                    fields: &fields,
                }
            ),
            Err(AuthenticationCredentialDisclosureRejection::UnsupportedVersion(version))
                if u32::from(version) == 2
        ));
        let authorized = OmittedMethodDisclosureScenario::authorized()?;
        let actionable = OmittedMethodDisclosureScenario::versioned_facts(
            PageControlActionability::Actionable,
            2,
        );
        assert!(matches!(
            authorized.password_continuation.consume(
                &AuthenticationPasswordDisclosureRequest {
                    fresh_facts: &actionable,
                    fields: &fields,
                }
            ),
            Err(AuthenticationCredentialDisclosureRejection::UnsupportedVersion(version))
                if u32::from(version) == 2
        ));
        Ok(())
    }

    #[test]
    fn version_and_generic_password_count_are_required_wire_fields() -> anyhow::Result<()> {
        let control = OmittedMethodDisclosureScenario::control(PageControlActionability::Inert);
        for field_name in ["schemaVersion", "genericPasswordFieldCount"] {
            let mut encoded = serde_json::to_value(&control)?;
            let serde_json::Value::Object(fields) = &mut encoded else {
                anyhow::bail!("versioned disclosure control must encode as an object");
            };
            match fields.remove(field_name) {
                Some(_) => {}
                None => anyhow::bail!("expected wire field {field_name}"),
            }
            assert!(
                serde_json::from_value::<VersionedAuthenticationDisclosureControlObservation>(
                    encoded
                )
                .is_err()
            );
        }
        Ok(())
    }

    #[test]
    fn legacy_page_facts_without_disclosure_evidence_decode_to_absent() -> anyhow::Result<()> {
        let mut encoded = serde_json::to_value(AuthenticationPageObservationFacts::default())?;
        let serde_json::Value::Object(fields) = &mut encoded else {
            anyhow::bail!("authentication page facts must encode as an object");
        };
        match fields.remove("credentialDisclosureControl") {
            Some(_) => {}
            None => anyhow::bail!("current page facts lack disclosure evidence"),
        }
        let decoded = serde_json::from_value::<AuthenticationPageObservationFacts>(encoded)?;
        assert!(matches!(
            decoded.credential_disclosure_control,
            AuthenticationCredentialDisclosureControlObservation::Absent
        ));
        assert!(matches!(
            decoded.credential_disclosure_planning_decision(),
            AuthenticationCredentialDisclosurePlanningDecision::Rejected(
                AuthenticationCredentialDisclosureRejection::ControlObservationAbsent
            )
        ));
        let mut invalid = OmittedMethodDisclosureScenario::facts(PageControlActionability::Inert);
        invalid.fields.username_field_count = 0.into();
        assert!(matches!(
            invalid.credential_disclosure_planning_decision(),
            AuthenticationCredentialDisclosurePlanningDecision::Rejected(
                AuthenticationCredentialDisclosureRejection::AuthenticationContextRejected
            )
        ));
        invalid.credential_disclosure_control =
            AuthenticationCredentialDisclosureControlObservation::Observed(Vec::new());
        assert!(matches!(
            invalid.credential_disclosure_planning_decision(),
            AuthenticationCredentialDisclosurePlanningDecision::Rejected(
                AuthenticationCredentialDisclosureRejection::MalformedControlObservation
            )
        ));
        Ok(())
    }

    #[test]
    fn exact_activation_is_positive_and_hostile_variants_fail_closed() {
        let control =
            OmittedMethodDisclosureScenario::control(PageControlActionability::Actionable);
        assert_eq!(
            control.classify(),
            AuthenticationDisclosureControlDecision::AdvancesAuthentication
        );
        let mutations: &[fn(&mut VersionedAuthenticationDisclosureControlObservation)] = &[
            |value| {
                value.observation.destination_identity =
                    "https://attacker.example/login".to_owned();
            },
            |value| {
                value.observation.destination_identity =
                    "https://login.example.test/recover".to_owned();
            },
            |value| value.observation.label = "Sign in with Google".to_owned(),
            |value| value.observation.form_identity = "signup".to_owned(),
            |value| value.observation.machine_identity = "provider".to_owned(),
            |value| {
                value.observation.authentication_username = AuthenticationUsernameEvidence::Strong;
            },
            |value| value.observation.semantics = PageControlSemantics::SemanticSubmit,
            |value| value.observation.submission_method = PageControlSubmissionMethod::Get,
            |value| {
                value.observation.submission_destination_source =
                    PageControlSubmissionDestinationSource::Authored;
            },
            |value| value.observation.ownership = PageControlOwnership::Unowned,
            |value| value.observation.actionability = PageControlActionability::Inert,
            |value| value.observation.password_field_count = 2.into(),
            |value| value.generic_password_field_count = 1.into(),
            |value| value.observation.new_password_field_count = 1.into(),
            |value| value.observation.one_time_code_field_count = 1.into(),
            |value| value.observation.semantic_submit_control_count = 1.into(),
            |value| {
                value.observation.source_origin =
                    "x".repeat(MAX_AUTHENTICATION_CONTROL_TEXT_BYTES + 1);
            },
        ];
        for mutation in mutations {
            let mut rejected = control.clone();
            mutation(&mut rejected);
            assert_eq!(
                rejected.classify(),
                AuthenticationDisclosureControlDecision::DoesNotAdvanceAuthentication
            );
        }
    }

    #[test]
    fn disclosure_requires_preflight_then_fresh_actionable_consumption() -> anyhow::Result<()> {
        let initial_facts = OmittedMethodDisclosureScenario::facts(PageControlActionability::Inert);
        let mut generic_fields = OmittedMethodDisclosureScenario::fields();
        generic_fields[1] = field::Credential {
            field_index: field::Index::ONE,
            role: field::CredentialRole::Password(field::Password::Generic),
            editability: field::Editability::Writable,
        }
        .into();
        assert!(matches!(
            initial_facts
                .credential_disclosure_planning_decision()
                .plan(&AuthenticationCredentialDisclosurePlanningRequest {
                    fields: &generic_fields,
                }),
            Err(AuthenticationCredentialDisclosureRejection::CredentialFieldsNotExact)
        ));
        let fields = OmittedMethodDisclosureScenario::fields();
        let authorized = OmittedMethodDisclosureScenario::authorized()?;
        assert_eq!(
            authorized.username_assignment.credential,
            credential_fill::CredentialKind::Username
        );
        assert_eq!(
            authorized.username_assignment.field_index,
            field::Index::ZERO
        );
        let actionable_facts =
            OmittedMethodDisclosureScenario::facts(PageControlActionability::Actionable);
        let password =
            authorized
                .password_continuation
                .consume(&AuthenticationPasswordDisclosureRequest {
                    fresh_facts: &actionable_facts,
                    fields: &fields,
                })?;
        assert_eq!(
            password.credential,
            credential_fill::CredentialKind::CurrentPassword
        );
        assert_eq!(password.field_index, field::Index::ONE);
        Ok(())
    }

    #[test]
    fn readonly_password_evidence_rejects_every_disclosure_stage() -> anyhow::Result<()> {
        let readonly_planning =
            OmittedMethodDisclosureScenario::readonly_facts(PageControlActionability::Inert);
        assert!(matches!(
            readonly_planning.credential_disclosure_planning_decision(),
            AuthenticationCredentialDisclosurePlanningDecision::Rejected(
                AuthenticationCredentialDisclosureRejection::AuthenticationContextRejected
            )
        ));

        let readonly_preflight =
            OmittedMethodDisclosureScenario::readonly_facts(PageControlActionability::Inert);
        assert!(matches!(
            OmittedMethodDisclosureScenario::planned()?.preflight(
                &AuthenticationCredentialDisclosurePreflightRequest {
                    fresh_facts: &readonly_preflight,
                    fields: &OmittedMethodDisclosureScenario::fields(),
                }
            ),
            Err(AuthenticationCredentialDisclosureRejection::AuthenticationContextRejected)
        ));

        let fields = OmittedMethodDisclosureScenario::fields();
        let authorized = OmittedMethodDisclosureScenario::authorized()?;
        let readonly_consumption =
            OmittedMethodDisclosureScenario::readonly_facts(PageControlActionability::Actionable);
        assert!(matches!(
            authorized
                .password_continuation
                .consume(&AuthenticationPasswordDisclosureRequest {
                    fresh_facts: &readonly_consumption,
                    fields: &fields,
                }),
            Err(AuthenticationCredentialDisclosureRejection::AuthenticationContextRejected)
        ));
        Ok(())
    }

    #[test]
    fn consumption_rejects_fresh_field_and_route_drift() -> anyhow::Result<()> {
        let fields = OmittedMethodDisclosureScenario::fields();
        let authorized = OmittedMethodDisclosureScenario::authorized()?;
        let actionable =
            OmittedMethodDisclosureScenario::facts(PageControlActionability::Actionable);
        let mut password_drift = fields;
        password_drift[1] = OmittedMethodDisclosureScenario::field(
            field::Index::TWO,
            field::CredentialRole::Password(field::Password::Current),
            field::Editability::Writable,
        );
        assert!(matches!(
            authorized
                .password_continuation
                .consume(&AuthenticationPasswordDisclosureRequest {
                    fresh_facts: &actionable,
                    fields: &password_drift,
                }),
            Err(AuthenticationCredentialDisclosureRejection::CredentialAssignmentsChanged)
        ));

        let authorized = OmittedMethodDisclosureScenario::authorized()?;
        let mut route_drift =
            OmittedMethodDisclosureScenario::facts(PageControlActionability::Actionable);
        let AuthenticationCredentialDisclosureControlObservation::Observed(controls) =
            &mut route_drift.credential_disclosure_control
        else {
            anyhow::bail!("scenario lacks disclosure control");
        };
        let Some(control) = controls.first_mut() else {
            anyhow::bail!("scenario lacks a versioned control");
        };
        control.observation.destination_identity =
            "https://login.example.test/account/delete".to_owned();
        assert!(matches!(
            authorized
                .password_continuation
                .consume(&AuthenticationPasswordDisclosureRequest {
                    fresh_facts: &route_drift,
                    fields: &fields,
                }),
            Err(AuthenticationCredentialDisclosureRejection::AuthenticationContextRejected)
        ));
        Ok(())
    }
}
