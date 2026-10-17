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
    #[error("sign-in sender origin is not a canonical origin")]
    OriginNotCanonical,
    #[error("stored sign-in site is not canonical")]
    SiteNotCanonical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SignInAttemptScheme {
    Http,
    Https,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
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

    fn canonical(&self) -> String {
        let SignInAttemptSiteHost(host) = &self.host;
        let scheme = match self.scheme {
            SignInAttemptScheme::Http => "http",
            SignInAttemptScheme::Https => "https",
        };
        format!("{scheme}://{host}")
    }
}

impl SignInAttemptSenderOrigin {
    /// Admits only a canonical `scheme://host[:port]` http(s) origin.
    #[expect(
        clippy::match_bool,
        reason = "canonical-origin equality is converted immediately into admission"
    )]
    pub(crate) fn site(&self) -> Result<SignInAttemptSite, SignInAttemptSiteError> {
        let url = Url::parse(self.text()).map_err(|_| SignInAttemptSiteError::UnsupportedUrl)?;
        let site = SignInAttemptSite::try_from(&url)?;
        match url.origin().ascii_serialization() == self.text() {
            true => Ok(site),
            false => Err(SignInAttemptSiteError::OriginNotCanonical),
        }
    }
}

impl SignInPageLinkHref {
    pub(crate) fn url(&self) -> Result<Url, SignInAttemptSiteError> {
        Url::parse(self.text()).map_err(|_| SignInAttemptSiteError::UnsupportedUrl)
    }
}

impl TryFrom<String> for SignInAttemptSite {
    type Error = SignInAttemptSiteError;

    #[expect(
        clippy::match_bool,
        reason = "canonical stored-site equality is converted immediately into strict decoding"
    )]
    fn try_from(stored: String) -> Result<Self, Self::Error> {
        let url = Url::parse(&stored).map_err(|_| SignInAttemptSiteError::SiteNotCanonical)?;
        let site = Self::try_from(&url)?;
        match site.canonical() == stored {
            true => Ok(site),
            false => Err(SignInAttemptSiteError::SiteNotCanonical),
        }
    }
}

impl From<SignInAttemptSite> for String {
    fn from(site: SignInAttemptSite) -> Self {
        site.canonical()
    }
}

#[cfg(test)]
mod tests {
    use super::{SignInAttemptSite, SignInAttemptSiteError, SignInAttemptSiteRelation};
    use crate::SignInAttemptSenderOrigin;

    struct SiteCase {
        recorded: &'static str,
        sender: &'static str,
        relation: SignInAttemptSiteRelation,
    }

    impl SiteCase {
        fn assert_relation(&self) -> anyhow::Result<()> {
            let recorded = SignInAttemptSenderOrigin::try_from(self.recorded.to_owned())?.site()?;
            let sender = SignInAttemptSenderOrigin::try_from(self.sender.to_owned())?.site()?;
            assert_eq!(
                recorded.relation(&sender),
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
            assert!(origin.site().is_err(), "{rejected}");
        }
        Ok(())
    }

    #[test]
    fn stored_site_round_trips_canonically_and_rejects_other_forms() -> anyhow::Result<()> {
        let site =
            SignInAttemptSenderOrigin::try_from("https://www.namecheap.com".to_owned())?.site()?;
        let stored = serde_json::to_string(&site)?;
        assert_eq!(stored, r#""https://namecheap.com""#);
        assert_eq!(serde_json::from_str::<SignInAttemptSite>(&stored)?, site);
        for rejected in [
            "https://www.namecheap.com",
            "https://namecheap.com/",
            "ftp://namecheap.com",
        ] {
            assert_ne!(
                SignInAttemptSite::try_from(rejected.to_owned()),
                Ok(site.clone()),
                "{rejected}"
            );
        }
        assert_eq!(
            SignInAttemptSite::try_from("ftp://namecheap.com".to_owned()),
            Err(SignInAttemptSiteError::UnsupportedUrl)
        );
        Ok(())
    }
}
