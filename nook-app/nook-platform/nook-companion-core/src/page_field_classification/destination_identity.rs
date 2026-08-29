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
}

fn is_http_url(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str().is_some()
}

fn is_origin_only(url: &Url) -> bool {
    url.path() == "/" && url.query().is_none() && url.fragment().is_none()
}

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

fn decode_component(value: &str) -> Option<String> {
    if !has_valid_percent_encoding(value) {
        return None;
    }
    let decoded = percent_decode_str(value).decode_utf8().ok()?;
    if decoded.chars().any(char::is_control) || decoded.contains('%') {
        return None;
    }
    Some(decoded.into_owned())
}

fn decode_query_component(value: &str) -> Option<String> {
    decode_component(&value.replace('+', " "))
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

fn host_matches_registered_domain(host: &str, registered_domain: &str) -> bool {
    host == registered_domain
        || host
            .strip_suffix(registered_domain)
            .is_some_and(|prefix| prefix.ends_with('.'))
}

fn host_is_registered_authentication_provider(host: &str) -> bool {
    REGISTERED_AUTHENTICATION_PROVIDER_DOMAINS
        .iter()
        .any(|domain| host_matches_registered_domain(host, domain))
}

/// Validate and canonicalize an untrusted browser destination.
///
/// The source must be an origin-only HTTP(S) URL. The destination must be the
/// browser-resolved absolute URL (after document/base resolution) and must have
/// that exact origin. Encoded control characters, malformed escapes, and
/// recursive percent escapes fail closed before authentication policy.
#[must_use]
pub fn canonicalize_control_destination(
    source_origin: &str,
    destination_identity: &str,
) -> Option<CanonicalControlDestination> {
    if source_origin.len() > MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
        || destination_identity.len() > MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
    {
        return None;
    }
    let source = Url::parse(source_origin.trim()).ok()?;
    if !is_http_url(&source) || !is_origin_only(&source) {
        return None;
    }
    let destination_identity = destination_identity.trim();
    let destination = Url::parse(destination_identity).ok()?;
    if !is_http_url(&destination) || destination.origin() != source.origin() {
        return None;
    }

    let decoded_path = decode_component(destination.path())?;
    let query = match destination.query() {
        Some(value) => Some(decode_query_component(value)?),
        None => None,
    };
    let fragment = match destination.fragment() {
        Some(value) => Some(decode_component(value)?),
        None => None,
    };
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
        return None;
    }

    Some(CanonicalControlDestination {
        path_identity,
        route_identity,
        has_provider_authority: destination.scheme() == "https"
            && destination
                .host_str()
                .is_some_and(host_is_registered_authentication_provider),
    })
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
                canonicalize_control_destination(source, destination)
                    .map(|canonical| canonical.path_identity),
                Some(expected_path.to_owned())
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
                canonicalize_control_destination("https://example.test", destination).is_none(),
                "{destination}"
            );
        }
    }

    #[test]
    fn decodes_route_evidence_once_before_policy() {
        assert_eq!(
            canonicalize_control_destination(
                "https://example.test",
                "https://example.test/auth/%64elete-account?action=close+account",
            )
            .map(|canonical| (canonical.path_identity, canonical.route_identity)),
            Some((
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
                canonicalize_control_destination("https://example.test", destination).is_none(),
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
                canonicalize_control_destination(source, "https://example.test/login").is_none(),
                "{source}"
            );
        }
    }

    #[test]
    fn records_provider_authority_from_the_validated_host() {
        assert!(
            canonicalize_control_destination(
                "https://accounts.google.com",
                "https://accounts.google.com/signin",
            )
            .is_some_and(|canonical| canonical.has_provider_authority)
        );
        assert!(
            canonicalize_control_destination(
                "https://example.test",
                "https://example.test/signin/google",
            )
            .is_some_and(|canonical| !canonical.has_provider_authority)
        );
        assert!(
            canonicalize_control_destination(
                "https://google.attacker.com",
                "https://google.attacker.com/signin",
            )
            .is_some_and(|canonical| !canonical.has_provider_authority)
        );
        assert!(
            canonicalize_control_destination(
                "http://accounts.google.com",
                "http://accounts.google.com/signin",
            )
            .is_some_and(|canonical| !canonical.has_provider_authority)
        );
    }

    #[test]
    fn preserves_fragment_routes_as_policy_evidence() {
        assert_eq!(
            canonicalize_control_destination(
                "https://example.test",
                "https://example.test/#/delete-account",
            )
            .map(|canonical| (canonical.path_identity, canonical.route_identity)),
            Some((
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
        assert!(canonicalize_control_destination("https://example.test", &destination).is_none());
        let fragment = format!(
            "https://example.test/login#{}",
            "x".repeat(MAX_AUTHENTICATION_CONTROL_TEXT_BYTES)
        );
        assert!(canonicalize_control_destination("https://example.test", &fragment).is_none());
    }
}
