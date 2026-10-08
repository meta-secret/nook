//! Non-secret presentation of observed login actions; never an action authority.
use crate::{
    AuthenticationOutcomeObservation, AuthenticationOutcomeVerdict,
    AuthenticationWorkflowCurrentStep,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
pub enum AuthenticationLoginChecklistActivity {
    Ready,
    Filling,
    Filled,
    Submitting,
    Submitted,
    SubmissionRejected,
    SubmissionUnobserved,
    FillFailed,
    TakenOver,
}

/// Retained presentation state contains owned outcomes, never raw sensors.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum AuthenticationLoginChecklistState {
    Activity {
        activity: AuthenticationLoginChecklistActivity,
    },
    Outcome {
        result: AuthenticationLoginChecklistResult,
    },
}

/// External observations are converted at projection time and not retained.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum AuthenticationLoginChecklistObservation {
    Activity {
        activity: AuthenticationLoginChecklistActivity,
    },
    Outcome {
        verdict: AuthenticationOutcomeVerdict,
        observation: AuthenticationOutcomeObservation,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Tsify)]
pub enum AuthenticationLoginChecklistOutcomePolling {
    Wait,
    Stop,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
pub enum AuthenticationLoginChecklistResult {
    Waiting,
    Confirmed,
    Attention,
}

struct LoginChecklistOutcomeEvidence {
    verdict: AuthenticationOutcomeVerdict,
    observation: AuthenticationOutcomeObservation,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct AuthenticationLoginChecklistProjection {
    pub state: AuthenticationLoginChecklistState,
    pub observation: AuthenticationLoginChecklistObservation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Tsify)]
pub enum AuthenticationLoginChecklistStep {
    FillLogin,
    SubmitForm,
    CheckResult,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Tsify)]
pub enum AuthenticationLoginChecklistRowState {
    Done,
    Current,
    Pending,
    Attention,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Tsify)]
pub enum AuthenticationLoginChecklistStatus {
    Ready,
    Working,
    Waiting,
    Attention,
    Complete,
    Inactive,
}

/// Chrome i18n is the fixed external key boundary. Key selection stays in Rust.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(transparent)]
pub struct AuthenticationLoginChecklistMessageKey(String);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
pub struct AuthenticationLoginChecklistRow {
    pub step: AuthenticationLoginChecklistStep,
    pub ordinal: AuthenticationWorkflowCurrentStep,
    pub state: AuthenticationLoginChecklistRowState,
    pub label_key: AuthenticationLoginChecklistMessageKey,
    pub detail_key: AuthenticationLoginChecklistMessageKey,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
pub struct AuthenticationLoginChecklistPresentation {
    pub state: AuthenticationLoginChecklistState,
    pub status: AuthenticationLoginChecklistStatus,
    pub status_key: AuthenticationLoginChecklistMessageKey,
    pub outcome_polling: AuthenticationLoginChecklistOutcomePolling,
    pub rows: [AuthenticationLoginChecklistRow; 3],
}

impl AuthenticationLoginChecklistProjection {
    #[must_use]
    pub fn project(self) -> AuthenticationLoginChecklistPresentation {
        self.state.observe(self.observation).presentation()
    }
}

impl AuthenticationLoginChecklistState {
    #[must_use]
    pub fn observe(self, observation: AuthenticationLoginChecklistObservation) -> Self {
        match observation {
            AuthenticationLoginChecklistObservation::Activity { activity } => {
                Self::Activity { activity }
            }
            AuthenticationLoginChecklistObservation::Outcome {
                verdict,
                observation,
            } => self.observe_outcome(
                LoginChecklistOutcomeEvidence {
                    verdict,
                    observation,
                }
                .into(),
            ),
        }
    }

    fn observe_outcome(self, result: AuthenticationLoginChecklistResult) -> Self {
        match self {
            Self::Activity {
                activity: AuthenticationLoginChecklistActivity::Submitted,
            } => Self::Outcome { result },
            Self::Outcome { result: retained } => match retained {
                AuthenticationLoginChecklistResult::Waiting => Self::Outcome { result },
                AuthenticationLoginChecklistResult::Confirmed
                | AuthenticationLoginChecklistResult::Attention => self,
            },
            Self::Activity {
                activity:
                    AuthenticationLoginChecklistActivity::Ready
                    | AuthenticationLoginChecklistActivity::Filling
                    | AuthenticationLoginChecklistActivity::Filled
                    | AuthenticationLoginChecklistActivity::Submitting
                    | AuthenticationLoginChecklistActivity::SubmissionRejected
                    | AuthenticationLoginChecklistActivity::SubmissionUnobserved
                    | AuthenticationLoginChecklistActivity::FillFailed
                    | AuthenticationLoginChecklistActivity::TakenOver,
            } => self,
        }
    }

    #[must_use]
    pub fn presentation(self) -> AuthenticationLoginChecklistPresentation {
        let status = self.status();
        AuthenticationLoginChecklistPresentation {
            state: self,
            status,
            status_key: status.message_key(),
            outcome_polling: self.outcome_polling(),
            rows: [
                self.row(AuthenticationLoginChecklistStep::FillLogin),
                self.row(AuthenticationLoginChecklistStep::SubmitForm),
                self.row(AuthenticationLoginChecklistStep::CheckResult),
            ],
        }
    }

    fn outcome_polling(self) -> AuthenticationLoginChecklistOutcomePolling {
        match self {
            Self::Activity {
                activity: AuthenticationLoginChecklistActivity::Submitted,
            } => AuthenticationLoginChecklistOutcomePolling::Wait,
            Self::Outcome { result } => match result {
                AuthenticationLoginChecklistResult::Waiting => {
                    AuthenticationLoginChecklistOutcomePolling::Wait
                }
                AuthenticationLoginChecklistResult::Confirmed
                | AuthenticationLoginChecklistResult::Attention => {
                    AuthenticationLoginChecklistOutcomePolling::Stop
                }
            },
            Self::Activity {
                activity:
                    AuthenticationLoginChecklistActivity::Ready
                    | AuthenticationLoginChecklistActivity::Filling
                    | AuthenticationLoginChecklistActivity::Filled
                    | AuthenticationLoginChecklistActivity::Submitting
                    | AuthenticationLoginChecklistActivity::SubmissionRejected
                    | AuthenticationLoginChecklistActivity::SubmissionUnobserved
                    | AuthenticationLoginChecklistActivity::FillFailed
                    | AuthenticationLoginChecklistActivity::TakenOver,
            } => AuthenticationLoginChecklistOutcomePolling::Stop,
        }
    }

    fn status(self) -> AuthenticationLoginChecklistStatus {
        use AuthenticationLoginChecklistActivity as Activity;
        match self {
            Self::Activity {
                activity: Activity::Ready,
            } => AuthenticationLoginChecklistStatus::Ready,
            Self::Activity {
                activity: Activity::Filling | Activity::Submitting,
            } => AuthenticationLoginChecklistStatus::Working,
            Self::Activity {
                activity: Activity::Filled | Activity::Submitted | Activity::SubmissionUnobserved,
            } => AuthenticationLoginChecklistStatus::Waiting,
            Self::Activity {
                activity: Activity::SubmissionRejected | Activity::FillFailed,
            } => AuthenticationLoginChecklistStatus::Attention,
            Self::Outcome { result } => match result {
                AuthenticationLoginChecklistResult::Waiting => {
                    AuthenticationLoginChecklistStatus::Waiting
                }
                AuthenticationLoginChecklistResult::Confirmed => {
                    AuthenticationLoginChecklistStatus::Complete
                }
                AuthenticationLoginChecklistResult::Attention => {
                    AuthenticationLoginChecklistStatus::Attention
                }
            },
            Self::Activity {
                activity: Activity::TakenOver,
            } => AuthenticationLoginChecklistStatus::Inactive,
        }
    }

    fn row(self, step: AuthenticationLoginChecklistStep) -> AuthenticationLoginChecklistRow {
        let state = self.row_state(step);
        AuthenticationLoginChecklistRow {
            step,
            ordinal: step.ordinal(),
            state,
            label_key: step.message_key(),
            detail_key: self.detail_key(step),
        }
    }

    fn row_state(
        self,
        step: AuthenticationLoginChecklistStep,
    ) -> AuthenticationLoginChecklistRowState {
        use AuthenticationLoginChecklistActivity as Activity;
        use AuthenticationLoginChecklistRowState as Row;
        use AuthenticationLoginChecklistStep as Step;
        match self {
            Self::Activity {
                activity: Activity::Ready | Activity::TakenOver,
            } => Row::Pending,
            Self::Activity {
                activity: Activity::Filling,
            } => match step {
                Step::FillLogin => Row::Current,
                Step::SubmitForm | Step::CheckResult => Row::Pending,
            },
            Self::Activity {
                activity: Activity::FillFailed,
            } => match step {
                Step::FillLogin => Row::Attention,
                Step::SubmitForm | Step::CheckResult => Row::Pending,
            },
            Self::Activity {
                activity: Activity::Filled | Activity::Submitting | Activity::SubmissionUnobserved,
            } => match step {
                Step::FillLogin => Row::Done,
                Step::SubmitForm => Row::Current,
                Step::CheckResult => Row::Pending,
            },
            Self::Activity {
                activity: Activity::SubmissionRejected,
            } => match step {
                Step::FillLogin => Row::Done,
                Step::SubmitForm => Row::Attention,
                Step::CheckResult => Row::Pending,
            },
            Self::Activity {
                activity: Activity::Submitted,
            } => match step {
                Step::FillLogin | Step::SubmitForm => Row::Done,
                Step::CheckResult => Row::Current,
            },
            Self::Outcome { result } => result.row_state(step),
        }
    }

    fn detail_key(
        self,
        step: AuthenticationLoginChecklistStep,
    ) -> AuthenticationLoginChecklistMessageKey {
        use AuthenticationLoginChecklistActivity as Activity;
        use AuthenticationLoginChecklistStep as Step;
        let browser_key = match step {
            Step::FillLogin => match self {
                Self::Activity {
                    activity: Activity::Ready | Activity::TakenOver,
                } => "widgetChecklistFillReady",
                Self::Activity {
                    activity: Activity::Filling,
                } => "widgetChecklistFillWorking",
                Self::Activity {
                    activity: Activity::FillFailed,
                } => "widgetChecklistFillFailed",
                Self::Activity {
                    activity:
                        Activity::Filled
                        | Activity::Submitting
                        | Activity::Submitted
                        | Activity::SubmissionRejected
                        | Activity::SubmissionUnobserved,
                }
                | Self::Outcome { .. } => "widgetChecklistFillDone",
            },
            Step::SubmitForm => match self {
                Self::Activity {
                    activity:
                        Activity::Ready | Activity::Filling | Activity::FillFailed | Activity::TakenOver,
                } => "widgetChecklistSubmitPending",
                Self::Activity {
                    activity: Activity::Filled,
                } => "widgetChecklistSubmitReady",
                Self::Activity {
                    activity: Activity::Submitting,
                } => "widgetChecklistSubmitWorking",
                Self::Activity {
                    activity: Activity::SubmissionRejected,
                } => "widgetChecklistSubmitRejected",
                Self::Activity {
                    activity: Activity::SubmissionUnobserved,
                } => "widgetChecklistSubmitManual",
                Self::Activity {
                    activity: Activity::Submitted,
                }
                | Self::Outcome { .. } => "widgetChecklistSubmitDone",
            },
            Step::CheckResult => match self {
                Self::Activity {
                    activity:
                        Activity::Ready
                        | Activity::Filling
                        | Activity::Filled
                        | Activity::Submitting
                        | Activity::SubmissionRejected
                        | Activity::SubmissionUnobserved
                        | Activity::FillFailed
                        | Activity::TakenOver,
                } => "widgetChecklistResultPending",
                Self::Activity {
                    activity: Activity::Submitted,
                } => "widgetChecklistResultWaiting",
                Self::Outcome { result } => return result.detail_key(),
            },
        };
        AuthenticationLoginChecklistMessageKey(browser_key.to_owned())
    }
}

impl From<LoginChecklistOutcomeEvidence> for AuthenticationLoginChecklistResult {
    fn from(evidence: LoginChecklistOutcomeEvidence) -> Self {
        match evidence.verdict {
            AuthenticationOutcomeVerdict::Sufficient => Self::Confirmed,
            AuthenticationOutcomeVerdict::Conflicting | AuthenticationOutcomeVerdict::Timeout => {
                Self::Attention
            }
            AuthenticationOutcomeVerdict::Insufficient => {
                if evidence.observation.error_marker_present {
                    Self::Attention
                } else {
                    Self::Waiting
                }
            }
        }
    }
}

impl AuthenticationLoginChecklistResult {
    fn detail_key(self) -> AuthenticationLoginChecklistMessageKey {
        let browser_key = match self {
            Self::Waiting => "widgetChecklistResultWaiting",
            Self::Confirmed => "widgetChecklistResultDone",
            Self::Attention => "widgetChecklistResultAttention",
        };
        AuthenticationLoginChecklistMessageKey(browser_key.to_owned())
    }
    fn row_state(
        self,
        step: AuthenticationLoginChecklistStep,
    ) -> AuthenticationLoginChecklistRowState {
        match step {
            AuthenticationLoginChecklistStep::FillLogin
            | AuthenticationLoginChecklistStep::SubmitForm => {
                AuthenticationLoginChecklistRowState::Done
            }
            AuthenticationLoginChecklistStep::CheckResult => match self {
                Self::Waiting => AuthenticationLoginChecklistRowState::Current,
                Self::Confirmed => AuthenticationLoginChecklistRowState::Done,
                Self::Attention => AuthenticationLoginChecklistRowState::Attention,
            },
        }
    }
}

impl AuthenticationLoginChecklistStep {
    fn ordinal(self) -> AuthenticationWorkflowCurrentStep {
        match self {
            Self::FillLogin => 1,
            Self::SubmitForm => 2,
            Self::CheckResult => 3,
        }
        .into()
    }
    fn message_key(self) -> AuthenticationLoginChecklistMessageKey {
        let browser_key = match self {
            Self::FillLogin => "widgetChecklistFillLogin",
            Self::SubmitForm => "widgetChecklistSubmitForm",
            Self::CheckResult => "widgetChecklistCheckResult",
        };
        AuthenticationLoginChecklistMessageKey(browser_key.to_owned())
    }
}

impl AuthenticationLoginChecklistStatus {
    fn message_key(self) -> AuthenticationLoginChecklistMessageKey {
        let browser_key = match self {
            Self::Ready => "widgetChecklistReady",
            Self::Working => "widgetChecklistWorking",
            Self::Waiting => "widgetChecklistWaiting",
            Self::Attention => "widgetChecklistAttention",
            Self::Complete => "widgetChecklistComplete",
            Self::Inactive => "widgetChecklistInactive",
        };
        AuthenticationLoginChecklistMessageKey(browser_key.to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn observed_actions_drive_ordered_rows_without_assuming_field_types() {
        let ready = AuthenticationLoginChecklistState::Activity {
            activity: AuthenticationLoginChecklistActivity::Ready,
        };
        for row in ready.presentation().rows {
            assert_eq!(row.state, AuthenticationLoginChecklistRowState::Pending);
        }
        let filling = ready
            .observe(AuthenticationLoginChecklistObservation::Activity {
                activity: AuthenticationLoginChecklistActivity::Filling,
            })
            .presentation();
        let [fill, submit, result] = filling.rows;
        assert_eq!(fill.step, AuthenticationLoginChecklistStep::FillLogin);
        assert_eq!(submit.step, AuthenticationLoginChecklistStep::SubmitForm);
        assert_eq!(result.step, AuthenticationLoginChecklistStep::CheckResult);
        assert_eq!(fill.state, AuthenticationLoginChecklistRowState::Current);
        assert_eq!(submit.state, AuthenticationLoginChecklistRowState::Pending);
        assert_eq!(result.state, AuthenticationLoginChecklistRowState::Pending);
        assert_eq!(filling.status, AuthenticationLoginChecklistStatus::Working);
        let submitting = filling
            .state
            .observe(AuthenticationLoginChecklistObservation::Activity {
                activity: AuthenticationLoginChecklistActivity::Submitting,
            })
            .presentation();
        let [fill, submit, result] = submitting.rows;
        assert_eq!(fill.state, AuthenticationLoginChecklistRowState::Done);
        assert_eq!(submit.state, AuthenticationLoginChecklistRowState::Current);
        assert_eq!(result.state, AuthenticationLoginChecklistRowState::Pending);
    }

    #[test]
    fn every_unsubmitted_activity_ignores_sufficient_outcome() {
        for activity in [
            AuthenticationLoginChecklistActivity::Ready,
            AuthenticationLoginChecklistActivity::Filling,
            AuthenticationLoginChecklistActivity::Filled,
            AuthenticationLoginChecklistActivity::Submitting,
            AuthenticationLoginChecklistActivity::SubmissionRejected,
            AuthenticationLoginChecklistActivity::SubmissionUnobserved,
            AuthenticationLoginChecklistActivity::FillFailed,
            AuthenticationLoginChecklistActivity::TakenOver,
        ] {
            let state = AuthenticationLoginChecklistState::Activity { activity };
            assert_eq!(
                state.observe(AuthenticationLoginChecklistObservation::Outcome {
                    verdict: AuthenticationOutcomeVerdict::Sufficient,
                    observation: AuthenticationOutcomeObservation::default()
                }),
                state
            );
        }
    }

    #[test]
    fn rejection_and_manual_submission_never_complete_submit_or_start_result() {
        for activity in [
            AuthenticationLoginChecklistActivity::SubmissionRejected,
            AuthenticationLoginChecklistActivity::SubmissionUnobserved,
        ] {
            let presentation =
                AuthenticationLoginChecklistState::Activity { activity }.presentation();
            let [fill, submit, result] = presentation.rows;
            assert_eq!(fill.state, AuthenticationLoginChecklistRowState::Done);
            assert_ne!(submit.state, AuthenticationLoginChecklistRowState::Done);
            assert_eq!(result.state, AuthenticationLoginChecklistRowState::Pending);
            assert_ne!(
                presentation.status,
                AuthenticationLoginChecklistStatus::Working
            );
        }
    }

    #[test]
    fn only_sufficient_verdict_completes_observed_submission() {
        let submitted = AuthenticationLoginChecklistState::Activity {
            activity: AuthenticationLoginChecklistActivity::Submitted,
        };
        for verdict in [
            AuthenticationOutcomeVerdict::Sufficient,
            AuthenticationOutcomeVerdict::Insufficient,
            AuthenticationOutcomeVerdict::Conflicting,
            AuthenticationOutcomeVerdict::Timeout,
        ] {
            let presentation = submitted
                .observe(AuthenticationLoginChecklistObservation::Outcome {
                    verdict,
                    observation: AuthenticationOutcomeObservation::default(),
                })
                .presentation();
            let [fill, submit, result] = presentation.rows;
            assert_eq!(fill.state, AuthenticationLoginChecklistRowState::Done);
            assert_eq!(submit.state, AuthenticationLoginChecklistRowState::Done);
            match verdict {
                AuthenticationOutcomeVerdict::Sufficient => {
                    assert_eq!(result.state, AuthenticationLoginChecklistRowState::Done);
                    assert_eq!(
                        presentation.status,
                        AuthenticationLoginChecklistStatus::Complete
                    );
                }
                AuthenticationOutcomeVerdict::Insufficient => {
                    assert_eq!(result.state, AuthenticationLoginChecklistRowState::Current);
                    assert_eq!(
                        presentation.status,
                        AuthenticationLoginChecklistStatus::Waiting
                    );
                }
                AuthenticationOutcomeVerdict::Conflicting
                | AuthenticationOutcomeVerdict::Timeout => {
                    assert_eq!(
                        result.state,
                        AuthenticationLoginChecklistRowState::Attention
                    );
                    assert_eq!(
                        presentation.status,
                        AuthenticationLoginChecklistStatus::Attention
                    );
                }
            }
        }
    }

    #[test]
    fn terminal_outcomes_remain_visible_until_explicit_activity_change() {
        for verdict in [
            AuthenticationOutcomeVerdict::Sufficient,
            AuthenticationOutcomeVerdict::Conflicting,
            AuthenticationOutcomeVerdict::Timeout,
        ] {
            let state = AuthenticationLoginChecklistState::Activity {
                activity: AuthenticationLoginChecklistActivity::Submitted,
            }
            .observe(AuthenticationLoginChecklistObservation::Outcome {
                verdict,
                observation: AuthenticationOutcomeObservation::default(),
            });
            assert_eq!(
                state.observe(AuthenticationLoginChecklistObservation::Outcome {
                    verdict: AuthenticationOutcomeVerdict::Insufficient,
                    observation: AuthenticationOutcomeObservation::default()
                }),
                state
            );
            let taken_over = state
                .observe(AuthenticationLoginChecklistObservation::Activity {
                    activity: AuthenticationLoginChecklistActivity::TakenOver,
                })
                .presentation();
            assert_eq!(
                taken_over.status,
                AuthenticationLoginChecklistStatus::Inactive
            );
            for row in taken_over.rows {
                assert_eq!(row.state, AuthenticationLoginChecklistRowState::Pending);
            }
            let failed = state
                .observe(AuthenticationLoginChecklistObservation::Activity {
                    activity: AuthenticationLoginChecklistActivity::FillFailed,
                })
                .presentation();
            assert_eq!(failed.status, AuthenticationLoginChecklistStatus::Attention);
            for row in failed.rows {
                assert_ne!(row.state, AuthenticationLoginChecklistRowState::Current);
            }
        }
    }

    #[test]
    fn awaiting_outcome_can_accept_a_later_sufficient_runtime_verdict() {
        let pending = AuthenticationLoginChecklistState::Activity {
            activity: AuthenticationLoginChecklistActivity::Submitted,
        }
        .observe(AuthenticationLoginChecklistObservation::Outcome {
            verdict: AuthenticationOutcomeVerdict::Insufficient,
            observation: AuthenticationOutcomeObservation::default(),
        });
        assert_eq!(
            pending
                .observe(AuthenticationLoginChecklistObservation::Outcome {
                    verdict: AuthenticationOutcomeVerdict::Sufficient,
                    observation: AuthenticationOutcomeObservation::default()
                })
                .presentation()
                .status,
            AuthenticationLoginChecklistStatus::Complete
        );
    }

    #[test]
    fn existing_error_only_insufficient_verdict_stops_with_generic_attention() {
        let observation = AuthenticationOutcomeObservation {
            error_marker_present: true,
            elapsed_ms: 9_000.into(),
            ..AuthenticationOutcomeObservation::default()
        };
        let verdict =
            observation.classify_authentication_outcome(crate::DEFAULT_OUTCOME_EVIDENCE_TIMEOUT_MS);
        assert_eq!(verdict, AuthenticationOutcomeVerdict::Insufficient);
        let state = AuthenticationLoginChecklistState::Activity {
            activity: AuthenticationLoginChecklistActivity::Submitted,
        }
        .observe(AuthenticationLoginChecklistObservation::Outcome {
            verdict,
            observation,
        });
        let presentation = state.presentation();
        assert_eq!(
            presentation.status,
            AuthenticationLoginChecklistStatus::Attention
        );
        assert_eq!(
            presentation.outcome_polling,
            AuthenticationLoginChecklistOutcomePolling::Stop
        );
        let [_, _, result] = presentation.rows;
        assert_eq!(
            result.state,
            AuthenticationLoginChecklistRowState::Attention
        );
        assert_eq!(
            result.detail_key,
            AuthenticationLoginChecklistMessageKey("widgetChecklistResultAttention".to_owned())
        );
        assert_eq!(
            state.observe(AuthenticationLoginChecklistObservation::Outcome {
                verdict: AuthenticationOutcomeVerdict::Sufficient,
                observation: AuthenticationOutcomeObservation::default()
            }),
            state
        );
    }

    #[test]
    fn typed_state_roundtrip_preserves_owned_result_and_rejects_unknown_input()
    -> serde_json::Result<()> {
        let state = AuthenticationLoginChecklistState::Outcome {
            result: AuthenticationLoginChecklistResult::Confirmed,
        };
        let encoded = serde_json::to_string(&state)?;
        assert_eq!(
            serde_json::from_str::<AuthenticationLoginChecklistState>(&encoded)?,
            state
        );
        assert!(
            serde_json::from_str::<AuthenticationLoginChecklistObservation>(
                r#"{"kind":"Outcome","verdict":99}"#
            )
            .is_err()
        );
        assert!(
            serde_json::from_str::<AuthenticationLoginChecklistState>(
                r#"{"kind":"Outcome","result":"Invented"}"#
            )
            .is_err()
        );
        assert!(
            serde_json::from_str::<AuthenticationLoginChecklistState>(
                r#"{"kind":"Activity","activity":"OptimisticSuccess"}"#
            )
            .is_err()
        );
        Ok(())
    }
}
