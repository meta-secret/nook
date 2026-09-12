#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::form_identity::AuthenticationRouteIdentity;
use crate::AuthenticationAdvanceControlObservation;

use crate::AuthenticationControlText;
/// Borrowed control identity, reused across label and provider predicates.
pub(super) struct AuthenticationControlIdentity<'a> {
    identity: &'a str,
}
impl<'a> AuthenticationControlIdentity<'a> {
    pub(super) fn new(identity: &'a str) -> Self {
        Self { identity }
    }
}
#[derive(Clone, Copy)]
enum ProviderNameScope {
    Label,
    Registered,
}

impl AuthenticationControlIdentity<'_> {
    fn names_provider(&self, scope: ProviderNameScope) -> bool {
        let identity = self.identity;
        let allow_single_letter_x = matches!(scope, ProviderNameScope::Label);
        let identity = AuthenticationControlText::new(identity).expand_identity_text();
        AuthenticationControlText::new(&identity).contains_any_word(&[
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
        ]) || (allow_single_letter_x
            && AuthenticationControlText::new(&identity).contains_any_word(&["x"]))
    }
    pub(super) fn label_names_provider(&self) -> bool {
        let identity = self.identity;
        AuthenticationControlIdentity::new(identity).names_provider(ProviderNameScope::Label)
    }
    pub(super) fn names_registered_provider(&self) -> bool {
        let identity = self.identity;
        AuthenticationControlIdentity::new(identity).names_provider(ProviderNameScope::Registered)
    }
    pub(super) fn route_names_provider(&self) -> bool {
        let identity = self.identity;
        let route =
            AuthenticationControlText::new(identity.split(['?', '#']).next().unwrap_or_default())
                .expand_identity_text();
        let fragment =
            AuthenticationControlText::new(identity.split_once('#').map_or("", |(_, value)| value))
                .expand_identity_text();
        let segments = identity
            .split(['?', '#'])
            .next()
            .unwrap_or_default()
            .split('/')
            .filter(|segment| !segment.is_empty())
            .map(|segment| AuthenticationControlText::new(segment).expand_identity_text())
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
        // Apple embeds its exact first-party authorization route in a
        // cross-origin iframe. It is a login destination, not an external
        // provider selector; canonical destination policy separately retains
        // the exact same-origin binding.
        let is_apple_identity_authorization_signin =
            segments
                .iter()
                .map(String::as_str)
                .eq(["appleauth", "auth", "authorize", "signin"]);
        let has_unknown_login_route_segment =
            segments.iter().enumerate().any(|(index, segment)| {
                let mut tails = segments.iter().skip(index + 1).map(String::as_str);
                let has_local_tail = match (tails.next(), tails.next()) {
                    (None, None) => true,
                    (Some(tail), None) => is_local_tail(tail),
                    _ => false,
                };
                AuthenticationRouteIdentity::new(segment).indicates_login()
                    && (!segments.iter().take(index).all(|prefix| {
                        matches!(
                            prefix.as_str(),
                            "account" | "auth" | "authentication" | "common" | "users"
                        ) || is_version(prefix)
                    }) || !has_local_tail)
            });
        AuthenticationControlIdentity::new(identity).names_provider(ProviderNameScope::Registered)
            || identity.split(['?', '#']).any(|metadata| {
                metadata.split('&').any(|component| {
                    let key = AuthenticationControlText::new(
                        component.split('=').next().unwrap_or_default(),
                    )
                    .expand_identity_text();
                    let root = key
                        .strip_suffix(" id")
                        .or_else(|| key.strip_suffix(" name"))
                        .unwrap_or(&key);
                    ["provider", "identity provider", "idp", "connection"].contains(&root)
                })
            })
            || AuthenticationControlText::new(&route).contains_any_word(&["provider", "idp"])
            || (has_unknown_login_route_segment && !is_apple_identity_authorization_signin)
            || ((AuthenticationControlText::new(&route).contains_any_word(&["x"])
                || AuthenticationControlText::new(&fragment).contains_any_word(&["x"]))
                && AuthenticationControlText::new(&route)
                    .contains_any_word(&["login", "log in", "signin", "sign in"]))
    }
    fn has_provider_selection_grammar(&self) -> bool {
        let identity = self.identity;
        let tokens = identity.split_whitespace().collect::<Vec<_>>();
        tokens.iter().enumerate().any(|(index, token)| {
            let tail = || tokens.iter().skip(index + 1).copied();
            let is_credential_tail = tail().eq(["email"])
                || tail().eq(["password"])
                || tail().eq(["email", "address"])
                || tail().eq(["your", "email"])
                || tail().eq(["your", "email", "address"])
                || tail().eq(["your", "password", "to", "sign", "in"]);
            matches!(
                *token,
                "with" | "using" | "via" | "use" | "choose" | "select"
            ) && index + 1 < tokens.len()
                && !is_credential_tail
        })
    }
    pub(super) fn is_microsoft_primary_sign_in(&self) -> bool {
        let label = self.identity;
        let identity = AuthenticationControlText::new(label).expand_identity_text();
        identity.starts_with("sign in to ")
            && AuthenticationControlText::new(&identity).contains_any_word(&["microsoft"])
            && !AuthenticationControlIdentity::new(&identity.replace("microsoft", ""))
                .label_names_provider()
    }
    pub(super) fn is_alternate_authentication_route(&self) -> bool {
        let label = self.identity;
        let identity = AuthenticationControlText::new(label).expand_identity_text();
        if AuthenticationControlText::new(&identity).contains_any_word(&["passkey", "saml", "sso"])
        {
            return true;
        }
        (AuthenticationControlIdentity::new(&identity).label_names_provider()
            && !AuthenticationControlIdentity::new(label).is_microsoft_primary_sign_in())
            || (AuthenticationAdvanceControlObservation::looks_like_unrestricted_login_advance_control_label(label)
                && AuthenticationControlIdentity::new(&identity).has_provider_selection_grammar())
    }
    pub(super) fn is_auxiliary(&self) -> bool {
        let label = self.identity;
        let identity = AuthenticationControlText::new(label).expand_identity_text();
        AuthenticationControlText::new(&identity).contains_any_word(&["password"])
            && AuthenticationControlText::new(&identity).contains_any_word(&[
                "show",
                "hide",
                "reveal",
                "unmask",
                "mask",
                "toggle",
                "visibility",
                "visible",
            ])
    }
    pub(super) fn is_explicit_advance(&self) -> bool {
        let label = self.identity;
        AuthenticationControlText::new(
            &AuthenticationControlText::new(label).expand_identity_text(),
        )
        .contains_any_word(&["signin", "sign-in", "sign in", "login", "log-in", "log in"])
    }
    pub(super) fn is_one_time_code_resend(&self) -> bool {
        let label = self.identity;
        AuthenticationControlText::new(
            &AuthenticationControlText::new(label).expand_identity_text(),
        )
        .contains_any_word(&[
            "resend",
            "send again",
            "request new code",
            "send new code",
            "another code",
        ])
    }
    pub(super) fn is_password_recovery(&self) -> bool {
        let label = self.identity;
        let identity = AuthenticationControlText::new(label).expand_identity_text();
        AuthenticationControlText::new(&identity).contains_any_word(&["password"])
            && AuthenticationControlText::new(&identity)
                .contains_any_word(&["forgot", "forget", "recover", "recovery", "reset"])
    }
    pub(super) fn is_registration(&self) -> bool {
        let label = self.identity;
        AuthenticationControlText::new(
            &AuthenticationControlText::new(label).expand_identity_text(),
        )
        .contains_any_word(&[
            "create account",
            "register",
            "registration",
            "signup",
            "sign-up",
            "sign up",
        ])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_names_keep_label_and_route_scopes_distinct() {
        for (identity, label, registered) in [
            ("x", true, false),
            ("X.com", true, true),
            ("Sign in with Google", true, true),
            ("Sign in with email", false, false),
        ] {
            let control = AuthenticationControlIdentity::new(identity);
            assert_eq!(control.label_names_provider(), label, "{identity}");
            assert_eq!(
                control.names_registered_provider(),
                registered,
                "{identity}"
            );
        }
    }

    #[test]
    fn provider_selection_preserves_local_login_tails_and_metadata_vetoes() {
        for (route, expected) in [
            ("/auth/login/identifier", false),
            ("/auth/v2/login/password", false),
            ("/auth/login/custom", true),
            ("/auth/login?connection=local", true),
            ("/auth/login#provider=unknown", true),
        ] {
            assert_eq!(
                AuthenticationControlIdentity::new(route).route_names_provider(),
                expected,
                "{route}"
            );
        }
    }

    #[test]
    fn alternate_labels_preserve_local_credentials_and_microsoft_primary_sign_in() {
        for (label, expected) in [
            ("Continue with email", false),
            ("Continue with your password to sign in", false),
            ("Continue with corporate", true),
            ("Sign in to Microsoft", false),
            ("Sign in with Microsoft", true),
            ("Use passkey", true),
        ] {
            assert_eq!(
                AuthenticationControlIdentity::new(label).is_alternate_authentication_route(),
                expected,
                "{label}"
            );
        }
    }
}
