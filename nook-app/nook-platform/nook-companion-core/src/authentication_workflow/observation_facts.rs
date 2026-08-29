use super::{
    AuthenticationAdvanceControlEvidence, AuthenticationEnrollmentEvidence,
    AuthenticationFormObservationPriority, AuthenticationPageObservation,
    AuthenticationPageObservations, AuthenticationPasskeyEvidence, AuthenticationWorkflowMatch,
};
use crate::page_field_classification::{
    AuthenticationAdvanceControlObservation, AuthenticationUsernameEvidence, PageControlOwnership,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

mod ceremony;
mod passkey;
pub use ceremony::{
    AuthenticationCeremonyContextObservation, AuthenticationCeremonyObservationFacts,
    AuthenticationDetailedAdvanceControlObservation,
};
pub use passkey::{
    AuthenticationDetailedPasskeyControlObservation, AuthenticationPasskeyControlObservation,
};

/// Raw, non-secret field facts observed inside one authentication scope.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthenticationFieldObservationFacts {
    pub username_field_count: u32,
    pub current_password_field_count: u32,
    pub new_password_field_count: u32,
    pub generic_password_field_count: u32,
    pub one_time_code_field_count: u32,
}

impl AuthenticationFieldObservationFacts {
    /// Validate that detailed control evidence describes these same fields and scope.
    #[must_use]
    pub fn is_compatible_with_detailed_control(
        self,
        observation: &AuthenticationAdvanceControlObservation,
    ) -> bool {
        self.current_password_field_count
            .saturating_add(self.generic_password_field_count)
            .saturating_add(self.new_password_field_count)
            == observation.password_field_count
            && self.new_password_field_count == observation.new_password_field_count
            && self.one_time_code_field_count == observation.one_time_code_field_count
            && (self.username_field_count > 0)
                != matches!(
                    observation.authentication_username,
                    AuthenticationUsernameEvidence::Absent
                )
            && matches!(
                observation.ownership,
                PageControlOwnership::OwnedForm | PageControlOwnership::LocallyScoped
            )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationAuthenticatorSetupObservation {
    #[default]
    Absent,
    Present,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationBackupCodesObservation {
    #[default]
    Absent,
    Present,
}

/// Raw, non-secret authenticator and passkey facts for one authentication scope.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthenticationAuthenticatorObservationFacts {
    pub authenticator_setup: AuthenticationAuthenticatorSetupObservation,
    pub backup_codes: AuthenticationBackupCodesObservation,
    pub passkey_control: AuthenticationPasskeyControlObservation,
    pub matching_passkey_account_count: u32,
    /// Detailed evidence is classified in Rust; the legacy presence flag is ignored.
    #[serde(default)]
    pub detailed_passkey_control: AuthenticationDetailedPasskeyControlObservation,
}

impl AuthenticationAuthenticatorObservationFacts {
    const fn enrollment_evidence(&self) -> AuthenticationEnrollmentEvidence {
        match (self.authenticator_setup, self.backup_codes) {
            (
                AuthenticationAuthenticatorSetupObservation::Present,
                AuthenticationBackupCodesObservation::Present,
            ) => AuthenticationEnrollmentEvidence::AuthenticatorSetupAndBackupCodes,
            (
                AuthenticationAuthenticatorSetupObservation::Present,
                AuthenticationBackupCodesObservation::Absent,
            ) => AuthenticationEnrollmentEvidence::AuthenticatorSetup,
            (
                AuthenticationAuthenticatorSetupObservation::Absent,
                AuthenticationBackupCodesObservation::Present,
            ) => AuthenticationEnrollmentEvidence::BackupCodes,
            (
                AuthenticationAuthenticatorSetupObservation::Absent,
                AuthenticationBackupCodesObservation::Absent,
            ) => AuthenticationEnrollmentEvidence::Absent,
        }
    }

    fn passkey_evidence(&self) -> AuthenticationPasskeyEvidence {
        self.detailed_passkey_control
            .evidence(self.matching_passkey_account_count)
    }
}

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
        self.ceremony.is_bounded()
            && self.detailed_advance_control.is_bounded()
            && self.authenticator.detailed_passkey_control.is_bounded()
    }

    #[must_use]
    pub fn into_observation(self) -> AuthenticationPageObservation {
        let advance_control = self.detailed_advance_control.evidence(self.fields);
        let authenticated_ceremony_context = self
            .ceremony
            .authentication_context
            .is_authenticated(self.fields);
        AuthenticationPageObservation {
            username_field_count: self.fields.username_field_count,
            current_password_field_count: self.fields.current_password_field_count,
            new_password_field_count: self.fields.new_password_field_count,
            generic_password_field_count: self.fields.generic_password_field_count,
            one_time_code_field_count: self.fields.one_time_code_field_count,
            one_time_code_progression: self.ceremony.derived_one_time_code_progression(
                matches!(
                    advance_control,
                    AuthenticationAdvanceControlEvidence::Present
                ) || authenticated_ceremony_context,
            ),
            manual_checkpoint: self.ceremony.manual_checkpoint,
            enrollment_evidence: self.authenticator.enrollment_evidence(),
            advance_control,
            passkey: self.authenticator.passkey_evidence(),
        }
    }

    #[must_use]
    pub fn form_priority(self) -> AuthenticationFormObservationPriority {
        self.into_observation().form_priority()
    }
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
        if self
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
                .map(AuthenticationPageObservationFacts::into_observation)
                .collect(),
        };
        observations.classify()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::authentication_workflow::AuthenticationOneTimeCodeProgressionEvidence;
    use crate::page_field_classification::AuthenticationAdvanceControlDecision;

    fn detailed_one_time_code_control(
        form_identity: &str,
        destination_identity: &str,
        label: &str,
    ) -> AuthenticationPageObservationFacts {
        detailed_one_time_code_control_with_username(
            form_identity,
            destination_identity,
            label,
            crate::AuthenticationUsernameEvidence::Absent,
        )
    }

    fn detailed_one_time_code_control_with_username(
        form_identity: &str,
        destination_identity: &str,
        label: &str,
        authentication_username: crate::AuthenticationUsernameEvidence,
    ) -> AuthenticationPageObservationFacts {
        let username_field_count = u32::from(!matches!(
            authentication_username,
            crate::AuthenticationUsernameEvidence::Absent
        ));
        AuthenticationPageObservationFacts {
            fields: AuthenticationFieldObservationFacts {
                username_field_count,
                one_time_code_field_count: 1,
                ..Default::default()
            },
            detailed_advance_control: AuthenticationDetailedAdvanceControlObservation::Observed(
                AuthenticationAdvanceControlObservation {
                    actionability: crate::PageControlActionability::Actionable,
                    ownership: crate::PageControlOwnership::OwnedForm,
                    semantics: crate::PageControlSemantics::SemanticSubmit,
                    authentication_username,
                    password_field_count: 0,
                    new_password_field_count: 0,
                    one_time_code_field_count: 1,
                    semantic_submit_control_count: 1,
                    source_origin: "https://example.test".to_owned(),
                    form_identity: form_identity.to_owned(),
                    destination_identity: destination_identity.to_owned(),
                    label: label.to_owned(),
                },
            ),
            ..Default::default()
        }
    }

    fn password_control(
        authentication_username: crate::AuthenticationUsernameEvidence,
        ownership: crate::PageControlOwnership,
        destination_identity: &str,
        label: &str,
    ) -> AuthenticationAdvanceControlObservation {
        password_control_from_origin(
            "https://example.test",
            authentication_username,
            ownership,
            destination_identity,
            label,
        )
    }

    fn password_control_from_origin(
        source_origin: &str,
        authentication_username: crate::AuthenticationUsernameEvidence,
        ownership: crate::PageControlOwnership,
        destination_identity: &str,
        label: &str,
    ) -> AuthenticationAdvanceControlObservation {
        AuthenticationAdvanceControlObservation {
            actionability: crate::PageControlActionability::Actionable,
            ownership,
            semantics: crate::PageControlSemantics::SemanticSubmit,
            authentication_username,
            password_field_count: 1,
            new_password_field_count: 0,
            one_time_code_field_count: 0,
            semantic_submit_control_count: 1,
            source_origin: source_origin.to_owned(),
            form_identity: String::new(),
            destination_identity: destination_identity.to_owned(),
            label: label.to_owned(),
        }
    }

    #[test]
    fn rejects_semantic_evidence_outside_rust_vocabulary() {
        let input = serde_json::json!({
            "fields": {
                "usernameFieldCount": 1,
                "currentPasswordFieldCount": 0,
                "newPasswordFieldCount": 0,
                "genericPasswordFieldCount": 0,
                "oneTimeCodeFieldCount": 0
            },
            "ceremony": {
                "oneTimeCodeProgression": "future-progression",
                "manualCheckpoint": "absent",
                "advanceControl": "present"
            },
            "authenticator": {
                "authenticatorSetup": "absent",
                "backupCodes": "absent",
                "passkeyControl": "absent",
                "matchingPasskeyAccountCount": 0
            }
        });

        assert!(serde_json::from_value::<AuthenticationPageObservationFacts>(input).is_err());
    }

    #[test]
    fn trusts_only_classified_detailed_advance_control_evidence() {
        let detailed = AuthenticationPageObservationFacts {
            fields: AuthenticationFieldObservationFacts {
                username_field_count: 1,
                current_password_field_count: 1,
                ..Default::default()
            },
            ceremony: AuthenticationCeremonyObservationFacts {
                advance_control: AuthenticationAdvanceControlEvidence::Present,
                ..Default::default()
            },
            detailed_advance_control: AuthenticationDetailedAdvanceControlObservation::Observed(
                AuthenticationAdvanceControlObservation {
                    actionability: crate::PageControlActionability::Actionable,
                    ownership: crate::PageControlOwnership::OwnedForm,
                    semantics: crate::PageControlSemantics::SemanticSubmit,
                    authentication_username: crate::AuthenticationUsernameEvidence::Strong,
                    password_field_count: 1,
                    new_password_field_count: 0,
                    one_time_code_field_count: 0,
                    semantic_submit_control_count: 1,
                    source_origin: "https://example.test".to_owned(),
                    form_identity: "login".to_owned(),
                    destination_identity: String::new(),
                    label: "Continue".to_owned(),
                },
            ),
            ..Default::default()
        };
        let mut reduced_only = detailed.clone();
        reduced_only.detailed_advance_control =
            AuthenticationDetailedAdvanceControlObservation::Absent;

        assert_eq!(
            detailed.into_observation().advance_control,
            AuthenticationAdvanceControlEvidence::Present
        );
        assert_eq!(
            reduced_only.into_observation().advance_control,
            AuthenticationAdvanceControlEvidence::Absent
        );
    }

    #[test]
    fn rejects_mismatched_outer_and_nested_authentication_facts() {
        let signup_with_login_control = AuthenticationPageObservationFacts {
            fields: AuthenticationFieldObservationFacts {
                username_field_count: 1,
                new_password_field_count: 1,
                ..Default::default()
            },
            detailed_advance_control: AuthenticationDetailedAdvanceControlObservation::Observed(
                AuthenticationAdvanceControlObservation {
                    actionability: crate::PageControlActionability::Actionable,
                    ownership: crate::PageControlOwnership::OwnedForm,
                    semantics: crate::PageControlSemantics::SemanticSubmit,
                    authentication_username: crate::AuthenticationUsernameEvidence::Strong,
                    password_field_count: 1,
                    new_password_field_count: 0,
                    one_time_code_field_count: 0,
                    semantic_submit_control_count: 1,
                    source_origin: "https://example.test".to_owned(),
                    form_identity: "login-form".to_owned(),
                    destination_identity: String::new(),
                    label: "Continue".to_owned(),
                },
            ),
            ..Default::default()
        };

        assert_eq!(
            signup_with_login_control.into_observation().advance_control,
            AuthenticationAdvanceControlEvidence::Absent
        );
    }

    #[test]
    fn matches_detailed_total_password_count_across_field_kinds() {
        let control = AuthenticationAdvanceControlObservation {
            actionability: crate::PageControlActionability::Actionable,
            ownership: crate::PageControlOwnership::OwnedForm,
            semantics: crate::PageControlSemantics::SemanticSubmit,
            authentication_username: crate::AuthenticationUsernameEvidence::Absent,
            password_field_count: 1,
            new_password_field_count: 1,
            one_time_code_field_count: 0,
            semantic_submit_control_count: 1,
            source_origin: "https://example.test".to_owned(),
            form_identity: String::new(),
            destination_identity: String::new(),
            label: "Continue".to_owned(),
        };
        let new_password = AuthenticationFieldObservationFacts {
            new_password_field_count: 1,
            ..Default::default()
        };
        assert!(new_password.is_compatible_with_detailed_control(&control));

        let current_password = AuthenticationFieldObservationFacts {
            current_password_field_count: 1,
            ..Default::default()
        };
        let current_control = AuthenticationAdvanceControlObservation {
            new_password_field_count: 0,
            ..control.clone()
        };
        assert!(current_password.is_compatible_with_detailed_control(&current_control));

        let generic_password = AuthenticationFieldObservationFacts {
            generic_password_field_count: 1,
            ..Default::default()
        };
        assert!(generic_password.is_compatible_with_detailed_control(&current_control));

        let mismatched_total = AuthenticationAdvanceControlObservation {
            password_field_count: 2,
            ..control
        };
        assert!(!new_password.is_compatible_with_detailed_control(&mismatched_total));
    }

    #[test]
    fn derives_one_time_code_progression_from_trusted_handler_signal() {
        let forged = AuthenticationPageObservationFacts {
            fields: AuthenticationFieldObservationFacts {
                one_time_code_field_count: 1,
                ..Default::default()
            },
            ceremony: AuthenticationCeremonyObservationFacts {
                one_time_code_progression:
                    AuthenticationOneTimeCodeProgressionEvidence::AutoSubmitObserved,
                ..Default::default()
            },
            ..Default::default()
        };
        assert_eq!(
            forged.into_observation().one_time_code_progression,
            AuthenticationOneTimeCodeProgressionEvidence::AdvanceControlRequired
        );

        let mut trusted = detailed_one_time_code_control("auth", "", "Verify code");
        trusted.ceremony.one_time_code_handler_signal =
            "oninput=this.form.requestSubmit()".to_owned();
        assert_eq!(
            trusted.into_observation().one_time_code_progression,
            AuthenticationOneTimeCodeProgressionEvidence::AutoSubmitObserved
        );

        let control_less = AuthenticationPageObservationFacts {
            fields: AuthenticationFieldObservationFacts {
                one_time_code_field_count: 1,
                ..Default::default()
            },
            ceremony: AuthenticationCeremonyObservationFacts {
                one_time_code_handler_signal: "onchange=this.form.submit()".to_owned(),
                authentication_context: AuthenticationCeremonyContextObservation {
                    authentication_username: AuthenticationUsernameEvidence::Absent,
                    source_origin: "https://example.test".to_owned(),
                    form_identity: "otp-challenge".to_owned(),
                    destination_identity: "/verify".to_owned(),
                },
                ..Default::default()
            },
            ..Default::default()
        };
        assert_eq!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![control_less],
            }
            .classify()
            .snapshot()
            .map(|snapshot| snapshot.kind),
            Ok(crate::authentication_workflow::AuthenticationWorkflowKind::TotpChallenge)
        );
    }

    #[test]
    fn rejects_oversized_one_time_code_handler_signal() {
        let facts = AuthenticationPageObservationFacts {
            fields: AuthenticationFieldObservationFacts {
                one_time_code_field_count: 1,
                ..Default::default()
            },
            ceremony: AuthenticationCeremonyObservationFacts {
                one_time_code_handler_signal: format!(
                    "oninput=this.form.submit(){}",
                    "x".repeat(
                        crate::page_field_classification::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
                    )
                ),
                ..Default::default()
            },
            ..Default::default()
        };

        assert_eq!(
            facts.clone().into_observation().one_time_code_progression,
            AuthenticationOneTimeCodeProgressionEvidence::AdvanceControlRequired
        );
        assert_eq!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![facts],
            }
            .classify(),
            AuthenticationWorkflowMatch::Rejected
        );
    }

    #[test]
    fn rejects_missing_outer_username_for_strong_nested_username() {
        let login_control = AuthenticationAdvanceControlObservation {
            actionability: crate::PageControlActionability::Actionable,
            ownership: crate::PageControlOwnership::OwnedForm,
            semantics: crate::PageControlSemantics::SemanticSubmit,
            authentication_username: crate::AuthenticationUsernameEvidence::Strong,
            password_field_count: 1,
            new_password_field_count: 0,
            one_time_code_field_count: 0,
            semantic_submit_control_count: 1,
            source_origin: "https://example.test".to_owned(),
            form_identity: String::new(),
            destination_identity: String::new(),
            label: "Continue".to_owned(),
        };
        let fields = AuthenticationFieldObservationFacts {
            current_password_field_count: 1,
            ..Default::default()
        };

        assert!(!fields.is_compatible_with_detailed_control(&login_control));
        assert_eq!(
            (AuthenticationPageObservationFacts {
                fields,
                detailed_advance_control: AuthenticationDetailedAdvanceControlObservation::Observed(
                    login_control
                ),
                ..Default::default()
            })
            .into_observation()
            .advance_control,
            AuthenticationAdvanceControlEvidence::Absent
        );
    }

    #[test]
    fn rejects_oversized_detailed_control_batch() {
        let facts = AuthenticationPageObservationFacts {
            detailed_advance_control: AuthenticationDetailedAdvanceControlObservation::Observed(
                AuthenticationAdvanceControlObservation {
                    actionability: crate::PageControlActionability::Inert,
                    ownership: crate::PageControlOwnership::Unowned,
                    semantics: crate::PageControlSemantics::Activation,
                    authentication_username: crate::AuthenticationUsernameEvidence::Absent,
                    password_field_count: 0,
                    new_password_field_count: 0,
                    one_time_code_field_count: 0,
                    semantic_submit_control_count: 0,
                    source_origin: "https://example.test".to_owned(),
                    form_identity: String::new(),
                    destination_identity: String::new(),
                    label: "x".repeat(
                        crate::page_field_classification::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES + 1,
                    ),
                },
            ),
            ..Default::default()
        };
        assert_eq!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![facts],
            }
            .classify(),
            AuthenticationWorkflowMatch::Rejected
        );
    }

    #[test]
    fn session_termination_controls_never_advance_authentication() {
        let control = |form_identity: &str, destination_identity: &str, label: &str| {
            AuthenticationAdvanceControlObservation {
                actionability: crate::PageControlActionability::Actionable,
                ownership: crate::PageControlOwnership::OwnedForm,
                semantics: crate::PageControlSemantics::SemanticSubmit,
                authentication_username: crate::AuthenticationUsernameEvidence::Absent,
                password_field_count: 1,
                new_password_field_count: 0,
                one_time_code_field_count: 0,
                semantic_submit_control_count: 1,
                source_origin: "https://example.test".to_owned(),
                form_identity: form_identity.to_owned(),
                destination_identity: destination_identity.to_owned(),
                label: label.to_owned(),
            }
        };
        for observed in [
            control("/auth/logoff", "", "Log off"),
            control("signoff", "", "Continue"),
            control("", "/auth/logoff", "Continue"),
            control("auth", "", "Sign off"),
        ] {
            assert_eq!(
                observed.classify(),
                AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication
            );
        }
    }

    #[test]
    fn generic_oauth_authorization_advances_only_a_primary_login() {
        let control = password_control;
        for evidence in [
            crate::AuthenticationUsernameEvidence::Strong,
            crate::AuthenticationUsernameEvidence::Explicit,
        ] {
            assert_eq!(
                control(
                    evidence,
                    crate::PageControlOwnership::OwnedForm,
                    "/oauth2/authorize",
                    "Sign in",
                )
                .classify(),
                AuthenticationAdvanceControlDecision::AdvancesAuthentication
            );
        }
        for rejected in [
            control(
                crate::AuthenticationUsernameEvidence::Generic,
                crate::PageControlOwnership::OwnedForm,
                "/oauth2/authorize",
                "Sign in",
            ),
            control(
                crate::AuthenticationUsernameEvidence::Strong,
                crate::PageControlOwnership::Unowned,
                "/oauth2/authorize",
                "Sign in",
            ),
            control(
                crate::AuthenticationUsernameEvidence::Strong,
                crate::PageControlOwnership::OwnedForm,
                "/oauth/google",
                "Sign in",
            ),
            control(
                crate::AuthenticationUsernameEvidence::Explicit,
                crate::PageControlOwnership::OwnedForm,
                "/oauth2/authorize/google",
                "Sign in",
            ),
            control(
                crate::AuthenticationUsernameEvidence::Strong,
                crate::PageControlOwnership::OwnedForm,
                "/oauth2/authorize",
                "Continue with Google",
            ),
            control(
                crate::AuthenticationUsernameEvidence::Explicit,
                crate::PageControlOwnership::OwnedForm,
                "/oauth2/authorize",
                "Continue with Apple",
            ),
            control(
                crate::AuthenticationUsernameEvidence::Strong,
                crate::PageControlOwnership::OwnedForm,
                "/oauth2/authorize",
                "Google Sign in",
            ),
            control(
                crate::AuthenticationUsernameEvidence::Explicit,
                crate::PageControlOwnership::OwnedForm,
                "/oauth2/authorize",
                "Apple Login",
            ),
            control(
                crate::AuthenticationUsernameEvidence::Strong,
                crate::PageControlOwnership::OwnedForm,
                "/oauth2/authorize",
                "Sign in Google",
            ),
            control(
                crate::AuthenticationUsernameEvidence::Explicit,
                crate::PageControlOwnership::OwnedForm,
                "/oauth2/authorize",
                "Continue",
            ),
        ] {
            assert_eq!(
                rejected.classify(),
                AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication
            );
        }
    }

    #[test]
    fn provider_hostnames_do_not_override_login_route_identity() {
        for (evidence, source_origin, destination) in [
            (
                crate::AuthenticationUsernameEvidence::Strong,
                "https://github.com",
                "https://github.com/session",
            ),
            (
                crate::AuthenticationUsernameEvidence::Explicit,
                "https://gitlab.com",
                "https://gitlab.com/users/sign_in",
            ),
            (
                crate::AuthenticationUsernameEvidence::Explicit,
                "https://github.com",
                "//github.com/session",
            ),
        ] {
            assert_eq!(
                password_control_from_origin(
                    source_origin,
                    evidence,
                    crate::PageControlOwnership::OwnedForm,
                    destination,
                    "Sign in",
                )
                .classify(),
                AuthenticationAdvanceControlDecision::AdvancesAuthentication
            );
        }
        for evidence in [
            crate::AuthenticationUsernameEvidence::Generic,
            crate::AuthenticationUsernameEvidence::StandardsBasedEmail,
        ] {
            for (source_origin, destination) in [
                ("https://github.com", "https://github.com/session"),
                ("https://gitlab.com", "//gitlab.com/users/sign_in"),
            ] {
                assert_eq!(
                    password_control_from_origin(
                        source_origin,
                        evidence,
                        crate::PageControlOwnership::OwnedForm,
                        destination,
                        "Sign in",
                    )
                    .classify(),
                    AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication,
                    "{evidence:?} {destination}"
                );
            }
        }
        for (destination, label) in [
            ("/oauth/github", "Sign in"),
            ("/login/google", "Sign in"),
            ("https://accounts.google.com/o/oauth2/v2/auth", "Sign in"),
            ("https://github.com/login/oauth/authorize", "Sign in"),
            ("https://github.com/session", "Continue with GitHub"),
        ] {
            assert_eq!(
                password_control(
                    crate::AuthenticationUsernameEvidence::Strong,
                    crate::PageControlOwnership::OwnedForm,
                    destination,
                    label,
                )
                .classify(),
                AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication,
                "{destination} {label}"
            );
        }
    }

    #[test]
    fn one_time_code_controls_require_affirmative_authentication_context() -> anyhow::Result<()> {
        let neutral = detailed_one_time_code_control("verification", "/verify", "Confirm");
        assert_eq!(
            neutral.clone().into_observation().advance_control,
            AuthenticationAdvanceControlEvidence::Absent
        );
        assert_eq!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![neutral.clone()],
            }
            .classify(),
            AuthenticationWorkflowMatch::NoMatch
        );

        for contextual in [
            detailed_one_time_code_control("auth", "", "Confirm"),
            detailed_one_time_code_control("", "/mfa/challenge", "Siguiente"),
            detailed_one_time_code_control("", "", "Verify TOTP"),
        ] {
            assert_eq!(
                contextual.clone().into_observation().advance_control,
                AuthenticationAdvanceControlEvidence::Present
            );
            let classified = AuthenticationPageObservationFactsBatch {
                observations: vec![contextual.clone()],
            }
            .classify();
            let AuthenticationWorkflowMatch::Matched(snapshot) = classified else {
                panic!("contextual one-time-code control was rejected: {contextual:?}");
            };
            assert_eq!(
                snapshot.kind,
                crate::authentication_workflow::AuthenticationWorkflowKind::TotpChallenge
            );
        }

        let neutral_username = detailed_one_time_code_control_with_username(
            "verification",
            "/verify",
            "Confirm",
            crate::AuthenticationUsernameEvidence::Explicit,
        );
        assert_eq!(
            neutral_username.clone().into_observation().advance_control,
            AuthenticationAdvanceControlEvidence::Absent
        );
        assert_eq!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![neutral_username],
            }
            .classify(),
            AuthenticationWorkflowMatch::NoMatch
        );

        for evidence in [
            crate::AuthenticationUsernameEvidence::Generic,
            crate::AuthenticationUsernameEvidence::StandardsBasedEmail,
        ] {
            assert_eq!(
                detailed_one_time_code_control_with_username("", "", "Siguiente", evidence)
                    .into_observation()
                    .advance_control,
                AuthenticationAdvanceControlEvidence::Absent
            );
        }

        let mut neutral_auto_submit = neutral;
        neutral_auto_submit.ceremony.one_time_code_handler_signal =
            "oninput=this.form.requestSubmit()".to_owned();
        assert_eq!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![neutral_auto_submit],
            }
            .classify(),
            AuthenticationWorkflowMatch::NoMatch
        );

        let mut authentication_auto_submit =
            detailed_one_time_code_control("auth", "", "Verify code");
        authentication_auto_submit
            .ceremony
            .one_time_code_handler_signal = "oninput=this.form.requestSubmit()".to_owned();
        assert_eq!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![authentication_auto_submit],
            }
            .classify()
            .snapshot()?
            .kind,
            crate::authentication_workflow::AuthenticationWorkflowKind::TotpChallenge
        );
        Ok(())
    }

    #[test]
    fn rejects_auto_submitted_transaction_one_time_code() {
        let mut transaction =
            detailed_one_time_code_control("transaction-confirmation", "/transfer", "Confirm");
        transaction.ceremony.one_time_code_handler_signal = "oninput=this.form.submit()".to_owned();

        let observation = transaction.clone().into_observation();
        assert_eq!(
            observation.one_time_code_progression,
            AuthenticationOneTimeCodeProgressionEvidence::AdvanceControlRequired
        );
        assert_eq!(
            observation.advance_control,
            AuthenticationAdvanceControlEvidence::Absent
        );
        assert_eq!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![transaction],
            }
            .classify(),
            AuthenticationWorkflowMatch::NoMatch
        );
    }

    #[test]
    fn financial_one_time_code_controls_cannot_outrank_a_real_login() -> anyhow::Result<()> {
        for identity in [
            "Transfer funds",
            "Wire funds",
            "Withdraw",
            "Withdrawal",
            "Deposit",
            "Send money",
            "Financial transaction",
            "Authorize transaction",
            "Transaction authorization",
        ] {
            for observed in [
                detailed_one_time_code_control(identity, "", "Continue"),
                detailed_one_time_code_control("", identity, "Continue"),
                detailed_one_time_code_control("", "", identity),
            ] {
                assert_eq!(
                    observed.into_observation().advance_control,
                    AuthenticationAdvanceControlEvidence::Absent
                );
            }
        }

        let authentication_code = detailed_one_time_code_control("auth", "", "Verify code");
        assert_eq!(
            authentication_code
                .clone()
                .into_observation()
                .advance_control,
            AuthenticationAdvanceControlEvidence::Present
        );
        let code_snapshot = AuthenticationPageObservationFactsBatch {
            observations: vec![authentication_code],
        }
        .classify()
        .snapshot()?;
        assert_eq!(
            code_snapshot.kind,
            crate::authentication_workflow::AuthenticationWorkflowKind::TotpChallenge
        );

        let login = AuthenticationPageObservationFacts {
            fields: AuthenticationFieldObservationFacts {
                username_field_count: 1,
                generic_password_field_count: 1,
                ..Default::default()
            },
            detailed_advance_control: AuthenticationDetailedAdvanceControlObservation::Observed(
                AuthenticationAdvanceControlObservation {
                    actionability: crate::PageControlActionability::Actionable,
                    ownership: crate::PageControlOwnership::OwnedForm,
                    semantics: crate::PageControlSemantics::SemanticSubmit,
                    authentication_username: crate::AuthenticationUsernameEvidence::Strong,
                    password_field_count: 1,
                    new_password_field_count: 0,
                    one_time_code_field_count: 0,
                    semantic_submit_control_count: 1,
                    source_origin: "https://example.test".to_owned(),
                    form_identity: "login".to_owned(),
                    destination_identity: String::new(),
                    label: "Sign in".to_owned(),
                },
            ),
            ..Default::default()
        };
        let snapshot = AuthenticationPageObservationFactsBatch {
            observations: vec![
                detailed_one_time_code_control("", "", "Transfer funds"),
                login,
            ],
        }
        .classify()
        .snapshot()?;
        assert_eq!(
            snapshot.kind,
            crate::authentication_workflow::AuthenticationWorkflowKind::Login
        );
        assert_eq!(
            snapshot.action,
            crate::authentication_workflow::AuthenticationWorkflowAction::ContinueWithNook
        );
        assert_eq!(snapshot.observation_index, 1);
        Ok(())
    }
}
