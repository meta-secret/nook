use super::{DEFAULT_GITHUB_REPO_NAME, ValidationError, ValidationResult};

/// Validated GitHub personal access token.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct GithubPat(String);

impl GithubPat {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        validate_github_pat(raw)
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

impl std::fmt::Display for GithubPat {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
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

/// Mask a stored GitHub PAT for display. Returns a named two-state result so
/// callers pattern-match on "no token" vs "hint" instead of guessing from a
/// sentinel string.
#[must_use]
pub fn mask_github_pat(pat: &str) -> GithubPatMask {
    let trimmed = pat.trim();
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

/// Validated GitHub repository name (not `owner/name`).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct GithubRepoName(String);

impl GithubRepoName {
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        validate_github_repo_name(raw)
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

impl std::fmt::Display for GithubRepoName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl AsRef<str> for GithubRepoName {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

pub fn validate_github_pat(pat: &str) -> ValidationResult<GithubPat> {
    let trimmed = pat.trim();
    if trimmed.is_empty() {
        return Err(ValidationError::GithubPatEmpty);
    }
    Ok(GithubPat(trimmed.to_owned()))
}

/// Validates a GitHub repository name (not `owner/name`). Empty uses [`DEFAULT_GITHUB_REPO_NAME`].
pub fn validate_github_repo_name(name: &str) -> ValidationResult<GithubRepoName> {
    let repo = if name.trim().is_empty() {
        DEFAULT_GITHUB_REPO_NAME.to_owned()
    } else {
        name.trim().to_owned()
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
    Ok(GithubRepoName(repo))
}
