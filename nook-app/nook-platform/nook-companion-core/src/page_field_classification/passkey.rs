//! Passkey and platform-authenticator control-label classification.

pub(crate) const PASSKEY_OR_PLATFORM_AUTHENTICATOR_WORDS: &[&str] = &[
    "pass key",
    "passkey",
    "webauthn",
    "security key",
    "hardware key",
    "fido",
    "touch id",
    "face id",
    "windows hello",
];

const PASSKEY_ENROLLMENT_OR_MANAGEMENT_WORDS: &[&str] = &[
    "add",
    "create",
    "enable",
    "enroll",
    "enrollment",
    "register",
    "registration",
    "manage",
    "management",
    "settings",
    "set up",
    "setup",
    "configure",
];

/// True when a labeled control advertises passkey / `WebAuthn` / platform authenticator.
use crate::{AuthenticationAdvanceControlObservation, AuthenticationControlText};
impl AuthenticationAdvanceControlObservation {
    #[must_use]
    pub fn looks_like_passkey_control_label(label: &str) -> bool {
        let identity = AuthenticationControlText::new(label).expand_identity_text();
        !AuthenticationControlText::new(&identity).contains_any_word(&[
            "delete",
            "remove",
            "revoke",
            "unlink",
            "disconnect",
            "disable",
            "deactivate",
        ]) && AuthenticationControlText::new(&identity)
            .contains_any_word(PASSKEY_OR_PLATFORM_AUTHENTICATOR_WORDS)
    }
}

/// True when a passkey-looking label describes enrollment or management, not login.
impl AuthenticationAdvanceControlObservation {
    #[must_use]
    pub fn looks_like_passkey_enrollment_or_management_label(label: &str) -> bool {
        let identity = AuthenticationControlText::new(label).expand_identity_text();
        AuthenticationControlText::new(&identity)
            .contains_any_word(PASSKEY_OR_PLATFORM_AUTHENTICATOR_WORDS)
            && AuthenticationControlText::new(&identity)
                .contains_any_word(PASSKEY_ENROLLMENT_OR_MANAGEMENT_WORDS)
    }
}

#[cfg(test)]
mod tests {

    #[test]
    fn distinguishes_login_passkeys_from_enrollment_labels() {
        assert!(
            AuthenticationAdvanceControlObservation::looks_like_passkey_control_label(
                "Sign in with passkey"
            )
        );
        assert!(
            !AuthenticationAdvanceControlObservation::looks_like_passkey_control_label("Continue")
        );
        assert!(AuthenticationAdvanceControlObservation::looks_like_passkey_enrollment_or_management_label(
            "Add passkey"
        ));
        assert!(!AuthenticationAdvanceControlObservation::looks_like_passkey_enrollment_or_management_label(
            "Sign in with a passkey"
        ));
    }
}
