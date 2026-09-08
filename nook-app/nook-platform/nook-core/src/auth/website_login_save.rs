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

use crate::secrets::secret_view::WebsiteHost;
use crate::{LoginHostMatchRequest, LoginSecret, SecretId};

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct WebsiteLoginSavePolicy;

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

impl<'a> WebsiteLoginSaveRequest<'a> {
    /// Decide create / update / already-saved / invalid for a captured login.
    ///
    /// `candidates` should already be filtered to the requesting origin when
    /// possible; host matching is still enforced here as a defense in depth.
    #[must_use]
    pub fn decide(&self) -> WebsiteLoginSaveDecision {
        WebsiteLoginSavePolicy::decide_parts(
            self.origin,
            self.username,
            self.password,
            self.candidates,
        )
    }
}

impl WebsiteLoginSavePolicy {
    pub(crate) fn decide_parts(
        origin: &str,
        username: &str,
        password: &str,
        candidates: &[WebsiteLoginSaveCandidate<'_>],
    ) -> WebsiteLoginSaveDecision {
        let username = username.trim();
        let password = password.trim();
        if username.is_empty() || password.is_empty() {
            return WebsiteLoginSaveDecision::Invalid;
        }
        if WebsiteHost::normalize(origin).is_empty() {
            return WebsiteLoginSaveDecision::Invalid;
        }

        let mut matching_username: Option<&WebsiteLoginSaveCandidate<'_>> = None;
        for candidate in candidates {
            if !(LoginHostMatchRequest {
                website_url: &candidate.login.website_url,
                origin,
            })
            .matches()
            {
                continue;
            }
            if candidate.login.username.trim() != username {
                continue;
            }
            matching_username = Some(candidate);
            if candidate.login.password == password {
                return WebsiteLoginSaveDecision::AlreadySaved {
                    secret_id: candidate.secret_id.clone(),
                };
            }
        }

        if let Some(candidate) = matching_username {
            return WebsiteLoginSaveDecision::Update {
                secret_id: candidate.secret_id.clone(),
            };
        }
        WebsiteLoginSaveDecision::Create
    }

    pub(crate) fn legacy_decide(
        origin: &str,
        username: &str,
        password: &str,
        candidates: &[WebsiteLoginSaveCandidate<'_>],
    ) -> WebsiteLoginSaveDecision {
        Self::decide_parts(origin, username, password, candidates)
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
}
