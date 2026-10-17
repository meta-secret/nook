//! Schemeful same-site binding of a sign-in attempt.
//!
//! A site is the URL scheme (`http`/`https`) plus the registrable domain from
//! the public suffix list, or the exact host when no registrable domain exists
//! (IP addresses, `localhost`, a bare public suffix). Ports never distinguish
//! sites. `nook-core` owns the credential-matching PSL policy but depends on
//! this crate, so the same pinned `psl` crate and rule are applied here.

use std::str;

use serde::{Deserialize, Serialize};
use url::{Host, Url};

use super::page_evidence::SignInPageLinkHref;
use super::request::SignInAttemptSenderOrigin;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub(crate) enum SignInAttemptSiteError {
    #[error("sign-in site URL is not an absolute http(s) URL")]
    UnsupportedUrl,
    #[error("sign-in origin is not a canonical origin")]
    OriginNotCanonical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SignInAttemptScheme {
    Http,
    Https,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SignInAttemptSite {
    scheme: SignInAttemptScheme,
    host: SignInAttemptSiteHost,
}

/// Registrable domain, or the exact host when the PSL yields none.
#[derive(Debug, Clone, PartialEq, Eq)]
struct SignInAttemptSiteHost(String);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SignInAttemptSiteRelation {
    SameSite,
    OtherSite,
}

impl TryFrom<&Url> for SignInAttemptSite {
    type Error = SignInAttemptSiteError;

    fn try_from(url: &Url) -> Result<Self, Self::Error> {
        let scheme = match url.scheme() {
            "https" => SignInAttemptScheme::Https,
            "http" => SignInAttemptScheme::Http,
            _ => return Err(SignInAttemptSiteError::UnsupportedUrl),
        };
        let host = match url.host() {
            Some(Host::Domain(domain)) => SignInAttemptSiteHost::from(domain),
            Some(Host::Ipv4(_) | Host::Ipv6(_)) => match url.host_str() {
                Some(exact) => SignInAttemptSiteHost(exact.to_owned()),
                None => return Err(SignInAttemptSiteError::UnsupportedUrl),
            },
            None => return Err(SignInAttemptSiteError::UnsupportedUrl),
        };
        Ok(Self { scheme, host })
    }
}

impl From<&str> for SignInAttemptSiteHost {
    fn from(domain: &str) -> Self {
        let registrable = psl::domain(domain.as_bytes())
            .map(|registrable| str::from_utf8(registrable.as_bytes()).map(str::to_owned));
        match registrable {
            Some(Ok(registrable)) => Self(registrable),
            Some(Err(_)) | None => Self(domain.to_owned()),
        }
    }
}

impl SignInAttemptSite {
    #[expect(
        clippy::match_bool,
        reason = "site equality is converted immediately into the named same-site relation"
    )]
    pub(crate) fn relation(&self, other: &Self) -> SignInAttemptSiteRelation {
        match self == other {
            true => SignInAttemptSiteRelation::SameSite,
            false => SignInAttemptSiteRelation::OtherSite,
        }
    }
}

/// A canonical http(s) origin (`scheme://host[:port]`) and its site.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub(crate) struct SignInAttemptOrigin {
    canonical: String,
    site: SignInAttemptSite,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SignInAttemptOriginRelation {
    SameOrigin,
    OtherOrigin,
}

impl TryFrom<String> for SignInAttemptOrigin {
    type Error = SignInAttemptSiteError;

    /// Admits only the browser's canonical serialization of an http(s) origin.
    #[expect(
        clippy::match_bool,
        reason = "canonical-origin equality is converted immediately into admission"
    )]
    fn try_from(origin: String) -> Result<Self, Self::Error> {
        let url = Url::parse(&origin).map_err(|_| SignInAttemptSiteError::UnsupportedUrl)?;
        let site = SignInAttemptSite::try_from(&url)?;
        match url.origin().ascii_serialization() == origin {
            true => Ok(Self {
                canonical: origin,
                site,
            }),
            false => Err(SignInAttemptSiteError::OriginNotCanonical),
        }
    }
}

impl From<SignInAttemptOrigin> for String {
    fn from(origin: SignInAttemptOrigin) -> Self {
        origin.canonical
    }
}

impl SignInAttemptOrigin {
    pub(crate) const fn site(&self) -> &SignInAttemptSite {
        &self.site
    }

    #[expect(
        clippy::match_bool,
        reason = "exact-origin equality is converted immediately into the named relation"
    )]
    pub(crate) fn relation(&self, other: &Self) -> SignInAttemptOriginRelation {
        match self.canonical == other.canonical {
            true => SignInAttemptOriginRelation::SameOrigin,
            false => SignInAttemptOriginRelation::OtherOrigin,
        }
    }
}

impl SignInAttemptSenderOrigin {
    /// Admits only a canonical `scheme://host[:port]` http(s) origin.
    pub(crate) fn origin(&self) -> Result<SignInAttemptOrigin, SignInAttemptSiteError> {
        SignInAttemptOrigin::try_from(self.text().to_owned())
    }
}

impl SignInPageLinkHref {
    pub(crate) fn url(&self) -> Result<Url, SignInAttemptSiteError> {
        Url::parse(self.text()).map_err(|_| SignInAttemptSiteError::UnsupportedUrl)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        SignInAttemptOrigin, SignInAttemptOriginRelation, SignInAttemptSiteError,
        SignInAttemptSiteRelation,
    };
    use crate::SignInAttemptSenderOrigin;

    struct SiteCase {
        recorded: &'static str,
        sender: &'static str,
        relation: SignInAttemptSiteRelation,
    }

    impl SiteCase {
        fn assert_relation(&self) -> anyhow::Result<()> {
            let recorded =
                SignInAttemptSenderOrigin::try_from(self.recorded.to_owned())?.origin()?;
            let sender = SignInAttemptSenderOrigin::try_from(self.sender.to_owned())?.origin()?;
            assert_eq!(
                recorded.site().relation(sender.site()),
                self.relation,
                "{} vs {}",
                self.recorded,
                self.sender
            );
            Ok(())
        }
    }

    #[test]
    fn same_site_uses_scheme_and_registrable_domain_with_exact_host_fallback() -> anyhow::Result<()>
    {
        use SignInAttemptSiteRelation::{OtherSite, SameSite};
        for case in [
            SiteCase {
                recorded: "https://www.namecheap.com",
                sender: "https://ap.www.namecheap.com",
                relation: SameSite,
            },
            SiteCase {
                recorded: "https://login.example.co.uk",
                sender: "https://example.co.uk",
                relation: SameSite,
            },
            SiteCase {
                recorded: "https://a.example.co.uk",
                sender: "https://b.other.co.uk",
                relation: OtherSite,
            },
            SiteCase {
                recorded: "https://www.namecheap.com",
                sender: "http://www.namecheap.com",
                relation: OtherSite,
            },
            SiteCase {
                recorded: "https://alice.github.io",
                sender: "https://bob.github.io",
                relation: OtherSite,
            },
            SiteCase {
                recorded: "http://localhost:4173",
                sender: "http://localhost:5173",
                relation: SameSite,
            },
            SiteCase {
                recorded: "http://127.0.0.1:8080",
                sender: "http://127.0.0.2:8080",
                relation: OtherSite,
            },
            SiteCase {
                recorded: "http://[::1]:3000",
                sender: "http://[::1]:3001",
                relation: SameSite,
            },
        ] {
            case.assert_relation()?;
        }
        Ok(())
    }

    #[test]
    fn sender_origin_must_be_a_canonical_http_origin() -> anyhow::Result<()> {
        for rejected in [
            "chrome-extension://abcdefghijklmnop",
            "file:///tmp/login.html",
            "https://www.namecheap.com/myaccount/login",
            "https://www.namecheap.com/",
            "not a url",
            "",
        ] {
            let origin = SignInAttemptSenderOrigin::try_from(rejected.to_owned())?;
            assert!(origin.origin().is_err(), "{rejected}");
        }
        Ok(())
    }

    #[test]
    fn stored_origin_round_trips_exactly_and_compares_by_exact_origin() -> anyhow::Result<()> {
        let origin = SignInAttemptOrigin::try_from("https://www.namecheap.com".to_owned())?;
        let stored = serde_json::to_string(&origin)?;
        assert_eq!(stored, r#""https://www.namecheap.com""#);
        assert_eq!(
            serde_json::from_str::<SignInAttemptOrigin>(&stored)?,
            origin
        );
        let subdomain = SignInAttemptOrigin::try_from("https://ap.www.namecheap.com".to_owned())?;
        assert_eq!(
            origin.relation(&origin.clone()),
            SignInAttemptOriginRelation::SameOrigin
        );
        assert_eq!(
            origin.relation(&subdomain),
            SignInAttemptOriginRelation::OtherOrigin
        );
        assert_eq!(
            SignInAttemptOrigin::try_from("ftp://namecheap.com".to_owned()),
            Err(SignInAttemptSiteError::UnsupportedUrl)
        );
        assert_eq!(
            SignInAttemptOrigin::try_from("https://www.namecheap.com/".to_owned()),
            Err(SignInAttemptSiteError::OriginNotCanonical)
        );
        Ok(())
    }
}
