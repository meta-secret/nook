//! Typed, non-secret authentication outcome evidence for Nook Pilot.
//!
//! Content scripts report bounded DOM/navigation signals with no secrets.
//! This module owns whether those signals are sufficient to treat a workflow
//! as complete before durably creating or replacing credentials.

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::wasm_bindgen;

/// Default wall-clock budget while waiting for success evidence after submit.
pub const DEFAULT_OUTCOME_EVIDENCE_TIMEOUT_MS: u32 = 8_000;

/// Bounded, non-secret observation collected after an authentication act.
///
/// Independent boolean sensors are intentional: content scripts report each
/// signal separately and Rust owns the composition policy.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticationOutcomeObservation {
    /// Document URL left a login/signup/password-change-like path.
    pub navigated_away_from_auth_path: bool,
    /// Username/password/OTP fields are still visible in the active document.
    pub auth_fields_present: bool,
    /// Explicit success marker present (`data-nook-auth-outcome="success"` or equivalent).
    pub success_marker_present: bool,
    /// Explicit error/alert marker present.
    pub error_marker_present: bool,
    /// Same-document SPA mutation observed after the act (not a full navigation).
    pub same_document_mutation: bool,
    /// Observation was collected from an iframe document.
    pub in_iframe: bool,
    /// Milliseconds since the authentication act (submit/fill).
    pub elapsed_ms: u32,
}

/// Classification of collected outcome evidence.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AuthenticationOutcomeVerdict {
    Sufficient,
    Insufficient,
    Conflicting,
    Timeout,
}

impl AuthenticationOutcomeVerdict {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Sufficient => "sufficient",
            Self::Insufficient => "insufficient",
            Self::Conflicting => "conflicting",
            Self::Timeout => "timeout",
        }
    }

    /// Durable credential create/replace is allowed only for Sufficient.
    #[must_use]
    pub const fn allows_credential_commit(self) -> bool {
        matches!(self, Self::Sufficient)
    }
}

/// Classify bounded outcome evidence.
///
/// Navigation alone is never Sufficient. Error and success together are
/// Conflicting. Without an explicit success marker the verdict stays
/// Insufficient until the timeout budget elapses.
#[must_use]
pub const fn classify_authentication_outcome(
    observation: AuthenticationOutcomeObservation,
    timeout_ms: u32,
) -> AuthenticationOutcomeVerdict {
    if observation.success_marker_present && observation.error_marker_present {
        return AuthenticationOutcomeVerdict::Conflicting;
    }

    if observation.error_marker_present {
        return AuthenticationOutcomeVerdict::Insufficient;
    }

    if observation.success_marker_present {
        return AuthenticationOutcomeVerdict::Sufficient;
    }

    // Explicit policy: leaving the auth path, clearing fields, SPA mutation,
    // or iframe context without a success marker is never enough to commit.
    let _ = (
        observation.navigated_away_from_auth_path,
        observation.auth_fields_present,
        observation.same_document_mutation,
        observation.in_iframe,
    );

    if observation.elapsed_ms >= timeout_ms {
        return AuthenticationOutcomeVerdict::Timeout;
    }

    AuthenticationOutcomeVerdict::Insufficient
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> AuthenticationOutcomeObservation {
        AuthenticationOutcomeObservation::default()
    }

    #[test]
    fn navigation_alone_is_never_sufficient() {
        let observation = AuthenticationOutcomeObservation {
            navigated_away_from_auth_path: true,
            auth_fields_present: false,
            elapsed_ms: 500,
            ..base()
        };
        assert_eq!(
            classify_authentication_outcome(observation, DEFAULT_OUTCOME_EVIDENCE_TIMEOUT_MS),
            AuthenticationOutcomeVerdict::Insufficient
        );
    }

    #[test]
    fn success_marker_is_sufficient() {
        let observation = AuthenticationOutcomeObservation {
            success_marker_present: true,
            auth_fields_present: false,
            navigated_away_from_auth_path: true,
            elapsed_ms: 300,
            ..base()
        };
        assert_eq!(
            classify_authentication_outcome(observation, DEFAULT_OUTCOME_EVIDENCE_TIMEOUT_MS),
            AuthenticationOutcomeVerdict::Sufficient
        );
        assert!(AuthenticationOutcomeVerdict::Sufficient.allows_credential_commit());
    }

    #[test]
    fn error_marker_is_insufficient() {
        let observation = AuthenticationOutcomeObservation {
            error_marker_present: true,
            auth_fields_present: true,
            elapsed_ms: 200,
            ..base()
        };
        assert_eq!(
            classify_authentication_outcome(observation, DEFAULT_OUTCOME_EVIDENCE_TIMEOUT_MS),
            AuthenticationOutcomeVerdict::Insufficient
        );
        assert!(!AuthenticationOutcomeVerdict::Insufficient.allows_credential_commit());
    }

    #[test]
    fn error_and_success_conflict() {
        let observation = AuthenticationOutcomeObservation {
            success_marker_present: true,
            error_marker_present: true,
            elapsed_ms: 100,
            ..base()
        };
        assert_eq!(
            classify_authentication_outcome(observation, DEFAULT_OUTCOME_EVIDENCE_TIMEOUT_MS),
            AuthenticationOutcomeVerdict::Conflicting
        );
    }

    #[test]
    fn spa_mutation_without_success_is_insufficient() {
        let observation = AuthenticationOutcomeObservation {
            same_document_mutation: true,
            auth_fields_present: false,
            elapsed_ms: 400,
            ..base()
        };
        assert_eq!(
            classify_authentication_outcome(observation, DEFAULT_OUTCOME_EVIDENCE_TIMEOUT_MS),
            AuthenticationOutcomeVerdict::Insufficient
        );
    }

    #[test]
    fn spa_success_marker_is_sufficient() {
        let observation = AuthenticationOutcomeObservation {
            same_document_mutation: true,
            success_marker_present: true,
            auth_fields_present: false,
            elapsed_ms: 250,
            ..base()
        };
        assert_eq!(
            classify_authentication_outcome(observation, DEFAULT_OUTCOME_EVIDENCE_TIMEOUT_MS),
            AuthenticationOutcomeVerdict::Sufficient
        );
    }

    #[test]
    fn iframe_success_requires_explicit_marker() {
        let navigated_only = AuthenticationOutcomeObservation {
            in_iframe: true,
            navigated_away_from_auth_path: true,
            auth_fields_present: false,
            elapsed_ms: 300,
            ..base()
        };
        assert_eq!(
            classify_authentication_outcome(navigated_only, DEFAULT_OUTCOME_EVIDENCE_TIMEOUT_MS),
            AuthenticationOutcomeVerdict::Insufficient
        );

        let with_marker = AuthenticationOutcomeObservation {
            in_iframe: true,
            success_marker_present: true,
            elapsed_ms: 300,
            ..base()
        };
        assert_eq!(
            classify_authentication_outcome(with_marker, DEFAULT_OUTCOME_EVIDENCE_TIMEOUT_MS),
            AuthenticationOutcomeVerdict::Sufficient
        );
    }

    #[test]
    fn timeout_when_budget_elapses_without_success() {
        let observation = AuthenticationOutcomeObservation {
            navigated_away_from_auth_path: true,
            auth_fields_present: false,
            elapsed_ms: DEFAULT_OUTCOME_EVIDENCE_TIMEOUT_MS,
            ..base()
        };
        assert_eq!(
            classify_authentication_outcome(observation, DEFAULT_OUTCOME_EVIDENCE_TIMEOUT_MS),
            AuthenticationOutcomeVerdict::Timeout
        );
        assert!(!AuthenticationOutcomeVerdict::Timeout.allows_credential_commit());
    }

    #[test]
    fn multi_page_redirect_still_needs_success_marker() {
        let observation = AuthenticationOutcomeObservation {
            navigated_away_from_auth_path: true,
            auth_fields_present: false,
            same_document_mutation: false,
            elapsed_ms: 1_200,
            ..base()
        };
        assert_eq!(
            classify_authentication_outcome(observation, DEFAULT_OUTCOME_EVIDENCE_TIMEOUT_MS),
            AuthenticationOutcomeVerdict::Insufficient
        );
    }

    #[test]
    fn verdict_names_are_stable() {
        assert_eq!(
            AuthenticationOutcomeVerdict::Sufficient.as_str(),
            "sufficient"
        );
        assert_eq!(
            AuthenticationOutcomeVerdict::Insufficient.as_str(),
            "insufficient"
        );
        assert_eq!(
            AuthenticationOutcomeVerdict::Conflicting.as_str(),
            "conflicting"
        );
        assert_eq!(AuthenticationOutcomeVerdict::Timeout.as_str(), "timeout");
    }
}
