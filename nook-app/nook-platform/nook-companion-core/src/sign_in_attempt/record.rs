//! The Rust-owned sign-in attempt record and its strict storage codec.
//!
//! The service worker keeps exactly one record per tab in
//! `chrome.storage.session` and never parses it. The record holds no
//! credential, username, field value, or page text other than the one
//! Rust-selected, bounded site message of a failed attempt.

use std::cmp::Ordering;

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use super::conclusion::SignInAttemptConclusion;
use super::outcome::SignInAttemptOutcomeWait;
use super::request::{SignInAttemptLoginReference, SignInAttemptRequestError};
use super::site::SignInAttemptSite;
use crate::{AuthenticationOutcomeElapsedMilliseconds, CompanionEpochMilliseconds};

/// Opaque JSON text of the Rust-owned record. TypeScript stores and returns it
/// verbatim and never parses it. Rust decodes it strictly.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "string")]
pub struct SignInAttemptStoredRecord(String);

/// Why a stored record was not admitted; the lifecycle answers `RecordRejected`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub(crate) enum SignInAttemptRecordError {
    #[error("stored sign-in attempt record exceeds its bound")]
    TooLarge,
    #[error("stored sign-in attempt record is malformed")]
    Malformed,
    #[error("stored sign-in attempt record schema is unsupported")]
    UnsupportedSchema,
    #[error("stored sign-in attempt record is internally inconsistent")]
    Inconsistent,
}

/// Supported stored-record schema revisions. There is one writer revision and
/// no compatibility reader: an unknown revision is rejected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "u8", into = "u8")]
pub(crate) enum SignInAttemptRecordSchema {
    V1,
}

impl SignInAttemptRecordSchema {
    pub(crate) const CURRENT: Self = Self::V1;
}

impl TryFrom<u8> for SignInAttemptRecordSchema {
    type Error = SignInAttemptRecordError;

    fn try_from(revision: u8) -> Result<Self, Self::Error> {
        match revision {
            1 => Ok(Self::V1),
            _ => Err(SignInAttemptRecordError::UnsupportedSchema),
        }
    }
}

impl From<SignInAttemptRecordSchema> for u8 {
    fn from(schema: SignInAttemptRecordSchema) -> Self {
        match schema {
            SignInAttemptRecordSchema::V1 => 1,
        }
    }
}

/// A validated Unix-millisecond instant supplied by the service worker clock.
#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(
    try_from = "CompanionEpochMilliseconds",
    into = "CompanionEpochMilliseconds"
)]
pub(crate) struct SignInAttemptInstant(CompanionEpochMilliseconds);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SignInAttemptChronology {
    Ordered,
    Reversed,
}

impl TryFrom<CompanionEpochMilliseconds> for SignInAttemptInstant {
    type Error = SignInAttemptRequestError;

    fn try_from(instant: CompanionEpochMilliseconds) -> Result<Self, Self::Error> {
        instant
            .validate()
            .map_err(|_| SignInAttemptRequestError::TimeInvalid)?;
        Ok(Self(instant))
    }
}

impl From<SignInAttemptInstant> for CompanionEpochMilliseconds {
    fn from(instant: SignInAttemptInstant) -> Self {
        let SignInAttemptInstant(instant) = instant;
        instant
    }
}

impl SignInAttemptInstant {
    pub(crate) fn elapsed_since(self, earlier: Self) -> AuthenticationOutcomeElapsedMilliseconds {
        let Self(now) = self;
        let Self(earlier) = earlier;
        now.elapsed_since(earlier)
    }

    /// Whether this instant does not precede `earlier`.
    pub(crate) fn chronology_after(self, earlier: Self) -> SignInAttemptChronology {
        match self.partial_cmp(&earlier) {
            Some(Ordering::Greater | Ordering::Equal) => SignInAttemptChronology::Ordered,
            Some(Ordering::Less) | None => SignInAttemptChronology::Reversed,
        }
    }
}

/// Pre-submit progress of Nook's own fill/submit actuation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum SignInAttemptPreSubmitStep {
    Filling,
    Filled,
    /// Nook filled but could not observe a submission; the user submits.
    ManualSubmit,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
pub(crate) enum SignInAttemptPhase {
    BeforeSubmit { step: SignInAttemptPreSubmitStep },
    AwaitingOutcome { wait: SignInAttemptOutcomeWait },
    Concluded { conclusion: SignInAttemptConclusion },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SignInAttemptRecord {
    pub(crate) schema: SignInAttemptRecordSchema,
    pub(crate) site: SignInAttemptSite,
    pub(crate) login: SignInAttemptLoginReference,
    pub(crate) started_at: SignInAttemptInstant,
    pub(crate) phase: SignInAttemptPhase,
}

impl SignInAttemptStoredRecord {
    /// Bound on the stored JSON text; a larger value is rejected unread.
    pub(crate) const MAX_BYTES: usize = 8_192;

    pub(crate) fn decode(&self) -> Result<SignInAttemptRecord, SignInAttemptRecordError> {
        let Self(stored) = self;
        match stored.len() {
            0..=Self::MAX_BYTES => {}
            _ => return Err(SignInAttemptRecordError::TooLarge),
        }
        let record = serde_json::from_str::<SignInAttemptRecord>(stored)
            .map_err(|_| SignInAttemptRecordError::Malformed)?;
        record.consistent()
    }
}

impl SignInAttemptRecord {
    pub(crate) fn encode(&self) -> Result<SignInAttemptStoredRecord, SignInAttemptRequestError> {
        serde_json::to_string(self)
            .map(SignInAttemptStoredRecord)
            .map_err(|_| SignInAttemptRequestError::RecordEncodingFailed)
    }

    fn consistent(self) -> Result<Self, SignInAttemptRecordError> {
        let chronology = match &self.phase {
            SignInAttemptPhase::AwaitingOutcome { wait } => wait.chronology_after(self.started_at),
            SignInAttemptPhase::BeforeSubmit { .. } | SignInAttemptPhase::Concluded { .. } => {
                SignInAttemptChronology::Ordered
            }
        };
        match chronology {
            SignInAttemptChronology::Ordered => Ok(self),
            SignInAttemptChronology::Reversed => Err(SignInAttemptRecordError::Inconsistent),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{SignInAttemptRecordError, SignInAttemptStoredRecord};

    /// Deliberately raw stored text: these documents exercise the strict decoder.
    struct RawStoredRecord(&'static str);

    impl RawStoredRecord {
        const VALID: &'static str = r#"{"schema":1,"site":"https://namecheap.com","login":"store_a:secret_b","started_at":1000,"phase":{"kind":"BeforeSubmit","step":"Filling"}}"#;

        fn decode(&self) -> Result<(), SignInAttemptRecordError> {
            let Self(raw) = self;
            SignInAttemptStoredRecord((*raw).to_owned())
                .decode()
                .map(|_| ())
        }
    }

    #[test]
    fn strict_decoder_accepts_the_current_shape() {
        assert_eq!(RawStoredRecord(RawStoredRecord::VALID).decode(), Ok(()));
    }

    #[test]
    fn strict_decoder_rejects_malformed_unknown_and_unsupported_records() {
        for raw in [
            "not json",
            // Unknown field (a username must never be smuggled into the record).
            r#"{"schema":1,"site":"https://namecheap.com","login":"store_a:secret_b","started_at":1000,"phase":{"kind":"BeforeSubmit","step":"Filling"},"username":"alice"}"#,
            // Unsupported schema revision.
            r#"{"schema":2,"site":"https://namecheap.com","login":"store_a:secret_b","started_at":1000,"phase":{"kind":"BeforeSubmit","step":"Filling"}}"#,
            // Non-canonical site.
            r#"{"schema":1,"site":"https://www.namecheap.com","login":"store_a:secret_b","started_at":1000,"phase":{"kind":"BeforeSubmit","step":"Filling"}}"#,
            // Invalid login reference.
            r#"{"schema":1,"site":"https://namecheap.com","login":"has space","started_at":1000,"phase":{"kind":"BeforeSubmit","step":"Filling"}}"#,
            // Invalid instant.
            r#"{"schema":1,"site":"https://namecheap.com","login":"store_a:secret_b","started_at":-5,"phase":{"kind":"BeforeSubmit","step":"Filling"}}"#,
            // Unknown field inside the phase.
            r#"{"schema":1,"site":"https://namecheap.com","login":"store_a:secret_b","started_at":1000,"phase":{"kind":"BeforeSubmit","step":"Filling","extra":true}}"#,
            // Unknown phase.
            r#"{"schema":1,"site":"https://namecheap.com","login":"store_a:secret_b","started_at":1000,"phase":{"kind":"Signing"}}"#,
            // Missing required field.
            r#"{"schema":1,"site":"https://namecheap.com","started_at":1000,"phase":{"kind":"BeforeSubmit","step":"Filling"}}"#,
        ] {
            assert_eq!(
                RawStoredRecord(raw).decode(),
                Err(SignInAttemptRecordError::Malformed),
                "{raw}"
            );
        }
    }

    #[test]
    fn strict_decoder_rejects_over_bound_text_before_parsing() {
        let padded = format!(
            "{}{}",
            RawStoredRecord::VALID,
            " ".repeat(SignInAttemptStoredRecord::MAX_BYTES)
        );
        assert_eq!(
            SignInAttemptStoredRecord(padded).decode(),
            Err(SignInAttemptRecordError::TooLarge)
        );
    }
}
