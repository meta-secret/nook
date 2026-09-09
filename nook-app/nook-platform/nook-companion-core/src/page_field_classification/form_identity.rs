#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::control_identity::AuthenticationControlIdentity;
use super::{AuthenticationUsernameEvidence, PASSKEY_OR_PLATFORM_AUTHENTICATOR_WORDS};
use crate::AuthenticationAdvanceControlObservation;
use crate::AuthenticationControlText;
/// Borrowed route or form evidence; predicates do not confer authorization.
pub(super) struct AuthenticationRouteIdentity<'a> {
    identity: &'a str,
}
impl<'a> AuthenticationRouteIdentity<'a> {
    pub(super) fn new(identity: &'a str) -> Self {
        Self { identity }
    }
}

#[derive(Clone, Copy)]
pub(super) enum CredentialDestination {
    Authentication,
    PasswordUpdate,
}
#[derive(Clone, Copy)]
pub(super) enum OAuthAuthorization {
    Disallowed,
    Allowed,
}
#[derive(Clone, Copy)]
pub(super) struct DestinationPolicy {
    pub(super) credential: CredentialDestination,
    pub(super) provider: OAuthAuthorization,
}

/// The independently observed identities used to distinguish OTP login from enrollment.
pub(super) struct OneTimeCodeContext<'a> {
    pub(super) authentication_username: AuthenticationUsernameEvidence,
    pub(super) form_identity: &'a str,
    pub(super) destination_identity: &'a str,
    pub(super) label: &'a str,
}

impl AuthenticationRouteIdentity<'_> {
    pub(super) fn indicates_authentication(&self) -> bool {
        let identity = self.identity;
        AuthenticationControlText::new(
            &AuthenticationControlText::new(identity).expand_identity_text(),
        )
        .contains_any_word(&[
            "login",
            "log in",
            "signin",
            "sign in",
            "identity",
            "auth",
            "authentication",
        ])
    }
    pub(super) fn indicates_login(&self) -> bool {
        let identity = self.identity;
        let identity = AuthenticationControlText::new(identity).expand_identity_text();
        AuthenticationControlText::new(&identity)
            .contains_any_word(&["login", "log in", "signin", "sign in"])
    }
    fn normalized(&self) -> String {
        let identity = self.identity;
        let normalized = identity.trim().to_ascii_lowercase();
        normalized
            .split(['?', '#'])
            .next()
            .unwrap_or_default()
            .trim_end_matches('/')
            .to_owned()
    }
    pub(super) fn indicates_oauth_authorization(&self) -> bool {
        let destination_identity = self.identity;
        let route = AuthenticationRouteIdentity::new(destination_identity).normalized();
        if matches!(route.as_str(), "/oauth2/authorize" | "/oauth/authorize")
            || route.ends_with("/oauth2/authorize")
            || route.ends_with("/oauth/authorize")
        {
            return true;
        }
        let Some((_, versioned_authorization)) = route.rsplit_once("/oauth2/") else {
            return false;
        };
        let mut segments = versioned_authorization.split('/');
        let (Some(version), Some("authorize"), None) =
            (segments.next(), segments.next(), segments.next())
        else {
            return false;
        };
        version.strip_prefix('v').is_some_and(|digits| {
            !digits.is_empty()
                && digits.len() <= 3
                && digits.bytes().all(|byte| byte.is_ascii_digit())
        })
    }
    fn indicates_alternate_provider(&self, authorization: OAuthAuthorization) -> bool {
        let destination_identity = self.identity;
        let allow_generic_oauth_authorization =
            matches!(authorization, OAuthAuthorization::Allowed);
        AuthenticationControlIdentity::new(destination_identity).route_names_provider()
            || AuthenticationControlText::new(
                &AuthenticationControlText::new(destination_identity).expand_identity_text(),
            )
            .contains_any_word(&["passkey", "saml", "sso"])
            || (AuthenticationControlText::new(
                &AuthenticationControlText::new(destination_identity).expand_identity_text(),
            )
            .contains_any_word(&["oauth"])
                && !(allow_generic_oauth_authorization
                    && AuthenticationRouteIdentity::new(destination_identity)
                        .indicates_oauth_authorization()))
    }
    fn without_oauth_form_post_metadata(&self) -> String {
        let destination_identity = self.identity;
        let Some((path, query)) = destination_identity.split_once('?') else {
            return destination_identity.to_owned();
        };
        if !AuthenticationRouteIdentity::new(path).indicates_oauth_authorization() {
            return destination_identity.to_owned();
        }
        let remaining_query = query
            .split('&')
            .filter(|component| {
                let Some((key, value)) = component.split_once('=') else {
                    return true;
                };
                AuthenticationControlText::new(key).expand_identity_text() != "response mode"
                    || AuthenticationControlText::new(value).expand_identity_text() != "form post"
            })
            .collect::<Vec<_>>()
            .join("&");
        if remaining_query.is_empty() {
            path.to_owned()
        } else {
            format!("{path}?{remaining_query}")
        }
    }
    fn without_navigation_metadata(&self) -> String {
        let destination_identity = self.identity;
        let Some((path, query)) = destination_identity.split_once('?') else {
            return destination_identity.to_owned();
        };
        let remaining_query = query
            .split('&')
            .filter(|component| {
                let key = component.split_once('=').map_or(*component, |(key, _)| key);
                !matches!(
                    AuthenticationControlText::new(key)
                        .expand_identity_text()
                        .as_str(),
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
    pub(super) fn has_disallowed_action_or_provider(&self, policy: DestinationPolicy) -> bool {
        let destination_identity = self.identity;
        let password_update_destination =
            matches!(policy.credential, CredentialDestination::PasswordUpdate);
        let content_identity = AuthenticationRouteIdentity::new(
            &AuthenticationRouteIdentity::new(destination_identity)
                .without_oauth_form_post_metadata(),
        )
        .without_navigation_metadata();
        AuthenticationRouteIdentity::new(destination_identity).has_disallowed_route_action()
            || AuthenticationRouteIdentity::new(
                destination_identity
                    .split_once('#')
                    .map_or("", |(_, value)| value),
            )
            .indicates_alternate_provider(policy.provider)
            || (AuthenticationAdvanceControlObservation::looks_like_non_authentication_submit_control_label(&content_identity)
                && !password_update_destination
                && !AuthenticationRouteIdentity::new(destination_identity)
                    .indicates_safe_post_login())
            || AuthenticationRouteIdentity::new(&content_identity)
                .indicates_alternate_provider(policy.provider)
    }
    fn names_passkey_enrollment_or_management(&self) -> bool {
        let identity = self.identity;
        AuthenticationControlText::new(identity).contains_any_word(&[
            "create",
            "enable",
            "enroll",
            "enrollment",
            "setup",
            "set up",
            "register",
            "registration",
            "add",
            "manage",
            "management",
            "configure",
        ])
    }
    fn names_passkey_authentication(&self) -> bool {
        let destination_identity = self.identity;
        let identity = AuthenticationControlText::new(destination_identity).expand_identity_text();
        AuthenticationControlText::new(&identity)
            .contains_any_word(PASSKEY_OR_PLATFORM_AUTHENTICATOR_WORDS)
            && AuthenticationRouteIdentity::new(&identity).indicates_authentication()
            && !AuthenticationRouteIdentity::new(&identity).names_passkey_enrollment_or_management()
            && !AuthenticationControlIdentity::new(destination_identity).names_registered_provider()
    }
    pub(super) fn has_disallowed_passkey_action_or_provider(&self) -> bool {
        let destination_identity = self.identity;
        let content_identity = AuthenticationRouteIdentity::new(
            &AuthenticationRouteIdentity::new(destination_identity)
                .without_oauth_form_post_metadata(),
        )
        .without_navigation_metadata();
        let passkey_authentication_route =
            AuthenticationRouteIdentity::new(&content_identity).names_passkey_authentication();
        let content_identity_text =
            AuthenticationControlText::new(&content_identity).expand_identity_text();
        let passkey_enrollment_route = AuthenticationControlText::new(&content_identity_text)
            .contains_any_word(PASSKEY_OR_PLATFORM_AUTHENTICATOR_WORDS)
            && AuthenticationRouteIdentity::new(&content_identity_text)
                .names_passkey_enrollment_or_management();
        passkey_enrollment_route
            || AuthenticationRouteIdentity::new(destination_identity).has_disallowed_route_action()
            || AuthenticationRouteIdentity::new(
                destination_identity
                    .split_once('#')
                    .map_or("", |(_, value)| value),
            )
            .indicates_alternate_provider(OAuthAuthorization::Disallowed)
            || (AuthenticationAdvanceControlObservation::looks_like_non_authentication_submit_control_label(&content_identity)
                && !AuthenticationRouteIdentity::new(destination_identity)
                    .indicates_safe_post_login()
                && !passkey_authentication_route)
            || (AuthenticationRouteIdentity::new(&content_identity)
                .indicates_alternate_provider(OAuthAuthorization::Disallowed)
                && !passkey_authentication_route)
    }
    pub(super) fn has_control_veto(&self) -> bool {
        let identity = self.identity;
        AuthenticationRouteIdentity::new(identity).has_disallowed_action_or_provider(
            DestinationPolicy {
                credential: CredentialDestination::Authentication,
                provider: OAuthAuthorization::Disallowed,
            },
        ) || AuthenticationControlIdentity::new(identity).is_registration()
            || AuthenticationControlIdentity::new(identity).is_password_recovery()
            || AuthenticationControlIdentity::new(identity).is_auxiliary()
    }
    pub(super) fn indicates_one_time_code_authentication(&self) -> bool {
        let identity = self.identity;
        let identity = AuthenticationControlText::new(identity).expand_identity_text();
        AuthenticationRouteIdentity::new(&identity).indicates_authentication()
            || AuthenticationControlText::new(&identity).contains_any_word(&[
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
            ])
    }
    pub(super) fn indicates_authenticator_enrollment(&self) -> bool {
        let identity = self.identity;
        let identity = AuthenticationControlText::new(identity).expand_identity_text();
        AuthenticationControlText::new(&identity).contains_any_word(&[
            "enroll",
            "enrollment",
            "setup",
            "set up",
            "register",
            "create",
            "enable",
            "add",
            "configure",
            "activate",
            "pair",
            "pairing",
            "provision",
            "provisioning",
        ]) && AuthenticationControlText::new(&identity).contains_any_word(&[
            "otp",
            "totp",
            "2 fa",
            "2fa",
            "mfa",
            "two factor",
            "one time code",
            "authenticator",
        ])
    }
}

impl OneTimeCodeContext<'_> {
    pub(super) fn has_authentication_context(&self) -> bool {
        let Self {
            authentication_username,
            form_identity,
            destination_identity,
            label,
        } = *self;
        if [form_identity, destination_identity, label]
            .into_iter()
            .any(|identity| {
                AuthenticationRouteIdentity::new(identity).indicates_authenticator_enrollment()
            })
        {
            return false;
        }
        matches!(
            authentication_username,
            AuthenticationUsernameEvidence::Strong | AuthenticationUsernameEvidence::Explicit
        ) || [form_identity, destination_identity, label]
            .into_iter()
            .any(|identity| {
                AuthenticationRouteIdentity::new(identity).indicates_one_time_code_authentication()
            })
    }
}

impl AuthenticationRouteIdentity<'_> {
    pub(super) fn has_safe_login_identity(&self) -> bool {
        let destination_identity = self.identity;
        AuthenticationRouteIdentity::new(destination_identity).indicates_login()
            && !AuthenticationRouteIdentity::new(destination_identity)
                .indicates_non_authentication()
            && !AuthenticationRouteIdentity::new(destination_identity).has_control_veto()
    }
    pub(super) fn indicates_destructive_action(&self) -> bool {
        let form_identity = self.identity;
        let identity = AuthenticationControlText::new(form_identity).expand_identity_text();
        let changes_account_detail = AuthenticationControlText::new(&identity)
            .contains_any_word(&["change", "update", "edit", "save"])
            && (AuthenticationControlText::new(&identity).contains_any_word(&[
                "email",
                "username",
                "user name",
                "phone",
                "profile",
            ]) || (AuthenticationControlText::new(&identity)
                .contains_any_word(&["account detail", "details"])
                && !AuthenticationControlText::new(&identity).contains_any_word(&[
                    "password",
                    "credential",
                    "credentials",
                ])));
        let transaction_action = AuthenticationControlText::new(&identity).contains_any_word(&[
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
        ]) || (AuthenticationControlText::new(&identity)
            .contains_any_word(&["authorize", "confirm", "submit"])
            && (AuthenticationControlText::new(&identity).contains_any_word(&[
                "transaction",
                "transactions",
                "payment",
                "payments",
            ]) || AuthenticationControlText::new(&identity)
                .contains_any_word(&["order", "orders"])));
        let locks_account_or_session = AuthenticationControlText::new(&identity)
            .contains_any_word(&["lock", "freeze", "close"])
            && AuthenticationControlText::new(&identity).contains_any_word(&["account", "session"]);
        changes_account_detail
            || transaction_action
            || locks_account_or_session
            || AuthenticationControlText::new(&identity).contains_any_word(&[
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
            ])
    }
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
impl AuthenticationRouteIdentity<'_> {
    pub(super) fn indicates_account_management(&self) -> bool {
        let form = self.identity;
        AuthenticationControlText::new(&AuthenticationControlText::new(form).expand_identity_text())
            .contains_any_word(NON_AUTHENTICATION_ACCOUNT_WORDS)
    }
    pub(super) fn indicates_non_authentication(&self) -> bool {
        let destination_identity = self.identity;
        if destination_identity.trim().is_empty() {
            return false;
        }
        let identity = AuthenticationControlText::new(destination_identity).expand_identity_text();
        if AuthenticationRouteIdentity::new(&identity).indicates_destructive_action()
            || AuthenticationControlText::new(&identity).contains_any_word(&[
                "register",
                "registration",
                "signup",
                "sign up",
                "recover",
                "recovery",
                "forgot password",
                "reset",
                "reset password",
            ])
        {
            return true;
        }
        !AuthenticationRouteIdentity::new(&identity).indicates_authentication()
            && AuthenticationRouteIdentity::new(&identity).indicates_account_management()
    }
    fn indicates_safe_post_login(&self) -> bool {
        let destination_identity = self.identity;
        matches!(
            AuthenticationRouteIdentity::new(destination_identity)
                .normalized()
                .as_str(),
            "/auth/post-login" | "/authentication/post-login"
        )
    }
    fn has_disallowed_route_action(&self) -> bool {
        let destination_identity = self.identity;
        let path_identity = AuthenticationControlText::new(
            destination_identity
                .split(['?', '#'])
                .next()
                .unwrap_or_default(),
        )
        .expand_identity_text();
        AuthenticationControlText::new(&path_identity)
            .contains_any_word(&["cancel", "back", "help", "profile", "payment"])
            || AuthenticationControlText::new(&path_identity).contains_any_word(&[
                "billing",
                "subscribe",
                "search",
                "publish",
            ])
            || (AuthenticationControlText::new(&path_identity).contains_any_word(&["post"])
                && !AuthenticationRouteIdentity::new(destination_identity)
                    .indicates_safe_post_login())
            || AuthenticationControlText::new(&path_identity).contains_any_word(&["learn more"])
    }
    pub(super) fn indicates_password_update(&self) -> bool {
        let destination_identity = self.identity;
        let identity = AuthenticationControlText::new(destination_identity).expand_identity_text();
        (AuthenticationAdvanceControlObservation::looks_like_password_update_submit_control_label(
            destination_identity,
        ) || (AuthenticationControlText::new(&identity)
            .contains_any_word(&["credential", "credentials"])
            && AuthenticationControlText::new(&identity)
                .contains_any_word(&["save", "update", "change", "set", "reset"])))
            && !AuthenticationRouteIdentity::new(destination_identity)
                .indicates_destructive_action()
            && !AuthenticationRouteIdentity::new(destination_identity).has_disallowed_route_action()
    }
    pub(super) fn indicates_registration(&self) -> bool {
        let destination_identity = self.identity;
        !destination_identity.trim().is_empty()
            && AuthenticationControlText::new(
                &AuthenticationControlText::new(destination_identity).expand_identity_text(),
            )
            .contains_any_word(&["register", "registration", "signup", "sign up"])
    }
    pub(super) fn indicates_password_recovery(&self) -> bool {
        let destination_identity = self.identity;
        let identity = AuthenticationControlText::new(destination_identity).expand_identity_text();
        !destination_identity.trim().is_empty()
            && (AuthenticationControlText::new(&identity).contains_any_word(&[
                "recover",
                "recovery",
                "forgot password",
            ]) || (AuthenticationControlText::new(&identity).contains_any_word(&["reset"])
                && AuthenticationControlText::new(&identity)
                    .contains_any_word(&["password", "credential"])))
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn destination_metadata_removal_preserves_action_evidence() {
        for (raw, expected) in [
            (
                "/oauth2/authorize?response_mode=form_post",
                "/oauth2/authorize",
            ),
            (
                "/login?response_mode=form_post",
                "/login?response_mode=form_post",
            ),
            (
                "/oauth/authorize?response_mode=form_post&action=delete",
                "/oauth/authorize?action=delete",
            ),
            (
                "/oauth/authorize?response_mode=query",
                "/oauth/authorize?response_mode=query",
            ),
        ] {
            assert_eq!(
                AuthenticationRouteIdentity::new(raw).without_oauth_form_post_metadata(),
                expected
            );
        }
        for (raw, expected) in [
            (
                "/login?next=/checkout&action=delete",
                "/login?action=delete",
            ),
            ("/login?return_to=/settings&redirect_uri=/billing", "/login"),
            (
                "/login?provider=unknown&continue=/checkout",
                "/login?provider=unknown",
            ),
        ] {
            assert_eq!(
                AuthenticationRouteIdentity::new(raw).without_navigation_metadata(),
                expected
            );
        }
    }

    #[test]
    fn oauth_permission_does_not_admit_provider_selection_or_destructive_actions() {
        for (route, expected) in [
            (
                "/oauth2/authorize?response_mode=form_post&next=/checkout",
                false,
            ),
            ("/oauth2/v1/authorize", false),
            ("/login?provider=unknown", true),
            ("/auth/payment", true),
            ("/login#provider=unknown", true),
        ] {
            assert_eq!(
                AuthenticationRouteIdentity::new(route).has_disallowed_action_or_provider(
                    DestinationPolicy {
                        credential: CredentialDestination::Authentication,
                        provider: OAuthAuthorization::Allowed,
                    }
                ),
                expected,
                "{route}"
            );
        }
        assert!(
            AuthenticationRouteIdentity::new("/oauth2/authorize")
                .has_disallowed_action_or_provider(DestinationPolicy {
                    credential: CredentialDestination::Authentication,
                    provider: OAuthAuthorization::Disallowed,
                })
        );
        for route in [
            "/oauth2/v/authorize",
            "/oauth2/v1beta/authorize",
            "/oauth2/v1234/authorize",
            "/oauth2/v1/token",
            "/oauth2/v1/authorize/continue",
        ] {
            assert!(
                AuthenticationRouteIdentity::new(route).has_disallowed_action_or_provider(
                    DestinationPolicy {
                        credential: CredentialDestination::Authentication,
                        provider: OAuthAuthorization::Allowed,
                    }
                ),
                "{route}"
            );
        }
    }

    #[test]
    fn passkey_routes_distinguish_authentication_from_enrollment() {
        for (route, expected) in [
            ("/auth/passkey/login", false),
            ("/auth/passkey/enroll", true),
            ("/auth/passkey/manage", true),
            ("/auth/passkey/login?provider=google", true),
        ] {
            assert_eq!(
                AuthenticationRouteIdentity::new(route).has_disallowed_passkey_action_or_provider(),
                expected,
                "{route}"
            );
        }
    }

    #[test]
    fn strong_username_evidence_supplies_one_time_code_authentication_context() {
        for evidence in [
            AuthenticationUsernameEvidence::Strong,
            AuthenticationUsernameEvidence::Explicit,
        ] {
            assert!(
                OneTimeCodeContext {
                    authentication_username: evidence,
                    form_identity: "",
                    destination_identity: "",
                    label: ""
                }
                .has_authentication_context()
            );
        }
    }

    #[test]
    fn authenticator_enrollment_identities_do_not_supply_otp_authentication_context() {
        for (form_identity, destination_identity) in [
            ("mfa-enrollment-form", "/auth/mfa/enroll"),
            ("totp-setup-form", "/auth/totp/setup"),
            ("authenticator-enable-form", "/account/authenticator/enable"),
            ("mfa-add-form", "/auth/mfa/add"),
            ("totp-configure-form", "/auth/totp/configure"),
            ("authenticator-activate-form", "/auth/mfa/activate"),
            ("totp-pair-form", "/auth/totp/pair"),
            ("mfa-provision-form", "/auth/mfa/provision"),
        ] {
            assert!(
                !OneTimeCodeContext {
                    authentication_username: AuthenticationUsernameEvidence::Explicit,
                    form_identity,
                    destination_identity,
                    label: "Continue"
                }
                .has_authentication_context(),
                "{form_identity} {destination_identity}"
            );
        }
        assert!(
            OneTimeCodeContext {
                authentication_username: AuthenticationUsernameEvidence::Explicit,
                form_identity: "otp-challenge-form",
                destination_identity: "/auth/mfa/verify",
                label: "Continue"
            }
            .has_authentication_context()
        );
    }

    #[test]
    fn weaker_username_evidence_still_requires_string_authentication_context() {
        for evidence in [
            AuthenticationUsernameEvidence::Absent,
            AuthenticationUsernameEvidence::Generic,
            AuthenticationUsernameEvidence::StandardsBasedEmail,
            AuthenticationUsernameEvidence::WebAuthnEmail,
        ] {
            assert!(
                !OneTimeCodeContext {
                    authentication_username: evidence,
                    form_identity: "",
                    destination_identity: "",
                    label: ""
                }
                .has_authentication_context()
            );
            assert!(
                OneTimeCodeContext {
                    authentication_username: evidence,
                    form_identity: "verify-otp-form",
                    destination_identity: "",
                    label: "Continue"
                }
                .has_authentication_context()
            );
        }
    }

    #[test]
    fn unconditional_vetoes_cover_account_detail_transaction_and_termination_actions() {
        for identity in "/auth/change-email|Update username|Edit phone|Save profile|Change account details|Pay now|/checkout/confirm|Purchase|Place order|Transfer funds|Wire funds|Withdraw|Withdrawal|Deposit|Send money|Financial transaction|Authorize transaction|Transaction authorization|/transactions/123/authorize|/payments/123/confirm|/orders/123/confirm|/auth/logoff|Log off|signoff|Sign off|Lock account|Freeze session".split('|') {
            assert!(AuthenticationRouteIdentity::new(identity).indicates_destructive_action());
        }
        for identity in "Change password|Update credentials|/account/details/change-password|/account/details/update-credentials|Sign in|signin|login|log in|lock password field|freeze animation".split('|') {
            assert!(!AuthenticationRouteIdentity::new(identity).indicates_destructive_action());
        }
    }
}
