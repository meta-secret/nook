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
