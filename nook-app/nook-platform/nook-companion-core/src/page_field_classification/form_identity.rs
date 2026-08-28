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
    let changes_account_detail =
        contains_any_word(&identity, &["change", "update", "edit", "save"])
            && (contains_any_word(
                &identity,
                &["email", "username", "user name", "phone", "profile"],
            ) || (contains_any_word(&identity, &["account detail", "details"])
                && !contains_any_word(&identity, &["password", "credential", "credentials"])));
    let transaction_action = contains_any_word(
        &identity,
        &[
            "pay",
            "payment",
            "checkout",
            "purchase",
            "buy",
            "place order",
            "confirm order",
            "cart",
            "transfer",
            "wire",
            "withdraw",
            "withdrawal",
            "deposit",
            "send money",
            "financial transaction",
            "authorize transaction",
            "transaction authorization",
        ],
    );
    let locks_account_or_session = contains_any_word(&identity, &["lock", "freeze"])
        && contains_any_word(&identity, &["account", "session"]);
    changes_account_detail
        || transaction_action
        || locks_account_or_session
        || contains_any_word(
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
                "logoff",
                "log off",
                "signoff",
                "sign off",
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unconditional_vetoes_cover_account_detail_transaction_and_termination_actions() {
        for identity in [
            "/auth/change-email",
            "Update username",
            "Edit phone",
            "Save profile",
            "Change account details",
            "Pay now",
            "/checkout/confirm",
            "Purchase",
            "Place order",
            "Transfer funds",
            "Wire funds",
            "Withdraw",
            "Withdrawal",
            "Deposit",
            "Send money",
            "Financial transaction",
            "Authorize transaction",
            "Transaction authorization",
            "/auth/logoff",
            "Log off",
            "signoff",
            "Sign off",
            "Lock account",
            "Freeze session",
        ] {
            assert!(form_identity_indicates_destructive_action(identity));
        }
        for identity in [
            "Change password",
            "Update credentials",
            "/account/details/change-password",
            "/account/details/update-credentials",
            "Sign in",
            "signin",
            "login",
            "log in",
            "lock password field",
            "freeze animation",
        ] {
            assert!(!form_identity_indicates_destructive_action(identity));
        }
    }
}
