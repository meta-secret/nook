//! Decide whether a captured website login should be created, updated, or skipped.
//!
//! Browser companions capture username/password only after a form submit and ask
//! this module which vault write, if any, is appropriate. Secrets never leave the
//! Rust/WASM boundary except as a one-shot capture payload for an explicit Save.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::{LoginHostMatch, LoginHostMatchRequest, LoginSecret, LoginWebsiteHost, SecretId};

/// Candidate login already stored for the requesting origin.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct WebsiteLoginSaveCandidate<'a> {
    pub secret_id: &'a SecretId,
    pub login: &'a LoginSecret,
}

/// Named request for the website-login save policy.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct WebsiteLoginSaveRequest<'a> {
    pub origin: &'a str,
    pub username: &'a str,
    pub password: &'a str,
    pub candidates: &'a [WebsiteLoginSaveCandidate<'a>],
}

/// Policy outcome for a consented website-login save offer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WebsiteLoginSaveDecision {
    /// No matching login exists; create a new secret.
    Create,
    /// Same host + username exists with a different password; replace it.
    Update { secret_id: SecretId },
    /// Exact login already stored; do not offer another write.
    AlreadySaved { secret_id: SecretId },
    /// Username or password missing/invalid for a durable login record.
    Invalid,
}

impl WebsiteLoginSaveDecision {
    #[must_use]
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Create => "create",
            Self::Update { .. } => "update",
            Self::AlreadySaved { .. } => "already-saved",
            Self::Invalid => "invalid",
        }
    }
}

impl WebsiteLoginSaveRequest<'_> {
    /// Decide create / update / already-saved / invalid for a captured login.
    ///
    /// `candidates` should already be filtered to the requesting origin when
    /// possible; host matching is still enforced here as a defense in depth.
    #[expect(
        clippy::match_bool,
        reason = "existing scalar credential comparisons are consumed through native patterns in the save decision"
    )]
    #[must_use]
    pub fn decide(&self) -> WebsiteLoginSaveDecision {
        let username = self.username.trim();
        let password = self.password;
        match username.is_empty() || password.is_empty() {
            true => return WebsiteLoginSaveDecision::Invalid,
            false => {}
        }
        let Ok(_) = LoginWebsiteHost::try_from(self.origin) else {
            return WebsiteLoginSaveDecision::Invalid;
        };

        let mut decision = WebsiteLoginSaveDecision::Create;
        for candidate in self.candidates {
            match (LoginHostMatchRequest {
                website_url: &candidate.login.website_url,
                origin: self.origin,
            })
            .assess()
            {
                LoginHostMatch::Matched => {}
                LoginHostMatch::Unmatched => continue,
            }
            match candidate.login.username.trim() == username {
                true => {}
                false => continue,
            }
            decision = WebsiteLoginSaveDecision::Update {
                secret_id: candidate.secret_id.clone(),
            };
            match candidate.login.password == password {
                true => {
                    return WebsiteLoginSaveDecision::AlreadySaved {
                        secret_id: candidate.secret_id.clone(),
                    };
                }
                false => {}
            }
        }

        decision
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SecretId;

    fn secret_id(label: &str) -> anyhow::Result<SecretId> {
        Ok(crate::SecretId::parse(&format!(
            "secret_SMypl8K0w9{label}"
        ))?)
    }

    fn decide_website_login_save(
        origin: &str,
        username: &str,
        password: &str,
        candidates: &[WebsiteLoginSaveCandidate<'_>],
    ) -> WebsiteLoginSaveDecision {
        WebsiteLoginSaveRequest {
            origin,
            username,
            password,
            candidates,
        }
        .decide()
    }

    fn login(website_url: &str, username: &str, password: &str) -> LoginSecret {
        LoginSecret {
            website_url: website_url.to_owned(),
            username: username.to_owned(),
            password: password.to_owned(),
            notes: String::new(),
        }
    }

    #[test]
    fn rejects_blank_username_or_password() -> anyhow::Result<()> {
        let id = secret_id("a")?;
        let existing = login("https://example.com", "alice", "old");
        let candidates = [WebsiteLoginSaveCandidate {
            secret_id: &id,
            login: &existing,
        }];
        assert_eq!(
            decide_website_login_save("https://example.com", "  ", "password", &candidates),
            WebsiteLoginSaveDecision::Invalid
        );
        assert_eq!(
            decide_website_login_save("https://example.com", "alice", "", &candidates),
            WebsiteLoginSaveDecision::Invalid
        );
        Ok(())
    }

    #[test]
    fn creates_when_no_matching_username_for_origin() -> anyhow::Result<()> {
        let id = secret_id("b")?;
        let existing = login("https://other.example", "alice", "old");
        let candidates = [WebsiteLoginSaveCandidate {
            secret_id: &id,
            login: &existing,
        }];
        assert_eq!(
            decide_website_login_save(
                "https://example.com",
                "alice@nook.test",
                "new-password",
                &candidates
            ),
            WebsiteLoginSaveDecision::Create
        );
        Ok(())
    }

    #[test]
    fn updates_when_username_matches_with_different_password() -> anyhow::Result<()> {
        let id = secret_id("c")?;
        let existing = login("https://www.example.com/login", "alice", "old-password");
        let candidates = [WebsiteLoginSaveCandidate {
            secret_id: &id,
            login: &existing,
        }];
        assert_eq!(
            decide_website_login_save("https://example.com", "alice", "new-password", &candidates),
            WebsiteLoginSaveDecision::Update {
                secret_id: id.clone()
            }
        );
        Ok(())
    }

    #[test]
    fn skips_when_exact_login_already_saved() -> anyhow::Result<()> {
        let id = secret_id("d")?;
        let existing = login("https://example.com", "alice", "same-password");
        let candidates = [WebsiteLoginSaveCandidate {
            secret_id: &id,
            login: &existing,
        }];
        assert_eq!(
            decide_website_login_save("https://example.com", "alice", "same-password", &candidates),
            WebsiteLoginSaveDecision::AlreadySaved {
                secret_id: id.clone()
            }
        );
        Ok(())
    }

    #[test]
    fn rejects_empty_origin() {
        assert_eq!(
            decide_website_login_save("", "alice", "password", &[]),
            WebsiteLoginSaveDecision::Invalid
        );
    }

    #[test]
    fn compares_password_bytes_without_trimming() -> anyhow::Result<()> {
        let id = secret_id("e")?;
        let existing = login("https://example.com", "alice", " password ");
        let candidates = [WebsiteLoginSaveCandidate {
            secret_id: &id,
            login: &existing,
        }];
        assert_eq!(
            decide_website_login_save("https://example.com", "alice", " password ", &candidates),
            WebsiteLoginSaveDecision::AlreadySaved {
                secret_id: id.clone()
            }
        );
        assert_eq!(
            decide_website_login_save("https://example.com", "alice", "password", &candidates),
            WebsiteLoginSaveDecision::Update { secret_id: id }
        );
        Ok(())
    }

    #[test]
    fn whitespace_password_is_a_nonempty_credential() {
        assert_eq!(
            decide_website_login_save("https://example.com", "alice", " ", &[]),
            WebsiteLoginSaveDecision::Create
        );
    }
}
