use super::{contains_any_word, expand_identity_text};

pub(super) fn form_identity_indicates_destructive_action(form_identity: &str) -> bool {
    let identity = expand_identity_text(form_identity);
    contains_any_word(
        &identity,
        &[
            "delete",
            "remove",
            "deactivate",
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
    form_identity_indicates_destructive_action(&identity)
        || form_identity_indicates_non_authentication_account_management(&identity)
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
                "reset password",
            ],
        )
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
