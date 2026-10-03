//! Canonical same-origin destination evidence for authentication controls.

use percent_encoding::percent_decode_str;
use url::Url;

use super::{MAX_AUTHENTICATION_CONTROL_TEXT_BYTES, MAX_AUTHENTICATION_DESTINATION_TEXT_BYTES};

/// A validated authentication-control destination bound to its source origin.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CanonicalControlDestination {
    /// Percent-decoded path used for route-policy decisions.
    pub path_identity: String,
    /// Percent-decoded path and query used for action-policy decisions.
    pub route_identity: String,
    /// Whether the source host is a known external authentication authority.
    pub has_provider_authority: bool,
    /// Whether the source host is a Microsoft authentication authority.
    pub has_microsoft_provider_authority: bool,
    /// Whether the exact HTTPS destination host and path are Microsoft's consumer login root.
    pub is_microsoft_consumer_login_root: bool,
    authentication_policy_route_identity: String,
    authentication_policy_destination: AuthenticationPolicyDestination,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AuthenticationPolicyDestination {
    Default,
    TeslaAccountAuthorization,
    MicrosoftConsumerAuthorization,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MicrosoftConsumerLoginDestination {
    IdentifierEntry,
    Unrelated,
}

/// Named values required by `CanonicalControlDestination::canonicalize_control_destination`.
#[derive(Clone, Copy)]
pub struct ControlDestinationEvidence<'a> {
    pub source_origin: &'a str,
    pub destination_identity: &'a str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("invalid or untrusted authentication control destination")]
pub struct InvalidControlDestination;

impl CanonicalControlDestination {
    pub(crate) fn microsoft_consumer_login_destination(&self) -> MicrosoftConsumerLoginDestination {
        match (
            &self.authentication_policy_destination,
            self.route_identity.as_str(),
        ) {
            (AuthenticationPolicyDestination::MicrosoftConsumerAuthorization, _) => {
                MicrosoftConsumerLoginDestination::IdentifierEntry
            }
            (
                AuthenticationPolicyDestination::Default
                | AuthenticationPolicyDestination::TeslaAccountAuthorization,
                "/",
            ) if self.is_microsoft_consumer_login_root => {
                MicrosoftConsumerLoginDestination::IdentifierEntry
            }
            (
                AuthenticationPolicyDestination::Default
                | AuthenticationPolicyDestination::TeslaAccountAuthorization,
                _,
            ) => MicrosoftConsumerLoginDestination::Unrelated,
        }
    }

    fn is_http_url(url: &Url) -> bool {
        matches!(url.scheme(), "http" | "https")
            && url.username().is_empty()
            && url.password().is_none()
            && url.host_str().is_some()
    }

    fn is_bounded_tesla_locale(locale: &str) -> bool {
        if locale.len() > 16 {
            return false;
        }
        let mut parts = locale.split('-');
        let Some(language) = parts.next() else {
            return false;
        };
        let Some(region) = parts.next() else {
            return false;
        };
        parts.next().is_none()
            && (2..=3).contains(&language.len())
            && language.bytes().all(|byte| byte.is_ascii_lowercase())
            && ((region.len() == 2 && region.bytes().all(|byte| byte.is_ascii_uppercase()))
                || (region.len() == 3 && region.bytes().all(|byte| byte.is_ascii_digit())))
    }

    fn tesla_account_authorization_route(url: &Url) -> Option<String> {
        if url.scheme() != "https"
            || url.host_str() != Some("auth.tesla.com")
            || url.port_or_known_default() != Some(443)
            || url.path() != "/oauth2/v1/authorize"
            || url.fragment().is_some()
        {
            return None;
        }
        let pairs = url.query_pairs().collect::<Vec<_>>();
        if pairs.len() != 5 {
            return None;
        }
        let exactly_one = |key: &str, expected: &str| {
            pairs
                .iter()
                .filter(|(candidate, _)| candidate == key)
                .map(|(_, value)| value.as_ref())
                .eq([expected])
        };
        let locale = pairs
            .iter()
            .find(|(candidate, _)| candidate == "locale")
            .map(|(_, value)| value.as_ref());
        if !exactly_one("response_type", "code")
            || !exactly_one("client_id", "accounts")
            || !exactly_one("redirect_uri", "https://accounts.tesla.com/oauth2/callback")
            || !exactly_one("scope", "offline_access user profile ou_code email")
            || !locale.is_some_and(Self::is_bounded_tesla_locale)
        {
            return None;
        }
        Some(url.path().to_owned())
    }

    fn amazon_claim_authentication_route(url: &Url) -> Option<String> {
        if url.scheme() != "https"
            || url.host_str() != Some("www.amazon.com")
            || url.port_or_known_default() != Some(443)
            || url.path() != "/ax/claim"
            || url.fragment().is_some()
        {
            return None;
        }
        let pairs = url.query_pairs().collect::<Vec<_>>();
        if pairs.len() != 6 {
            return None;
        }
        let exactly_one = |key: &str, expected: &str| {
            pairs
                .iter()
                .filter(|(candidate, _)| candidate == key)
                .map(|(_, value)| value.as_ref())
                .eq([expected])
        };
        if !exactly_one("openid.ns", "http://specs.openid.net/auth/2.0")
            || !exactly_one("openid.mode", "checkid_setup")
            || !exactly_one("openid.assoc_handle", "usflex")
            || !exactly_one("policy_handle", "Retail-Checkout")
        {
            return None;
        }
        let return_to = pairs
            .iter()
            .find(|(key, _)| key == "openid.return_to")
            .and_then(|(_, value)| Url::parse(value).ok())?;
        if return_to.scheme() != "https"
            || return_to.host_str() != Some("www.amazon.com")
            || return_to.port_or_known_default() != Some(443)
        {
            return None;
        }
        let arb = pairs
            .iter()
            .find(|(key, _)| key == "arb")
            .map(|(_, value)| value.as_ref())?;
        if arb.is_empty() || arb.len() > 128 {
            return None;
        }
        Some(url.path().to_owned())
    }

    pub(crate) fn authentication_policy_route_identity(&self) -> &str {
        &self.authentication_policy_route_identity
    }

    pub(crate) fn is_tesla_account_authorization(&self) -> bool {
        matches!(
            self.authentication_policy_destination,
            AuthenticationPolicyDestination::TeslaAccountAuthorization
        )
    }
}

impl CanonicalControlDestination {
    fn is_origin_only(url: &Url) -> bool {
        url.path() == "/" && url.query().is_none() && url.fragment().is_none()
    }
}

impl CanonicalControlDestination {
    fn has_valid_percent_encoding(value: &str) -> bool {
        let bytes = value.as_bytes();
        let mut index = 0;
        while let Some(byte) = bytes.get(index) {
            if *byte == b'%' {
                let valid_hex_pair = matches!(
                    (bytes.get(index + 1), bytes.get(index + 2)),
                    (Some(first), Some(second))
                        if first.is_ascii_hexdigit() && second.is_ascii_hexdigit()
                );
                if !valid_hex_pair {
                    return false;
                }
                index += 3;
            } else {
                index += 1;
            }
        }
        true
    }
}

impl CanonicalControlDestination {
    fn decode_component(value: &str) -> Result<String, InvalidControlDestination> {
        if !CanonicalControlDestination::has_valid_percent_encoding(value) {
            return Err(InvalidControlDestination);
        }
        let decoded = percent_decode_str(value)
            .decode_utf8()
            .map_err(|_| InvalidControlDestination)?;
        if decoded.chars().any(char::is_control) || decoded.contains('%') {
            return Err(InvalidControlDestination);
        }
        Ok(decoded.into_owned())
    }
}

impl CanonicalControlDestination {
    fn decode_query_component(value: &str) -> Result<String, InvalidControlDestination> {
        CanonicalControlDestination::decode_component(&value.replace('+', " "))
    }
}

const REGISTERED_AUTHENTICATION_PROVIDER_DOMAINS: &[&str] = &[
    "apple.com",
    "facebook.com",
    "github.com",
    "gitlab.com",
    "google.com",
    "linkedin.com",
    "live.com",
    "microsoft.com",
    "microsoftonline.com",
    "okta.com",
    "twitter.com",
    "x.com",
];

impl CanonicalControlDestination {
    fn host_matches_registered_domain(host: &str, registered_domain: &str) -> bool {
        host == registered_domain
            || host
                .strip_suffix(registered_domain)
                .is_some_and(|prefix| prefix.ends_with('.'))
    }
}

impl CanonicalControlDestination {
    fn host_is_registered_authentication_provider(host: &str) -> bool {
        REGISTERED_AUTHENTICATION_PROVIDER_DOMAINS
            .iter()
            .any(|domain| CanonicalControlDestination::host_matches_registered_domain(host, domain))
    }
}

/// Validate and canonicalize an untrusted browser destination.
///
/// The source must be an origin-only HTTP(S) URL. The destination must be the
/// browser-resolved absolute URL (after document/base resolution) and must have
/// that exact origin. Encoded control characters, malformed escapes, and
/// recursive percent escapes fail closed before authentication policy.
impl CanonicalControlDestination {
    pub fn canonicalize_control_destination(
        request: ControlDestinationEvidence<'_>,
    ) -> Result<CanonicalControlDestination, InvalidControlDestination> {
        let ControlDestinationEvidence {
            source_origin,
            destination_identity,
        } = request;
        if source_origin.len() > MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
            || destination_identity.len() > MAX_AUTHENTICATION_DESTINATION_TEXT_BYTES
        {
            return Err(InvalidControlDestination);
        }
        let source = Url::parse(source_origin.trim()).map_err(|_| InvalidControlDestination)?;
        if !CanonicalControlDestination::is_http_url(&source)
            || !CanonicalControlDestination::is_origin_only(&source)
        {
            return Err(InvalidControlDestination);
        }
        let destination_identity = destination_identity.trim();
        let destination =
            Url::parse(destination_identity).map_err(|_| InvalidControlDestination)?;
        if !CanonicalControlDestination::is_http_url(&destination)
            || destination.origin() != source.origin()
        {
            return Err(InvalidControlDestination);
        }

        let decoded_path = CanonicalControlDestination::decode_component(destination.path())?;
        let query = match destination.query() {
            Some(value) => Some(CanonicalControlDestination::decode_query_component(value)?),
            None => None,
        };
        let fragment = match destination.fragment() {
            Some(value) => Some(CanonicalControlDestination::decode_component(value)?),
            None => None,
        };
        let is_microsoft_consumer_login_root = destination.scheme() == "https"
            && destination.host_str() == Some("login.live.com")
            && destination.port_or_known_default() == Some(443)
            && decoded_path == "/";
        let mut path_identity = decoded_path.clone();
        if let Some(fragment) = &fragment {
            path_identity.push('#');
            path_identity.push_str(fragment);
        }
        let mut route_identity = decoded_path;
        if let Some(query) = query {
            route_identity.push('?');
            route_identity.push_str(&query);
        }
        if let Some(fragment) = fragment {
            route_identity.push('#');
            route_identity.push_str(&fragment);
        }
        if route_identity.len() > MAX_AUTHENTICATION_DESTINATION_TEXT_BYTES {
            return Err(InvalidControlDestination);
        }

        let tesla_account_authorization_route =
            CanonicalControlDestination::tesla_account_authorization_route(&destination);
        let mut authentication_policy_route_identity = tesla_account_authorization_route
            .clone()
            .or_else(|| {
                CanonicalControlDestination::amazon_claim_authentication_route(&destination)
            })
            .unwrap_or_else(|| route_identity.clone());
        let authentication_policy_destination = match (
            destination.scheme(),
            destination.host_str(),
            destination.port_or_known_default(),
            destination.path(),
            destination.fragment(),
        ) {
            ("https", Some("login.live.com"), Some(443), "/oauth20_authorize.srf", None) => {
                // The provider path names OAuth, but its query remains action/provider evidence.
                authentication_policy_route_identity =
                    route_identity.replacen("/oauth20_authorize.srf", "/", 1);
                AuthenticationPolicyDestination::MicrosoftConsumerAuthorization
            }
            _ => match tesla_account_authorization_route {
                Some(_) => AuthenticationPolicyDestination::TeslaAccountAuthorization,
                None => AuthenticationPolicyDestination::Default,
            },
        };
        Ok(CanonicalControlDestination {
            path_identity,
            route_identity,
            has_provider_authority: destination.scheme() == "https"
                && destination
                    .host_str()
                    .is_some_and(Self::host_is_registered_authentication_provider),
            has_microsoft_provider_authority: destination.scheme() == "https"
                && destination.host_str().is_some_and(|host| {
                    ["live.com", "microsoft.com", "microsoftonline.com"]
                        .iter()
                        .any(|domain| {
                            CanonicalControlDestination::host_matches_registered_domain(
                                host, domain,
                            )
                        })
                }),
            is_microsoft_consumer_login_root,
            authentication_policy_route_identity,
            authentication_policy_destination,
        })
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::{
        AuthenticationAdvanceControlDecision, AuthenticationAdvanceControlObservation,
        AuthenticationUsernameEvidence, PageControlActionability, PageControlOwnership,
        PageControlSemantics, PageControlSubmissionDestinationSource, PageControlSubmissionMethod,
    };

    #[test]
    fn microsoft_authorization_query_keeps_control_classification_fail_closed() {
        for destination_identity in [
            "https://login.live.com/oauth20_authorize.srf?provider=google",
            "https://login.live.com/oauth20_authorize.srf?action=%64elete-account",
            "https://login.live.com/oauth20_authorize.srf?scope=passkey",
        ] {
            let observation = AuthenticationAdvanceControlObservation {
                actionability: PageControlActionability::Actionable,
                ownership: PageControlOwnership::OwnedForm,
                semantics: PageControlSemantics::SemanticSubmit,
                authentication_username: AuthenticationUsernameEvidence::Explicit,
                password_field_count: 0.into(),
                new_password_field_count: 0.into(),
                one_time_code_field_count: 0.into(),
                semantic_submit_control_count: 1.into(),
                source_origin: "https://login.live.com".to_owned(),
                form_identity: String::new(),
                destination_identity: destination_identity.to_owned(),
                label: "Next".to_owned(),
                machine_identity: String::new(),
                submission_method: PageControlSubmissionMethod::Post,
                submission_destination_source: PageControlSubmissionDestinationSource::Omitted,
            };
            assert_eq!(
                observation.classify(),
                AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication,
                "{destination_identity}"
            );
        }
    }

    #[test]
    fn microsoft_authorization_destination_preserves_query_veto_evidence() -> anyhow::Result<()> {
        let destination = CanonicalControlDestination::canonicalize_control_destination(
            ControlDestinationEvidence {
                source_origin: "https://login.live.com",
                destination_identity: "https://login.live.com/oauth20_authorize.srf?client_id=mock-client&scope=openid+profile&action=%64elete-account",
            },
        )?;
        assert_eq!(
            destination.microsoft_consumer_login_destination(),
            MicrosoftConsumerLoginDestination::IdentifierEntry
        );
        assert_eq!(
            destination.authentication_policy_route_identity(),
            "/?client_id=mock-client&scope=openid profile&action=delete-account"
        );
        Ok(())
    }

    #[test]
    fn microsoft_authorization_destination_requires_exact_https_authority_and_path()
    -> anyhow::Result<()> {
        for (source_origin, destination_identity) in [
            (
                "http://login.live.com",
                "http://login.live.com/oauth20_authorize.srf",
            ),
            (
                "https://login.live.com:8443",
                "https://login.live.com:8443/oauth20_authorize.srf",
            ),
            (
                "https://nested.login.live.com",
                "https://nested.login.live.com/oauth20_authorize.srf",
            ),
            (
                "https://login.live.com.evil.example",
                "https://login.live.com.evil.example/oauth20_authorize.srf",
            ),
            (
                "https://accounts.google.com",
                "https://accounts.google.com/oauth20_authorize.srf",
            ),
            (
                "https://login.live.com",
                "https://login.live.com/oauth20_authorize.srf/unrelated",
            ),
            (
                "https://login.live.com",
                "https://login.live.com/%6Fauth20_authorize.srf",
            ),
            (
                "https://login.live.com",
                "https://login.live.com/oauth20_authorize.srf#login",
            ),
        ] {
            let destination = CanonicalControlDestination::canonicalize_control_destination(
                ControlDestinationEvidence {
                    source_origin,
                    destination_identity,
                },
            )?;
            assert_eq!(
                destination.microsoft_consumer_login_destination(),
                MicrosoftConsumerLoginDestination::Unrelated,
                "{destination_identity}"
            );
        }
        Ok(())
    }

    #[test]
    fn accepts_browser_resolved_same_origin_destinations() {
        for (source, destination, expected_path) in [
            (
                "https://example.test",
                "https://example.test/login",
                "/login",
            ),
            (
                "https://github.com",
                "https://github.com/session",
                "/session",
            ),
            (
                "https://gitlab.com",
                "https://gitlab.com/users/sign_in",
                "/users/sign_in",
            ),
        ] {
            assert_eq!(
                CanonicalControlDestination::canonicalize_control_destination(
                    ControlDestinationEvidence {
                        source_origin: source,
                        destination_identity: destination
                    }
                )
                .map(|canonical| canonical.path_identity),
                Ok(expected_path.to_owned())
            );
        }
    }

    #[test]
    fn rejects_cross_origin_and_unsupported_destinations() {
        for destination in [
            "https://evil.example/login",
            "https://accounts.google.com/o/oauth2/v2/auth",
            "//evil.example/login",
            "javascript:submit()",
            "data:text/plain,login",
            "https://user@example.test/login",
            "/login",
            "../login",
        ] {
            assert!(
                CanonicalControlDestination::canonicalize_control_destination(
                    ControlDestinationEvidence {
                        source_origin: "https://example.test",
                        destination_identity: destination
                    }
                )
                .is_err(),
                "{destination}"
            );
        }
    }

    #[test]
    fn decodes_route_evidence_once_before_policy() {
        assert_eq!(
            CanonicalControlDestination::canonicalize_control_destination(ControlDestinationEvidence { source_origin: "https://example.test", destination_identity: "https://example.test/auth/%64elete-account?action=close+account" })
            .map(|canonical| (canonical.path_identity, canonical.route_identity)),
            Ok((
                "/auth/delete-account".to_owned(),
                "/auth/delete-account?action=close account".to_owned(),
            ))
        );

        for destination in [
            "https://example.test/login/%ZZ",
            "https://example.test/login#%ZZ",
            "https://example.test/login/%2564elete",
        ] {
            assert!(
                CanonicalControlDestination::canonicalize_control_destination(
                    ControlDestinationEvidence {
                        source_origin: "https://example.test",
                        destination_identity: destination
                    }
                )
                .is_err(),
                "{destination}"
            );
        }
    }

    #[test]
    fn requires_an_origin_only_source() {
        for source in [
            "not an origin",
            "ftp://example.test",
            "https://user@example.test",
            "https://example.test/path",
            "https://example.test?next=/login",
        ] {
            assert!(
                CanonicalControlDestination::canonicalize_control_destination(
                    ControlDestinationEvidence {
                        source_origin: source,
                        destination_identity: "https://example.test/login"
                    }
                )
                .is_err(),
                "{source}"
            );
        }
    }

    #[test]
    fn records_provider_authority_from_the_validated_host() {
        assert!(
            CanonicalControlDestination::canonicalize_control_destination(
                ControlDestinationEvidence {
                    source_origin: "https://accounts.google.com",
                    destination_identity: "https://accounts.google.com/signin"
                }
            )
            .is_ok_and(|canonical| canonical.has_provider_authority)
        );
        assert!(
            CanonicalControlDestination::canonicalize_control_destination(
                ControlDestinationEvidence {
                    source_origin: "https://example.test",
                    destination_identity: "https://example.test/signin/google"
                }
            )
            .is_ok_and(|canonical| !canonical.has_provider_authority)
        );
        assert!(
            CanonicalControlDestination::canonicalize_control_destination(
                ControlDestinationEvidence {
                    source_origin: "https://google.attacker.com",
                    destination_identity: "https://google.attacker.com/signin"
                }
            )
            .is_ok_and(|canonical| !canonical.has_provider_authority)
        );
        assert!(
            CanonicalControlDestination::canonicalize_control_destination(
                ControlDestinationEvidence {
                    source_origin: "http://accounts.google.com",
                    destination_identity: "http://accounts.google.com/signin"
                }
            )
            .is_ok_and(|canonical| !canonical.has_provider_authority)
        );
    }

    #[test]
    fn preserves_fragment_routes_as_policy_evidence() {
        assert_eq!(
            CanonicalControlDestination::canonicalize_control_destination(
                ControlDestinationEvidence {
                    source_origin: "https://example.test",
                    destination_identity: "https://example.test/#/delete-account"
                }
            )
            .map(|canonical| (canonical.path_identity, canonical.route_identity)),
            Ok((
                "/#/delete-account".to_owned(),
                "/#/delete-account".to_owned(),
            ))
        );
    }

    #[test]
    fn rejects_oversized_canonical_route_evidence() {
        let destination = format!(
            "https://example.test/login?next={}",
            "x".repeat(MAX_AUTHENTICATION_DESTINATION_TEXT_BYTES)
        );
        assert!(
            CanonicalControlDestination::canonicalize_control_destination(
                ControlDestinationEvidence {
                    source_origin: "https://example.test",
                    destination_identity: &destination
                }
            )
            .is_err()
        );
        let fragment = format!(
            "https://example.test/login#{}",
            "x".repeat(MAX_AUTHENTICATION_DESTINATION_TEXT_BYTES)
        );
        assert!(
            CanonicalControlDestination::canonicalize_control_destination(
                ControlDestinationEvidence {
                    source_origin: "https://example.test",
                    destination_identity: &fragment
                }
            )
            .is_err()
        );
    }

    #[test]
    fn amazon_claim_metadata_uses_the_exact_authentication_route_for_policy() {
        let destination = "https://www.amazon.com/ax/claim?openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0&openid.return_to=https%3A%2F%2Fwww.amazon.com%2F%3Fref_%3Dnav_ya_signin&policy_handle=Retail-Checkout&openid.mode=checkid_setup&openid.assoc_handle=usflex&arb=mock-arb";
        let canonical = CanonicalControlDestination::canonicalize_control_destination(
            ControlDestinationEvidence {
                source_origin: "https://www.amazon.com",
                destination_identity: destination,
            },
        );
        assert!(canonical.is_ok());
        let Ok(canonical) = canonical else {
            return;
        };
        assert!(canonical.route_identity.contains("Retail-Checkout"));
        assert_eq!(
            canonical.authentication_policy_route_identity(),
            "/ax/claim"
        );

        for hostile in [
            destination.replace("checkid_setup", "delete-account"),
            destination.replace("www.amazon.com%2F", "attacker.example%2F"),
            format!("{destination}&action=checkout"),
        ] {
            let canonical = CanonicalControlDestination::canonicalize_control_destination(
                ControlDestinationEvidence {
                    source_origin: "https://www.amazon.com",
                    destination_identity: &hostile,
                },
            );
            assert!(canonical.is_ok());
            let Ok(canonical) = canonical else {
                return;
            };
            assert_ne!(
                canonical.authentication_policy_route_identity(),
                "/ax/claim"
            );
        }
    }

    #[test]
    fn tesla_account_oauth_metadata_uses_the_exact_authentication_route_for_policy() {
        let destination = "https://auth.tesla.com/oauth2/v1/authorize?response_type=code&client_id=accounts&redirect_uri=https%3A%2F%2Faccounts.tesla.com%2Foauth2%2Fcallback&scope=offline_access+user+profile+ou_code+email&locale=en-US";
        let canonical = CanonicalControlDestination::canonicalize_control_destination(
            ControlDestinationEvidence {
                source_origin: "https://auth.tesla.com",
                destination_identity: destination,
            },
        );
        assert!(canonical.is_ok());
        let Ok(canonical) = canonical else {
            return;
        };
        assert!(canonical.route_identity.contains("scope=offline_access"));
        assert_eq!(
            canonical.authentication_policy_route_identity(),
            "/oauth2/v1/authorize"
        );

        for locale in ["de-DE", "fr-FR", "es-ES", "pt-BR", "zh-CN"] {
            let localized = destination.replace("locale=en-US", &format!("locale={locale}"));
            let canonical = CanonicalControlDestination::canonicalize_control_destination(
                ControlDestinationEvidence {
                    source_origin: "https://auth.tesla.com",
                    destination_identity: &localized,
                },
            );
            assert!(canonical.is_ok(), "{locale}");
            let Ok(canonical) = canonical else {
                continue;
            };
            assert_eq!(
                canonical.authentication_policy_route_identity(),
                "/oauth2/v1/authorize"
            );
        }

        for hostile in [
            destination.replace("client_id=accounts", "client_id=attacker"),
            destination.replace(
                "accounts.tesla.com%2Foauth2%2Fcallback",
                "attacker.example%2Fcallback",
            ),
            destination.replace("profile", "delete-account"),
            destination.replace("locale=en-US", "locale=english-US"),
            destination.replace("locale=en-US", "locale=en-us"),
            destination.replace("locale=en-US", "locale=en-US-extra"),
            format!("{destination}&provider=google"),
        ] {
            let canonical = CanonicalControlDestination::canonicalize_control_destination(
                ControlDestinationEvidence {
                    source_origin: "https://auth.tesla.com",
                    destination_identity: &hostile,
                },
            );
            assert!(canonical.is_ok());
            let Ok(canonical) = canonical else {
                return;
            };
            assert_ne!(
                canonical.authentication_policy_route_identity(),
                "/oauth2/v1/authorize"
            );
        }
    }
}
