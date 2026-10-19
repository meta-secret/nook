//! The http(s) origin of the page that presented an authenticator setup.
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use super::AuthenticatorEnrollmentError;
use crate::secrets::secret_view::WebsiteHost;
use serde::Deserialize;
use url::{Origin, Url};

/// A serialized http(s) tuple origin, such as `https://www.example.com`.
///
/// The input must equal its own origin serialization (`location.origin`):
/// paths, queries, fragments, credentials, opaque origins, and other schemes
/// are rejected rather than reduced to an origin.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(try_from = "String")]
pub struct EnrollmentPageOrigin(Url);

impl TryFrom<String> for EnrollmentPageOrigin {
    type Error = AuthenticatorEnrollmentError;

    #[expect(
        clippy::match_bool,
        reason = "origin equality is converted through a native pattern at page-origin admission"
    )]
    fn try_from(text: String) -> Result<Self, Self::Error> {
        let url = Url::parse(&text).map_err(|_| AuthenticatorEnrollmentError::PageOriginInvalid)?;
        match url.scheme() {
            "http" | "https" => {}
            _ => return Err(AuthenticatorEnrollmentError::PageOriginInvalid),
        }
        let Origin::Tuple(..) = url.origin() else {
            return Err(AuthenticatorEnrollmentError::PageOriginInvalid);
        };
        match url.origin().ascii_serialization() == text {
            true => Ok(Self(url)),
            false => Err(AuthenticatorEnrollmentError::PageOriginInvalid),
        }
    }
}

impl EnrollmentPageOrigin {
    /// The default service name: the origin host without a leading `www.`.
    pub fn default_issuer(&self) -> Result<WebsiteHost, AuthenticatorEnrollmentError> {
        let Self(url) = self;
        WebsiteHost::normalize(url.as_str())
            .map_err(|_| AuthenticatorEnrollmentError::PageOriginInvalid)
    }
}

#[cfg(test)]
mod tests {
    use super::{AuthenticatorEnrollmentError, EnrollmentPageOrigin};

    struct OriginFixture<'a> {
        origin: &'a str,
    }

    impl OriginFixture<'_> {
        fn default_issuer(&self) -> anyhow::Result<String> {
            Ok(EnrollmentPageOrigin::try_from(self.origin.to_owned())?
                .default_issuer()?
                .into_string())
        }
    }

    #[test]
    fn default_issuer_is_the_origin_host_without_a_leading_www() -> anyhow::Result<()> {
        assert_eq!(
            OriginFixture {
                origin: "https://www.example.com"
            }
            .default_issuer()?,
            "example.com"
        );
        assert_eq!(
            OriginFixture {
                origin: "https://dashboard.example.com"
            }
            .default_issuer()?,
            "dashboard.example.com"
        );
        assert_eq!(
            OriginFixture {
                origin: "http://localhost:8080"
            }
            .default_issuer()?,
            "localhost"
        );
        Ok(())
    }

    #[test]
    fn rejects_values_that_are_not_serialized_http_origins() {
        for origin in [
            "",
            "example.com",
            "https://www.example.com/",
            "https://www.example.com/setup",
            "https://www.example.com?x=1",
            "https://user@www.example.com",
            "https://WWW.EXAMPLE.COM",
            "ftp://example.com",
            "chrome-extension://abcdefghijklmnop",
            "file:///tmp/setup.html",
            "data:text/html,setup",
        ] {
            assert!(
                matches!(
                    EnrollmentPageOrigin::try_from(origin.to_owned()),
                    Err(AuthenticatorEnrollmentError::PageOriginInvalid)
                ),
                "{origin:?}"
            );
        }
    }
}
