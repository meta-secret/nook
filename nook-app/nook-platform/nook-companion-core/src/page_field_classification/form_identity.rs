use super::{contains_any_word, expand_identity_text};

pub(super) fn identity_indicates_explicit_authentication_route(identity: &str) -> bool {
    contains_any_word(
        &expand_identity_text(identity),
        &[
            "login",
            "log in",
            "signin",
            "sign in",
            "sign-in",
            "identity",
            "auth",
            "authentication",
        ],
    )
}

pub(super) fn form_identity_indicates_destructive_action(form_identity: &str) -> bool {
    let identity = expand_identity_text(form_identity);
    contains_any_word(
        &identity,
        &[
            "delete",
            "remove",
            "deactivate",
            "disable",
            "unlink",
            "disconnect",
            "logout",
            "log out",
            "signout",
            "sign out",
            "revoke",
            "suspend",
            "close account",
            "erase",
            "destroy",
            "terminate",
            "eliminar",
        ],
    )
}

pub(super) fn form_identity_indicates_non_authentication_account_management(
    form_identity: &str,
) -> bool {
    let identity = expand_identity_text(form_identity);
    contains_any_word(
        &identity,
        &[
            "profile",
            "settings",
            "preferences",
            "newsletter",
            "subscribe",
            "marketing",
            "contact",
        ],
    )
}

pub(super) fn control_destination_indicates_non_authentication_route(
    destination_identity: &str,
) -> bool {
    if destination_identity.trim().is_empty() {
        return false;
    }
    let identity = expand_identity_text(destination_identity);
    if form_identity_indicates_destructive_action(&identity)
        || contains_any_word(
            &identity,
            &[
                "register",
                "registration",
                "signup",
                "sign up",
                "recover",
                "recovery",
                "forgot password",
                "reset",
                "reset password",
            ],
        )
    {
        return true;
    }
    !identity_indicates_explicit_authentication_route(&identity)
        && form_identity_indicates_non_authentication_account_management(&identity)
}

pub(super) fn control_destination_indicates_safe_post_login_route(
    destination_identity: &str,
) -> bool {
    let normalized = destination_identity.trim().to_ascii_lowercase();
    let route = normalized
        .split(['?', '#'])
        .next()
        .unwrap_or_default()
        .trim_end_matches('/');
    matches!(route, "/auth/post-login" | "/authentication/post-login")
}

pub(super) fn control_destination_indicates_registration_route(destination_identity: &str) -> bool {
    if destination_identity.trim().is_empty() {
        return false;
    }
    contains_any_word(
        &expand_identity_text(destination_identity),
        &["register", "registration", "signup", "sign up"],
    )
}

pub(super) fn control_destination_indicates_password_recovery_route(
    destination_identity: &str,
) -> bool {
    if destination_identity.trim().is_empty() {
        return false;
    }
    let identity = expand_identity_text(destination_identity);
    contains_any_word(&identity, &["recover", "recovery", "forgot password"])
        || (contains_any_word(&identity, &["reset"])
            && contains_any_word(&identity, &["password", "credential"]))
}
