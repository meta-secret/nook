//! Authentication fields of one login step and how a later page relates to
//! the step that was submitted.

use serde::{Deserialize, Serialize};

use super::request::SignInAttemptAuthFields;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum SignInAttemptFieldPresence {
    Present,
    Absent,
}

impl From<bool> for SignInAttemptFieldPresence {
    #[expect(
        clippy::match_bool,
        reason = "the frozen sensor contract boolean is converted immediately into named presence"
    )]
    fn from(present: bool) -> Self {
        match present {
            true => Self::Present,
            false => Self::Absent,
        }
    }
}

/// Which credential fields of one login step are visible.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SignInAttemptAuthStep {
    pub(crate) username: SignInAttemptFieldPresence,
    pub(crate) current_password: SignInAttemptFieldPresence,
    pub(crate) one_time_code: SignInAttemptFieldPresence,
}

impl From<&SignInAttemptAuthFields> for SignInAttemptAuthStep {
    fn from(fields: &SignInAttemptAuthFields) -> Self {
        Self {
            username: SignInAttemptFieldPresence::from(fields.username_present),
            current_password: SignInAttemptFieldPresence::from(fields.current_password_present),
            one_time_code: SignInAttemptFieldPresence::from(fields.one_time_code_present),
        }
    }
}

/// Whether the current page still shows a login workflow.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SignInAttemptLoginWorkflow {
    /// A username, current-password, or one-time-code field is visible.
    Shown,
    /// No authentication field is visible.
    Left,
}

impl From<&SignInAttemptAuthFields> for SignInAttemptLoginWorkflow {
    fn from(fields: &SignInAttemptAuthFields) -> Self {
        use SignInAttemptFieldPresence::{Absent, Present};
        let step = SignInAttemptAuthStep::from(fields);
        match (step.username, step.current_password, step.one_time_code) {
            (Absent, Absent, Absent) => Self::Left,
            (Present, Present | Absent, Present | Absent)
            | (Absent, Present, Present | Absent)
            | (Absent, Absent, Present) => Self::Shown,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SignInAttemptStepRelation {
    /// Same username/password presence as the submitted step.
    SameStep,
    /// A username or password field of the submitted step is still visible.
    OverlappingStep,
    /// A different authentication step (for example a new code field).
    OtherStep,
    /// No authentication field is visible.
    NoAuthFields,
}

impl SignInAttemptAuthStep {
    pub(crate) fn relation(self, current: Self) -> SignInAttemptStepRelation {
        use SignInAttemptFieldPresence::{Absent, Present};
        let fields = (
            current.username,
            current.current_password,
            current.one_time_code,
        );
        if let (Absent, Absent, Absent) = fields {
            return SignInAttemptStepRelation::NoAuthFields;
        }
        match (
            self.username,
            current.username,
            self.current_password,
            current.current_password,
        ) {
            (Present, Present, Present, Present)
            | (Present, Present, Absent, Absent)
            | (Absent, Absent, Present, Present) => SignInAttemptStepRelation::SameStep,
            (Present, Present, Present | Absent, Present | Absent)
            | (Present | Absent, Present | Absent, Present, Present) => {
                SignInAttemptStepRelation::OverlappingStep
            }
            (Present | Absent, Present | Absent, Present | Absent, Present | Absent) => {
                SignInAttemptStepRelation::OtherStep
            }
        }
    }
}
