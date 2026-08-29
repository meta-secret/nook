use super::{
    contains_any_word, expand_identity_text, looks_like_unrestricted_login_advance_control_label,
};

fn identity_names_external_authentication_provider(
    identity: &str,
    allow_single_letter_x: bool,
) -> bool {
    let identity = expand_identity_text(identity);
    contains_any_word(
        &identity,
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
            "x com",
            "okta",
        ],
    ) || (allow_single_letter_x && contains_any_word(&identity, &["x"]))
}

pub(super) fn label_names_external_authentication_provider(identity: &str) -> bool {
    identity_names_external_authentication_provider(identity, true)
}

pub(super) fn route_names_external_authentication_provider(identity: &str) -> bool {
    let route = expand_identity_text(identity.split(['?', '#']).next().unwrap_or_default());
    identity_names_external_authentication_provider(identity, false)
        || identity.split_once('?').is_some_and(|(_, query)| {
            query
                .split(['&', '#'])
                .filter_map(|component| component.split_once('='))
                .any(|(key, _)| key.eq_ignore_ascii_case("provider"))
        })
        || (contains_any_word(&route, &["x"])
            && contains_any_word(&route, &["login", "log in", "signin", "sign in"]))
}

fn has_open_ended_provider_selection_grammar(identity: &str) -> bool {
    let tokens = identity.split_whitespace().collect::<Vec<_>>();
    tokens.iter().enumerate().any(|(index, token)| {
        matches!(
            *token,
            "with" | "using" | "via" | "use" | "choose" | "select"
        ) && index + 1 < tokens.len()
            && !matches!(&tokens[index + 1..], ["email" | "password"])
    })
}

pub(super) fn looks_like_microsoft_primary_sign_in_label(label: &str) -> bool {
    let identity = expand_identity_text(label);
    identity.starts_with("sign in to ")
        && contains_any_word(&identity, &["microsoft"])
        && !label_names_external_authentication_provider(&identity.replace("microsoft", ""))
}

pub(super) fn looks_like_alternate_authentication_route_control_label(label: &str) -> bool {
    let identity = expand_identity_text(label);
    if contains_any_word(&identity, &["passkey", "saml", "sso"]) {
        return true;
    }
    (label_names_external_authentication_provider(&identity)
        && !looks_like_microsoft_primary_sign_in_label(label))
        || (looks_like_unrestricted_login_advance_control_label(label)
            && has_open_ended_provider_selection_grammar(&identity))
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
