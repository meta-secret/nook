#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use std::fmt;

use super::{DEFAULT_GITHUB_REPO_NAME, ValidationError, ValidationResult};

/// Validated GitHub personal access token.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct GithubPat(String);

impl GithubPat {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Err(ValidationError::GithubPatEmpty);
        }
        Ok(Self(trimmed.to_owned()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(self) -> String {
        self.0
    }

    #[must_use]
    pub fn mask(raw: &str) -> GithubPatMask {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return GithubPatMask::NoToken;
        }
        let prefix_len = if trimmed.starts_with("github_pat_") {
            GITHUB_PAT_FINE_GRAINED_HINT_LEN
        } else {
            GITHUB_PAT_CLASSIC_HINT_LEN
        };
        if trimmed.chars().count() <= prefix_len {
            return GithubPatMask::Hint(GITHUB_PAT_FULLY_HIDDEN.to_owned());
        }
        let hint: String = trimmed.chars().take(prefix_len).collect();
        GithubPatMask::Hint(format!("{hint}…"))
    }
}

impl fmt::Display for GithubPat {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl AsRef<str> for GithubPat {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

/// Safe display form of a stored GitHub PAT for provider lists.
///
/// Two real states, named rather than smuggled through `Option`/empty strings:
/// there is either no usable token, or a token truncated to a prefix hint that
/// never reveals the full secret.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GithubPatMask {
    /// No token is saved (or it is blank). UI supplies the localized copy.
    NoToken,
    /// The token, truncated to a leading hint (e.g. `github_pat_11A…`).
    Hint(String),
}

/// Fully hidden fallback used when even the prefix would leak too much.
const GITHUB_PAT_FULLY_HIDDEN: &str = "••••";

/// Number of leading characters kept as a recognizability hint. Fine-grained
/// (`github_pat_`) tokens keep a longer prefix than classic (`ghp_…`) ones so
/// the token family is still distinguishable without exposing the secret.
const GITHUB_PAT_FINE_GRAINED_HINT_LEN: usize = 14;
const GITHUB_PAT_CLASSIC_HINT_LEN: usize = 10;

/// Validated GitHub repository name (not `owner/name`).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct GithubRepoName(String);

impl GithubRepoName {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let repo = if raw.trim().is_empty() {
            DEFAULT_GITHUB_REPO_NAME.to_owned()
        } else {
            raw.trim().to_owned()
        };
        if repo.len() > 100 {
            return Err(ValidationError::GithubRepoLength);
        }
        if repo == "." || repo == ".." {
            return Err(ValidationError::GithubRepoInvalid);
        }
        if !repo
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
        {
            return Err(ValidationError::GithubRepoChars);
        }
        Ok(Self(repo))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_inner(self) -> String {
        self.0
    }
}

impl fmt::Display for GithubRepoName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl AsRef<str> for GithubRepoName {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_github_repo_name_defaults_and_rejects_invalid() -> anyhow::Result<()> {
        assert_eq!(
            GithubRepoName::parse("  ")?.as_str(),
            DEFAULT_GITHUB_REPO_NAME
        );
        assert_eq!(GithubRepoName::parse("work-vault")?.as_str(), "work-vault");
        assert!(GithubRepoName::parse(".").is_err());
        assert!(GithubRepoName::parse("bad name").is_err());
        Ok(())
    }

    #[test]
    fn mask_github_pat_named_states() {
        assert_eq!(GithubPat::mask("   "), GithubPatMask::NoToken);
        assert_eq!(GithubPat::mask(""), GithubPatMask::NoToken);
        assert_eq!(
            GithubPat::mask("github_pat_11AAAAAAAAAA"),
            GithubPatMask::Hint("github_pat_11A…".to_owned())
        );
        assert_eq!(
            GithubPat::mask("ghp_1234567890ABCDEF"),
            GithubPatMask::Hint("ghp_123456…".to_owned())
        );
        assert_eq!(
            GithubPat::mask("ghp_short"),
            GithubPatMask::Hint("••••".to_owned())
        );
    }
}
