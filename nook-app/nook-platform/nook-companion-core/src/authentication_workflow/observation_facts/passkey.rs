use crate::page_field_classification::{
    AuthenticationAdvanceControlObservation, authentication_passkey_control_is_safe,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

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
}
