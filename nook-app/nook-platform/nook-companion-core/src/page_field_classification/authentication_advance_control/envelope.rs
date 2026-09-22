use super::{
    AuthenticationAdvanceControlObservation, AuthenticationUsernameEvidence,
    PageControlSubmissionDestinationSource, PageControlSubmissionMethod,
};
use crate::AuthenticationFieldCount;

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
        matches!(self.submission_method, PageControlSubmissionMethod::Get)
            && matches!(
                self.submission_destination_source,
                PageControlSubmissionDestinationSource::Omitted
            )
            && matches!(
                self.authentication_username,
                AuthenticationUsernameEvidence::Explicit
            )
            && self.has_booking_identifier_form_identity()
            && self.is_identifier_only_get_advance()
    }
}
