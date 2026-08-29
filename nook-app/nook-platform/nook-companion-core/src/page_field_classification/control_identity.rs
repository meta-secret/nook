use super::form_identity::identity_indicates_explicit_login_route;
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
            "amazon",
            "discord",
        ],
    ) || (allow_single_letter_x && contains_any_word(&identity, &["x"]))
}
pub(super) fn label_names_external_authentication_provider(identity: &str) -> bool {
    identity_names_external_authentication_provider(identity, true)
}

pub(super) fn identity_names_registered_external_authentication_provider(identity: &str) -> bool {
    identity_names_external_authentication_provider(identity, false)
}
pub(super) fn route_names_external_authentication_provider(identity: &str) -> bool {
    let route = expand_identity_text(identity.split(['?', '#']).next().unwrap_or_default());
    let fragment = expand_identity_text(identity.split_once('#').map_or("", |(_, value)| value));
    let segments = identity
        .split(['?', '#'])
        .next()
        .unwrap_or_default()
        .split('/')
        .filter(|segment| !segment.is_empty())
        .map(expand_identity_text)
        .collect::<Vec<_>>();
    let is_version = |segment: &str| {
        segment
            .strip_prefix("v ")
            .or_else(|| segment.strip_prefix('v'))
            .is_some_and(|version| !version.is_empty() && version.parse::<u32>().is_ok())
    };
    let is_local_tail = |segment: &str| {
        matches!(segment, "identifier" | "email" | "password" | "username")
            || matches!(segment, "verify" | "challenge" | "callback")
            || is_version(segment)
    };
    let has_unknown_login_route_segment = segments.iter().enumerate().any(|(index, segment)| {
        let tails = &segments[index + 1..];
        identity_indicates_explicit_login_route(segment)
            && (!segments[..index].iter().all(|prefix| {
                matches!(prefix.as_str(), "auth" | "authentication" | "common")
                    || is_version(prefix)
            }) || !(tails.is_empty() || matches!(tails, [tail] if is_local_tail(tail))))
    });
    identity_names_external_authentication_provider(identity, false)
        || identity.split(['?', '#']).any(|metadata| {
            metadata.split('&').any(|component| {
                let key = expand_identity_text(component.split('=').next().unwrap_or_default());
                let root = key
                    .strip_suffix(" id")
                    .or_else(|| key.strip_suffix(" name"))
                    .unwrap_or(&key);
                ["provider", "identity provider", "idp", "connection"].contains(&root)
            })
        })
        || contains_any_word(&route, &["provider", "idp"])
        || has_unknown_login_route_segment
        || ((contains_any_word(&route, &["x"]) || contains_any_word(&fragment, &["x"]))
            && contains_any_word(&route, &["login", "log in", "signin", "sign in"]))
}
fn has_open_ended_provider_selection_grammar(identity: &str) -> bool {
    let tokens = identity.split_whitespace().collect::<Vec<_>>();
    tokens.iter().enumerate().any(|(index, token)| {
        matches!(
            *token,
            "with" | "using" | "via" | "use" | "choose" | "select"
        ) && index + 1 < tokens.len()
            && !matches!(
                &tokens[index + 1..],
                ["email" | "password"]
                    | ["email", "address"]
                    | ["your", "email"]
                    | ["your", "email", "address"]
                    | ["your", "password", "to", "sign", "in"]
            )
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
pub(super) fn looks_like_explicit_authentication_advance_control_label(label: &str) -> bool {
    contains_any_word(
        &expand_identity_text(label),
        &["signin", "sign-in", "sign in", "login", "log-in", "log in"],
    )
}
pub(super) fn looks_like_one_time_code_resend_control_label(label: &str) -> bool {
    contains_any_word(
        &expand_identity_text(label),
        &[
            "resend",
            "send again",
            "request new code",
            "send new code",
            "another code",
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
