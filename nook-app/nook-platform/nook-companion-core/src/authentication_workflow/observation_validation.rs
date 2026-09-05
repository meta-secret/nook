//! Validation for bounded authentication observation envelopes.

use super::AuthenticationPageObservation;

pub const MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT: u32 = 100;
pub const MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS: usize = 20;

/// Validate the bounded, non-secret observation envelope accepted from clients.
#[must_use]
pub fn authentication_page_observations_are_valid(
    observations: &[AuthenticationPageObservation],
) -> bool {
    !observations.is_empty()
        && observations.len() <= MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS
        && observations.iter().all(|observation| {
            [
                observation.username_field_count.raw(),
                observation.current_password_field_count.raw(),
                observation.new_password_field_count.raw(),
                observation.generic_password_field_count.raw(),
                observation.one_time_code_field_count.raw(),
                observation.matching_passkey_account_count.raw(),
            ]
            .into_iter()
            .all(|count| count <= MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT)
                && observation.password_field_count().raw()
                    <= MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AuthenticationWorkflowMatch, AuthenticationWorkflowSnapshotError,
        classify_authentication_workflow_candidates,
    };

    #[test]
    fn validates_bounded_authentication_observation_envelopes() {
        let valid = [AuthenticationPageObservation {
            username_field_count: MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT.into(),
            ..Default::default()
        }];
        assert!(authentication_page_observations_are_valid(&valid));
        assert!(!authentication_page_observations_are_valid(&[]));

        let excessive_count = [AuthenticationPageObservation {
            current_password_field_count: (MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT + 1).into(),
            ..Default::default()
        }];
        assert!(!authentication_page_observations_are_valid(
            &excessive_count
        ));

        let combined_password_overflow = [AuthenticationPageObservation {
            current_password_field_count: (MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT / 2).into(),
            generic_password_field_count: (MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT / 2 + 1).into(),
            ..Default::default()
        }];
        assert!(!authentication_page_observations_are_valid(
            &combined_password_overflow
        ));

        let excessive_pages = vec![
            AuthenticationPageObservation::default();
            MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS + 1
        ];
        assert!(!authentication_page_observations_are_valid(
            &excessive_pages
        ));
    }

    #[test]
    fn classifier_rejects_observations_outside_the_portable_envelope() {
        let excessive_field_count = [AuthenticationPageObservation {
            username_field_count: (MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT + 1).into(),
            current_password_field_count: 1.into(),
            ..Default::default()
        }];
        let rejected = classify_authentication_workflow_candidates(&excessive_field_count);
        assert_eq!(rejected, AuthenticationWorkflowMatch::Rejected);
        assert_eq!(
            rejected.snapshot(),
            Err(AuthenticationWorkflowSnapshotError::Rejected)
        );

        let excessive_pages = vec![
            AuthenticationPageObservation {
                username_field_count: 1.into(),
                current_password_field_count: 1.into(),
                ..Default::default()
            };
            MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS + 1
        ];
        assert_eq!(
            classify_authentication_workflow_candidates(&excessive_pages),
            AuthenticationWorkflowMatch::Rejected
        );
    }
}
