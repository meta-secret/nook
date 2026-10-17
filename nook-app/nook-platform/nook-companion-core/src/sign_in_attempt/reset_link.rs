//! Password-reset link classification and click-time revalidation.
//!
//! A reset link is an absolute http(s) URL on the attempt's own site whose
//! visible text or URL path uses reset/forgot/recover vocabulary (English or
//! Russian). The same rule admits the offer and revalidates the clicked link,
//! so a stale or cross-site handle is never activated.

use super::page_evidence::{SignInPageLink, SignInPageLinkIndex, SignInPageLinks};
use super::site::{SignInAttemptSite, SignInAttemptSiteRelation};
use super::vocabulary::{SignInAttemptNormalizedText, SignInAttemptTermMatch, SignInAttemptTerms};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SignInAttemptResetLink {
    Reset(SignInPageLinkIndex),
    NotReset,
}

impl SignInPageLink {
    const TEXT_TERMS: SignInAttemptTerms = SignInAttemptTerms(&[
        "reset",
        "forgot",
        "forgotten",
        "recover",
        "lost password",
        "сброс",
        "забыли",
        "восстанов",
    ]);
    const PATH_TERMS: SignInAttemptTerms = SignInAttemptTerms(&[
        "reset",
        "forgot",
        "recover",
        "lost-password",
        "lostpassword",
        "lost_password",
    ]);

    pub(crate) fn reset_link(&self, site: &SignInAttemptSite) -> SignInAttemptResetLink {
        let Ok(url) = self.href.url() else {
            return SignInAttemptResetLink::NotReset;
        };
        let Ok(link_site) = SignInAttemptSite::try_from(&url) else {
            return SignInAttemptResetLink::NotReset;
        };
        match site.relation(&link_site) {
            SignInAttemptSiteRelation::SameSite => {}
            SignInAttemptSiteRelation::OtherSite => return SignInAttemptResetLink::NotReset,
        }
        let text = SignInAttemptNormalizedText::from(self.text.text());
        let path = SignInAttemptNormalizedText::from(url.path());
        match (
            Self::TEXT_TERMS.find_in(&text),
            Self::PATH_TERMS.find_in(&path),
        ) {
            (SignInAttemptTermMatch::Matched, _) | (_, SignInAttemptTermMatch::Matched) => {
                SignInAttemptResetLink::Reset(self.index)
            }
            (SignInAttemptTermMatch::Unmatched, SignInAttemptTermMatch::Unmatched) => {
                SignInAttemptResetLink::NotReset
            }
        }
    }
}

impl SignInPageLinks {
    /// The first same-site reset link on the current page.
    pub(crate) fn reset_link(&self, site: &SignInAttemptSite) -> SignInAttemptResetLink {
        self.iter().fold(
            SignInAttemptResetLink::NotReset,
            |found, link| match found {
                SignInAttemptResetLink::Reset(_) => found,
                SignInAttemptResetLink::NotReset => link.reset_link(site),
            },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::SignInAttemptResetLink;
    use crate::{
        SignInAttemptSenderOrigin, SignInPageLink, SignInPageLinkHref, SignInPageLinkIndex,
        SignInPageLinkText, SignInPageLinks,
    };

    struct LinkCase {
        text: &'static str,
        href: &'static str,
        reset: SignInAttemptResetLink,
    }

    impl LinkCase {
        fn link(&self) -> anyhow::Result<SignInPageLink> {
            Ok(SignInPageLink {
                index: SignInPageLinkIndex::from(4),
                text: SignInPageLinkText::try_from(self.text.to_owned())?,
                href: SignInPageLinkHref::try_from(self.href.to_owned())?,
            })
        }

        fn assert_classification(&self) -> anyhow::Result<()> {
            let site = SignInAttemptSenderOrigin::try_from("https://www.namecheap.com".to_owned())?
                .site()?;
            assert_eq!(
                self.link()?.reset_link(&site),
                self.reset,
                "{} {}",
                self.text,
                self.href
            );
            Ok(())
        }
    }

    #[test]
    fn reset_links_require_same_site_http_and_reset_vocabulary() -> anyhow::Result<()> {
        let reset = SignInAttemptResetLink::Reset(SignInPageLinkIndex::from(4));
        let not_reset = SignInAttemptResetLink::NotReset;
        for case in [
            LinkCase {
                text: "Password Reset",
                href: "https://www.namecheap.com/myaccount/forgotpassword/",
                reset,
            },
            LinkCase {
                text: "Need help?",
                href: "https://ap.www.namecheap.com/reset-password",
                reset,
            },
            LinkCase {
                text: "Забыли пароль?",
                href: "https://www.namecheap.com/help",
                reset,
            },
            LinkCase {
                text: "Password Reset",
                href: "https://evil.example/reset",
                reset: not_reset,
            },
            LinkCase {
                text: "Password Reset",
                href: "http://www.namecheap.com/reset",
                reset: not_reset,
            },
            LinkCase {
                text: "Password Reset",
                href: "javascript:alert(1)",
                reset: not_reset,
            },
            LinkCase {
                text: "Password Reset",
                href: "/myaccount/forgotpassword/",
                reset: not_reset,
            },
            LinkCase {
                text: "Create account",
                href: "https://www.namecheap.com/myaccount/signup/",
                reset: not_reset,
            },
        ] {
            case.assert_classification()?;
        }
        Ok(())
    }

    #[test]
    fn page_offer_is_the_first_reset_link() -> anyhow::Result<()> {
        let site =
            SignInAttemptSenderOrigin::try_from("https://www.namecheap.com".to_owned())?.site()?;
        let links = SignInPageLinks::try_from(vec![
            SignInPageLink {
                index: SignInPageLinkIndex::from(1),
                text: SignInPageLinkText::try_from("Sign up".to_owned())?,
                href: SignInPageLinkHref::try_from("https://www.namecheap.com/signup".to_owned())?,
            },
            SignInPageLink {
                index: SignInPageLinkIndex::from(2),
                text: SignInPageLinkText::try_from("Password Reset".to_owned())?,
                href: SignInPageLinkHref::try_from("https://www.namecheap.com/forgot".to_owned())?,
            },
            SignInPageLink {
                index: SignInPageLinkIndex::from(3),
                text: SignInPageLinkText::try_from("Recover account".to_owned())?,
                href: SignInPageLinkHref::try_from("https://www.namecheap.com/recover".to_owned())?,
            },
        ])?;
        assert_eq!(
            links.reset_link(&site),
            SignInAttemptResetLink::Reset(SignInPageLinkIndex::from(2))
        );
        Ok(())
    }
}
