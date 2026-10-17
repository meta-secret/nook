//! Stability of not-yet-decisive post-submit evidence.
//!
//! "Signed-in looking" evidence confirms after the existing 750 ms interval;
//! an unexplained re-presentation of the same step fails `Unknown` after 2 s.
//! The record keeps only the kind of evidence and when it began.

use serde::{Deserialize, Serialize};

use super::outcome::SignInAttemptOutcomeWait;
use super::record::SignInAttemptInstant;
use crate::{AuthenticationOutcomeElapsedMilliseconds, AuthenticationOutcomeTimeoutMilliseconds};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum SignInAttemptSettlingEvidence {
    /// No auth fields, no error-looking message, no challenge.
    SignedInLooking,
    /// The submitted step re-presented on a new document without a message.
    StepRepresented,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SignInAttemptSettledness {
    Settled,
    Settling,
}

impl SignInAttemptSettlingEvidence {
    pub(crate) fn window(self) -> AuthenticationOutcomeTimeoutMilliseconds {
        match self {
            Self::SignedInLooking => SignInAttemptOutcomeWait::CONFIRMATION_STABILITY,
            Self::StepRepresented => SignInAttemptOutcomeWait::REPRESENTATION_STABILITY,
        }
    }

    #[expect(
        clippy::match_bool,
        reason = "the elapsed-time comparison is converted immediately into named settledness"
    )]
    pub(crate) fn settledness(
        self,
        elapsed: AuthenticationOutcomeElapsedMilliseconds,
    ) -> SignInAttemptSettledness {
        match elapsed.has_reached(self.window()) {
            true => SignInAttemptSettledness::Settled,
            false => SignInAttemptSettledness::Settling,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
pub(crate) enum SignInAttemptStability {
    Unsettled {},
    Settling {
        evidence: SignInAttemptSettlingEvidence,
        since: SignInAttemptInstant,
    },
}

/// Not-yet-decisive evidence and when it was observed.
#[derive(Debug, Clone, Copy)]
pub(crate) struct SignInAttemptSettlingObservation {
    pub(crate) evidence: SignInAttemptSettlingEvidence,
    pub(crate) now: SignInAttemptInstant,
}

impl SignInAttemptStability {
    /// When the observed evidence began to hold: continuing evidence keeps its
    /// start, while new or different evidence restarts the window now.
    pub(crate) fn since(self, observed: SignInAttemptSettlingObservation) -> SignInAttemptInstant {
        use SignInAttemptSettlingEvidence::{SignedInLooking, StepRepresented};
        let SignInAttemptSettlingObservation { evidence, now } = observed;
        match (self, evidence) {
            (
                Self::Settling {
                    evidence: SignedInLooking,
                    since,
                },
                SignedInLooking,
            )
            | (
                Self::Settling {
                    evidence: StepRepresented,
                    since,
                },
                StepRepresented,
            ) => since,
            (
                Self::Settling {
                    evidence: SignedInLooking,
                    ..
                },
                StepRepresented,
            )
            | (
                Self::Settling {
                    evidence: StepRepresented,
                    ..
                },
                SignedInLooking,
            )
            | (Self::Unsettled {}, SignedInLooking | StepRepresented) => now,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        SignInAttemptSettlingEvidence, SignInAttemptSettlingObservation, SignInAttemptStability,
    };
    use crate::sign_in_attempt::record::SignInAttemptInstant;

    #[test]
    fn continuing_evidence_keeps_its_start_and_new_evidence_restarts_now() -> anyhow::Result<()> {
        let started = serde_json::from_str::<SignInAttemptInstant>("1000")?;
        let now = serde_json::from_str::<SignInAttemptInstant>("1500")?;
        let settling = SignInAttemptStability::Settling {
            evidence: SignInAttemptSettlingEvidence::SignedInLooking,
            since: started,
        };
        let continuing = SignInAttemptSettlingObservation {
            evidence: SignInAttemptSettlingEvidence::SignedInLooking,
            now,
        };
        let changed = SignInAttemptSettlingObservation {
            evidence: SignInAttemptSettlingEvidence::StepRepresented,
            now,
        };
        assert_eq!(settling.since(continuing), started);
        assert_eq!(settling.since(changed), now);
        assert_eq!(SignInAttemptStability::Unsettled {}.since(continuing), now);
        Ok(())
    }
}
