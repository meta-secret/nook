//! Passkey and platform-authenticator control-label classification.

use super::{contains_any_word, expand_identity_text};

pub(super) const PASSKEY_OR_PLATFORM_AUTHENTICATOR_WORDS: &[&str] = &[
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
#[must_use]
pub fn looks_like_passkey_control_label(label: &str) -> bool {
    let identity = expand_identity_text(label);
    !contains_any_word(
        &identity,
        &[
            "delete",
            "remove",
            "revoke",
            "unlink",
            "disconnect",
            "disable",
            "deactivate",
        ],
    ) && contains_any_word(&identity, PASSKEY_OR_PLATFORM_AUTHENTICATOR_WORDS)
}

/// True when a passkey-looking label describes enrollment or management, not login.
#[must_use]
pub fn looks_like_passkey_enrollment_or_management_label(label: &str) -> bool {
    let identity = expand_identity_text(label);
    contains_any_word(&identity, PASSKEY_OR_PLATFORM_AUTHENTICATOR_WORDS)
        && contains_any_word(&identity, PASSKEY_ENROLLMENT_OR_MANAGEMENT_WORDS)
}

#[cfg(test)]
mod tests {
    use super::{
        looks_like_passkey_control_label, looks_like_passkey_enrollment_or_management_label,
    };

    #[test]
    fn distinguishes_login_passkeys_from_enrollment_labels() {
        assert!(looks_like_passkey_control_label("Sign in with passkey"));
        assert!(!looks_like_passkey_control_label("Continue"));
        assert!(looks_like_passkey_enrollment_or_management_label(
            "Add passkey"
        ));
        assert!(!looks_like_passkey_enrollment_or_management_label(
            "Sign in with a passkey"
        ));
    }
}
