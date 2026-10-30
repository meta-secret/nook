use super::{
    AuthenticationControlText,
    control_text::AuthenticationIdentityPhraseEvidence,
    form_identity::{AuthenticationPasswordRecoveryEvidence, AuthenticationRouteIdentity},
};

/// Whether observed container metadata explicitly names an authentication surface.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthenticationContainerIdentity {
    Authentication,
    Unrelated,
}

impl AuthenticationControlText<'_> {
    #[must_use]
    pub fn authentication_container_identity(&self) -> AuthenticationContainerIdentity {
        let identity = self.expand_identity_text();
        match AuthenticationControlText::new(&identity).identity_phrase_evidence(&[
            "login", "log in", "signin", "sign in", "signup", "sign up",
        ]) {
            AuthenticationIdentityPhraseEvidence::Found(_) => {
                AuthenticationContainerIdentity::Authentication
            }
            AuthenticationIdentityPhraseEvidence::Absent => {
                match AuthenticationRouteIdentity::new(&identity).password_recovery_evidence() {
                    AuthenticationPasswordRecoveryEvidence::Recovery => {
                        AuthenticationContainerIdentity::Authentication
                    }
                    AuthenticationPasswordRecoveryEvidence::Unrelated => {
                        AuthenticationContainerIdentity::Unrelated
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_authentication_surfaces_exclude_css_reset_utilities() {
        for identity in [
            "login-form",
            "signIn",
            "sign_up",
            "signup",
            "reset-password",
            "resetCredentials",
            "password-recovery",
        ] {
            assert_eq!(
                AuthenticationControlText::new(identity).authentication_container_identity(),
                AuthenticationContainerIdentity::Authentication,
                "{identity}"
            );
        }
        for identity in [
            "",
            "reset",
            "reset_base__1e6d9s10 knox-reset",
            "reset-button",
            "signincomplete",
            "search",
        ] {
            assert_eq!(
                AuthenticationControlText::new(identity).authentication_container_identity(),
                AuthenticationContainerIdentity::Unrelated,
                "{identity}"
            );
        }
    }
}
