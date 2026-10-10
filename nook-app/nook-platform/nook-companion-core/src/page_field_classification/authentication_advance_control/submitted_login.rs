//! Candidate staging admits scoped activation without claiming authenticated success.
use super::{
    AuthenticationAdvanceControlObservation, AuthenticationControlIdentity,
    AuthenticationRouteIdentity, AuthenticationUsernameEvidence, PageControlActionability,
    PageControlSemantics, PageControlSubmissionMethod,
};
use crate::AuthenticationControlText;
use crate::AuthenticationFieldObservationFacts;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SubmittedLoginControlAdmission {
    Admitted,
    Inert,
    ForbiddenMethod,
    IncompatibleScope,
    SemanticVeto,
    Absent,
}

#[derive(Clone, Copy)]
pub(crate) struct SubmittedLoginControlRequest {
    pub fields: AuthenticationFieldObservationFacts,
    pub username: AuthenticationUsernameEvidence,
}

impl AuthenticationAdvanceControlObservation {
    #[must_use]
    pub(crate) fn classify_submitted_login_candidate(
        &self,
        request: SubmittedLoginControlRequest,
    ) -> SubmittedLoginControlAdmission {
        let SubmittedLoginControlRequest { fields, username } = request;
        let PageControlActionability::Actionable = self.actionability else {
            return SubmittedLoginControlAdmission::Inert;
        };
        let false = matches!(
            self.submission_method,
            PageControlSubmissionMethod::Get | PageControlSubmissionMethod::Dialog
        ) else {
            return SubmittedLoginControlAdmission::ForbiddenMethod;
        };
        let mut observation = self.clone();
        observation.authentication_username = username;
        observation.password_field_count = fields
            .current_password_field_count
            .saturating_add(fields.generic_password_field_count)
            .saturating_add(fields.new_password_field_count);
        observation.new_password_field_count = fields.new_password_field_count;
        observation.one_time_code_field_count = fields.one_time_code_field_count;
        observation.semantic_submit_control_count = match self.semantics {
            PageControlSemantics::SemanticSubmit => 1.into(),
            PageControlSemantics::Activation => 0.into(),
        };
        let true =
            (observation.is_bounded() && fields.is_compatible_with_detailed_control(&observation))
        else {
            return SubmittedLoginControlAdmission::IncompatibleScope;
        };
        let false = [
            self.label.as_str(),
            self.machine_identity.as_str(),
            self.form_identity.as_str(),
            self.destination_identity.as_str(),
        ]
        .iter()
        .any(|identity| {
            let control = AuthenticationControlIdentity::new(identity);
            let expanded = AuthenticationControlText::new(identity).expand_identity_text();
            control.is_auxiliary()
                || AuthenticationControlText::new(&expanded).contains_any_word(&["reset"])
                || control.is_registration()
                || control.is_password_recovery()
                || control.is_alternate_authentication_route()
                || AuthenticationRouteIdentity::new(identity).has_control_veto()
                || Self::looks_like_non_authentication_submit_control_label(identity)
        }) else {
            return SubmittedLoginControlAdmission::SemanticVeto;
        };
        SubmittedLoginControlAdmission::Admitted
    }
}
