//! Complete canonical hosts for credential admission, independent of display grouping.

use super::WebsiteHostError;
use std::net::{Ipv4Addr, Ipv6Addr};
use url::{Host, Url};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoginWebsiteHost {
    Domain(LoginDomainHost),
    Ipv4(Ipv4Addr),
    Ipv6(Ipv6Addr),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoginDomainHost(String);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoginHostMatch {
    Matched,
    Unmatched,
}

impl TryFrom<&str> for LoginWebsiteHost {
    type Error = WebsiteHostError;
    #[expect(
        clippy::match_bool,
        reason = "dependency predicates are converted through native patterns at canonical host admission"
    )]
    fn try_from(raw: &str) -> Result<Self, Self::Error> {
        let raw = raw.trim();
        let url = match raw.contains("://") {
            true => Url::parse(raw),
            false => Url::parse(&format!("https://{raw}")),
        }
        .map_err(|_| WebsiteHostError)?;
        match url.host() {
            Some(Host::Domain(host)) => match Host::parse(host).map_err(|_| WebsiteHostError)? {
                Host::Domain(host) => LoginDomainHost::try_from(host.as_str()).map(Self::Domain),
                Host::Ipv4(host) => Ok(Self::Ipv4(host)),
                Host::Ipv6(host) => Ok(Self::Ipv6(host)),
            },
            Some(Host::Ipv4(host)) => Ok(Self::Ipv4(host)),
            Some(Host::Ipv6(host)) => Ok(Self::Ipv6(host)),
            None => Err(WebsiteHostError),
        }
    }
}

impl LoginWebsiteHost {
    #[must_use]
    #[expect(
        clippy::match_bool,
        reason = "exact host equality is translated to the named credential admission outcome"
    )]
    pub fn matches(&self, other: &Self) -> LoginHostMatch {
        match self == other {
            true => return LoginHostMatch::Matched,
            false => {}
        }
        match self {
            Self::Domain(left) => match other {
                Self::Domain(right) => left.matches(right),
                Self::Ipv4(_) | Self::Ipv6(_) => LoginHostMatch::Unmatched,
            },
            Self::Ipv4(_) | Self::Ipv6(_) => LoginHostMatch::Unmatched,
        }
    }
}

impl TryFrom<&str> for LoginDomainHost {
    type Error = WebsiteHostError;
    #[expect(
        clippy::match_bool,
        reason = "DNS label predicate results are consumed as validation outcomes"
    )]
    fn try_from(raw: &str) -> Result<Self, Self::Error> {
        let host = match raw.strip_suffix('.') {
            Some(host) => host,
            None => raw,
        }
        .to_ascii_lowercase();
        match host.len() {
            1..=253 => {}
            _ => return Err(WebsiteHostError),
        }
        for label in host.split('.') {
            match label.len() {
                1..=63 => {}
                _ => return Err(WebsiteHostError),
            }
            match label.starts_with('-')
                || label.ends_with('-')
                || !label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            {
                true => return Err(WebsiteHostError),
                false => {}
            }
        }
        Ok(Self(host))
    }
}

impl LoginDomainHost {
    #[expect(
        clippy::match_bool,
        reason = "PSL domain equality is translated to the named credential admission outcome"
    )]
    fn matches(&self, other: &Self) -> LoginHostMatch {
        let Self(left) = self;
        let Self(right) = other;
        let Some(left) = psl::domain(left.as_bytes()) else {
            return LoginHostMatch::Unmatched;
        };
        let Some(right) = psl::domain(right.as_bytes()) else {
            return LoginHostMatch::Unmatched;
        };
        match left.as_bytes() == right.as_bytes() {
            true => LoginHostMatch::Matched,
            false => LoginHostMatch::Unmatched,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        CredentialKind, FocusedLoginFillError, FocusedLoginFillOrigin, FocusedLoginFillProjection,
        LoginHostMatchRequest, LoginSecret, SecretId, SecretRecord, SecretSearchCatalog,
        SecretType, SecretValue, StoredRecordPayload, VaultCrypto, VaultKeys,
        WebsiteLoginSaveCandidate, WebsiteLoginSaveDecision, WebsiteLoginSaveRequest,
    };
    use std::collections::HashMap;

    struct LoginSiteCase {
        saved: &'static str,
        requesting: &'static str,
        expected: LoginHostMatch,
    }

    impl LoginSiteCase {
        fn assert_consumers(&self) -> anyhow::Result<()> {
            let id = SecretId::parse("secret_SMypl8K0w9a")?;
            let login = LoginSecret {
                website_url: self.saved.to_owned(),
                username: "synthetic-account".to_owned(),
                password: "synthetic-password".to_owned(),
                notes: String::new(),
            };
            let candidates = [WebsiteLoginSaveCandidate {
                secret_id: &id,
                login: &login,
            }];
            let decision = WebsiteLoginSaveRequest {
                origin: self.requesting,
                username: "synthetic-account",
                password: "synthetic-password",
                candidates: &candidates,
            }
            .decide();
            let expected_decision = match self.expected {
                LoginHostMatch::Matched => WebsiteLoginSaveDecision::AlreadySaved {
                    secret_id: id.clone(),
                },
                LoginHostMatch::Unmatched => WebsiteLoginSaveDecision::Create,
            };
            assert_eq!(decision, expected_decision);
            let record = SecretRecord {
                id: id.clone(),
                secret_type: SecretType::Login,
                data: SecretValue::Login(login),
            };
            let keys = VaultKeys::generate()?;
            let crypto = VaultCrypto::new(&keys.secrets_key)?;
            let ciphertext = crypto.encrypt_value(record.data.to_yaml()?.as_str())?;
            let records = HashMap::from([(
                id,
                (
                    SecretType::Login,
                    StoredRecordPayload::from_age_armored(ciphertext),
                ),
            )]);
            let mut catalog = SecretSearchCatalog::default();
            catalog.reconcile(&records, &crypto, &keys.secrets_key)?;
            let accounts =
                catalog.matching_login_accounts(&LoginWebsiteHost::try_from(self.requesting)?);
            let origin = FocusedLoginFillOrigin::try_from(self.requesting.to_owned())?;
            let focused = FocusedLoginFillProjection {
                record,
                origin: &origin,
                credential: CredentialKind::CurrentPassword,
            }
            .reveal();
            match self.expected {
                LoginHostMatch::Matched => {
                    let [account] = accounts.as_slice() else {
                        anyhow::bail!("expected one synthetic login");
                    };
                    assert_eq!(String::from(account.website_url.clone()), self.saved);
                    assert_eq!(focused?.as_str(), "synthetic-password");
                    assert!(
                        LoginHostMatchRequest {
                            website_url: self.saved,
                            origin: self.requesting
                        }
                        .assess()
                            == LoginHostMatch::Matched
                    );
                }
                LoginHostMatch::Unmatched => {
                    assert!(accounts.is_empty());
                    assert!(matches!(
                        focused,
                        Err(FocusedLoginFillError::OriginMismatch)
                    ));
                    assert!(
                        LoginHostMatchRequest {
                            website_url: self.saved,
                            origin: self.requesting
                        }
                        .assess()
                            == LoginHostMatch::Unmatched
                    );
                }
            }
            Ok(())
        }
    }

    #[test]
    fn registrable_domain_policy_is_symmetric_across_shared_consumers() -> anyhow::Result<()> {
        for case in [
            LoginSiteCase {
                saved: "https://example.com/login",
                requesting: "https://arbitrary.example.com",
                expected: LoginHostMatch::Matched,
            },
            LoginSiteCase {
                saved: "https://one.example.co.uk/login",
                requesting: "https://two.example.co.uk",
                expected: LoginHostMatch::Matched,
            },
            LoginSiteCase {
                saved: "https://one.tenant.github.io/login",
                requesting: "https://two.tenant.github.io",
                expected: LoginHostMatch::Matched,
            },
            LoginSiteCase {
                saved: "https://a.github.io/login",
                requesting: "https://b.github.io",
                expected: LoginHostMatch::Unmatched,
            },
            LoginSiteCase {
                saved: "https://www.github.io/login",
                requesting: "https://github.io",
                expected: LoginHostMatch::Unmatched,
            },
            LoginSiteCase {
                saved: "https://www.github.io/login",
                requesting: "https://login.www.github.io",
                expected: LoginHostMatch::Matched,
            },
            LoginSiteCase {
                saved: "https://a.blogspot.com/login",
                requesting: "https://b.blogspot.com",
                expected: LoginHostMatch::Unmatched,
            },
            LoginSiteCase {
                saved: "https://a.appspot.com/login",
                requesting: "https://b.appspot.com",
                expected: LoginHostMatch::Unmatched,
            },
            LoginSiteCase {
                saved: "https://a.foo.ck/login",
                requesting: "https://b.foo.ck",
                expected: LoginHostMatch::Unmatched,
            },
            LoginSiteCase {
                saved: "https://a.www.ck/login",
                requesting: "https://b.www.ck",
                expected: LoginHostMatch::Matched,
            },
            LoginSiteCase {
                saved: "https://a.city.kawasaki.jp/login",
                requesting: "https://b.city.kawasaki.jp",
                expected: LoginHostMatch::Matched,
            },
            LoginSiteCase {
                saved: "https://a.example.nookunknown/login",
                requesting: "https://b.example.nookunknown",
                expected: LoginHostMatch::Matched,
            },
            LoginSiteCase {
                saved: "https://a.device.local/login",
                requesting: "https://b.device.local",
                expected: LoginHostMatch::Matched,
            },
            LoginSiteCase {
                saved: "http://localhost:80/login",
                requesting: "http://localhost:90",
                expected: LoginHostMatch::Matched,
            },
            LoginSiteCase {
                saved: "http://localhost/login",
                requesting: "http://child.localhost",
                expected: LoginHostMatch::Unmatched,
            },
            LoginSiteCase {
                saved: "http://127.0.0.1/login",
                requesting: "http://127.0.0.2",
                expected: LoginHostMatch::Unmatched,
            },
            LoginSiteCase {
                saved: "http://[::1]/login",
                requesting: "http://[0:0:0:0:0:0:0:1]:90",
                expected: LoginHostMatch::Matched,
            },
            LoginSiteCase {
                saved: "http://[::1]/login",
                requesting: "http://[::2]",
                expected: LoginHostMatch::Unmatched,
            },
            LoginSiteCase {
                saved: "https://bücher.de/login",
                requesting: "https://login.xn--bcher-kva.de",
                expected: LoginHostMatch::Matched,
            },
            LoginSiteCase {
                saved: "https://EXAMPLE.COM./login?x=1#fragment",
                requesting: "https://example.com",
                expected: LoginHostMatch::Matched,
            },
            LoginSiteCase {
                saved: "https://example.com/login",
                requesting: "https://example.com.evil.org",
                expected: LoginHostMatch::Unmatched,
            },
            LoginSiteCase {
                saved: "https://example.com/login",
                requesting: "https://evil-example.com",
                expected: LoginHostMatch::Unmatched,
            },
            LoginSiteCase {
                saved: "https://co.uk/login",
                requesting: "https://example.co.uk",
                expected: LoginHostMatch::Unmatched,
            },
            LoginSiteCase {
                saved: "https://microsoft.com/login",
                requesting: "https://login.microsoftonline.com",
                expected: LoginHostMatch::Unmatched,
            },
            LoginSiteCase {
                saved: "https://vk.ru/login",
                requesting: "https://vk.com",
                expected: LoginHostMatch::Unmatched,
            },
        ] {
            case.assert_consumers()?;
            LoginSiteCase {
                saved: case.requesting,
                requesting: case.saved,
                expected: case.expected,
            }
            .assert_consumers()?;
        }
        Ok(())
    }

    #[test]
    fn malformed_dns_is_rejected_before_exact_or_psl_matching() {
        for raw in [
            "",
            "https://",
            "https://example..com",
            "https://example.com..",
            "https://-example.com",
            "https://example-.com",
            "https://under_score.example.com",
            "https://example.com:invalid",
        ] {
            assert!(LoginWebsiteHost::try_from(raw).is_err());
            assert!(
                LoginHostMatchRequest {
                    website_url: raw,
                    origin: raw
                }
                .assess()
                    == LoginHostMatch::Unmatched
            );
        }
    }
}
