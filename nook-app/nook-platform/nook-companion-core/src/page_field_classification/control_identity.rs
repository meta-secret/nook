use super::{
    contains_any_word, expand_identity_text, looks_like_unrestricted_login_advance_control_label,
};

pub(super) fn identity_names_external_authentication_provider(identity: &str) -> bool {
    contains_any_word(
        &expand_identity_text(identity),
        &[
            "google",
            "apple",
            "microsoft",
            "facebook",
            "github",
            "git hub",
            "gitlab",
            "git lab",
            "linkedin",
            "linked in",
            "twitter",
            "x",
            "x com",
            "okta",
        ],
    )
}

pub(super) fn looks_like_alternate_authentication_route_control_label(label: &str) -> bool {
    let identity = expand_identity_text(label);
    if contains_any_word(&identity, &["passkey", "saml", "sso"]) {
        return true;
    }
    let names_external_provider = identity_names_external_authentication_provider(&identity);
    if !names_external_provider {
        return false;
    }
    let selects_alternate_provider = contains_any_word(
        &identity,
        &["with", "using", "via", "use", "choose", "select"],
    );
    selects_alternate_provider || !looks_like_unrestricted_login_advance_control_label(label)
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
