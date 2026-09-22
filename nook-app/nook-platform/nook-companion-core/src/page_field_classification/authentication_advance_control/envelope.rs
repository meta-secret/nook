use super::{
    AuthenticationAdvanceControlObservation, AuthenticationUsernameEvidence,
    PageControlSubmissionDestinationSource, PageControlSubmissionMethod,
};
use crate::AuthenticationFieldCount;
use url::Url;

impl AuthenticationAdvanceControlObservation {
    /// Whether DOM-controlled text and bounded field counts fit the observation envelope.
    #[must_use]
    pub fn is_bounded(&self) -> bool {
        self.source_origin.len() <= super::super::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
            && self.form_identity.len() <= super::super::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
            && self.destination_identity.len()
                <= super::super::MAX_AUTHENTICATION_DESTINATION_TEXT_BYTES
            && self.label.len() <= super::super::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
            && self.machine_identity.len() <= super::super::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
            && [
                self.password_field_count,
                self.new_password_field_count,
                self.one_time_code_field_count,
            ]
            .into_iter()
            .all(AuthenticationFieldCount::is_within_observation_limit)
            && self
                .semantic_submit_control_count
                .is_within_observation_limit()
    }

    pub(super) fn is_extended_identifier_only_get_advance(&self) -> bool {
        let Ok(destination) = Url::parse(&self.destination_identity) else {
            return false;
        };
        let mut query = destination.query_pairs();
        let has_exact_booking_token = query
            .next()
            .is_some_and(|(key, value)| key == "op_token" && !value.is_empty())
            && query.next().is_none();
        matches!(self.submission_method, PageControlSubmissionMethod::Get)
            && matches!(
                self.submission_destination_source,
                PageControlSubmissionDestinationSource::Omitted
            )
            && matches!(
                self.authentication_username,
                AuthenticationUsernameEvidence::Explicit
            )
            && self.source_origin == "https://account.booking.com"
            && destination.scheme() == "https"
            && destination.host_str() == Some("account.booking.com")
            && destination.path() == "/sign-in"
            && destination.fragment().is_none()
            && has_exact_booking_token
            && self.has_booking_identifier_form_identity()
            && self.is_identifier_only_get_advance()
    }
}
