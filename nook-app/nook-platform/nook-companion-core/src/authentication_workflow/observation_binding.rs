use super::AuthenticationPageObservationFactsBatch;
use serde::{Deserialize, Serialize};
use tsify::Tsify;

const OBSERVATION_BINDING_VERSION: &str = "nook-auth-observation-v1:";

/// Opaque canonical Rust binding for one ordered, bounded browser observation batch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "string", into_wasm_abi, from_wasm_abi)]
pub struct AuthenticationObservationBindingToken(String);

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("authentication observation facts cannot be bound")]
pub struct AuthenticationObservationBindingError;

/// Canonically bind the exact ordered facts Rust will classify.
pub fn bind_authentication_page_observation_facts(
    facts: &AuthenticationPageObservationFactsBatch,
) -> Result<AuthenticationObservationBindingToken, AuthenticationObservationBindingError> {
    if !facts.is_valid_binding() {
        return Err(AuthenticationObservationBindingError);
    }
    let canonical =
        serde_json::to_string(facts).map_err(|_| AuthenticationObservationBindingError)?;
    Ok(AuthenticationObservationBindingToken(format!(
        "{OBSERVATION_BINDING_VERSION}{canonical}"
    )))
}

/// Compare current browser facts with a prior Rust-issued canonical binding.
#[must_use]
pub fn authentication_page_observation_facts_match_binding(
    binding: &AuthenticationObservationBindingToken,
    facts: &AuthenticationPageObservationFactsBatch,
) -> bool {
    bind_authentication_page_observation_facts(facts).is_ok_and(|current| current == *binding)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AuthenticationCredentialSubmissionFacts, AuthenticationCredentialSubmissionObservation,
        AuthenticationFieldObservationFacts, AuthenticationPageObservationFacts,
        PageControlActionability, PageControlSubmissionMethod,
    };

    fn bound_password_observation() -> AuthenticationPageObservationFactsBatch {
        AuthenticationPageObservationFactsBatch {
            observations: vec![AuthenticationPageObservationFacts {
                fields: AuthenticationFieldObservationFacts {
                    current_password_field_count: 1,
                    actionable_password_field_count: 1,
                    ..Default::default()
                },
                credential_submission: AuthenticationCredentialSubmissionObservation::Observed(
                    AuthenticationCredentialSubmissionFacts {
                        actionability: PageControlActionability::Actionable,
                        method: PageControlSubmissionMethod::Post,
                        source_origin: "https://example.test".to_owned(),
                        form_identity: "login".to_owned(),
                        destination_identity: "https://example.test/session".to_owned(),
                    },
                ),
                ..Default::default()
            }],
        }
    }

    #[test]
    fn binds_only_the_exact_ordered_submission_and_field_facts() -> anyhow::Result<()> {
        let approved = bound_password_observation();
        let binding = bind_authentication_page_observation_facts(&approved)?;
        assert!(authentication_page_observation_facts_match_binding(
            &binding, &approved
        ));

        let mut get_route = approved.clone();
        let AuthenticationCredentialSubmissionObservation::Observed(submission) =
            &mut get_route.observations[0].credential_submission
        else {
            unreachable!();
        };
        submission.method = PageControlSubmissionMethod::Get;
        assert!(!authentication_page_observation_facts_match_binding(
            &binding, &get_route
        ));

        let mut inert_route = approved.clone();
        let AuthenticationCredentialSubmissionObservation::Observed(submission) =
            &mut inert_route.observations[0].credential_submission
        else {
            unreachable!();
        };
        submission.actionability = PageControlActionability::Inert;
        assert!(!authentication_page_observation_facts_match_binding(
            &binding,
            &inert_route
        ));

        let mut readonly = approved;
        readonly.observations[0]
            .fields
            .actionable_password_field_count = 0;
        readonly.observations[0]
            .fields
            .readonly_password_field_count = 1;
        assert!(!authentication_page_observation_facts_match_binding(
            &binding, &readonly
        ));
        Ok(())
    }

    #[test]
    fn rejects_empty_unbounded_and_incomplete_password_bindings() {
        assert!(
            bind_authentication_page_observation_facts(&AuthenticationPageObservationFactsBatch {
                observations: Vec::new(),
            })
            .is_err()
        );

        let mut incomplete = bound_password_observation();
        incomplete.observations[0]
            .fields
            .actionable_password_field_count = 0;
        assert!(bind_authentication_page_observation_facts(&incomplete).is_err());
    }
}
