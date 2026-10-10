//! Capture only explicit user submission of one unambiguous login scope.
use super::outcome::{LoginControlLabel, LoginObservationError};
use crate::AuthenticationDetailedAdvanceControlObservation;
use crate::AuthenticationUsernameEvidence;
use crate::credential_fill::field::{
    Classification, Credential, CredentialRole, Editability, Index, Observation, Password,
};
use crate::credential_fill::{Assignment, CredentialKind, Plan};
use crate::page_field_classification::{
    SubmittedLoginControlAdmission, SubmittedLoginControlRequest,
};
use crate::{PageControlActionability, PageInputType, PageLoginContext};

use crate::{
    AuthenticationControlText, AuthenticationFieldObservationFacts, AuthenticationPageObservation,
    AuthenticationPageObservationFacts, AuthenticationWorkflowKind, AuthenticationWorkflowMatch,
    AuthenticationWorkflowStage, MAX_AUTHENTICATION_CONTROL_TEXT_BYTES,
    MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT, PageInputFieldObservation,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
pub enum LoginSubmissionEvent {
    FormSubmit,
    Click,
    Enter,
    Other,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
pub enum LoginSubmissionTrust {
    Trusted,
    Untrusted,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum LoginSubmissionTarget {
    CredentialScope,
    CredentialField {
        field_index: LoginCapturedFieldIndex,
    },
    OutsideCredentialScope,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
pub enum LoginPasswordFieldHistory {
    PreviouslyPassword,
    Unobserved,
}

#[derive(Debug, Clone)]
pub struct LoginSubmissionField {
    input_type: PageInputType,
    actionability: PageControlActionability,
    editability: Editability,
    autocomplete_tokens: Vec<String>,
    identity_text: String,
    login_context: PageLoginContext,
    password_history: LoginPasswordFieldHistory,
}
impl From<PageInputFieldObservation> for LoginSubmissionField {
    #[expect(
        clippy::match_bool,
        reason = "Convert external DOM flags immediately into owned actionability and editability states"
    )]
    fn from(field: PageInputFieldObservation) -> Self {
        Self {
            input_type: field.input_type,
            actionability: match field.disabled {
                true => PageControlActionability::Inert,
                false => PageControlActionability::Actionable,
            },
            editability: match field.read_only {
                true => Editability::Readonly,
                false => Editability::Writable,
            },
            autocomplete_tokens: field.autocomplete_tokens,
            identity_text: field.identity_text,
            login_context: field.login_context,
            password_history: LoginPasswordFieldHistory::Unobserved,
        }
    }
}
impl LoginSubmissionField {
    #[must_use]
    pub fn with_password_history(mut self, history: LoginPasswordFieldHistory) -> Self {
        self.password_history = history;
        self
    }
    fn page_observation(&self) -> PageInputFieldObservation {
        PageInputFieldObservation {
            input_type: self.input_type,
            disabled: matches!(self.actionability, PageControlActionability::Inert),
            read_only: matches!(self.editability, Editability::Readonly),
            autocomplete_tokens: self.autocomplete_tokens.clone(),
            identity_text: self.identity_text.clone(),
            login_context: self.login_context,
        }
    }
    fn classification(&self, index: Index) -> Classification {
        let mut observed = self.page_observation();
        match self.password_history {
            LoginPasswordFieldHistory::Unobserved => {}
            LoginPasswordFieldHistory::PreviouslyPassword => match observed.input_type {
                PageInputType::Text => observed.input_type = PageInputType::Password,
                PageInputType::Email
                | PageInputType::Tel
                | PageInputType::Number
                | PageInputType::Password
                | PageInputType::Other => {}
            },
        }
        Classification::from_page_input(index, &observed)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct LoginSubmissionIntent {
    pub event: LoginSubmissionEvent,
    pub trust: LoginSubmissionTrust,
    pub target: LoginSubmissionTarget,
    pub control_label: LoginControlLabel,
    pub context: AuthenticationPageObservationFacts,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(try_from = "LoginCapturedFieldIndexWire")]
pub struct LoginCapturedFieldIndex {
    value: u32,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LoginCapturedFieldIndexWire {
    value: u32,
}

impl TryFrom<LoginCapturedFieldIndexWire> for LoginCapturedFieldIndex {
    type Error = LoginObservationError;
    fn try_from(wire: LoginCapturedFieldIndexWire) -> Result<Self, Self::Error> {
        match wire.value {
            value if value < MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT => Ok(Self { value }),
            _ => Err(LoginObservationError::InvalidTargetField),
        }
    }
}

impl From<Index> for LoginCapturedFieldIndex {
    fn from(index: Index) -> Self {
        Self {
            value: u32::from(index),
        }
    }
}

impl LoginCapturedFieldIndex {
    #[must_use]
    pub(crate) fn is_bounded(self) -> bool {
        self.value < MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum LoginSubmissionDecision {
    ExplicitAuthentication {
        workflow_kind: AuthenticationWorkflowKind,
    },
    Captured {
        username_field_index: LoginCapturedFieldIndex,
        password_field_index: LoginCapturedFieldIndex,
        workflow_kind: AuthenticationWorkflowKind,
    },
    Ignored,
}

#[derive(Debug, Clone)]
pub struct LoginSubmissionObservation {
    intent: LoginSubmissionIntent,
    fields: Vec<LoginSubmissionField>,
}

impl TryFrom<LoginSubmissionIntent> for LoginSubmissionObservation {
    type Error = LoginObservationError;
    fn try_from(intent: LoginSubmissionIntent) -> Result<Self, Self::Error> {
        let true = intent
            .context
            .authentication_page_observation_facts_is_admissible()
        else {
            return Err(LoginObservationError::InvalidSubmissionContext);
        };
        Ok(Self {
            intent,
            fields: Vec::new(),
        })
    }
}

impl LoginSubmissionObservation {
    #[must_use = "use the updated submission observation"]
    pub fn add_field(mut self, field: LoginSubmissionField) -> Result<Self, LoginObservationError> {
        let false = self.fields.len() >= MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT as usize else {
            return Err(LoginObservationError::TooManyFields);
        };
        let false = (field.identity_text.len() > MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
            || field.autocomplete_tokens.len() > MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT as usize
            || field
                .autocomplete_tokens
                .iter()
                .any(|token| token.len() > MAX_AUTHENTICATION_CONTROL_TEXT_BYTES))
        else {
            return Err(LoginObservationError::FieldMetadataTooLong);
        };
        self.fields.push(field);
        Ok(self)
    }

    #[must_use]
    pub fn classify(&self) -> LoginSubmissionDecision {
        let LoginSubmissionTrust::Trusted = self.intent.trust else {
            return LoginSubmissionDecision::Ignored;
        };
        let SubmittedLoginControlAdmission::Admitted = self.intent.target_admission() else {
            return LoginSubmissionDecision::Ignored;
        };
        let true = self
            .intent
            .context
            .authentication_page_observation_facts_is_admissible()
        else {
            return LoginSubmissionDecision::Ignored;
        };
        match self.intent.event {
            LoginSubmissionEvent::FormSubmit
            | LoginSubmissionEvent::Enter
            | LoginSubmissionEvent::Click => {}
            LoginSubmissionEvent::Other => return LoginSubmissionDecision::Ignored,
        }
        let mut fields = Vec::with_capacity(self.fields.len());
        for (index, input) in self.fields.iter().enumerate() {
            let Ok(index) = u32::try_from(index) else {
                return LoginSubmissionDecision::Ignored;
            };
            if let Classification::Observed(observed) = input.classification(index.into()) {
                fields.push(observed.observation);
            }
        }
        let AuthenticationWorkflowMatch::Matched(workflow) = self.intent.classify_workflow(&fields)
        else {
            return LoginSubmissionDecision::Ignored;
        };
        match workflow.stage {
            AuthenticationWorkflowStage::Credentials => {}
            AuthenticationWorkflowStage::SecondFactor
            | AuthenticationWorkflowStage::Verification
            | AuthenticationWorkflowStage::Setup
            | AuthenticationWorkflowStage::Recovery
            | AuthenticationWorkflowStage::Manual => return LoginSubmissionDecision::Ignored,
        }
        match workflow.kind {
            AuthenticationWorkflowKind::Signup | AuthenticationWorkflowKind::PasswordChange => {
                return match self.intent.event {
                    LoginSubmissionEvent::FormSubmit => {
                        LoginSubmissionDecision::ExplicitAuthentication {
                            workflow_kind: workflow.kind,
                        }
                    }
                    LoginSubmissionEvent::Click
                    | LoginSubmissionEvent::Enter
                    | LoginSubmissionEvent::Other => LoginSubmissionDecision::Ignored,
                };
            }
            AuthenticationWorkflowKind::Login => {}
            AuthenticationWorkflowKind::TotpChallenge
            | AuthenticationWorkflowKind::TotpEnrollment
            | AuthenticationWorkflowKind::Manual => return LoginSubmissionDecision::Ignored,
        }
        let Ok(plan) = Plan::from_fields(&fields) else {
            return LoginSubmissionDecision::Ignored;
        };
        let AuthenticationWorkflowMatch::Matched(_) = self.intent.classify_login_workflow(&plan)
        else {
            return LoginSubmissionDecision::Ignored;
        };
        let SubmittedLoginControlAdmission::Admitted = self.submission_control_admission(&fields)
        else {
            return LoginSubmissionDecision::Ignored;
        };
        match plan.assignments.as_slice() {
            [
                Assignment {
                    field_index: username,
                    credential: CredentialKind::Username,
                },
                Assignment {
                    field_index: password,
                    credential: CredentialKind::CurrentPassword,
                },
            ] => self.intent.classify_selected_fields(LoginSelectedFields {
                username: LoginCapturedFieldIndex::from(*username),
                password: LoginCapturedFieldIndex::from(*password),
                workflow: workflow.kind,
            }),
            _ => LoginSubmissionDecision::Ignored,
        }
    }

    fn submission_control_admission(
        &self,
        observed: &[Observation],
    ) -> SubmittedLoginControlAdmission {
        match self.intent.event {
            LoginSubmissionEvent::FormSubmit | LoginSubmissionEvent::Enter => {
                return SubmittedLoginControlAdmission::Admitted;
            }
            LoginSubmissionEvent::Other => return SubmittedLoginControlAdmission::Absent,
            LoginSubmissionEvent::Click => {}
        }
        let AuthenticationDetailedAdvanceControlObservation::Observed(controls) =
            &self.intent.context.detailed_advance_control
        else {
            return SubmittedLoginControlAdmission::Absent;
        };
        let [control] = controls.as_slice() else {
            return SubmittedLoginControlAdmission::Absent;
        };
        let true = control.label == String::from(self.intent.control_label.clone()) else {
            return SubmittedLoginControlAdmission::Absent;
        };
        let fields = observed.iter().copied().fold(
            AuthenticationFieldObservationFacts::default(),
            AuthenticationFieldObservationFacts::include_login_submission_field,
        );
        let usernames: Vec<_> = self
            .fields
            .iter()
            .map(|input| input.page_observation().authentication_username_evidence())
            .collect();
        control.classify_submitted_login_candidate(SubmittedLoginControlRequest {
            fields,
            username: AuthenticationUsernameEvidence::strongest_authentication_username_evidence(
                &usernames,
            ),
        })
    }
}

#[derive(Clone, Copy)]
struct LoginSelectedFields {
    username: LoginCapturedFieldIndex,
    password: LoginCapturedFieldIndex,
    workflow: AuthenticationWorkflowKind,
}

impl LoginSubmissionIntent {
    fn target_admission(&self) -> SubmittedLoginControlAdmission {
        match (self.event, self.target) {
            (
                LoginSubmissionEvent::FormSubmit | LoginSubmissionEvent::Click,
                LoginSubmissionTarget::CredentialScope,
            )
            | (LoginSubmissionEvent::Enter, LoginSubmissionTarget::CredentialField { .. }) => {
                SubmittedLoginControlAdmission::Admitted
            }
            (
                LoginSubmissionEvent::FormSubmit | LoginSubmissionEvent::Click,
                LoginSubmissionTarget::CredentialField { .. }
                | LoginSubmissionTarget::OutsideCredentialScope,
            )
            | (
                LoginSubmissionEvent::Enter,
                LoginSubmissionTarget::CredentialScope
                | LoginSubmissionTarget::OutsideCredentialScope,
            )
            | (
                LoginSubmissionEvent::Other,
                LoginSubmissionTarget::CredentialScope
                | LoginSubmissionTarget::CredentialField { .. }
                | LoginSubmissionTarget::OutsideCredentialScope,
            ) => SubmittedLoginControlAdmission::IncompatibleScope,
        }
    }

    fn classify_selected_fields(&self, selected: LoginSelectedFields) -> LoginSubmissionDecision {
        match self.event {
            LoginSubmissionEvent::Enter => match self.target {
                LoginSubmissionTarget::CredentialField { field_index }
                    if field_index == selected.username || field_index == selected.password => {}
                LoginSubmissionTarget::CredentialScope
                | LoginSubmissionTarget::OutsideCredentialScope
                | LoginSubmissionTarget::CredentialField { .. } => {
                    return LoginSubmissionDecision::Ignored;
                }
            },
            LoginSubmissionEvent::FormSubmit | LoginSubmissionEvent::Click => {
                let LoginSubmissionTarget::CredentialScope = self.target else {
                    return LoginSubmissionDecision::Ignored;
                };
            }
            LoginSubmissionEvent::Other => return LoginSubmissionDecision::Ignored,
        }
        LoginSubmissionDecision::Captured {
            username_field_index: selected.username,
            password_field_index: selected.password,
            workflow_kind: selected.workflow,
        }
    }

    fn classify_workflow(&self, observed: &[Observation]) -> AuthenticationWorkflowMatch {
        let mut facts = self.context.clone();
        // Raw control counts are host observations, not canonical field evidence.
        // Candidate actionability is checked separately after the login scope is selected.
        facts.detailed_advance_control = AuthenticationDetailedAdvanceControlObservation::Absent;
        facts.fields = observed.iter().copied().fold(
            AuthenticationFieldObservationFacts::default(),
            AuthenticationFieldObservationFacts::include_login_submission_field,
        );
        AuthenticationPageObservation::from(facts).classify_authentication_workflow()
    }
    fn classify_login_workflow(&self, plan: &Plan) -> AuthenticationWorkflowMatch {
        let identity = AuthenticationControlText::new(
            &self.context.ceremony.authentication_context.form_identity,
        )
        .expand_identity_text();
        let label = String::from(self.control_label.clone());
        let label = AuthenticationControlText::new(&label).expand_identity_text();
        let false = [identity.as_str(), label.as_str()].iter().any(|text| {
            AuthenticationControlText::new(text).contains_any_word(&[
                "signup",
                "sign up",
                "register",
                "registration",
                "create account",
                "new account",
                "change password",
                "reset password",
                "forgot password",
                "recover password",
            ])
        }) else {
            return AuthenticationWorkflowMatch::Rejected;
        };
        let mut facts = self.context.clone();
        facts.fields = plan.assignments.iter().fold(
            AuthenticationFieldObservationFacts::default(),
            |mut fields, assignment| {
                match assignment.credential {
                    CredentialKind::Username => {
                        fields.username_field_count =
                            fields.username_field_count.saturating_add(1.into());
                    }
                    CredentialKind::CurrentPassword => {
                        fields.current_password_field_count =
                            fields.current_password_field_count.saturating_add(1.into());
                        fields.actionable_password_field_count = fields
                            .actionable_password_field_count
                            .saturating_add(1.into());
                    }
                }
                fields
            },
        );
        facts.detailed_advance_control = AuthenticationDetailedAdvanceControlObservation::Absent;
        AuthenticationWorkflowMatch::classify_authentication_workflow_candidates(&[
            AuthenticationPageObservation::from(facts),
        ])
    }
}

impl AuthenticationFieldObservationFacts {
    #[must_use]
    fn include_login_submission_field(mut self, observed: Observation) -> Self {
        match observed {
            Observation::Credential(Credential {
                role: CredentialRole::Username,
                ..
            }) => self.username_field_count = self.username_field_count.saturating_add(1.into()),
            Observation::Credential(Credential {
                role: CredentialRole::Password(Password::Current),
                ..
            }) => {
                self.current_password_field_count =
                    self.current_password_field_count.saturating_add(1.into());
            }
            Observation::Credential(Credential {
                role: CredentialRole::Password(Password::Generic),
                ..
            }) => {
                self.generic_password_field_count =
                    self.generic_password_field_count.saturating_add(1.into());
            }
            Observation::NewPassword(_) => {
                self.new_password_field_count =
                    self.new_password_field_count.saturating_add(1.into());
            }
            Observation::OneTimeCode(_) => {
                self.one_time_code_field_count =
                    self.one_time_code_field_count.saturating_add(1.into());
            }
        }
        match observed {
            Observation::Credential(Credential {
                role: CredentialRole::Password(_),
                editability: Editability::Writable,
                ..
            })
            | Observation::NewPassword(_) => {
                self.actionable_password_field_count = self
                    .actionable_password_field_count
                    .saturating_add(1.into());
            }
            Observation::Credential(Credential {
                role: CredentialRole::Password(_),
                editability: Editability::Readonly,
                ..
            }) => {
                self.readonly_password_field_count =
                    self.readonly_password_field_count.saturating_add(1.into());
            }
            Observation::Credential(Credential {
                role: CredentialRole::Username,
                ..
            })
            | Observation::OneTimeCode(_) => {}
        }
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::AuthenticationDetailedAdvanceControlObservation;
    use crate::AuthenticationUsernameEvidence;
    use crate::PageControlActionability;
    use crate::PageControlOwnership;
    use crate::PageControlSemantics;
    use crate::PageControlSubmissionDestinationSource;
    use crate::PageControlSubmissionMethod;
    use crate::PageInputType;

    struct Fixture;
    impl Fixture {
        fn login(
            event: LoginSubmissionEvent,
        ) -> Result<LoginSubmissionObservation, LoginObservationError> {
            let context = AuthenticationPageObservationFacts {
                detailed_advance_control: AuthenticationDetailedAdvanceControlObservation::observed(
                    Self::control("Sign On"),
                ),
                ..Default::default()
            };
            let observation = LoginSubmissionObservation::try_from(LoginSubmissionIntent {
                event,
                trust: LoginSubmissionTrust::Trusted,
                target: match event {
                    LoginSubmissionEvent::Enter => LoginSubmissionTarget::CredentialField {
                        field_index: LoginCapturedFieldIndex::from(Index::ONE),
                    },
                    LoginSubmissionEvent::FormSubmit
                    | LoginSubmissionEvent::Click
                    | LoginSubmissionEvent::Other => LoginSubmissionTarget::CredentialScope,
                },
                control_label: LoginControlLabel::try_from("Sign On".to_owned())?,
                context,
            })?;
            let username = PageInputFieldObservation {
                input_type: PageInputType::Text,
                disabled: false,
                read_only: false,
                autocomplete_tokens: vec!["username".to_owned()],
                identity_text: "User ID".to_owned(),
                login_context: true.into(),
            };
            let password = PageInputFieldObservation {
                input_type: PageInputType::Password,
                autocomplete_tokens: vec!["current-password".to_owned()],
                identity_text: "Password".to_owned(),
                ..username.clone()
            };
            observation
                .add_field(username.into())?
                .add_field(password.into())
        }

        fn control(label: &str) -> crate::AuthenticationAdvanceControlObservation {
            crate::AuthenticationAdvanceControlObservation {
                actionability: PageControlActionability::Actionable,
                ownership: PageControlOwnership::LocallyScoped,
                semantics: PageControlSemantics::Activation,
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
    }

    #[test]
    fn scoped_click_accepts_continue_localized_and_icon_submit_but_vetoes_auxiliary_controls()
    -> anyhow::Result<()> {
        for label in ["Continue", "Next", "Anmelden", ""] {
            let mut observation = Fixture::login(LoginSubmissionEvent::Click)?;
            observation.intent.control_label = LoginControlLabel::try_from(label.to_owned())?;
            let mut control = Fixture::control(label);
            control.semantics = PageControlSemantics::SemanticSubmit;
            observation.intent.context.detailed_advance_control =
                AuthenticationDetailedAdvanceControlObservation::observed(control);
            assert!(
                matches!(
                    observation.classify(),
                    LoginSubmissionDecision::Captured { .. }
                ),
                "{label}"
            );
        }
        for label in ["Show password", "Cancel", "Reset", "Delete", "Sign up"] {
            let mut observation = Fixture::login(LoginSubmissionEvent::Click)?;
            observation.intent.control_label = LoginControlLabel::try_from(label.to_owned())?;
            observation.intent.context.detailed_advance_control =
                AuthenticationDetailedAdvanceControlObservation::observed(Fixture::control(label));
            assert_eq!(
                observation.classify(),
                LoginSubmissionDecision::Ignored,
                "{label}"
            );
        }
        let mut observation = Fixture::login(LoginSubmissionEvent::Click)?;
        observation.intent.context.detailed_advance_control =
            AuthenticationDetailedAdvanceControlObservation::Absent;
        assert_eq!(observation.classify(), LoginSubmissionDecision::Ignored);
        for ownership in [
            PageControlOwnership::Unowned,
            PageControlOwnership::LocallyScoped,
        ] {
            let mut control = Fixture::control("Sign On");
            control.ownership = ownership;
            control.actionability = PageControlActionability::Inert;
            observation.intent.context.detailed_advance_control =
                AuthenticationDetailedAdvanceControlObservation::observed(control);
            assert_eq!(observation.classify(), LoginSubmissionDecision::Ignored);
        }
        Ok(())
    }

    #[test]
    fn captures_native_click_and_enter_only_with_same_scope_credentials() -> anyhow::Result<()> {
        for event in [
            LoginSubmissionEvent::FormSubmit,
            LoginSubmissionEvent::Click,
            LoginSubmissionEvent::Enter,
        ] {
            assert_eq!(
                Fixture::login(event)?.classify(),
                LoginSubmissionDecision::Captured {
                    username_field_index: LoginCapturedFieldIndex::from(Index::ZERO),
                    password_field_index: LoginCapturedFieldIndex::from(Index::ONE),
                    workflow_kind: AuthenticationWorkflowKind::Login,
                }
            );
        }
        Ok(())
    }

    #[test]
    fn rejects_untrusted_and_unrelated_interactions() -> anyhow::Result<()> {
        let mut observation = Fixture::login(LoginSubmissionEvent::Click)?;
        observation.intent.trust = LoginSubmissionTrust::Untrusted;
        assert_eq!(observation.classify(), LoginSubmissionDecision::Ignored);
        observation.intent.trust = LoginSubmissionTrust::Trusted;
        observation.intent.control_label = LoginControlLabel::try_from("Show password".to_owned())?;
        assert_eq!(observation.classify(), LoginSubmissionDecision::Ignored);
        observation.intent.event = LoginSubmissionEvent::Enter;
        observation.intent.target = LoginSubmissionTarget::OutsideCredentialScope;
        assert_eq!(observation.classify(), LoginSubmissionDecision::Ignored);
        observation.intent.target = LoginSubmissionTarget::CredentialScope;
        observation.intent.event = LoginSubmissionEvent::Other;
        assert_eq!(observation.classify(), LoginSubmissionDecision::Ignored);
        Ok(())
    }

    #[test]
    fn registration_change_password_otp_and_ambiguous_passwords_do_not_capture_logins()
    -> anyhow::Result<()> {
        let original = Fixture::login(LoginSubmissionEvent::FormSubmit)?;
        {
            let mut observation = original.clone();
            let Some(password) = observation.fields.get_mut(1) else {
                anyhow::bail!("missing password fixture")
            };
            password.autocomplete_tokens = vec!["one-time-code".to_owned()];
            assert_eq!(observation.classify(), LoginSubmissionDecision::Ignored);
        }
        let Some(password) = original.fields.get(1) else {
            anyhow::bail!("missing password fixture")
        };
        assert_eq!(
            original.clone().add_field(password.clone())?.classify(),
            LoginSubmissionDecision::Ignored
        );
        Ok(())
    }

    #[test]
    fn routes_existing_explicit_native_signup_and_password_change_without_generic_capture()
    -> anyhow::Result<()> {
        let mut signup = Fixture::login(LoginSubmissionEvent::FormSubmit)?;
        signup
            .fields
            .get_mut(1)
            .ok_or_else(|| anyhow::anyhow!("missing password fixture"))?
            .autocomplete_tokens = vec!["new-password".to_owned()];
        assert_eq!(
            signup.classify(),
            LoginSubmissionDecision::ExplicitAuthentication {
                workflow_kind: AuthenticationWorkflowKind::Signup
            }
        );
        let original = Fixture::login(LoginSubmissionEvent::FormSubmit)?;
        let change = original.add_field(
            signup
                .fields
                .get(1)
                .ok_or_else(|| anyhow::anyhow!("missing password fixture"))?
                .clone(),
        )?;
        assert_eq!(
            change.classify(),
            LoginSubmissionDecision::ExplicitAuthentication {
                workflow_kind: AuthenticationWorkflowKind::PasswordChange
            }
        );
        signup.intent.event = LoginSubmissionEvent::Enter;
        assert_eq!(signup.classify(), LoginSubmissionDecision::Ignored);
        signup.intent.event = LoginSubmissionEvent::FormSubmit;
        signup.intent.trust = LoginSubmissionTrust::Untrusted;
        assert_eq!(signup.classify(), LoginSubmissionDecision::Ignored);
        Ok(())
    }

    #[test]
    fn same_node_password_history_admits_revealed_generic_password_only() -> anyhow::Result<()> {
        let mut observation = Fixture::login(LoginSubmissionEvent::Enter)?;
        let password = observation
            .fields
            .get_mut(1)
            .ok_or_else(|| anyhow::anyhow!("missing password fixture"))?;
        password.input_type = PageInputType::Text;
        password.autocomplete_tokens.clear();
        assert_eq!(observation.classify(), LoginSubmissionDecision::Ignored);
        observation
            .fields
            .get_mut(1)
            .ok_or_else(|| anyhow::anyhow!("missing password fixture"))?
            .password_history = LoginPasswordFieldHistory::PreviouslyPassword;
        assert!(matches!(
            observation.classify(),
            LoginSubmissionDecision::Captured { .. }
        ));
        observation
            .fields
            .get_mut(1)
            .ok_or_else(|| anyhow::anyhow!("missing password fixture"))?
            .autocomplete_tokens = vec!["one-time-code".to_owned()];
        assert_eq!(observation.classify(), LoginSubmissionDecision::Ignored);
        Ok(())
    }

    #[test]
    fn preserves_revealed_password_role_and_rejects_incomplete_or_disabled_fields()
    -> anyhow::Result<()> {
        let mut observation = Fixture::login(LoginSubmissionEvent::FormSubmit)?;
        let Some(password) = observation.fields.get_mut(1) else {
            anyhow::bail!("missing password fixture")
        };
        password.input_type = PageInputType::Text;
        assert!(matches!(
            observation.classify(),
            LoginSubmissionDecision::Captured { .. }
        ));
        let Some(password) = observation.fields.get_mut(1) else {
            anyhow::bail!("missing password fixture")
        };
        password.actionability = PageControlActionability::Inert;
        assert_eq!(observation.classify(), LoginSubmissionDecision::Ignored);
        observation.fields.clear();
        assert_eq!(observation.classify(), LoginSubmissionDecision::Ignored);
        Ok(())
    }

    #[test]
    fn enter_is_owned_by_selected_username_or_password_and_rejects_sibling_search()
    -> anyhow::Result<()> {
        let mut observation = Fixture::login(LoginSubmissionEvent::Enter)?.add_field(
            PageInputFieldObservation {
                input_type: PageInputType::Text,
                disabled: false,
                read_only: false,
                autocomplete_tokens: Vec::new(),
                identity_text: "Search".to_owned(),
                login_context: false.into(),
            }
            .into(),
        )?;
        for selected in [Index::ZERO, Index::ONE] {
            observation.intent.target = LoginSubmissionTarget::CredentialField {
                field_index: LoginCapturedFieldIndex::from(selected),
            };
            assert!(matches!(
                observation.classify(),
                LoginSubmissionDecision::Captured { .. }
            ));
        }
        for target in [
            LoginSubmissionTarget::CredentialField {
                field_index: LoginCapturedFieldIndex::from(Index::TWO),
            },
            LoginSubmissionTarget::CredentialScope,
            LoginSubmissionTarget::OutsideCredentialScope,
        ] {
            observation.intent.target = target;
            assert_eq!(observation.classify(), LoginSubmissionDecision::Ignored);
        }
        observation.intent.target = LoginSubmissionTarget::CredentialField {
            field_index: LoginCapturedFieldIndex::from(Index::ONE),
        };
        observation
            .fields
            .get_mut(1)
            .ok_or_else(|| anyhow::anyhow!("password fixture"))?
            .editability = Editability::Readonly;
        assert_eq!(observation.classify(), LoginSubmissionDecision::Ignored);
        Ok(())
    }
}
