use super::{contains_any_word, expand_identity_text, looks_like_login_advance_control_label};

pub(super) fn looks_like_alternate_authentication_route_control_label(label: &str) -> bool {
    let identity = expand_identity_text(label);
    if contains_any_word(&identity, &["passkey", "saml", "sso"]) {
        return true;
    }
    let names_external_provider = contains_any_word(
        &identity,
        &[
            "google",
            "apple",
            "microsoft",
            "facebook",
            "github",
            "gitlab",
            "linkedin",
            "twitter",
            "okta",
        ],
    );
    if !names_external_provider {
        return false;
    }
    let selects_alternate_provider = contains_any_word(
        &identity,
        &["with", "using", "via", "use", "choose", "select"],
    );
    selects_alternate_provider || !looks_like_login_advance_control_label(label)
}

pub(super) fn looks_like_explicit_authentication_advance_control_label(label: &str) -> bool {
    contains_any_word(
        &expand_identity_text(label),
        &["signin", "sign-in", "sign in", "login", "log-in", "log in"],
    )
}

pub(super) fn looks_like_auxiliary_authentication_control_label(label: &str) -> bool {
    let identity = expand_identity_text(label);
    contains_any_word(&identity, &["password"])
        && contains_any_word(
            &identity,
            &[
                "show",
                "hide",
                "reveal",
                "unmask",
                "mask",
                "toggle",
                "visibility",
                "visible",
            ],
        )
}

pub(super) fn looks_like_password_recovery_route_control_label(label: &str) -> bool {
    let identity = expand_identity_text(label);
    contains_any_word(&identity, &["password"])
        && contains_any_word(
            &identity,
            &["forgot", "forget", "recover", "recovery", "reset"],
        )
}

pub(super) fn looks_like_registration_route_control_label(label: &str) -> bool {
    contains_any_word(
        &expand_identity_text(label),
        &[
            "create account",
            "register",
            "registration",
            "signup",
            "sign-up",
            "sign up",
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::looks_like_registration_route_control_label;

    #[test]
    fn recognizes_registration_routes_without_matching_login_actions() {
        assert!(looks_like_registration_route_control_label(
            "Create account"
        ));
        assert!(looks_like_registration_route_control_label("Sign up"));
        assert!(looks_like_registration_route_control_label("Register"));
        assert!(!looks_like_registration_route_control_label("Sign in"));
    }
}
