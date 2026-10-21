use super::{AuthenticationPageObservation, AuthenticationPageObservationFacts};

impl AuthenticationPageObservationFacts {
    /// Fill eligibility does not grant permission to advance or submit the page.
    pub(super) fn into_workflow_observation(self) -> AuthenticationPageObservation {
        match (
            self.is_bounded(),
            self.has_progression()
                || self
                    .ceremony
                    .authentication_context
                    .is_authenticated(self.fields),
        ) {
            (true, true) => AuthenticationPageObservation::from(self),
            (false, _) | (true, false) => AuthenticationPageObservation::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AuthenticationAdvanceControlDecision, AuthenticationAdvanceControlEvidence,
        AuthenticationAdvanceControlObservation, AuthenticationCeremonyContextObservation,
        AuthenticationCeremonyObservationFacts, AuthenticationCredentialSubmissionFacts,
        AuthenticationCredentialSubmissionObservation,
        AuthenticationDetailedAdvanceControlObservation, AuthenticationFieldObservationFacts,
        AuthenticationFormObservationPriority, AuthenticationImplicitSubmitActuationObservation,
        AuthenticationOneTimeCodeProgressionEvidence, AuthenticationPageObservationFactsBatch,
        AuthenticationUsernameEvidence, AuthenticationWorkflowAction, AuthenticationWorkflowKind,
        AuthenticationWorkflowMatch, PageControlActionability, PageControlOwnership,
        PageControlSemantics, PageControlSubmissionDestinationSource, PageControlSubmissionMethod,
    };

    struct OtpChallengeScenario;

    impl OtpChallengeScenario {
        fn get_submit() -> AuthenticationAdvanceControlObservation {
            AuthenticationAdvanceControlObservation {
                actionability: PageControlActionability::Actionable,
                ownership: PageControlOwnership::OwnedForm,
                semantics: PageControlSemantics::SemanticSubmit,
                authentication_username: AuthenticationUsernameEvidence::Absent,
                password_field_count: 0.into(),
                new_password_field_count: 0.into(),
                one_time_code_field_count: 1.into(),
                semantic_submit_control_count: 1.into(),
                source_origin: "https://example.test".to_owned(),
                form_identity: String::new(),
                destination_identity: "https://example.test/twofa/totp/".to_owned(),
                label: "Submit".to_owned(),
                machine_identity: String::new(),
                submission_method: PageControlSubmissionMethod::Get,
                submission_destination_source: PageControlSubmissionDestinationSource::Authored,
            }
        }

        fn facts() -> AuthenticationPageObservationFacts {
            let control = Self::get_submit();
            AuthenticationPageObservationFacts {
                fields: AuthenticationFieldObservationFacts {
                    one_time_code_field_count: 1.into(),
                    ..Default::default()
                },
                ceremony: AuthenticationCeremonyObservationFacts {
                    authentication_context: AuthenticationCeremonyContextObservation {
                        authentication_username: control.authentication_username,
                        source_origin: control.source_origin.clone(),
                        form_identity: control.form_identity.clone(),
                        destination_identity: control.destination_identity.clone(),
                    },
                    ..Default::default()
                },
                credential_submission: AuthenticationCredentialSubmissionObservation::Observed(
                    AuthenticationCredentialSubmissionFacts {
                        actionability: control.actionability,
                        method: control.submission_method,
                        source_origin: control.source_origin.clone(),
                        form_identity: control.form_identity.clone(),
                        destination_identity: control.destination_identity.clone(),
                    },
                ),
                detailed_advance_control: AuthenticationDetailedAdvanceControlObservation::observed(
                    control,
                ),
                ..Default::default()
            }
        }

        fn assert_fill_only(facts: AuthenticationPageObservationFacts) {
            let expected_priority = AuthenticationPageObservation {
                one_time_code_field_count: 1.into(),
                ..Default::default()
            }
            .form_priority();
            assert_eq!(facts.clone().form_priority(), expected_priority);
            assert_eq!(
                facts
                    .clone()
                    .authentication_page_observation_facts_priority(),
                expected_priority
            );
            assert_eq!(
                facts.detailed_advance_control.evidence(facts.fields),
                AuthenticationAdvanceControlEvidence::Absent
            );
            assert_eq!(
                facts
                    .ceremony
                    .derived_one_time_code_progression(facts.fields),
                AuthenticationOneTimeCodeProgressionEvidence::AdvanceControlRequired
            );
            assert!(!facts.ceremony.has_safe_implicit_submission(facts.fields));
            let AuthenticationWorkflowMatch::Matched(snapshot) =
                (AuthenticationPageObservationFactsBatch {
                    observations: vec![facts],
                })
                .classify()
            else {
                panic!("expected a fill-only OTP challenge");
            };
            assert_eq!(snapshot.kind, AuthenticationWorkflowKind::TotpChallenge);
            assert_eq!(snapshot.action, AuthenticationWorkflowAction::FillTotp);
        }

        fn assert_no_match(facts: AuthenticationPageObservationFacts) {
            assert_eq!(
                facts.clone().form_priority(),
                AuthenticationFormObservationPriority::default()
            );
            assert_eq!(
                AuthenticationPageObservationFactsBatch {
                    observations: vec![facts],
                }
                .classify(),
                AuthenticationWorkflowMatch::NoMatch
            );
        }
    }

    #[test]
    fn otp_get_form_is_available_for_explicit_fill_without_submit_permission() {
        assert_eq!(
            OtpChallengeScenario::get_submit().classify(),
            AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication
        );
        let facts = OtpChallengeScenario::facts();
        assert!(
            !AuthenticationImplicitSubmitActuationObservation {
                fields: facts.fields,
                ceremony: facts.ceremony.clone(),
                control_label: String::new(),
                control_machine_identity: String::new(),
            }
            .is_safe()
        );
        OtpChallengeScenario::assert_fill_only(facts);
    }

    #[test]
    fn otp_fill_needs_no_control_or_auto_submit_handler() {
        let mut facts = OtpChallengeScenario::facts();
        facts.detailed_advance_control = AuthenticationDetailedAdvanceControlObservation::Absent;
        OtpChallengeScenario::assert_fill_only(facts);
    }

    #[test]
    fn otp_fill_excludes_unrelated_cross_origin_and_missing_context() {
        for destination in [
            "https://example.test/checkout/confirm",
            "https://example.test/search",
            "https://other.test/twofa/totp/",
            "",
        ] {
            let mut facts = OtpChallengeScenario::facts();
            facts.ceremony.authentication_context.destination_identity = destination.to_owned();
            OtpChallengeScenario::assert_no_match(facts);
        }
        let mut facts = OtpChallengeScenario::facts();
        facts.ceremony.authentication_context.form_identity = "delete account".to_owned();
        OtpChallengeScenario::assert_no_match(facts);
    }

    #[test]
    fn otp_fill_excludes_password_and_mismatched_username_contexts() {
        let mut password = OtpChallengeScenario::facts();
        password.fields.current_password_field_count = 1.into();
        password.fields.actionable_password_field_count = 1.into();
        OtpChallengeScenario::assert_no_match(password);

        let mut username = OtpChallengeScenario::facts();
        username.fields.username_field_count = 1.into();
        OtpChallengeScenario::assert_no_match(username);

        let mut no_otp = OtpChallengeScenario::facts();
        no_otp.fields.one_time_code_field_count = 0.into();
        OtpChallengeScenario::assert_no_match(no_otp);
    }

    #[test]
    fn unbounded_otp_facts_remain_rejected_before_fill_admission() {
        let mut facts = OtpChallengeScenario::facts();
        facts.fields.one_time_code_field_count =
            (crate::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT + 1).into();
        assert_eq!(
            facts.clone().form_priority(),
            AuthenticationFormObservationPriority::default()
        );
        assert_eq!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![facts],
            }
            .classify(),
            AuthenticationWorkflowMatch::Rejected
        );
    }
}
