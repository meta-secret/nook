//! Decide whether a captured website login should be created, updated, or skipped.
//!
//! Browser companions capture username/password only after a form submit and ask
//! this module which vault write, if any, is appropriate. Secrets never leave the
//! Rust/WASM boundary except as a one-shot capture payload for an explicit Save.

use crate::{LoginSecret, SecretId, login_host_matches_origin};

/// Candidate login already stored for the requesting origin.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WebsiteLoginSaveCandidate<'a> {
    pub secret_id: &'a SecretId,
    pub login: &'a LoginSecret,
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

/// Decide create / update / already-saved / invalid for a captured login.
///
/// `candidates` should already be filtered to the requesting origin when
/// possible; host matching is still enforced here as a defense in depth.
#[must_use]
pub fn decide_website_login_save(
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
    if hostname_from_origin(origin).is_empty() {
        return WebsiteLoginSaveDecision::Invalid;
    }

    let mut matching_username: Option<&WebsiteLoginSaveCandidate<'_>> = None;
    for candidate in candidates {
        if !login_host_matches_origin(&candidate.login.website_url, origin) {
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

fn hostname_from_origin(origin: &str) -> String {
    crate::hostname_from_url(origin)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SecretId;

    fn secret_id(label: &str) -> SecretId {
        crate::validate_secret_id(label).expect("valid secret id")
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
    fn rejects_blank_username_or_password() {
        let id = secret_id("a");
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
    }

    #[test]
    fn creates_when_no_matching_username_for_origin() {
        let id = secret_id("b");
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
    }

    #[test]
    fn updates_when_username_matches_with_different_password() {
        let id = secret_id("c");
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
    }

    #[test]
    fn skips_when_exact_login_already_saved() {
        let id = secret_id("d");
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
    }

    #[test]
    fn rejects_empty_origin() {
        assert_eq!(
            decide_website_login_save("", "alice", "password", &[]),
            WebsiteLoginSaveDecision::Invalid
        );
    }
}
