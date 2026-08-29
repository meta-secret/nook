use super::control_identity::{
    looks_like_auxiliary_authentication_control_label,
    looks_like_password_recovery_route_control_label, looks_like_registration_route_control_label,
    route_names_external_authentication_provider,
};
use super::{
    AuthenticationUsernameEvidence, contains_any_word, expand_identity_text,
    looks_like_non_authentication_submit_control_label,
    looks_like_password_update_submit_control_label,
};
pub(super) fn identity_indicates_explicit_authentication_route(identity: &str) -> bool {
    contains_any_word(
        &expand_identity_text(identity),
        &[
            "login",
            "log in",
            "signin",
            "sign in",
            "identity",
            "auth",
            "authentication",
        ],
    )
}
pub(super) fn identity_indicates_explicit_login_route(identity: &str) -> bool {
    let identity = expand_identity_text(identity);
    contains_any_word(&identity, &["login", "log in", "signin", "sign in"])
}
fn normalized_route(identity: &str) -> String {
    let normalized = identity.trim().to_ascii_lowercase();
    normalized
        .split(['?', '#'])
        .next()
        .unwrap_or_default()
        .trim_end_matches('/')
        .to_owned()
}
pub(super) fn control_destination_indicates_generic_oauth_authorization_route(
    destination_identity: &str,
) -> bool {
    normalized_route(destination_identity) == "/oauth2/authorize"
}
fn control_destination_indicates_alternate_provider(
    destination_identity: &str,
    allow_generic_oauth_authorization: bool,
) -> bool {
    route_names_external_authentication_provider(destination_identity)
        || contains_any_word(
            &expand_identity_text(destination_identity),
            &["passkey", "saml", "sso"],
        )
        || (contains_any_word(&expand_identity_text(destination_identity), &["oauth"])
            && !(allow_generic_oauth_authorization
                && control_destination_indicates_generic_oauth_authorization_route(
                    destination_identity,
                )))
}
fn destination_without_oauth_form_post_metadata(destination_identity: &str) -> String {
    let Some((path, query)) = destination_identity.split_once('?') else {
        return destination_identity.to_owned();
    };
    if !control_destination_indicates_generic_oauth_authorization_route(path) {
        return destination_identity.to_owned();
    }
    let remaining_query = query
        .split('&')
        .filter(|component| {
            let Some((key, value)) = component.split_once('=') else {
                return true;
            };
            expand_identity_text(key) != "response mode"
                || expand_identity_text(value) != "form post"
        })
        .collect::<Vec<_>>()
        .join("&");
    if remaining_query.is_empty() {
        path.to_owned()
    } else {
        format!("{path}?{remaining_query}")
    }
}
fn destination_without_navigation_metadata(destination_identity: &str) -> String {
    let Some((path, query)) = destination_identity.split_once('?') else {
        return destination_identity.to_owned();
    };
    let remaining_query = query
        .split('&')
        .filter(|component| {
            let key = component.split_once('=').map_or(*component, |(key, _)| key);
            !matches!(
                expand_identity_text(key).as_str(),
                "next" | "return" | "return to" | "redirect" | "redirect uri" | "continue"
            )
        })
        .collect::<Vec<_>>()
        .join("&");
    if remaining_query.is_empty() {
        path.to_owned()
    } else {
        format!("{path}?{remaining_query}")
    }
}
pub(super) fn destination_has_disallowed_action_or_provider(
    destination_identity: &str,
    password_update_destination: bool,
    allow_generic_oauth_authorization: bool,
) -> bool {
    let content_identity = destination_without_navigation_metadata(
        &destination_without_oauth_form_post_metadata(destination_identity),
    );
    control_destination_has_disallowed_route_action(destination_identity)
        || control_destination_indicates_alternate_provider(
            destination_identity
                .split_once('#')
                .map_or("", |(_, value)| value),
            allow_generic_oauth_authorization,
        )
        || (looks_like_non_authentication_submit_control_label(&content_identity)
            && !password_update_destination
            && !control_destination_indicates_safe_post_login_route(destination_identity))
        || control_destination_indicates_alternate_provider(
            &content_identity,
            allow_generic_oauth_authorization,
        )
}

pub(super) fn passkey_destination_has_disallowed_action_or_provider(
    destination_identity: &str,
) -> bool {
    let content_identity = destination_without_navigation_metadata(
        &destination_without_oauth_form_post_metadata(destination_identity),
    );
    let passkey_authentication_route =
        identity_indicates_explicit_authentication_route(&content_identity)
            && contains_any_word(
                &expand_identity_text(&content_identity),
                &["passkey", "pass key", "webauthn"],
            )
            && !route_names_external_authentication_provider(&content_identity);
    control_destination_has_disallowed_route_action(destination_identity)
        || control_destination_indicates_alternate_provider(
            destination_identity
                .split_once('#')
                .map_or("", |(_, value)| value),
            false,
        )
        || (looks_like_non_authentication_submit_control_label(&content_identity)
            && !control_destination_indicates_safe_post_login_route(destination_identity))
        || (control_destination_indicates_alternate_provider(&content_identity, false)
            && !passkey_authentication_route)
}
pub(super) fn identity_has_authentication_control_veto(identity: &str) -> bool {
    destination_has_disallowed_action_or_provider(identity, false, false)
        || looks_like_registration_route_control_label(identity)
        || looks_like_password_recovery_route_control_label(identity)
        || looks_like_auxiliary_authentication_control_label(identity)
}
pub(super) fn identity_indicates_one_time_code_authentication_context(identity: &str) -> bool {
    let identity = expand_identity_text(identity);
    identity_indicates_explicit_authentication_route(&identity)
        || contains_any_word(
            &identity,
            &[
                "otp",
                "totp",
                "2 fa",
                "2fa",
                "mfa",
                "two factor",
                "one time code",
                "auth code",
                "authentication code",
                "authenticator",
            ],
        )
}
pub(super) fn one_time_code_control_has_authentication_context(
    authentication_username: AuthenticationUsernameEvidence,
    form_identity: &str,
    destination_identity: &str,
    label: &str,
) -> bool {
    matches!(
        authentication_username,
        AuthenticationUsernameEvidence::Strong | AuthenticationUsernameEvidence::Explicit
    ) || [form_identity, destination_identity, label]
        .into_iter()
        .any(identity_indicates_one_time_code_authentication_context)
}
pub(super) fn destination_has_safe_login_identity(destination_identity: &str) -> bool {
    identity_indicates_explicit_login_route(destination_identity)
        && !control_destination_indicates_non_authentication_route(destination_identity)
        && !identity_has_authentication_control_veto(destination_identity)
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
    let transaction_action =
        contains_any_word(
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
        ) || (contains_any_word(&identity, &["authorize", "confirm", "submit"])
            && (contains_any_word(
                &identity,
                &["transaction", "transactions", "payment", "payments"],
            ) || contains_any_word(&identity, &["order", "orders"])));
    let locks_account_or_session = contains_any_word(&identity, &["lock", "freeze", "close"])
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
const NON_AUTHENTICATION_ACCOUNT_WORDS: &[&str] = &[
    "profile",
    "settings",
    "preferences",
    "newsletter",
    "subscribe",
    "marketing",
    "contact",
];
pub(super) fn form_identity_indicates_non_authentication_account_management(form: &str) -> bool {
    contains_any_word(
        &expand_identity_text(form),
        NON_AUTHENTICATION_ACCOUNT_WORDS,
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
fn control_destination_indicates_safe_post_login_route(destination_identity: &str) -> bool {
    matches!(
        normalized_route(destination_identity).as_str(),
        "/auth/post-login" | "/authentication/post-login"
    )
}
fn control_destination_has_disallowed_route_action(destination_identity: &str) -> bool {
    let path_identity = expand_identity_text(
        destination_identity
            .split(['?', '#'])
            .next()
            .unwrap_or_default(),
    );
    contains_any_word(
        &path_identity,
        &["cancel", "back", "help", "profile", "payment"],
    ) || contains_any_word(
        &path_identity,
        &["billing", "subscribe", "search", "publish"],
    ) || (contains_any_word(&path_identity, &["post"])
        && !control_destination_indicates_safe_post_login_route(destination_identity))
        || contains_any_word(&path_identity, &["learn more"])
}
pub(super) fn control_destination_indicates_password_update_route(
    destination_identity: &str,
) -> bool {
    let identity = expand_identity_text(destination_identity);
    (looks_like_password_update_submit_control_label(destination_identity)
        || (contains_any_word(&identity, &["credential", "credentials"])
            && contains_any_word(&identity, &["save", "update", "change", "set", "reset"])))
        && !form_identity_indicates_destructive_action(destination_identity)
        && !control_destination_has_disallowed_route_action(destination_identity)
}

pub(super) fn control_destination_indicates_registration_route(destination_identity: &str) -> bool {
    !destination_identity.trim().is_empty()
        && contains_any_word(
            &expand_identity_text(destination_identity),
            &["register", "registration", "signup", "sign up"],
        )
}

pub(super) fn control_destination_indicates_password_recovery_route(
    destination_identity: &str,
) -> bool {
    let identity = expand_identity_text(destination_identity);
    !destination_identity.trim().is_empty()
        && (contains_any_word(&identity, &["recover", "recovery", "forgot password"])
            || (contains_any_word(&identity, &["reset"])
                && contains_any_word(&identity, &["password", "credential"])))
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strong_username_evidence_supplies_one_time_code_authentication_context() {
        for evidence in [
            AuthenticationUsernameEvidence::Strong,
            AuthenticationUsernameEvidence::Explicit,
        ] {
            assert!(one_time_code_control_has_authentication_context(
                evidence, "", "", ""
            ));
        }
    }

    #[test]
    fn weaker_username_evidence_still_requires_string_authentication_context() {
        for evidence in [
            AuthenticationUsernameEvidence::Absent,
            AuthenticationUsernameEvidence::Generic,
            AuthenticationUsernameEvidence::StandardsBasedEmail,
        ] {
            assert!(!one_time_code_control_has_authentication_context(
                evidence, "", "", ""
            ));
            assert!(one_time_code_control_has_authentication_context(
                evidence,
                "verify-otp-form",
                "",
                "Continue"
            ));
        }
    }

    #[test]
    fn unconditional_vetoes_cover_account_detail_transaction_and_termination_actions() {
        for identity in "/auth/change-email|Update username|Edit phone|Save profile|Change account details|Pay now|/checkout/confirm|Purchase|Place order|Transfer funds|Wire funds|Withdraw|Withdrawal|Deposit|Send money|Financial transaction|Authorize transaction|Transaction authorization|/transactions/123/authorize|/payments/123/confirm|/orders/123/confirm|/auth/logoff|Log off|signoff|Sign off|Lock account|Freeze session".split('|') {
            assert!(form_identity_indicates_destructive_action(identity));
        }
        for identity in "Change password|Update credentials|/account/details/change-password|/account/details/update-credentials|Sign in|signin|login|log in|lock password field|freeze animation".split('|') {
            assert!(!form_identity_indicates_destructive_action(identity));
        }
    }
}
