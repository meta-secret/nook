use super::{
    AuthenticationCredentialDisclosureControlObservation,
    AuthenticationDisclosureObservationSchemaVersion,
};
use crate::authentication_workflow::observation_facts::{
    AuthenticationCredentialSubmissionObservation, AuthenticationPageObservationFacts,
};
use crate::credential_fill::{self, field};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

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
            || !fresh_facts.credential_submission_is_absent()
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
            || !fresh_facts.credential_submission_is_absent()
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
    fn credential_submission_is_absent(&self) -> bool {
        matches!(
            self.credential_submission,
            AuthenticationCredentialSubmissionObservation::Absent
        )
    }

    /// Decide whether this exact full-page observation may plan exceptional disclosure.
    #[must_use]
    pub fn credential_disclosure_planning_decision(
        &self,
    ) -> AuthenticationCredentialDisclosurePlanningDecision {
        if let Some(rejection) = self.credential_disclosure_control.reader_rejection() {
            return AuthenticationCredentialDisclosurePlanningDecision::Rejected(rejection);
        }
        if self.is_bounded()
            && self.credential_submission_is_absent()
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
    use crate::authentication_workflow::observation_facts::{
        AuthenticationCredentialSubmissionFacts, AuthenticationFieldObservationFacts,
    };
    use crate::page_field_classification::{
        AuthenticationAdvanceControlObservation, AuthenticationUsernameEvidence,
        PageControlActionability, PageControlOwnership, PageControlSemantics,
        PageControlSubmissionDestinationSource, PageControlSubmissionMethod,
    };
    use crate::{
        AuthenticationCredentialDisclosureControlObservation,
        CurrentAuthenticationDisclosureControlRequest,
        VersionedAuthenticationDisclosureControlObservation,
    };

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

        fn versioned_facts(
            actionability: PageControlActionability,
            schema_version: u32,
        ) -> AuthenticationPageObservationFacts {
            let mut facts = Self::facts(actionability);
            Self::control_mut(&mut facts).schema_version = schema_version.into();
            facts
        }

        fn readonly_facts(
            actionability: PageControlActionability,
        ) -> AuthenticationPageObservationFacts {
            let mut facts = Self::facts(actionability);
            facts.fields.actionable_password_field_count = 0.into();
            facts.fields.readonly_password_field_count = 1.into();
            facts
        }

        fn insecure_facts(
            actionability: PageControlActionability,
        ) -> AuthenticationPageObservationFacts {
            let mut facts = Self::facts(actionability);
            let control = Self::control_mut(&mut facts);
            control.observation.source_origin = "http://login.example.test".to_owned();
            control.observation.destination_identity = "http://login.example.test/login".to_owned();
            facts
        }

        fn control_mut(
            facts: &mut AuthenticationPageObservationFacts,
        ) -> &mut VersionedAuthenticationDisclosureControlObservation {
            let AuthenticationCredentialDisclosureControlObservation::Observed(controls) =
                &mut facts.credential_disclosure_control
            else {
                panic!("scenario owns one disclosure control");
            };
            let Some(control) = controls.first_mut() else {
                unreachable!("scenario owns one control");
            };
            control
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

        fn observed_submission(
            method: PageControlSubmissionMethod,
        ) -> AuthenticationCredentialSubmissionObservation {
            AuthenticationCredentialSubmissionObservation::Observed(
                AuthenticationCredentialSubmissionFacts {
                    actionability: PageControlActionability::Actionable,
                    method,
                    source_origin: "https://login.example.test".to_owned(),
                    form_identity: String::new(),
                    destination_identity: "https://login.example.test/login".to_owned(),
                },
            )
        }
    }

    #[test]
    fn exact_transaction_releases_only_core_approved_assignments() -> anyhow::Result<()> {
        let authorized = OmittedMethodDisclosureScenario::authorized()?;
        assert_eq!(
            authorized.username_assignment,
            credential_fill::Assignment {
                field_index: field::Index::ZERO,
                credential: credential_fill::CredentialKind::Username,
            }
        );
        let fields = OmittedMethodDisclosureScenario::fields();
        let actionable =
            OmittedMethodDisclosureScenario::facts(PageControlActionability::Actionable);
        let password =
            authorized
                .password_continuation
                .consume(&AuthenticationPasswordDisclosureRequest {
                    fresh_facts: &actionable,
                    fields: &fields,
                })?;
        assert_eq!(
            password,
            credential_fill::Assignment {
                field_index: field::Index::ONE,
                credential: credential_fill::CredentialKind::CurrentPassword,
            }
        );
        Ok(())
    }

    #[test]
    fn generic_password_field_cannot_create_disclosure_authority() {
        let facts = OmittedMethodDisclosureScenario::facts(PageControlActionability::Inert);
        let mut fields = OmittedMethodDisclosureScenario::fields();
        fields[1] = OmittedMethodDisclosureScenario::field(
            field::Index::ONE,
            field::CredentialRole::Password(field::Password::Generic),
            field::Editability::Writable,
        );
        assert!(matches!(
            facts
                .credential_disclosure_planning_decision()
                .plan(&AuthenticationCredentialDisclosurePlanningRequest { fields: &fields }),
            Err(AuthenticationCredentialDisclosureRejection::CredentialFieldsNotExact)
        ));
    }

    #[test]
    fn unsupported_version_survives_every_disclosure_stage() -> anyhow::Result<()> {
        let inert =
            OmittedMethodDisclosureScenario::versioned_facts(PageControlActionability::Inert, 2);
        assert!(matches!(
            inert.credential_disclosure_planning_decision(),
            AuthenticationCredentialDisclosurePlanningDecision::Rejected(
                AuthenticationCredentialDisclosureRejection::UnsupportedVersion(version)
            ) if u32::from(version) == 2
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
        let actionable = OmittedMethodDisclosureScenario::versioned_facts(
            PageControlActionability::Actionable,
            2,
        );
        assert!(matches!(
            OmittedMethodDisclosureScenario::authorized()?
                .password_continuation
                .consume(&AuthenticationPasswordDisclosureRequest {
                    fresh_facts: &actionable,
                    fields: &fields,
                }),
            Err(AuthenticationCredentialDisclosureRejection::UnsupportedVersion(version))
                if u32::from(version) == 2
        ));
        Ok(())
    }

    #[test]
    fn effective_submission_rejects_planning_for_get_and_post() {
        for method in [
            PageControlSubmissionMethod::Get,
            PageControlSubmissionMethod::Post,
        ] {
            let mut facts = OmittedMethodDisclosureScenario::facts(PageControlActionability::Inert);
            facts.credential_submission =
                OmittedMethodDisclosureScenario::observed_submission(method);
            assert!(matches!(
                facts.credential_disclosure_planning_decision(),
                AuthenticationCredentialDisclosurePlanningDecision::Rejected(
                    AuthenticationCredentialDisclosureRejection::AuthenticationContextRejected
                )
            ));
        }
    }

    #[test]
    fn effective_submission_drift_rejects_preflight_and_consumption() -> anyhow::Result<()> {
        let fields = OmittedMethodDisclosureScenario::fields();
        let mut inert = OmittedMethodDisclosureScenario::facts(PageControlActionability::Inert);
        inert.credential_submission =
            OmittedMethodDisclosureScenario::observed_submission(PageControlSubmissionMethod::Post);
        assert!(matches!(
            OmittedMethodDisclosureScenario::planned()?.preflight(
                &AuthenticationCredentialDisclosurePreflightRequest {
                    fresh_facts: &inert,
                    fields: &fields,
                }
            ),
            Err(AuthenticationCredentialDisclosureRejection::AuthenticationContextRejected)
        ));
        let mut actionable =
            OmittedMethodDisclosureScenario::facts(PageControlActionability::Actionable);
        actionable.credential_submission =
            OmittedMethodDisclosureScenario::observed_submission(PageControlSubmissionMethod::Get);
        assert!(matches!(
            OmittedMethodDisclosureScenario::authorized()?
                .password_continuation
                .consume(&AuthenticationPasswordDisclosureRequest {
                    fresh_facts: &actionable,
                    fields: &fields,
                }),
            Err(AuthenticationCredentialDisclosureRejection::AuthenticationContextRejected)
        ));
        Ok(())
    }

    #[test]
    fn page_fact_drift_rejects_every_transaction_boundary() -> anyhow::Result<()> {
        for username_count in [0_u32, 2] {
            let mut facts = OmittedMethodDisclosureScenario::facts(PageControlActionability::Inert);
            facts.fields.username_field_count = username_count.into();
            assert!(matches!(
                facts.credential_disclosure_planning_decision(),
                AuthenticationCredentialDisclosurePlanningDecision::Rejected(
                    AuthenticationCredentialDisclosureRejection::AuthenticationContextRejected
                )
            ));
            assert!(matches!(
                OmittedMethodDisclosureScenario::planned()?.preflight(
                    &AuthenticationCredentialDisclosurePreflightRequest {
                        fresh_facts: &facts,
                        fields: &OmittedMethodDisclosureScenario::fields(),
                    }
                ),
                Err(AuthenticationCredentialDisclosureRejection::AuthenticationContextRejected)
            ));
        }
        let fields = OmittedMethodDisclosureScenario::fields();
        let mut actionable =
            OmittedMethodDisclosureScenario::facts(PageControlActionability::Actionable);
        actionable.fields.username_field_count = 2.into();
        assert!(matches!(
            OmittedMethodDisclosureScenario::authorized()?
                .password_continuation
                .consume(&AuthenticationPasswordDisclosureRequest {
                    fresh_facts: &actionable,
                    fields: &fields,
                }),
            Err(AuthenticationCredentialDisclosureRejection::AuthenticationContextRejected)
        ));
        Ok(())
    }

    #[test]
    fn readonly_password_and_insecure_origin_reject_every_boundary() -> anyhow::Result<()> {
        let fields = OmittedMethodDisclosureScenario::fields();
        for facts in [
            OmittedMethodDisclosureScenario::readonly_facts(PageControlActionability::Inert),
            OmittedMethodDisclosureScenario::insecure_facts(PageControlActionability::Inert),
        ] {
            assert!(matches!(
                facts.credential_disclosure_planning_decision(),
                AuthenticationCredentialDisclosurePlanningDecision::Rejected(
                    AuthenticationCredentialDisclosureRejection::AuthenticationContextRejected
                )
            ));
            assert!(matches!(
                OmittedMethodDisclosureScenario::planned()?.preflight(
                    &AuthenticationCredentialDisclosurePreflightRequest {
                        fresh_facts: &facts,
                        fields: &fields,
                    }
                ),
                Err(AuthenticationCredentialDisclosureRejection::AuthenticationContextRejected)
            ));
        }
        for facts in [
            OmittedMethodDisclosureScenario::readonly_facts(PageControlActionability::Actionable),
            OmittedMethodDisclosureScenario::insecure_facts(PageControlActionability::Actionable),
        ] {
            assert!(matches!(
                OmittedMethodDisclosureScenario::authorized()?
                    .password_continuation
                    .consume(&AuthenticationPasswordDisclosureRequest {
                        fresh_facts: &facts,
                        fields: &fields,
                    }),
                Err(AuthenticationCredentialDisclosureRejection::AuthenticationContextRejected)
            ));
        }
        Ok(())
    }

    #[test]
    fn preflight_rejects_fresh_field_drift() -> anyhow::Result<()> {
        let facts = OmittedMethodDisclosureScenario::facts(PageControlActionability::Inert);
        let fields = OmittedMethodDisclosureScenario::fields();
        let mutations: &[fn(&mut Vec<field::Observation>)] = &[
            |value| {
                value[0] = OmittedMethodDisclosureScenario::field(
                    field::Index::ZERO,
                    field::CredentialRole::Username,
                    field::Editability::Readonly,
                );
            },
            |value| {
                value[0] = OmittedMethodDisclosureScenario::field(
                    field::Index::ZERO,
                    field::CredentialRole::Password(field::Password::Current),
                    field::Editability::Writable,
                );
            },
            |value| {
                value[0] = OmittedMethodDisclosureScenario::field(
                    field::Index::TWO,
                    field::CredentialRole::Username,
                    field::Editability::Writable,
                );
            },
            |value| {
                value[0] = OmittedMethodDisclosureScenario::field(
                    field::Index::ONE,
                    field::CredentialRole::Username,
                    field::Editability::Writable,
                );
                value[1] = OmittedMethodDisclosureScenario::field(
                    field::Index::ZERO,
                    field::CredentialRole::Password(field::Password::Current),
                    field::Editability::Writable,
                );
            },
            |value| value.pop().map_or((), drop),
            |value| {
                value.push(OmittedMethodDisclosureScenario::field(
                    field::Index::TWO,
                    field::CredentialRole::Username,
                    field::Editability::Writable,
                ));
            },
        ];
        for mutation in mutations {
            let mut changed = fields.to_vec();
            mutation(&mut changed);
            assert!(matches!(
                OmittedMethodDisclosureScenario::planned()?.preflight(
                    &AuthenticationCredentialDisclosurePreflightRequest {
                        fresh_facts: &facts,
                        fields: &changed,
                    }
                ),
                Err(
                    AuthenticationCredentialDisclosureRejection::CredentialFieldsRejected(_)
                        | AuthenticationCredentialDisclosureRejection::CredentialFieldsNotExact
                        | AuthenticationCredentialDisclosureRejection::CredentialAssignmentsChanged
                )
            ));
        }
        Ok(())
    }

    #[test]
    fn duplicate_index_preserves_typed_rejection() -> anyhow::Result<()> {
        let facts = OmittedMethodDisclosureScenario::facts(PageControlActionability::Inert);
        let fields = OmittedMethodDisclosureScenario::fields();
        let duplicate = [
            fields[0],
            OmittedMethodDisclosureScenario::field(
                field::Index::ZERO,
                field::CredentialRole::Password(field::Password::Current),
                field::Editability::Writable,
            ),
        ];
        assert!(matches!(
            OmittedMethodDisclosureScenario::planned()?.preflight(
                &AuthenticationCredentialDisclosurePreflightRequest {
                    fresh_facts: &facts,
                    fields: &duplicate,
                }
            ),
            Err(
                AuthenticationCredentialDisclosureRejection::CredentialFieldsRejected(
                    credential_fill::CredentialFillRejection::DuplicateFieldIndex
                )
            )
        ));
        Ok(())
    }

    #[test]
    fn password_stage_rejects_assignment_and_route_drift() -> anyhow::Result<()> {
        let fields = OmittedMethodDisclosureScenario::fields();
        let mut changed = fields;
        changed[1] = OmittedMethodDisclosureScenario::field(
            field::Index::TWO,
            field::CredentialRole::Password(field::Password::Current),
            field::Editability::Writable,
        );
        let actionable =
            OmittedMethodDisclosureScenario::facts(PageControlActionability::Actionable);
        assert!(matches!(
            OmittedMethodDisclosureScenario::authorized()?
                .password_continuation
                .consume(&AuthenticationPasswordDisclosureRequest {
                    fresh_facts: &actionable,
                    fields: &changed,
                }),
            Err(AuthenticationCredentialDisclosureRejection::CredentialAssignmentsChanged)
        ));
        let mut route = actionable;
        OmittedMethodDisclosureScenario::control_mut(&mut route)
            .observation
            .destination_identity = "https://login.example.test/recover".to_owned();
        assert!(matches!(
            OmittedMethodDisclosureScenario::authorized()?
                .password_continuation
                .consume(&AuthenticationPasswordDisclosureRequest {
                    fresh_facts: &route,
                    fields: &fields,
                }),
            Err(AuthenticationCredentialDisclosureRejection::AuthenticationContextRejected)
        ));
        Ok(())
    }

    #[test]
    fn legacy_page_facts_without_disclosure_evidence_decode_to_absent() -> anyhow::Result<()> {
        let mut encoded = serde_json::to_value(AuthenticationPageObservationFacts::default())?;
        let serde_json::Value::Object(fields) = &mut encoded else {
            anyhow::bail!("authentication page facts must encode as an object");
        };
        fields
            .remove("credentialDisclosureControl")
            .ok_or_else(|| anyhow::anyhow!("current page facts lack disclosure evidence"))?;
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
        let mut malformed = OmittedMethodDisclosureScenario::facts(PageControlActionability::Inert);
        malformed.credential_disclosure_control =
            AuthenticationCredentialDisclosureControlObservation::Observed(Vec::new());
        assert!(matches!(
            malformed.credential_disclosure_planning_decision(),
            AuthenticationCredentialDisclosurePlanningDecision::Rejected(
                AuthenticationCredentialDisclosureRejection::MalformedControlObservation
            )
        ));
        Ok(())
    }
}
