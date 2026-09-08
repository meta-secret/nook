#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::{AuthenticationFieldObservationFacts, AuthenticationPageObservationFacts};
use crate::credential_fill::{self, field};
use crate::page_field_classification::{
    AuthenticationAdvanceControlObservation, AuthenticationUsernameEvidence,
    MAX_AUTHENTICATION_CONTROL_TEXT_BYTES, PageControlActionability, PageControlOwnership,
    PageControlSemantics, PageControlSubmissionDestinationSource, PageControlSubmissionMethod,
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

/// Typed result of validating full-page evidence for exceptional disclosure planning.
#[derive(Debug)]
pub enum AuthenticationCredentialDisclosurePlanningDecision {
    Rejected(credential_fill::CredentialFillRejection),
    Approved(Box<AuthenticationCredentialDisclosurePlanningCapability>),
}

/// Opaque authority that must be checked before the username is written.
#[derive(Debug)]
pub struct AuthenticationCredentialDisclosureCapability {
    approved_facts: AuthenticationPageObservationFacts,
    username_assignment: credential_fill::Assignment,
    password_assignment: credential_fill::Assignment,
}

/// Named fresh-facts request for the pre-username effect boundary.
pub struct AuthenticationCredentialDisclosurePreflightRequest<'a> {
    pub fresh_facts: &'a AuthenticationPageObservationFacts,
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
///     let _ = continuation.consume(first);
///     let _ = continuation.consume(second);
/// }
/// ```
#[derive(Debug)]
pub struct AuthenticationPasswordDisclosureContinuation {
    approved_facts: AuthenticationPageObservationFacts,
    password_assignment: credential_fill::Assignment,
}

/// Named fresh-facts request for the password effect boundary.
pub struct AuthenticationPasswordDisclosureRequest<'a> {
    pub fresh_facts: &'a AuthenticationPageObservationFacts,
}

impl AuthenticationCredentialDisclosurePlanningDecision {
    pub fn plan(
        self,
        request: AuthenticationCredentialDisclosurePlanningRequest<'_>,
    ) -> Result<
        AuthenticationCredentialDisclosureCapability,
        credential_fill::CredentialFillRejection,
    > {
        let Self::Approved(approval) = self else {
            return Err(credential_fill::CredentialFillRejection::AuthenticationContextRejected);
        };
        let exact_fields = request.fields.len() == 2
            && request
                .fields
                .iter()
                .filter(|observation| {
                    matches!(
                        observation,
                        field::Observation::Credential(field::Credential {
                            role: field::CredentialRole::Username,
                            editability: field::Editability::Writable,
                            ..
                        })
                    )
                })
                .count()
                == 1
            && request
                .fields
                .iter()
                .filter(|observation| {
                    matches!(
                        observation,
                        field::Observation::Credential(field::Credential {
                            role: field::CredentialRole::Password(field::Password::Current),
                            editability: field::Editability::Writable,
                            ..
                        })
                    )
                })
                .count()
                == 1;
        if !exact_fields {
            return Err(credential_fill::CredentialFillRejection::AuthenticationContextRejected);
        }
        let plan = credential_fill::Plan::from_fields(request.fields)?;
        let [username_assignment, password_assignment] = plan.assignments.as_slice() else {
            return Err(credential_fill::CredentialFillRejection::AuthenticationContextRejected);
        };
        if !matches!(
            username_assignment.credential,
            credential_fill::CredentialKind::Username
        ) || !matches!(
            password_assignment.credential,
            credential_fill::CredentialKind::CurrentPassword
        ) {
            return Err(credential_fill::CredentialFillRejection::AuthenticationContextRejected);
        }
        Ok(AuthenticationCredentialDisclosureCapability {
            approved_facts: approval.approved_facts,
            username_assignment: username_assignment.clone(),
            password_assignment: password_assignment.clone(),
        })
    }
}

impl AuthenticationCredentialDisclosureCapability {
    pub fn preflight(
        self,
        request: AuthenticationCredentialDisclosurePreflightRequest<'_>,
    ) -> Result<AuthorizedAuthenticationUsernameDisclosure, credential_fill::CredentialFillRejection>
    {
        if request.fresh_facts != &self.approved_facts
            || !request.fresh_facts.is_bounded()
            || !request
                .fresh_facts
                .credential_disclosure_control
                .has_planning_evidence(request.fresh_facts.fields)
        {
            return Err(credential_fill::CredentialFillRejection::AuthenticationContextRejected);
        }
        Ok(AuthorizedAuthenticationUsernameDisclosure {
            username_assignment: self.username_assignment,
            password_continuation: AuthenticationPasswordDisclosureContinuation {
                approved_facts: self.approved_facts,
                password_assignment: self.password_assignment,
            },
        })
    }
}

impl AuthenticationPasswordDisclosureContinuation {
    pub fn consume(
        self,
        request: AuthenticationPasswordDisclosureRequest<'_>,
    ) -> Result<credential_fill::Assignment, credential_fill::CredentialFillRejection> {
        if !request.fresh_facts.is_bounded()
            || !request
                .fresh_facts
                .credential_disclosure_control
                .has_actionable_consumption_evidence(request.fresh_facts.fields)
        {
            return Err(credential_fill::CredentialFillRejection::AuthenticationContextRejected);
        }
        let mut normalized = request.fresh_facts.clone();
        normalized
            .credential_disclosure_control
            .normalize_expected_actionability();
        if normalized != self.approved_facts {
            return Err(credential_fill::CredentialFillRejection::AuthenticationContextRejected);
        }
        Ok(self.password_assignment)
    }
}

impl AuthenticationPageObservationFacts {
    /// Decide whether this exact full-page observation may plan exceptional disclosure.
    #[must_use]
    pub fn credential_disclosure_planning_decision(
        &self,
    ) -> AuthenticationCredentialDisclosurePlanningDecision {
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
                credential_fill::CredentialFillRejection::AuthenticationContextRejected,
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

        fn fields() -> [field::Observation; 2] {
            [
                field::Credential {
                    field_index: field::Index::ZERO,
                    role: field::CredentialRole::Username,
                    editability: field::Editability::Writable,
                }
                .into(),
                field::Credential {
                    field_index: field::Index::ONE,
                    role: field::CredentialRole::Password(field::Password::Current),
                    editability: field::Editability::Writable,
                }
                .into(),
            ]
        }

        fn planned() -> Result<
            AuthenticationCredentialDisclosureCapability,
            credential_fill::CredentialFillRejection,
        > {
            let facts = Self::facts(PageControlActionability::Inert);
            facts.credential_disclosure_planning_decision().plan(
                AuthenticationCredentialDisclosurePlanningRequest {
                    fields: &Self::fields(),
                },
            )
        }
    }

    #[test]
    fn versioned_control_reports_unsupported_versions_without_classifying() -> anyhow::Result<()> {
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
        assert_eq!(
            AuthenticationDisclosureObservationSchemaVersion::CURRENT.0,
            1
        );
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
    fn exact_activation_is_positive_and_hostile_variants_fail_closed() {
        let control =
            OmittedMethodDisclosureScenario::control(PageControlActionability::Actionable);
        assert_eq!(
            control.classify(),
            AuthenticationDisclosureControlDecision::AdvancesAuthentication
        );
        let mutations: &[fn(&mut VersionedAuthenticationDisclosureControlObservation)] = &[
            |value| {
                value.observation.destination_identity = "https://attacker.example/login".to_owned()
            },
            |value| {
                value.observation.destination_identity =
                    "https://login.example.test/recover".to_owned()
            },
            |value| value.observation.label = "Sign in with Google".to_owned(),
            |value| value.observation.form_identity = "signup".to_owned(),
            |value| value.observation.machine_identity = "provider".to_owned(),
            |value| {
                value.observation.authentication_username = AuthenticationUsernameEvidence::Strong
            },
            |value| value.observation.semantics = PageControlSemantics::SemanticSubmit,
            |value| value.observation.submission_method = PageControlSubmissionMethod::Get,
            |value| {
                value.observation.submission_destination_source =
                    PageControlSubmissionDestinationSource::Authored
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
                    "x".repeat(MAX_AUTHENTICATION_CONTROL_TEXT_BYTES + 1)
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
                .plan(AuthenticationCredentialDisclosurePlanningRequest {
                    fields: &generic_fields,
                }),
            Err(credential_fill::CredentialFillRejection::AuthenticationContextRejected)
        ));
        let capability = OmittedMethodDisclosureScenario::planned()?;
        let authorized =
            capability.preflight(AuthenticationCredentialDisclosurePreflightRequest {
                fresh_facts: &initial_facts,
            })?;
        assert_eq!(
            authorized.username_assignment.credential,
            credential_fill::CredentialKind::Username
        );
        let actionable_facts =
            OmittedMethodDisclosureScenario::facts(PageControlActionability::Actionable);
        let password =
            authorized
                .password_continuation
                .consume(AuthenticationPasswordDisclosureRequest {
                    fresh_facts: &actionable_facts,
                })?;
        assert_eq!(
            password.credential,
            credential_fill::CredentialKind::CurrentPassword
        );
        Ok(())
    }

    #[test]
    fn preflight_and_consumption_reject_drift() -> anyhow::Result<()> {
        let mut preflight_drift =
            OmittedMethodDisclosureScenario::facts(PageControlActionability::Inert);
        preflight_drift.fields.username_field_count = 2.into();
        assert!(matches!(
            OmittedMethodDisclosureScenario::planned()?.preflight(
                AuthenticationCredentialDisclosurePreflightRequest {
                    fresh_facts: &preflight_drift,
                }
            ),
            Err(credential_fill::CredentialFillRejection::AuthenticationContextRejected)
        ));

        let initial = OmittedMethodDisclosureScenario::facts(PageControlActionability::Inert);
        let authorized = OmittedMethodDisclosureScenario::planned()?.preflight(
            AuthenticationCredentialDisclosurePreflightRequest {
                fresh_facts: &initial,
            },
        )?;
        let mut password_drift =
            OmittedMethodDisclosureScenario::facts(PageControlActionability::Actionable);
        password_drift.fields.generic_password_field_count = 1.into();
        password_drift.fields.current_password_field_count = 0.into();
        assert!(matches!(
            authorized
                .password_continuation
                .consume(AuthenticationPasswordDisclosureRequest {
                    fresh_facts: &password_drift,
                }),
            Err(credential_fill::CredentialFillRejection::AuthenticationContextRejected)
        ));

        let authorized = OmittedMethodDisclosureScenario::planned()?.preflight(
            AuthenticationCredentialDisclosurePreflightRequest {
                fresh_facts: &initial,
            },
        )?;
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
                .consume(AuthenticationPasswordDisclosureRequest {
                    fresh_facts: &route_drift,
                }),
            Err(credential_fill::CredentialFillRejection::AuthenticationContextRejected)
        ));
        Ok(())
    }
}
