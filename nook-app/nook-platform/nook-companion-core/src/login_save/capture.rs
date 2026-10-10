//! First-message capture metadata; credential values remain in the session ingress.
use super::{
    LoginAuthFieldPresence, LoginCapturedFieldIndex, LoginControlLabel, LoginObservationError,
    LoginPasswordFieldHistory, LoginSaveCaptureBaseline, LoginSaveCaptureSource,
    LoginSubmissionDecision, LoginSubmissionField, LoginSubmissionIntent,
    LoginSubmissionObservation, LoginSubmissionPageUrl,
};
use crate::{
    CompanionEpochMilliseconds, MAX_AUTHENTICATION_CONTROL_TEXT_BYTES,
    MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT, PageInputFieldObservation, PageInputType,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
pub enum LoginExplicitCandidatePresence {
    Present,
    Absent,
}

/// Raw browser-owned input attributes converted immediately to existing core facts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct LoginSubmissionFieldMetadata {
    pub input_type: String,
    pub disabled: bool,
    pub read_only: bool,
    pub autocomplete_tokens: Vec<String>,
    pub identity_text: String,
    pub login_context: bool,
    pub password_history: LoginPasswordFieldHistory,
}

impl LoginSubmissionFieldMetadata {
    fn into_field(self) -> Result<LoginSubmissionField, LoginObservationError> {
        match self.input_type.len() {
            length if length > MAX_AUTHENTICATION_CONTROL_TEXT_BYTES => {
                return Err(LoginObservationError::FieldMetadataTooLong);
            }
            _ => {}
        }
        Ok(LoginSubmissionField::from(PageInputFieldObservation {
            input_type: PageInputType::parse(&self.input_type),
            disabled: self.disabled,
            read_only: self.read_only,
            autocomplete_tokens: self.autocomplete_tokens,
            identity_text: self.identity_text,
            login_context: self.login_context.into(),
        })
        .with_password_history(self.password_history))
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct LoginSubmissionCapture {
    pub intent: LoginSubmissionIntent,
    pub fields: Vec<LoginSubmissionFieldMetadata>,
    pub submitted_at: CompanionEpochMilliseconds,
    pub submitted_url: LoginSubmissionPageUrl,
    pub controls: Vec<LoginControlLabel>,
    pub explicit_candidate: LoginExplicitCandidatePresence,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum LoginSaveCaptureDecision {
    SubmittedLogin {
        username_field_index: LoginCapturedFieldIndex,
        password_field_index: LoginCapturedFieldIndex,
        baseline: LoginSaveCaptureBaseline,
    },
    ExplicitAuthentication {
        baseline: LoginSaveCaptureBaseline,
    },
    Ignored,
}

/// Authoritative, nonsecret field selection retained with an offered capture.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum LoginSaveCaptureSelection {
    SubmittedLogin {
        username_field_index: LoginCapturedFieldIndex,
        password_field_index: LoginCapturedFieldIndex,
    },
    ExplicitAuthentication,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub(crate) enum LoginSaveSelectionError {
    #[error("login selection source differs from capture")]
    SourceMismatch,
    #[error("login selection indices are invalid")]
    InvalidIndices,
}

impl LoginSaveCaptureSelection {
    #[must_use = "consume selection validation"]
    pub(crate) fn validate_baseline(
        self,
        baseline: &LoginSaveCaptureBaseline,
    ) -> Result<(), LoginSaveSelectionError> {
        match (self, baseline.source) {
            (
                Self::SubmittedLogin {
                    username_field_index,
                    password_field_index,
                },
                LoginSaveCaptureSource::SubmittedLogin,
            ) => {
                let true = (username_field_index != password_field_index
                    && username_field_index.is_bounded()
                    && password_field_index.is_bounded())
                else {
                    return Err(LoginSaveSelectionError::InvalidIndices);
                };
                Ok(())
            }
            (Self::ExplicitAuthentication, LoginSaveCaptureSource::ExplicitAuthentication) => {
                Ok(())
            }
            (Self::SubmittedLogin { .. }, LoginSaveCaptureSource::ExplicitAuthentication)
            | (Self::ExplicitAuthentication, LoginSaveCaptureSource::SubmittedLogin) => {
                Err(LoginSaveSelectionError::SourceMismatch)
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum LoginCaptureError {
    #[error("invalid login capture timestamp")]
    InvalidTimestamp,
    #[error("invalid login capture context")]
    InvalidContext,
    #[error(transparent)]
    InvalidMetadata(#[from] LoginObservationError),
}

impl LoginSubmissionCapture {
    fn observation(&self) -> Result<LoginSubmissionObservation, LoginCaptureError> {
        self.submitted_at
            .validate()
            .map_err(|_| LoginCaptureError::InvalidTimestamp)?;
        if let 65.. = self.controls.len() {
            return Err(LoginObservationError::TooManyControls.into());
        }
        match self.fields.len() {
            count if count > MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT as usize => {
                return Err(LoginObservationError::TooManyFields.into());
            }
            _ => {}
        }
        let true = self
            .intent
            .context
            .authentication_page_observation_facts_is_admissible()
        else {
            return Err(LoginCaptureError::InvalidContext);
        };
        let mut observation = LoginSubmissionObservation::try_from(self.intent.clone())?;
        for metadata in &self.fields {
            observation = observation.add_field(metadata.clone().into_field()?)?;
        }
        Ok(observation)
    }

    pub fn validate(&self) -> Result<(), LoginCaptureError> {
        self.observation()?;
        Ok(())
    }

    pub fn classify(self) -> Result<LoginSaveCaptureDecision, LoginCaptureError> {
        let decision = self.observation()?.classify();
        match decision {
            LoginSubmissionDecision::Captured {
                username_field_index,
                password_field_index,
                workflow_kind,
            } => Ok(LoginSaveCaptureDecision::SubmittedLogin {
                username_field_index,
                password_field_index,
                baseline: LoginSaveCaptureBaseline {
                    source: LoginSaveCaptureSource::SubmittedLogin,
                    submitted_at: self.submitted_at,
                    submitted_url: self.submitted_url,
                    captured_workflow: workflow_kind,
                    initial_auth_fields: LoginAuthFieldPresence::Present,
                    controls: self.controls,
                },
            }),
            LoginSubmissionDecision::ExplicitAuthentication { workflow_kind } => {
                match self.explicit_candidate {
                    LoginExplicitCandidatePresence::Present => {
                        Ok(LoginSaveCaptureDecision::ExplicitAuthentication {
                            baseline: LoginSaveCaptureBaseline {
                                source: LoginSaveCaptureSource::ExplicitAuthentication,
                                submitted_at: self.submitted_at,
                                submitted_url: self.submitted_url,
                                captured_workflow: workflow_kind,
                                initial_auth_fields: LoginAuthFieldPresence::Present,
                                controls: self.controls,
                            },
                        })
                    }
                    LoginExplicitCandidatePresence::Absent => Ok(LoginSaveCaptureDecision::Ignored),
                }
            }
            LoginSubmissionDecision::Ignored => Ok(LoginSaveCaptureDecision::Ignored),
        }
    }
}
