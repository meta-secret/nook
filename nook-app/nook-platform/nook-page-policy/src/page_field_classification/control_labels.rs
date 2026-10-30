//! Authentication control label policy.

use super::{
    AuthenticationAdvanceControlObservation, AuthenticationControlText, ControlIdentity,
    LOGIN_ADVANCE_WORDS, MAX_AUTHENTICATION_CONTROL_TEXT_BYTES, RouteIdentity,
};

/// True when a checkbox/control label looks like terms / privacy acceptance.
impl AuthenticationAdvanceControlObservation {
    #[must_use]
    pub fn looks_like_manual_checkpoint_label(label: &str) -> bool {
        let lower = label.to_ascii_lowercase();
        [
            "terms", "privacy", "agree", "accept", "policy", "consent", "eula",
        ]
        .iter()
        .any(|needle| lower.contains(needle))
    }
}

/// True when body copy looks like an email-verification gate.
impl AuthenticationAdvanceControlObservation {
    #[must_use]
    pub fn looks_like_email_verification_body(body: &str) -> bool {
        let lower = body.to_ascii_lowercase();
        [
            "verify your email",
            "check your email",
            "email verification",
            "confirm your email",
        ]
        .iter()
        .any(|needle| lower.contains(needle))
    }
}

/// True when an activatable control advances an authentication ceremony.
impl AuthenticationAdvanceControlObservation {
    #[must_use]
    pub fn looks_like_login_advance_control_label(label: &str) -> bool {
        if label.len() > MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
        || RouteIdentity::new(label).indicates_destructive_action()
        || AuthenticationAdvanceControlObservation::looks_like_non_authentication_submit_control_label(label)
        || ControlIdentity::new(label).is_password_recovery()
        || ControlIdentity::new(label).is_registration()
        || ControlIdentity::new(label).is_alternate_authentication_route()
    {
        return false;
    }
        AuthenticationAdvanceControlObservation::looks_like_unrestricted_login_advance_control_label(
            label,
        )
    }
}

impl AuthenticationAdvanceControlObservation {
    pub(super) fn looks_like_unrestricted_login_advance_control_label(label: &str) -> bool {
        let identity = AuthenticationControlText::new(label).expand_identity_text();
        if AuthenticationControlText::new(&identity).contains_any_word(&["entrar"])
            && identity.split_whitespace().any(|token| token != "entrar")
        {
            return false;
        }
        AuthenticationAdvanceControlObservation::repeated_localized_login_label(&identity)
            || AuthenticationControlText::new(&identity).contains_any_word(LOGIN_ADVANCE_WORDS)
            || AuthenticationControlText::new(&identity).contains_any_word(&["submit"])
    }
}

impl AuthenticationAdvanceControlObservation {
    pub(super) fn repeated_localized_login_label(identity: &str) -> bool {
        let tokens = identity.split_whitespace().collect::<Vec<_>>();
        !tokens.is_empty()
            && (tokens.iter().all(|token| *token == "anmelden")
                || (tokens.len() % 2 == 0
                    && tokens.chunks(2).all(|pair| pair == ["se", "connecter"])))
    }
}

impl AuthenticationAdvanceControlObservation {
    pub(crate) fn looks_like_supported_localized_login_control_label(label: &str) -> bool {
        AuthenticationAdvanceControlObservation::repeated_localized_login_label(
            &AuthenticationControlText::new(label).expand_identity_text(),
        )
    }
}

/// True when a semantic submit explicitly describes a non-authentication action.
impl AuthenticationAdvanceControlObservation {
    #[must_use]
    pub fn looks_like_non_authentication_submit_control_label(label: &str) -> bool {
        let identity = AuthenticationControlText::new(label).expand_identity_text();
        AuthenticationControlText::new(&identity).contains_any_word(&[
            "save",
            "update",
            "subscribe",
            "search",
            "publish",
            "post",
            "delete",
            "remove",
            "deactivate",
            "close account",
            "erase",
            "destroy",
            "cancel",
            "back",
            "help",
            "learn more",
        ])
    }
}

impl AuthenticationAdvanceControlObservation {
    #[must_use]
    pub fn looks_like_password_update_submit_control_label(label: &str) -> bool {
        let identity = AuthenticationControlText::new(label).expand_identity_text();
        matches!(
            identity.as_str(),
            "save"
                | "save changes"
                | "save and continue"
                | "update"
                | "update credentials"
                | "change"
        ) || (AuthenticationControlText::new(&identity).contains_any_word(&["password"])
            && AuthenticationControlText::new(&identity)
                .contains_any_word(&["save", "update", "change", "set", "reset"]))
    }
}
