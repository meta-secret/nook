use crate::{
    PageControlActionability, PageControlSubmissionMethod, canonicalize_control_destination,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

/// Effective credential-submission route observed for an authentication scope.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthenticationCredentialSubmissionFacts {
    pub actionability: PageControlActionability,
    pub method: PageControlSubmissionMethod,
    pub source_origin: String,
    pub form_identity: String,
    pub destination_identity: String,
}

impl AuthenticationCredentialSubmissionFacts {
    pub(super) fn is_bounded(&self) -> bool {
        !matches!(self.method, PageControlSubmissionMethod::Absent)
            && self.form_identity.len()
                <= crate::page_field_classification::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
            && canonicalize_control_destination(&self.source_origin, &self.destination_identity)
                .is_some()
    }
}

/// Whether a scope has an effective browser submission route to bind.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", content = "facts", rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationCredentialSubmissionObservation {
    #[default]
    Absent,
    Observed(AuthenticationCredentialSubmissionFacts),
}

impl AuthenticationCredentialSubmissionObservation {
    pub(super) fn is_bounded(&self) -> bool {
        match self {
            Self::Absent => true,
            Self::Observed(facts) => facts.is_bounded(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn submission() -> AuthenticationCredentialSubmissionFacts {
        AuthenticationCredentialSubmissionFacts {
            actionability: PageControlActionability::Actionable,
            method: PageControlSubmissionMethod::Post,
            source_origin: "https://example.test".to_owned(),
            form_identity: "login".to_owned(),
            destination_identity: "https://example.test/session".to_owned(),
        }
    }

    #[test]
    fn validates_complete_effective_submission_routes() {
        assert!(submission().is_bounded());

        let mut absent_method = submission();
        absent_method.method = PageControlSubmissionMethod::Absent;
        assert!(!absent_method.is_bounded());

        let mut malformed_destination = submission();
        malformed_destination.destination_identity = "not a destination".to_owned();
        assert!(!malformed_destination.is_bounded());
    }
}
