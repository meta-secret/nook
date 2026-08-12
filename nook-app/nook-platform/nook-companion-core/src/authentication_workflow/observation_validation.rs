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
                observation.username_field_count,
                observation.current_password_field_count,
                observation.new_password_field_count,
                observation.generic_password_field_count,
                observation.one_time_code_field_count,
                observation.matching_passkey_account_count,
            ]
            .into_iter()
            .all(|count| count <= MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_bounded_authentication_observation_envelopes() {
        let valid = [AuthenticationPageObservation {
            username_field_count: MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT,
            ..Default::default()
        }];
        assert!(authentication_page_observations_are_valid(&valid));
        assert!(!authentication_page_observations_are_valid(&[]));

        let excessive_count = [AuthenticationPageObservation {
            current_password_field_count: MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT + 1,
            ..Default::default()
        }];
        assert!(!authentication_page_observations_are_valid(
            &excessive_count
        ));

        let excessive_pages = vec![
            AuthenticationPageObservation::default();
            MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS + 1
        ];
        assert!(!authentication_page_observations_are_valid(
            &excessive_pages
        ));
    }
}
