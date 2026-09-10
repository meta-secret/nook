//! Canonical same-origin destination evidence for authentication controls.

use percent_encoding::percent_decode_str;
use url::Url;

use super::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES;

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
}

/// Named values required by CanonicalControlDestination::canonicalize_control_destination.
pub struct ControlDestinationEvidence<'a> {
    pub source_origin: &'a str,
    pub destination_identity: &'a str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("invalid or untrusted authentication control destination")]
pub struct InvalidControlDestination;

impl CanonicalControlDestination {
    fn is_http_url(url: &Url) -> bool {
        matches!(url.scheme(), "http" | "https")
            && url.username().is_empty()
            && url.password().is_none()
            && url.host_str().is_some()
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
        while index < bytes.len() {
            if bytes[index] == b'%' {
                if index + 2 >= bytes.len()
                    || !bytes[index + 1].is_ascii_hexdigit()
                    || !bytes[index + 2].is_ascii_hexdigit()
                {
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
    #[must_use]
    pub fn canonicalize_control_destination(
        request: ControlDestinationEvidence<'_>,
    ) -> Result<CanonicalControlDestination, InvalidControlDestination> {
        let ControlDestinationEvidence {
            source_origin,
            destination_identity,
        } = request;
        if source_origin.len() > MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
            || destination_identity.len() > MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
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
        if route_identity.len() > MAX_AUTHENTICATION_CONTROL_TEXT_BYTES {
            return Err(InvalidControlDestination);
        }

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
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
            "x".repeat(MAX_AUTHENTICATION_CONTROL_TEXT_BYTES)
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
            "x".repeat(MAX_AUTHENTICATION_CONTROL_TEXT_BYTES)
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
}
