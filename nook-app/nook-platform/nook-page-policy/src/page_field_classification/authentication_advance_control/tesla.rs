use super::{
    AuthenticationAdvanceControlObservation, PageControlActionability, PageControlOwnership,
    PageControlSemantics, PageControlSubmissionDestinationSource, PageControlSubmissionMethod,
};
use crate::page_field_classification::AuthenticationUsernameEvidence;
use crate::{AuthenticationControlText, CanonicalControlDestination, ControlDestinationEvidence};

impl AuthenticationAdvanceControlObservation {
    /// Whether Tesla's disabled password submitter supplies planning evidence.
    /// Final actuation still requires a fresh actionable observation.
    #[must_use]
    pub fn allows_tesla_password_disclosure_planning(&self) -> bool {
        if !matches!(self.actionability, PageControlActionability::Inert)
            || !self.is_tesla_scripted_password_submit_shape()
        {
            return false;
        }
        let Ok(destination) = CanonicalControlDestination::canonicalize_control_destination(
            ControlDestinationEvidence {
                source_origin: &self.source_origin,
                destination_identity: &self.destination_identity,
            },
        ) else {
            return false;
        };
        if !destination.is_tesla_account_authorization() {
            return false;
        }
        let mut actionable = self.clone();
        actionable.actionability = PageControlActionability::Actionable;
        actionable.authentication_advance_control_is_safe()
    }

    pub(crate) fn is_tesla_scripted_password_submit_shape(&self) -> bool {
        matches!(self.ownership, PageControlOwnership::OwnedForm)
            && matches!(self.semantics, PageControlSemantics::SemanticSubmit)
            && matches!(
                self.authentication_username,
                AuthenticationUsernameEvidence::Absent
            )
            && matches!(self.submission_method, PageControlSubmissionMethod::Get)
            && matches!(
                self.submission_destination_source,
                PageControlSubmissionDestinationSource::Omitted
            )
            && self.source_origin == "https://auth.tesla.com"
            && self.form_identity.is_empty()
            && self.password_field_count.is_single()
            && self.new_password_field_count.is_zero()
            && self.one_time_code_field_count.is_zero()
            && !self.semantic_submit_control_count.is_multiple()
            && matches!(
                AuthenticationControlText::new(&self.label)
                    .expand_identity_text()
                    .as_str(),
                "sign in"
                    | "anmelden"
                    | "se connecter"
                    | "iniciar sesión"
                    | "accedi"
                    | "aanmelden"
                    | "entrar"
                    | "logga in"
                    | "logg inn"
                    | "log ind"
                    | "kirjaudu sisään"
                    | "zaloguj się"
                    | "přihlásit se"
                    | "サインイン"
                    | "로그인"
                    | "登录"
                    | "登入"
            )
            && AuthenticationControlText::new(&self.machine_identity).expand_identity_text()
                == "tds btn"
    }
}
