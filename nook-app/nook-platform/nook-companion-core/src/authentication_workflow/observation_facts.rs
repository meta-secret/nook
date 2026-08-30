use super::{
    AuthenticationAdvanceControlEvidence, AuthenticationFormObservationPriority,
    AuthenticationManualCheckpoint, AuthenticationPageObservation, AuthenticationPageObservations,
    AuthenticationWorkflowMatch,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

mod authenticator;
mod ceremony;
mod fields;
mod passkey;
pub use authenticator::{
    AuthenticationAuthenticatorObservationFacts, AuthenticationAuthenticatorSetupObservation,
    AuthenticationBackupCodesObservation,
};
pub use ceremony::{
    AuthenticationCeremonyContextObservation, AuthenticationCeremonyObservationFacts,
    AuthenticationDetailedAdvanceControlObservation,
};
pub use fields::AuthenticationFieldObservationFacts;
pub use passkey::{
    AuthenticationDetailedPasskeyControlCandidateObservation,
    AuthenticationDetailedPasskeyControlObservation, AuthenticationPasskeyControlObservation,
    authentication_passkey_control_candidate_is_safe,
    authentication_passkey_control_evidence_is_safe,
};

/// Raw browser facts grouped by the authentication domains that own their conversion.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthenticationPageObservationFacts {
    pub fields: AuthenticationFieldObservationFacts,
    pub ceremony: AuthenticationCeremonyObservationFacts,
    pub authenticator: AuthenticationAuthenticatorObservationFacts,
    /// Detailed control evidence is classified in Rust; the reduced ceremony flag stays fail-closed.
    #[serde(default)]
    pub detailed_advance_control: AuthenticationDetailedAdvanceControlObservation,
}

impl AuthenticationPageObservationFacts {
    fn is_bounded(&self) -> bool {
        self.fields.is_bounded()
            && self.authenticator.matching_passkey_account_count
                <= crate::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT
            && self.ceremony.is_bounded()
            && self.detailed_advance_control.is_bounded()
            && self.authenticator.detailed_passkey_control.is_bounded()
    }

    #[must_use]
    pub(crate) fn into_observation(self) -> AuthenticationPageObservation {
        AuthenticationPageObservation {
            username_field_count: self.fields.username_field_count,
            current_password_field_count: self.fields.current_password_field_count,
            new_password_field_count: self.fields.new_password_field_count,
            generic_password_field_count: self.fields.generic_password_field_count,
            one_time_code_field_count: self.fields.one_time_code_field_count,
            manual_checkpoint_present: matches!(
                self.ceremony.manual_checkpoint,
                AuthenticationManualCheckpoint::Present
            ),
            authenticator_setup_hint: self.authenticator.authenticator_setup_hint(),
            backup_codes_hint: self.authenticator.backup_codes_hint(),
            passkey_control_present: self.authenticator.passkey_control_present(self.fields),
            matching_passkey_account_count: self.authenticator.matching_passkey_account_count,
        }
    }

    #[must_use]
    pub fn form_priority(self) -> AuthenticationFormObservationPriority {
        if self.is_bounded() && self.has_progression() {
            self.into_observation().form_priority()
        } else {
            AuthenticationPageObservation::default().form_priority()
        }
    }

    fn has_progression(&self) -> bool {
        let trusted_context = self
            .ceremony
            .authentication_context
            .is_authenticated(self.fields);
        matches!(
            self.detailed_advance_control.evidence(self.fields),
            AuthenticationAdvanceControlEvidence::Present
        ) || self.authenticator.passkey_control_present(self.fields)
            || self.ceremony.has_safe_implicit_submission(self.fields)
            || matches!(
                self.ceremony.manual_checkpoint,
                AuthenticationManualCheckpoint::Present
            )
            || self.authenticator.authenticator_setup_hint()
            || self.authenticator.backup_codes_hint()
            || matches!(
                self.ceremony
                    .derived_one_time_code_progression(trusted_context),
                super::AuthenticationOneTimeCodeProgressionEvidence::AutoSubmitObserved
            )
    }
}

/// Rank one browser form observation from typed facts before the host applies its bounded scan.
#[must_use]
pub fn authentication_page_observation_facts_priority(
    facts: AuthenticationPageObservationFacts,
) -> u8 {
    facts.form_priority().value()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthenticationPageObservationFactsBatch {
    pub observations: Vec<AuthenticationPageObservationFacts>,
}

impl AuthenticationPageObservationFactsBatch {
    #[must_use]
    pub fn classify(&self) -> AuthenticationWorkflowMatch {
        if self.observations.len() > crate::MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS
            || self
                .observations
                .iter()
                .any(|observation| !observation.is_bounded())
        {
            return AuthenticationWorkflowMatch::Rejected;
        }
        let observations = AuthenticationPageObservations {
            observations: self
                .observations
                .iter()
                .cloned()
                .map(|observation| {
                    if observation.has_progression() {
                        observation.into_observation()
                    } else {
                        AuthenticationPageObservation::default()
                    }
                })
                .collect(),
        };
        super::classify_authentication_workflow_candidates(&observations.observations)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AuthenticationAdvanceControlObservation, AuthenticationUsernameEvidence,
        AuthenticationWorkflowKind, PageControlActionability, PageControlOwnership,
        PageControlSemantics,
    };

    fn password_login() -> AuthenticationPageObservationFacts {
        AuthenticationPageObservationFacts {
            fields: AuthenticationFieldObservationFacts {
                username_field_count: 1,
                current_password_field_count: 1,
                ..Default::default()
            },
            detailed_advance_control: AuthenticationDetailedAdvanceControlObservation::observed(
                AuthenticationAdvanceControlObservation {
                    actionability: PageControlActionability::Actionable,
                    ownership: PageControlOwnership::OwnedForm,
                    semantics: PageControlSemantics::SemanticSubmit,
                    authentication_username: AuthenticationUsernameEvidence::Strong,
                    password_field_count: 1,
                    new_password_field_count: 0,
                    one_time_code_field_count: 0,
                    semantic_submit_control_count: 1,
                    source_origin: "https://example.test".to_owned(),
                    form_identity: "login".to_owned(),
                    destination_identity: "https://example.test/login".to_owned(),
                    label: "Continue".to_owned(),
                    machine_identity: String::new(),
                },
            ),
            ..Default::default()
        }
    }

    #[test]
    fn detailed_control_produces_actionable_login() {
        let result = AuthenticationPageObservationFactsBatch {
            observations: vec![password_login()],
        }
        .classify();
        assert!(matches!(
            result,
            AuthenticationWorkflowMatch::Matched(snapshot)
                if snapshot.kind == AuthenticationWorkflowKind::Login
        ));
    }

    #[test]
    fn reduced_and_mismatched_control_claims_fail_closed() {
        let mut reduced = password_login();
        reduced.detailed_advance_control = AuthenticationDetailedAdvanceControlObservation::Absent;
        reduced.ceremony.advance_control = AuthenticationAdvanceControlEvidence::Present;
        assert_eq!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![reduced],
            }
            .classify(),
            AuthenticationWorkflowMatch::NoMatch
        );

        let mut mismatched = password_login();
        mismatched.fields.current_password_field_count = 2;
        assert_eq!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![mismatched],
            }
            .classify(),
            AuthenticationWorkflowMatch::NoMatch
        );
    }

    #[test]
    fn oversized_detailed_control_batch_is_rejected() {
        let observation = password_login();
        let control = match &observation.detailed_advance_control {
            AuthenticationDetailedAdvanceControlObservation::Observed(controls) => {
                controls[0].clone()
            }
            AuthenticationDetailedAdvanceControlObservation::Absent => unreachable!(),
        };
        let mut oversized = observation;
        oversized.detailed_advance_control =
            AuthenticationDetailedAdvanceControlObservation::Observed(vec![
                control;
                crate::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT
                    as usize
                    + 1
            ]);
        assert_eq!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![oversized],
            }
            .classify(),
            AuthenticationWorkflowMatch::Rejected
        );
    }

    #[test]
    fn oversized_sibling_field_counts_reject_the_entire_fact_batch() {
        let mut oversized = password_login();
        oversized.fields.username_field_count = crate::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT + 1;
        assert_eq!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![password_login(), oversized],
            }
            .classify(),
            AuthenticationWorkflowMatch::Rejected
        );
        assert!(matches!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![password_login()],
            }
            .classify(),
            AuthenticationWorkflowMatch::Matched(_)
        ));
    }

    #[test]
    fn excessive_flat_counts_are_rejected_before_progression_reduction() {
        let mut observation = AuthenticationPageObservationFacts::default();
        observation.fields.username_field_count =
            crate::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT + 1;
        assert_eq!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![observation],
            }
            .classify(),
            AuthenticationWorkflowMatch::Rejected
        );

        let mut observation = AuthenticationPageObservationFacts::default();
        observation.authenticator.matching_passkey_account_count =
            crate::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT + 1;
        assert_eq!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![observation],
            }
            .classify(),
            AuthenticationWorkflowMatch::Rejected
        );

        let mut observation = password_login();
        observation.authenticator.matching_passkey_account_count =
            crate::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT;
        assert!(matches!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![observation],
            }
            .classify(),
            AuthenticationWorkflowMatch::Matched(_)
        ));

        let mut observation = password_login();
        observation.fields.current_password_field_count = 50;
        observation.fields.generic_password_field_count = 51;
        assert_eq!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![observation],
            }
            .classify(),
            AuthenticationWorkflowMatch::Rejected
        );
    }

    #[test]
    fn rust_rejected_otp_controls_do_not_keep_progressing_form_priority() {
        let otp = AuthenticationPageObservationFacts {
            fields: AuthenticationFieldObservationFacts {
                one_time_code_field_count: 1,
                ..Default::default()
            },
            detailed_advance_control: AuthenticationDetailedAdvanceControlObservation::observed(
                AuthenticationAdvanceControlObservation {
                    actionability: PageControlActionability::Actionable,
                    ownership: PageControlOwnership::OwnedForm,
                    semantics: PageControlSemantics::SemanticSubmit,
                    authentication_username: AuthenticationUsernameEvidence::Absent,
                    password_field_count: 0,
                    new_password_field_count: 0,
                    one_time_code_field_count: 1,
                    semantic_submit_control_count: 1,
                    source_origin: "https://example.test".to_owned(),
                    form_identity: "otp".to_owned(),
                    destination_identity: "https://example.test/otp".to_owned(),
                    label: "Delete account".to_owned(),
                    machine_identity: "delete-account".to_owned(),
                },
            ),
            ..Default::default()
        };
        let otp_priority = otp.clone().form_priority();
        assert_eq!(
            otp_priority,
            AuthenticationFormObservationPriority::default()
        );
        assert_eq!(authentication_page_observation_facts_priority(otp), 1);
        assert!(password_login().form_priority() > otp_priority);
        assert_eq!(
            authentication_page_observation_facts_priority(password_login()),
            4
        );
    }

    #[test]
    fn unbounded_high_priority_facts_are_isolated_before_form_selection() {
        let valid_priority = password_login().form_priority();
        let mut unbounded = password_login();
        unbounded.fields.one_time_code_field_count =
            crate::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT + 1;

        let isolated_priority = unbounded.form_priority();
        assert_eq!(
            isolated_priority,
            AuthenticationFormObservationPriority::default()
        );
        assert!(isolated_priority < valid_priority);
    }

    #[test]
    fn explicit_passkey_marker_authenticates_a_generic_control_label() {
        let control = AuthenticationAdvanceControlObservation {
            actionability: PageControlActionability::Actionable,
            ownership: PageControlOwnership::LocallyScoped,
            semantics: PageControlSemantics::Activation,
            authentication_username: AuthenticationUsernameEvidence::Absent,
            password_field_count: 0,
            new_password_field_count: 0,
            one_time_code_field_count: 0,
            semantic_submit_control_count: 0,
            source_origin: "https://example.test".to_owned(),
            form_identity: "login".to_owned(),
            destination_identity: "https://example.test/login".to_owned(),
            label: "Continue".to_owned(),
            machine_identity: String::new(),
        };
        let facts = AuthenticationPageObservationFacts {
            authenticator: AuthenticationAuthenticatorObservationFacts {
                detailed_passkey_control:
                    AuthenticationDetailedPasskeyControlObservation::ExplicitlyMarked(control),
                ..Default::default()
            },
            ..Default::default()
        };

        assert!(authentication_passkey_control_evidence_is_safe(
            &facts.authenticator.detailed_passkey_control
        ));
        assert!(facts.into_observation().passkey_control_present);
    }

    #[test]
    fn later_safe_passkey_candidate_survives_an_inert_first_candidate() {
        let candidate = |actionability, label: &str| AuthenticationAdvanceControlObservation {
            actionability,
            ownership: PageControlOwnership::LocallyScoped,
            semantics: PageControlSemantics::Activation,
            authentication_username: AuthenticationUsernameEvidence::Absent,
            password_field_count: 0,
            new_password_field_count: 0,
            one_time_code_field_count: 0,
            semantic_submit_control_count: 0,
            source_origin: "https://example.test".to_owned(),
            form_identity: "login".to_owned(),
            destination_identity: "https://example.test/login".to_owned(),
            label: label.to_owned(),
            machine_identity: String::new(),
        };
        let facts = AuthenticationPageObservationFacts {
            authenticator: AuthenticationAuthenticatorObservationFacts {
                detailed_passkey_control:
                    AuthenticationDetailedPasskeyControlObservation::Candidates(vec![
                        AuthenticationDetailedPasskeyControlCandidateObservation::Labeled(
                            candidate(PageControlActionability::Inert, "Use passkey"),
                        ),
                        AuthenticationDetailedPasskeyControlCandidateObservation::Labeled(
                            candidate(PageControlActionability::Actionable, "Use passkey"),
                        ),
                    ]),
                ..Default::default()
            },
            ..Default::default()
        };

        assert!(facts.into_observation().passkey_control_present);
    }

    #[test]
    fn implicit_owned_form_submission_preserves_password_login() {
        let facts = AuthenticationPageObservationFacts {
            fields: AuthenticationFieldObservationFacts {
                username_field_count: 1,
                current_password_field_count: 1,
                ..Default::default()
            },
            ceremony: AuthenticationCeremonyObservationFacts {
                authentication_context: AuthenticationCeremonyContextObservation {
                    authentication_username: AuthenticationUsernameEvidence::Strong,
                    source_origin: "https://example.test".to_owned(),
                    form_identity: "login".to_owned(),
                    destination_identity: "https://example.test/session".to_owned(),
                },
                advance_control: AuthenticationAdvanceControlEvidence::ImplicitSubmission,
                ..Default::default()
            },
            ..Default::default()
        };

        assert!(matches!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![facts],
            }
            .classify(),
            AuthenticationWorkflowMatch::Matched(snapshot)
                if snapshot.kind == AuthenticationWorkflowKind::Login
        ));
    }

    #[test]
    fn implicit_credential_creation_admits_register_destinations() {
        let facts = AuthenticationPageObservationFacts {
            fields: AuthenticationFieldObservationFacts {
                username_field_count: 1,
                new_password_field_count: 1,
                ..Default::default()
            },
            ceremony: AuthenticationCeremonyObservationFacts {
                authentication_context: AuthenticationCeremonyContextObservation {
                    authentication_username: AuthenticationUsernameEvidence::Strong,
                    source_origin: "https://example.test".to_owned(),
                    form_identity: "signup-form".to_owned(),
                    destination_identity: "https://example.test/register".to_owned(),
                },
                advance_control: AuthenticationAdvanceControlEvidence::ImplicitSubmission,
                ..Default::default()
            },
            ..Default::default()
        };

        assert!(matches!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![facts],
            }
            .classify(),
            AuthenticationWorkflowMatch::Matched(snapshot)
                if snapshot.kind == AuthenticationWorkflowKind::Signup
        ));
    }

    #[test]
    fn implicit_credential_creation_rejects_destructive_register_destinations() {
        let facts = AuthenticationPageObservationFacts {
            fields: AuthenticationFieldObservationFacts {
                username_field_count: 1,
                new_password_field_count: 1,
                ..Default::default()
            },
            ceremony: AuthenticationCeremonyObservationFacts {
                authentication_context: AuthenticationCeremonyContextObservation {
                    authentication_username: AuthenticationUsernameEvidence::Strong,
                    source_origin: "https://example.test".to_owned(),
                    form_identity: "signup-form".to_owned(),
                    destination_identity: "https://example.test/account/delete/register".to_owned(),
                },
                advance_control: AuthenticationAdvanceControlEvidence::ImplicitSubmission,
                ..Default::default()
            },
            ..Default::default()
        };

        assert!(!matches!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![facts],
            }
            .classify(),
            AuthenticationWorkflowMatch::Matched(_)
        ));
    }

    #[test]
    fn localized_login_labels_are_positive_current_password_identity() {
        for label in ["Anmelden", "Se connecter"] {
            let mut facts = password_login();
            if let AuthenticationDetailedAdvanceControlObservation::Observed(controls) =
                &mut facts.detailed_advance_control
            {
                controls[0].form_identity.clear();
                controls[0].destination_identity = "https://example.test/session".to_owned();
                controls[0].label = label.to_owned();
            }
            assert!(matches!(
                AuthenticationPageObservationFactsBatch {
                    observations: vec![facts],
                }
                .classify(),
                AuthenticationWorkflowMatch::Matched(snapshot)
                    if snapshot.kind == AuthenticationWorkflowKind::Login
            ));
        }
    }

    #[test]
    fn otp_auto_submit_requires_authenticated_ceremony_context() {
        let mut otp = AuthenticationPageObservationFacts {
            fields: AuthenticationFieldObservationFacts {
                one_time_code_field_count: 1,
                ..Default::default()
            },
            ceremony: AuthenticationCeremonyObservationFacts {
                one_time_code_handler_signal: "oninput=this.form.requestSubmit()".to_owned(),
                authentication_context: AuthenticationCeremonyContextObservation {
                    authentication_username: AuthenticationUsernameEvidence::Absent,
                    source_origin: "https://example.test".to_owned(),
                    form_identity: "otp verification".to_owned(),
                    destination_identity: "https://example.test/login/verify".to_owned(),
                },
                ..Default::default()
            },
            ..Default::default()
        };
        assert!(matches!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![otp.clone()],
            }
            .classify(),
            AuthenticationWorkflowMatch::Matched(snapshot)
                if snapshot.kind == AuthenticationWorkflowKind::TotpChallenge
        ));

        otp.ceremony.authentication_context.form_identity = "checkout confirmation".to_owned();
        otp.ceremony.authentication_context.destination_identity =
            "https://example.test/checkout/confirm".to_owned();
        assert_eq!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![otp.clone()],
            }
            .classify(),
            AuthenticationWorkflowMatch::NoMatch
        );

        otp.ceremony.authentication_context.form_identity = String::new();
        otp.ceremony.authentication_context.destination_identity = String::new();
        assert_eq!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![otp.clone()],
            }
            .classify(),
            AuthenticationWorkflowMatch::NoMatch
        );

        otp.ceremony.authentication_context.destination_identity =
            "https://example.test/login/verify".to_owned();
        assert!(matches!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![otp],
            }
            .classify(),
            AuthenticationWorkflowMatch::Matched(snapshot)
                if snapshot.kind == AuthenticationWorkflowKind::TotpChallenge
        ));
    }

    #[test]
    fn passkey_evidence_must_match_the_surrounding_field_scope() {
        let control = AuthenticationAdvanceControlObservation {
            actionability: PageControlActionability::Actionable,
            ownership: PageControlOwnership::LocallyScoped,
            semantics: PageControlSemantics::Activation,
            authentication_username: AuthenticationUsernameEvidence::Explicit,
            password_field_count: 0,
            new_password_field_count: 0,
            one_time_code_field_count: 0,
            semantic_submit_control_count: 0,
            source_origin: "https://example.test".to_owned(),
            form_identity: "login".to_owned(),
            destination_identity: "https://example.test/login".to_owned(),
            label: "Use passkey".to_owned(),
            machine_identity: String::new(),
        };
        let facts = AuthenticationPageObservationFacts {
            fields: AuthenticationFieldObservationFacts {
                one_time_code_field_count: 1,
                ..Default::default()
            },
            authenticator: AuthenticationAuthenticatorObservationFacts {
                detailed_passkey_control:
                    AuthenticationDetailedPasskeyControlObservation::Candidates(vec![
                        AuthenticationDetailedPasskeyControlCandidateObservation::Labeled(control),
                    ]),
                ..Default::default()
            },
            ..Default::default()
        };

        assert!(authentication_passkey_control_evidence_is_safe(
            &facts.authenticator.detailed_passkey_control
        ));
        assert!(!facts.authenticator.passkey_control_present(facts.fields));
        assert_eq!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![facts],
            }
            .classify(),
            AuthenticationWorkflowMatch::NoMatch
        );
    }

    #[test]
    fn oversized_fact_batches_are_rejected_before_scanning_entries() {
        let observations =
            vec![password_login(); crate::MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS + 1];
        assert_eq!(
            AuthenticationPageObservationFactsBatch { observations }.classify(),
            AuthenticationWorkflowMatch::Rejected
        );
    }

    #[test]
    fn otp_handler_candidates_are_classified_independently() {
        let otp = AuthenticationPageObservationFacts {
            fields: AuthenticationFieldObservationFacts {
                one_time_code_field_count: 1,
                ..Default::default()
            },
            ceremony: AuthenticationCeremonyObservationFacts {
                one_time_code_handler_signals: vec![
                    "onchange=validateCode()".to_owned(),
                    "oninput=this.form.requestSubmit()".to_owned(),
                ],
                authentication_context: AuthenticationCeremonyContextObservation {
                    authentication_username: AuthenticationUsernameEvidence::Absent,
                    source_origin: "https://example.test".to_owned(),
                    form_identity: "otp verification".to_owned(),
                    destination_identity: "https://example.test/login/verify".to_owned(),
                },
                ..Default::default()
            },
            ..Default::default()
        };

        assert!(matches!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![otp],
            }
            .classify(),
            AuthenticationWorkflowMatch::Matched(snapshot)
                if snapshot.kind == AuthenticationWorkflowKind::TotpChallenge
        ));
    }

    #[test]
    fn otp_auto_submit_survives_only_when_a_rust_recognized_handler_is_kept() {
        let invalid = "oninput=validate_requestSubmit()".to_owned();
        let mut signals = vec![invalid; crate::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT as usize];
        let invalid_only = AuthenticationPageObservationFacts {
            fields: AuthenticationFieldObservationFacts {
                one_time_code_field_count: 1,
                ..Default::default()
            },
            ceremony: AuthenticationCeremonyObservationFacts {
                one_time_code_handler_signals: signals.clone(),
                authentication_context: AuthenticationCeremonyContextObservation {
                    authentication_username: AuthenticationUsernameEvidence::Absent,
                    source_origin: "https://example.test".to_owned(),
                    form_identity: "otp verification".to_owned(),
                    destination_identity: "https://example.test/login/verify".to_owned(),
                },
                ..Default::default()
            },
            ..Default::default()
        };
        assert_eq!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![invalid_only],
            }
            .classify(),
            AuthenticationWorkflowMatch::NoMatch
        );

        *signals.last_mut().expect("handler capacity") = "oninput=this.form.submit()".to_owned();
        let kept_submit = AuthenticationPageObservationFacts {
            fields: AuthenticationFieldObservationFacts {
                one_time_code_field_count: 1,
                ..Default::default()
            },
            ceremony: AuthenticationCeremonyObservationFacts {
                one_time_code_handler_signals: signals,
                authentication_context: AuthenticationCeremonyContextObservation {
                    authentication_username: AuthenticationUsernameEvidence::Absent,
                    source_origin: "https://example.test".to_owned(),
                    form_identity: "otp verification".to_owned(),
                    destination_identity: "https://example.test/login/verify".to_owned(),
                },
                ..Default::default()
            },
            ..Default::default()
        };
        assert!(matches!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![kept_submit],
            }
            .classify(),
            AuthenticationWorkflowMatch::Matched(snapshot)
                if snapshot.kind == AuthenticationWorkflowKind::TotpChallenge
        ));
    }
}
