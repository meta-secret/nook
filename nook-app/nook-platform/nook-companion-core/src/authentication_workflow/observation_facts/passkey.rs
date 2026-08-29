use crate::page_field_classification::{
    AuthenticationAdvanceControlObservation, authentication_passkey_control_is_safe,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationPasskeyControlObservation {
    #[default]
    Absent,
    Present,
}

/// How the browser identified one bounded passkey control candidate.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", content = "observation", rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationDetailedPasskeyControlCandidateObservation {
    Labeled(AuthenticationAdvanceControlObservation),
    ExplicitlyMarked(AuthenticationAdvanceControlObservation),
}

impl AuthenticationDetailedPasskeyControlCandidateObservation {
    fn observation(&self) -> &AuthenticationAdvanceControlObservation {
        match self {
            Self::Labeled(observation) | Self::ExplicitlyMarked(observation) => observation,
        }
    }

    fn is_safe(&self) -> bool {
        authentication_passkey_control_is_safe(
            self.observation(),
            matches!(self, Self::ExplicitlyMarked(_)),
        )
    }
}

/// Validate one bounded passkey candidate before binding it to a DOM control.
#[must_use]
pub fn authentication_passkey_control_candidate_is_safe(
    candidate: &AuthenticationDetailedPasskeyControlCandidateObservation,
) -> bool {
    candidate.is_safe()
}

/// Validate detailed passkey evidence before enriching it with vault metadata.
#[must_use]
pub fn authentication_passkey_control_evidence_is_safe(
    evidence: &AuthenticationDetailedPasskeyControlObservation,
) -> bool {
    evidence.is_safe()
}

/// Detailed browser evidence for the passkey control selected by the host.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", content = "observation", rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationDetailedPasskeyControlObservation {
    #[default]
    Absent,
    Observed(AuthenticationAdvanceControlObservation),
    /// The browser observed the dedicated non-secret passkey marker on this control.
    ExplicitlyMarked(AuthenticationAdvanceControlObservation),
    /// Every passkey candidate observed in the bounded authentication scope.
    Candidates(Vec<AuthenticationDetailedPasskeyControlCandidateObservation>),
}

impl AuthenticationDetailedPasskeyControlObservation {
    pub(super) fn is_bounded(&self) -> bool {
        matches!(self, Self::Absent)
            || matches!(self, Self::Observed(observation) | Self::ExplicitlyMarked(observation) if observation.is_bounded())
            || matches!(self, Self::Candidates(candidates)
                if !candidates.is_empty()
                    && candidates.len() <= crate::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT as usize
                    && candidates.iter().all(|candidate| candidate.observation().is_bounded()))
    }

    pub(super) fn is_safe(&self) -> bool {
        matches!(
            self,
            Self::Observed(observation) if authentication_passkey_control_is_safe(observation, false)
        ) || matches!(
            self,
            Self::ExplicitlyMarked(observation)
                if authentication_passkey_control_is_safe(observation, true)
        ) || matches!(
            self,
            Self::Candidates(candidates) if candidates.iter().any(
                AuthenticationDetailedPasskeyControlCandidateObservation::is_safe
            )
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AuthenticationUsernameEvidence, PageControlActionability, PageControlOwnership,
        PageControlSemantics,
    };

    fn passkey_control(label: &str) -> AuthenticationAdvanceControlObservation {
        AuthenticationAdvanceControlObservation {
            actionability: PageControlActionability::Actionable,
            ownership: PageControlOwnership::LocallyScoped,
            semantics: PageControlSemantics::Activation,
            authentication_username: AuthenticationUsernameEvidence::Explicit,
            password_field_count: 0,
            new_password_field_count: 0,
            one_time_code_field_count: 0,
            semantic_submit_control_count: 0,
            source_origin: "https://login.example.test".to_owned(),
            form_identity: "login-form".to_owned(),
            destination_identity: "https://login.example.test/auth/login".to_owned(),
            label: label.to_owned(),
        }
    }

    #[test]
    fn passkey_candidate_kind_controls_label_policy_without_weakening_route_vetoes() {
        let labeled = AuthenticationDetailedPasskeyControlCandidateObservation::Labeled(
            passkey_control("Use passkey"),
        );
        assert!(authentication_passkey_control_candidate_is_safe(&labeled));

        let explicitly_marked =
            AuthenticationDetailedPasskeyControlCandidateObservation::ExplicitlyMarked(
                passkey_control("Continue"),
            );
        assert!(authentication_passkey_control_candidate_is_safe(
            &explicitly_marked
        ));

        let mut unsafe_route = passkey_control("Use passkey");
        unsafe_route.destination_identity = "https://login.example.test/register".to_owned();
        let unsafe_candidate =
            AuthenticationDetailedPasskeyControlCandidateObservation::Labeled(unsafe_route);
        assert!(!authentication_passkey_control_candidate_is_safe(
            &unsafe_candidate
        ));
    }

    #[test]
    fn explicitly_marked_passkey_candidates_retain_destructive_label_vetoes() {
        for label in ["Delete passkey", "Remove security key", "Revoke device"] {
            let candidate =
                AuthenticationDetailedPasskeyControlCandidateObservation::ExplicitlyMarked(
                    passkey_control(label),
                );
            assert!(!authentication_passkey_control_candidate_is_safe(
                &candidate
            ));
        }
    }

    #[test]
    fn passkey_candidates_require_authentication_context() {
        let mut observation = passkey_control("Use passkey");
        observation.authentication_username = AuthenticationUsernameEvidence::Absent;
        observation.form_identity.clear();
        observation.destination_identity = "https://login.example.test/".to_owned();
        let candidate =
            AuthenticationDetailedPasskeyControlCandidateObservation::Labeled(observation);

        assert!(!authentication_passkey_control_candidate_is_safe(
            &candidate
        ));
    }

    #[test]
    fn explicitly_marked_enrollment_and_device_management_controls_are_rejected() {
        for label in [
            "Add passkey",
            "Add a security key",
            "Enroll passkey",
            "Manage devices",
        ] {
            let candidate =
                AuthenticationDetailedPasskeyControlCandidateObservation::ExplicitlyMarked(
                    passkey_control(label),
                );
            assert!(!authentication_passkey_control_candidate_is_safe(
                &candidate
            ));
        }
    }
}
