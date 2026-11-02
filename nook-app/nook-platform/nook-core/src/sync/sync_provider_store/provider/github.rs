#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
//! A repository of the token's GitHub account.

use nook_event_log::IdentityMountTarget;
use serde::{Deserialize, Serialize};
use tsify::Tsify;

use crate::{
    DEFAULT_GITHUB_REPO_NAME, GithubPat, ProviderSecretText, ProviderTargetKey, StorageConnection,
    StoredGithubRepository,
};

/// A GitHub repository and the token that reaches it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GithubProvider {
    pub repository: StoredGithubRepository,
    pub token: ProviderSecretText,
}

impl StoredGithubRepository {
    /// The repository a row or a draft connects to: its name, or `nook`.
    #[must_use]
    pub fn name(&self) -> &str {
        match self {
            Self::Repository(name) if !name.trim().is_empty() => name.trim(),
            Self::Repository(_) | Self::DefaultRepository => DEFAULT_GITHUB_REPO_NAME,
        }
    }

    /// `GitHub · name`, or `GitHub` for the default repository.
    #[must_use]
    pub fn label(&self) -> String {
        match self.name() {
            DEFAULT_GITHUB_REPO_NAME => "GitHub".to_owned(),
            name => format!("GitHub · {name}"),
        }
    }
}

impl GithubProvider {
    /// The detail line: the repository and a hint of its token.
    #[must_use]
    pub fn storage_detail(&self) -> String {
        format!(
            "{} · {}",
            self.repository.name(),
            GithubPat::hint(&self.token)
        )
    }

    /// One repository of one token is one target; repository names compare
    /// without case.
    #[must_use]
    pub fn target_key(&self) -> ProviderTargetKey {
        format!(
            "github:{}:{}",
            self.repository.name().to_lowercase(),
            self.token.expose().trim()
        )
        .into()
    }

    #[must_use]
    pub fn mount_target(&self) -> IdentityMountTarget {
        IdentityMountTarget::Github {
            repository: self.repository.name().to_owned(),
        }
    }

    #[must_use]
    pub fn storage_connection(&self) -> StorageConnection {
        StorageConnection::Github {
            token: self.token.clone(),
            repo: self.repository.name().to_owned(),
        }
    }

    pub(crate) fn transition_secrets<E>(
        &self,
        mut transition: impl FnMut(&ProviderSecretText) -> Result<ProviderSecretText, E>,
    ) -> Result<Self, E> {
        Ok(Self {
            repository: self.repository.clone(),
            token: transition(&self.token)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::GithubProvider;
    use crate::{
        IdentityMountTarget, ProviderSecretText, StorageConnection, StoredGithubRepository,
    };

    impl GithubProvider {
        pub(crate) fn fixture(repository: &str, token: &str) -> anyhow::Result<Self> {
            Ok(Self {
                repository: StoredGithubRepository::Repository(repository.to_owned()),
                token: ProviderSecretText::try_from(token.to_owned())?,
            })
        }
    }

    #[test]
    fn a_repository_names_its_label_detail_key_and_mount() -> anyhow::Result<()> {
        let named = GithubProvider::fixture(" Team-Vault ", "github_pat_11AAAAAAAAAAAAAA")?;
        assert_eq!(named.repository.label(), "GitHub · Team-Vault");
        assert_eq!(named.storage_detail(), "Team-Vault · github_pat_11A…");
        assert_eq!(
            named.mount_target(),
            IdentityMountTarget::Github {
                repository: "Team-Vault".to_owned()
            }
        );
        assert_eq!(
            named.target_key(),
            GithubProvider::fixture("team-vault", "github_pat_11AAAAAAAAAAAAAA")?.target_key()
        );
        assert_ne!(
            named.target_key(),
            GithubProvider::fixture("team-vault", "ghp_other")?.target_key()
        );
        for default in [
            StoredGithubRepository::DefaultRepository,
            StoredGithubRepository::Repository(" ".to_owned()),
            StoredGithubRepository::Repository("nook".to_owned()),
        ] {
            assert_eq!(default.label(), "GitHub");
            assert_eq!(default.name(), "nook");
        }
        let StorageConnection::Github { token, repo } = named.storage_connection() else {
            anyhow::bail!("a GitHub row connects to GitHub");
        };
        assert_eq!(token.expose(), "github_pat_11AAAAAAAAAAAAAA");
        assert_eq!(repo, "Team-Vault");
        Ok(())
    }
}
