//! Select the account identifier and new password from one submitted sign-up scope.
use super::{
    LoginCapturedFieldIndex, LoginSubmissionDecision, LoginSubmissionEvent, LoginSubmissionField,
    LoginSubmissionIntent, LoginSubmissionObservation, LoginSubmissionTarget,
};
use crate::credential_fill::field::{
    Credential, CredentialRole, Editability, Index, NewPassword, Observation, Password,
};
use crate::page_field_classification::{SubmittedCredentialIntent, SubmittedLoginControlAdmission};
use crate::{
    AuthenticationControlText, AuthenticationDetailedAdvanceControlObservation,
    AuthenticationFieldObservationFacts, AuthenticationPageObservation, AuthenticationWorkflowKind,
    AuthenticationWorkflowMatch, AuthenticationWorkflowStage, AutocompleteTokenQuery,
    PageInputFieldObservation,
};
use zeroize::Zeroize;

/// Registration wording on the submitted control, form, or route.
pub(super) const REGISTRATION_WORDS: [&str; 6] = [
    "signup",
    "sign up",
    "register",
    "registration",
    "create account",
    "new account",
];

/// Rust-derived equality of captured field values; it retains no value bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoginCapturedValueMatches {
    groups: Vec<LoginCapturedValueGroup>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LoginCapturedValueGroup {
    Empty,
    /// Position of the first captured field holding exactly the same bytes.
    Value(usize),
}

impl LoginCapturedValueMatches {
    #[must_use]
    pub fn from_values<V: AsRef<str>>(values: &[V]) -> Self {
        let groups = values
            .iter()
            .enumerate()
            .map(|(position, value)| {
                let value = value.as_ref();
                if value.is_empty() {
                    return LoginCapturedValueGroup::Empty;
                }
                LoginCapturedValueGroup::Value(
                    values
                        .iter()
                        .position(|other| other.as_ref() == value)
                        .unwrap_or(position),
                )
            })
            .collect();
        Self { groups }
    }

    /// Derive matches from browser-owned values, then wipe this copy.
    #[must_use]
    pub fn from_owned_values(mut values: Vec<String>) -> Self {
        let matches = Self::from_values(&values);
        values.zeroize();
        matches
    }

    #[must_use]
    pub(crate) fn len(&self) -> usize {
        self.groups.len()
    }

    fn same_nonempty_value(&self, left: Index, right: Index) -> bool {
        let group = |index: Index| {
            usize::try_from(u32::from(index))
                .ok()
                .and_then(|position| self.groups.get(position))
                .copied()
        };
        matches!(
            (group(left), group(right)),
            (
                Some(LoginCapturedValueGroup::Value(left)),
                Some(LoginCapturedValueGroup::Value(right))
            ) if left == right
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SignupConfirmation {
    Absent,
    Present(Index),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct SignupSelection {
    username: Index,
    password: Index,
    confirmation: SignupConfirmation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SignupSelectionMatch {
    Selected(SignupSelection),
    NotSignup,
}

pub(super) struct SignupScope<'a> {
    pub intent: &'a LoginSubmissionIntent,
    pub fields: &'a [LoginSubmissionField],
    pub observed: &'a [Observation],
    pub values: &'a LoginCapturedValueMatches,
}

impl SignupScope<'_> {
    /// A sign-up scope holds one new password, or a password and an identical
    /// confirmation, plus the account identifier preceding them. Any current,
    /// read-only, or one-time-code field leaves it to the existing flows.
    pub(super) fn select(&self) -> SignupSelectionMatch {
        let mut passwords = Vec::with_capacity(2);
        for observation in self.observed {
            match *observation {
                Observation::NewPassword(field) => passwords.push(field.field_index),
                Observation::Credential(Credential {
                    field_index,
                    role: CredentialRole::Password(Password::Generic),
                    editability: Editability::Writable,
                }) => passwords.push(field_index),
                Observation::Credential(Credential {
                    role: CredentialRole::Username,
                    ..
                }) => {}
                Observation::Credential(
                    Credential {
                        role: CredentialRole::Password(Password::Current),
                        ..
                    }
                    | Credential {
                        role: CredentialRole::Password(Password::Generic),
                        editability: Editability::Readonly,
                        ..
                    },
                )
                | Observation::OneTimeCode(_) => return SignupSelectionMatch::NotSignup,
            }
        }
        let (password, confirmation) = match passwords.as_slice() {
            [password] if self.is_new_password(*password) || self.registration_intent() => {
                (*password, SignupConfirmation::Absent)
            }
            [password, confirmation]
                if self.values.same_nonempty_value(*password, *confirmation) =>
            {
                (*password, SignupConfirmation::Present(*confirmation))
            }
            _ => return SignupSelectionMatch::NotSignup,
        };
        let Some(username) = self.account_identifier(password) else {
            return SignupSelectionMatch::NotSignup;
        };
        SignupSelectionMatch::Selected(SignupSelection {
            username,
            password,
            confirmation,
        })
    }

    fn is_new_password(&self, index: Index) -> bool {
        self.observed
            .iter()
            .any(|observation| *observation == Observation::from(NewPassword::from(index)))
    }

    fn registration_intent(&self) -> bool {
        let label = String::from(self.intent.control_label.clone());
        let context = &self.intent.context.ceremony.authentication_context;
        [
            label.as_str(),
            context.form_identity.as_str(),
            context.destination_identity.as_str(),
        ]
        .iter()
        .any(|text| {
            AuthenticationControlText::new(
                &AuthenticationControlText::new(text).expand_identity_text(),
            )
            .contains_any_word(&REGISTRATION_WORDS)
        })
    }

    /// Prefer the sole `autocomplete="username"` field; otherwise the nearest
    /// writable username-shaped field before the new password.
    fn account_identifier(&self, password: Index) -> Option<Index> {
        let usernames: Vec<Index> = self
            .observed
            .iter()
            .filter_map(|observation| match *observation {
                Observation::Credential(Credential {
                    field_index,
                    role: CredentialRole::Username,
                    editability: Editability::Writable,
                }) => Some(field_index),
                Observation::Credential(_)
                | Observation::NewPassword(_)
                | Observation::OneTimeCode(_) => None,
            })
            .collect();
        let explicit: Vec<Index> = usernames
            .iter()
            .copied()
            .filter(|index| self.has_username_token(*index))
            .collect();
        if let [username] = explicit.as_slice() {
            return Some(*username);
        }
        usernames
            .into_iter()
            .filter(|index| u32::from(*index) < u32::from(password))
            .max_by_key(|index| u32::from(*index))
    }

    fn has_username_token(&self, index: Index) -> bool {
        usize::try_from(u32::from(index))
            .ok()
            .and_then(|position| self.fields.get(position))
            .is_some_and(|field| {
                PageInputFieldObservation::has_autocomplete_token(AutocompleteTokenQuery {
                    tokens: &field.autocomplete_tokens,
                    expected: "username",
                })
            })
    }
}

impl SignupSelection {
    fn includes_target(self, target: LoginCapturedFieldIndex) -> bool {
        let confirmation = match self.confirmation {
            SignupConfirmation::Present(index) => target == LoginCapturedFieldIndex::from(index),
            SignupConfirmation::Absent => false,
        };
        confirmation
            || target == LoginCapturedFieldIndex::from(self.username)
            || target == LoginCapturedFieldIndex::from(self.password)
    }

    fn new_password_field_count(self) -> u32 {
        match self.confirmation {
            SignupConfirmation::Present(_) => 2,
            SignupConfirmation::Absent => 1,
        }
    }
}

impl LoginSubmissionObservation {
    /// Capture a sign-up through the same submission intent rules as a login,
    /// with registration wording admitted on the submitting control.
    pub(super) fn classify_signup(
        &self,
        observed: &[Observation],
        selection: SignupSelection,
    ) -> LoginSubmissionDecision {
        let AuthenticationWorkflowMatch::Matched(workflow) =
            self.intent.classify_signup_workflow(selection)
        else {
            return LoginSubmissionDecision::Ignored;
        };
        let (AuthenticationWorkflowKind::Signup, AuthenticationWorkflowStage::Credentials) =
            (workflow.kind, workflow.stage)
        else {
            return LoginSubmissionDecision::Ignored;
        };
        let SubmittedLoginControlAdmission::Admitted =
            self.submission_control_admission(observed, SubmittedCredentialIntent::Signup)
        else {
            return LoginSubmissionDecision::Ignored;
        };
        match (self.intent.event, self.intent.target) {
            (
                LoginSubmissionEvent::Enter,
                LoginSubmissionTarget::CredentialField { field_index },
            ) if selection.includes_target(field_index) => {}
            (
                LoginSubmissionEvent::FormSubmit | LoginSubmissionEvent::Click,
                LoginSubmissionTarget::CredentialScope,
            ) => {}
            (
                LoginSubmissionEvent::FormSubmit
                | LoginSubmissionEvent::Click
                | LoginSubmissionEvent::Enter
                | LoginSubmissionEvent::Other,
                LoginSubmissionTarget::CredentialScope
                | LoginSubmissionTarget::CredentialField { .. }
                | LoginSubmissionTarget::OutsideCredentialScope,
            ) => return LoginSubmissionDecision::Ignored,
        }
        LoginSubmissionDecision::Captured {
            username_field_index: LoginCapturedFieldIndex::from(selection.username),
            password_field_index: LoginCapturedFieldIndex::from(selection.password),
            workflow_kind: AuthenticationWorkflowKind::Signup,
        }
    }
}

impl LoginSubmissionIntent {
    fn classify_signup_workflow(&self, selection: SignupSelection) -> AuthenticationWorkflowMatch {
        let mut facts = self.context.clone();
        let new_passwords = selection.new_password_field_count().into();
        facts.fields = AuthenticationFieldObservationFacts {
            username_field_count: 1.into(),
            new_password_field_count: new_passwords,
            actionable_password_field_count: new_passwords,
            ..AuthenticationFieldObservationFacts::default()
        };
        facts.detailed_advance_control = AuthenticationDetailedAdvanceControlObservation::Absent;
        AuthenticationPageObservation::from(facts).classify_authentication_workflow()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AuthenticationAdvanceControlObservation, AuthenticationPageObservationFacts,
        AuthenticationUsernameEvidence, LoginControlLabel, LoginSubmissionTrust,
        OneTimeCodeEntryEvidence, PageControlActionability, PageControlOwnership,
        PageControlSemantics, PageControlSubmissionDestinationSource, PageControlSubmissionMethod,
        PageInputType,
    };

    struct Fixture;
    impl Fixture {
        fn input(
            input_type: PageInputType,
            tokens: &[&str],
            identity: &str,
        ) -> LoginSubmissionField {
            PageInputFieldObservation {
                input_type,
                disabled: false,
                read_only: false,
                autocomplete_tokens: tokens.iter().map(ToString::to_string).collect(),
                identity_text: identity.to_owned(),
                login_context: true.into(),
                one_time_code_entry: OneTimeCodeEntryEvidence::Unobserved,
            }
            .into()
        }

        fn email() -> LoginSubmissionField {
            Self::input(PageInputType::Email, &["email"], "Email")
        }

        fn password(identity: &str) -> LoginSubmissionField {
            Self::input(PageInputType::Password, &[], identity)
        }

        fn control(label: &str) -> AuthenticationAdvanceControlObservation {
            AuthenticationAdvanceControlObservation {
                actionability: PageControlActionability::Actionable,
                ownership: PageControlOwnership::OwnedForm,
                semantics: PageControlSemantics::SemanticSubmit,
                authentication_username: AuthenticationUsernameEvidence::Absent,
                password_field_count: 0.into(),
                new_password_field_count: 0.into(),
                one_time_code_field_count: 0.into(),
                semantic_submit_control_count: 0.into(),
                source_origin: "https://example.test".to_owned(),
                form_identity: String::new(),
                destination_identity: String::new(),
                label: label.to_owned(),
                machine_identity: String::new(),
                submission_method: PageControlSubmissionMethod::Absent,
                submission_destination_source: PageControlSubmissionDestinationSource::Omitted,
            }
        }

        fn submission(
            event: LoginSubmissionEvent,
            label: &str,
            fields: Vec<LoginSubmissionField>,
        ) -> anyhow::Result<LoginSubmissionObservation> {
            let target = match event {
                LoginSubmissionEvent::Enter => LoginSubmissionTarget::CredentialField {
                    field_index: LoginCapturedFieldIndex::from(Index::from(
                        u32::try_from(fields.len())?.saturating_sub(1),
                    )),
                },
                LoginSubmissionEvent::FormSubmit
                | LoginSubmissionEvent::Click
                | LoginSubmissionEvent::Other => LoginSubmissionTarget::CredentialScope,
            };
            let mut observation = LoginSubmissionObservation::try_from(LoginSubmissionIntent {
                event,
                trust: LoginSubmissionTrust::Trusted,
                target,
                control_label: LoginControlLabel::try_from(label.to_owned())?,
                context: AuthenticationPageObservationFacts {
                    detailed_advance_control:
                        AuthenticationDetailedAdvanceControlObservation::observed(Self::control(
                            label,
                        )),
                    ..Default::default()
                },
            })?;
            for field in fields {
                observation = observation.add_field(field)?;
            }
            Ok(observation)
        }

        fn confirmed() -> Vec<LoginSubmissionField> {
            vec![
                Self::email(),
                Self::password("Password"),
                Self::password("Confirm password"),
            ]
        }

        fn captured(username: Index, password: Index) -> LoginSubmissionDecision {
            LoginSubmissionDecision::Captured {
                username_field_index: LoginCapturedFieldIndex::from(username),
                password_field_index: LoginCapturedFieldIndex::from(password),
                workflow_kind: AuthenticationWorkflowKind::Signup,
            }
        }
    }

    #[test]
    fn value_matches_pair_identical_nonempty_values_without_keeping_them() {
        let matches =
            LoginCapturedValueMatches::from_values(&["a@example.test", "pw", "pw", "", ""]);
        assert_eq!(matches.len(), 5);
        assert!(matches.same_nonempty_value(Index::ONE, Index::TWO));
        assert!(!matches.same_nonempty_value(Index::ZERO, Index::ONE));
        assert!(!matches.same_nonempty_value(Index::THREE, Index::from(4)));
        assert!(!matches.same_nonempty_value(Index::ONE, Index::from(9)));
        assert!(!format!("{matches:?}").contains("pw"));
    }

    #[test]
    fn password_typed_twice_captures_signup_on_submit_click_and_enter() -> anyhow::Result<()> {
        let values = LoginCapturedValueMatches::from_values(&["a@example.test", "pw", "pw"]);
        for (event, label) in [
            (LoginSubmissionEvent::FormSubmit, ""),
            (LoginSubmissionEvent::Click, "Create account"),
            (LoginSubmissionEvent::Click, "Sign up"),
            (LoginSubmissionEvent::Click, "Continue"),
            (LoginSubmissionEvent::Enter, ""),
        ] {
            assert_eq!(
                Fixture::submission(event, label, Fixture::confirmed())?.classify(&values),
                Fixture::captured(Index::ZERO, Index::ONE),
                "{event:?} {label}"
            );
        }
        Ok(())
    }

    #[test]
    fn mismatched_or_empty_confirmation_and_untrusted_events_are_not_saved() -> anyhow::Result<()> {
        for values in [
            LoginCapturedValueMatches::from_values(&["a@example.test", "pw", "pW"]),
            LoginCapturedValueMatches::from_values(&["a@example.test", "", ""]),
        ] {
            let observation =
                Fixture::submission(LoginSubmissionEvent::FormSubmit, "", Fixture::confirmed())?;
            assert_eq!(
                observation.classify(&values),
                LoginSubmissionDecision::Ignored
            );
        }
        let values = LoginCapturedValueMatches::from_values(&["a@example.test", "pw", "pw"]);
        let mut observation =
            Fixture::submission(LoginSubmissionEvent::FormSubmit, "", Fixture::confirmed())?;
        observation.intent.trust = LoginSubmissionTrust::Untrusted;
        assert_eq!(
            observation.classify(&values),
            LoginSubmissionDecision::Ignored
        );
        let mut observation =
            Fixture::submission(LoginSubmissionEvent::Enter, "", Fixture::confirmed())?;
        observation.intent.target = LoginSubmissionTarget::OutsideCredentialScope;
        assert_eq!(
            observation.classify(&values),
            LoginSubmissionDecision::Ignored
        );
        Ok(())
    }

    #[test]
    fn signup_click_keeps_provider_reveal_and_destructive_vetoes() -> anyhow::Result<()> {
        let values = LoginCapturedValueMatches::from_values(&["a@example.test", "pw", "pw"]);
        for label in [
            "Sign up with Google",
            "Show password",
            "Cancel",
            "Forgot password",
        ] {
            assert_eq!(
                Fixture::submission(LoginSubmissionEvent::Click, label, Fixture::confirmed())?
                    .classify(&values),
                LoginSubmissionDecision::Ignored,
                "{label}"
            );
        }
        Ok(())
    }

    #[test]
    fn single_password_is_signup_only_with_registration_wording() -> anyhow::Result<()> {
        let values = LoginCapturedValueMatches::from_values(&["a@example.test", "pw"]);
        let fields = || vec![Fixture::email(), Fixture::password("Password")];
        assert_eq!(
            Fixture::submission(LoginSubmissionEvent::Click, "Create account", fields())?
                .classify(&values),
            Fixture::captured(Index::ZERO, Index::ONE)
        );
        let mut by_form = Fixture::submission(LoginSubmissionEvent::FormSubmit, "", fields())?;
        by_form
            .intent
            .context
            .ceremony
            .authentication_context
            .form_identity = "signup-form".to_owned();
        assert_eq!(
            by_form.classify(&values),
            Fixture::captured(Index::ZERO, Index::ONE)
        );
        let mut by_route = Fixture::submission(LoginSubmissionEvent::FormSubmit, "", fields())?;
        by_route
            .intent
            .context
            .ceremony
            .authentication_context
            .destination_identity = "/users/register".to_owned();
        assert_eq!(
            by_route.classify(&values),
            Fixture::captured(Index::ZERO, Index::ONE)
        );
        assert_eq!(
            Fixture::submission(LoginSubmissionEvent::Click, "Sign in", fields())?
                .classify(&values),
            LoginSubmissionDecision::Captured {
                username_field_index: LoginCapturedFieldIndex::from(Index::ZERO),
                password_field_index: LoginCapturedFieldIndex::from(Index::ONE),
                workflow_kind: AuthenticationWorkflowKind::Login,
            }
        );
        Ok(())
    }

    #[test]
    fn account_identifier_prefers_username_token_then_nearest_preceding_field() -> anyhow::Result<()>
    {
        let values = LoginCapturedValueMatches::from_values(&["a", "b", "pw", "pw"]);
        let tokened = vec![
            Fixture::email(),
            Fixture::input(PageInputType::Text, &["username"], "Username"),
            Fixture::password("Password"),
            Fixture::password("Repeat password"),
        ];
        assert_eq!(
            Fixture::submission(LoginSubmissionEvent::FormSubmit, "", tokened)?.classify(&values),
            Fixture::captured(Index::ONE, Index::TWO)
        );
        let untokened = vec![
            Fixture::input(PageInputType::Text, &[], "Username"),
            Fixture::email(),
            Fixture::password("Password"),
            Fixture::password("Repeat password"),
        ];
        assert_eq!(
            Fixture::submission(LoginSubmissionEvent::FormSubmit, "", untokened)?.classify(&values),
            Fixture::captured(Index::ONE, Index::TWO)
        );
        let values = LoginCapturedValueMatches::from_values(&["pw", "pw"]);
        let passwords_only = vec![Fixture::password("Password"), Fixture::password("Confirm")];
        assert_eq!(
            Fixture::submission(LoginSubmissionEvent::FormSubmit, "", passwords_only)?
                .classify(&values),
            LoginSubmissionDecision::Ignored
        );
        Ok(())
    }

    #[test]
    fn current_password_keeps_password_change_out_of_signup_capture() -> anyhow::Result<()> {
        let values = LoginCapturedValueMatches::from_values(&["a", "old", "pw", "pw"]);
        let fields = vec![
            Fixture::email(),
            Fixture::input(
                PageInputType::Password,
                &["current-password"],
                "Current password",
            ),
            Fixture::input(PageInputType::Password, &["new-password"], "New password"),
            Fixture::input(
                PageInputType::Password,
                &["new-password"],
                "Confirm password",
            ),
        ];
        assert_eq!(
            Fixture::submission(LoginSubmissionEvent::FormSubmit, "", fields)?.classify(&values),
            LoginSubmissionDecision::ExplicitAuthentication {
                workflow_kind: AuthenticationWorkflowKind::PasswordChange
            }
        );
        Ok(())
    }
}
