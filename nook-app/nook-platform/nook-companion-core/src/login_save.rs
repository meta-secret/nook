//! Portable submission capture, ephemeral scope, and consent-save eligibility.

mod capture;
mod context;
mod outcome;
mod submission;

pub use capture::{
    LoginCaptureError, LoginExplicitCandidatePresence, LoginSaveCaptureDecision,
    LoginSaveCaptureSelection, LoginSubmissionCapture, LoginSubmissionFieldMetadata,
};
pub use context::{
    LoginSaveCaptureBaseline, LoginSaveCaptureSource, LoginSaveCommitEvidence,
    LoginSaveContextError, LoginSaveFrameId, LoginSaveScopeMatch, LoginSaveSenderContext,
    LoginSaveTabId, LoginSubmissionPageUrl,
};
pub use outcome::{
    LoginAuthFieldPresence, LoginControlLabel, LoginManualCheckpoint, LoginObservationError,
    LoginSaveEligibility, LoginSaveOutcomeDecision, LoginSaveOutcomeObservation,
    LoginSubmissionOrigin, LoginSubmissionPresence, LoginSubmissionTransition,
};
pub use submission::{
    LoginCapturedFieldIndex, LoginPasswordFieldHistory, LoginSubmissionDecision,
    LoginSubmissionEvent, LoginSubmissionField, LoginSubmissionIntent, LoginSubmissionObservation,
    LoginSubmissionTarget, LoginSubmissionTrust,
};
