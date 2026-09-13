use std::path::Path;

use super::command::DeliveryCommand;
use crate::model::GitSha;

pub(super) struct LocalDevEvidence<'a> {
    pub(super) repository: &'a Path,
    pub(super) origin_main_sha: &'a GitSha,
    pub(super) pinned_local_dev_sha: &'a GitSha,
    pub(super) feature_sha: &'a GitSha,
}

impl LocalDevEvidence<'_> {
    pub(super) async fn validate(self) -> crate::HiveResult<()> {
        let Self {
            repository,
            origin_main_sha,
            pinned_local_dev_sha,
            feature_sha,
        } = self;
        let origin_main_sha = origin_main_sha.as_str();
        let pinned_local_dev_sha = pinned_local_dev_sha.as_str();
        let feature_sha = feature_sha.as_str();
        DeliveryCommand::run_git_status(
            repository,
            &["merge-base", "--is-ancestor", origin_main_sha, pinned_local_dev_sha],
            "verify originMainSha is an ancestor of pinnedLocalDevSha",
        )
        .await
        .map_err(|error| {
            crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: originMainSha is not an ancestor of pinnedLocalDevSha: {error}"
            ))
        })?;
        DeliveryCommand::run_git_status(
            repository,
            &["merge-base", "--is-ancestor", pinned_local_dev_sha, feature_sha],
            "verify serialized local-dev fast-forward contains the exact feature head",
        )
        .await
        .map_err(|error| {
            crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: feature head {feature_sha} is not a fast-forward descendant of pinnedLocalDevSha {pinned_local_dev_sha}: {error}"
            ))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::LocalDevEvidence;
    use crate::model::GitSha;
    use crate::HiveResult;
    use std::fs;
    use std::path::Path;
    use std::process::Command;

    fn git(repository: &Path, arguments: &[&str]) -> HiveResult<String> {
        let output = Command::new("git")
            .args(arguments)
            .current_dir(repository)
            .output()?;
        if !output.status.success() {
            return Err(crate::HiveError::message(format!(
                "local-dev fixture git {arguments:?} failed with {}",
                output.status
            )));
        }
        Ok(String::from_utf8(output.stdout)?.trim().to_owned())
    }

    fn configure(repository: &Path) -> HiveResult<()> {
        git(repository, &["init", "--quiet"])?;
        git(repository, &["config", "user.name", "Hive Test"])?;
        git(
            repository,
            &["config", "user.email", "hive@example.invalid"],
        )?;
        Ok(())
    }

    #[tokio::test]
    async fn local_dev_accepts_an_exact_feature_ancestor() -> HiveResult<()> {
        let repository = tempfile::tempdir()?;
        configure(repository.path())?;
        fs::write(repository.path().join("repair.txt"), "base\n")?;
        git(repository.path(), &["add", "repair.txt"])?;
        git(repository.path(), &["commit", "--quiet", "-m", "base"])?;
        let base_sha = git(repository.path(), &["rev-parse", "HEAD"])?;
        git(repository.path(), &["branch", "dev"])?;
        git(repository.path(), &["checkout", "--quiet", "-b", "codex/hive-repair"])?;
        fs::write(repository.path().join("repair.txt"), "base\nrepair\n")?;
        git(repository.path(), &["add", "repair.txt"])?;
        git(repository.path(), &["commit", "--quiet", "-m", "repair"])?;
        let feature_sha = git(repository.path(), &["rev-parse", "HEAD"])?;
        git(repository.path(), &["checkout", "--quiet", "dev"])?;
        git(
            repository.path(),
            &["merge", "--quiet", "--ff-only", "codex/hive-repair"],
        )?;
        let dev_sha = git(repository.path(), &["rev-parse", "dev"])?;
        let origin_main_sha = GitSha::try_from(base_sha.as_str())?;
        let pinned_local_dev_sha = GitSha::try_from(dev_sha.as_str())?;
        let feature_sha = GitSha::try_from(feature_sha.as_str())?;

        LocalDevEvidence {
            repository: repository.path(),
            origin_main_sha: &origin_main_sha,
            pinned_local_dev_sha: &pinned_local_dev_sha,
            feature_sha: &feature_sha,
        }
        .validate()
        .await?;
        Ok(())
    }

    #[tokio::test]
    async fn local_dev_rejects_a_feature_not_descended_from_pinned_dev() -> HiveResult<()> {
        let repository = tempfile::tempdir()?;
        configure(repository.path())?;
        fs::write(repository.path().join("repair.txt"), "base\n")?;
        git(repository.path(), &["add", "repair.txt"])?;
        git(repository.path(), &["commit", "--quiet", "-m", "base"])?;
        let base_sha = git(repository.path(), &["rev-parse", "HEAD"])?;
        git(repository.path(), &["checkout", "--quiet", "-b", "codex/hive-repair"])?;
        fs::write(repository.path().join("repair.txt"), "base\nrepair\n")?;
        git(repository.path(), &["add", "repair.txt"])?;
        git(repository.path(), &["commit", "--quiet", "-m", "repair"])?;
        let feature_sha = git(repository.path(), &["rev-parse", "HEAD"])?;

        let other = tempfile::tempdir()?;
        configure(other.path())?;
        fs::write(other.path().join("repair.txt"), "other\n")?;
        git(other.path(), &["add", "repair.txt"])?;
        git(other.path(), &["commit", "--quiet", "-m", "other"])?;
        let dev_sha = git(other.path(), &["rev-parse", "HEAD"])?;
        let origin_main_sha = GitSha::try_from(base_sha.as_str())?;
        let pinned_local_dev_sha = GitSha::try_from(dev_sha.as_str())?;
        let feature_sha = GitSha::try_from(feature_sha.as_str())?;

        let error = LocalDevEvidence {
            repository: repository.path(),
            origin_main_sha: &origin_main_sha,
            pinned_local_dev_sha: &pinned_local_dev_sha,
            feature_sha: &feature_sha,
        }
        .validate()
        .await
        .err()
        .ok_or_else(|| crate::HiveError::message("unlanded feature was accepted"))?;
        assert!(error.to_string().contains("originMainSha is not an ancestor"));
        Ok(())
    }

    #[tokio::test]
    async fn local_dev_requires_the_three_pinned_commits() -> HiveResult<()> {
        let repository = tempfile::tempdir()?;
        configure(repository.path())?;
        fs::write(repository.path().join("repair.txt"), "base\n")?;
        git(repository.path(), &["add", "repair.txt"])?;
        git(repository.path(), &["commit", "--quiet", "-m", "base"])?;
        let feature_sha = git(repository.path(), &["rev-parse", "HEAD"])?;
        let origin_main_sha = GitSha::try_from(
            "ffffffffffffffffffffffffffffffffffffffff",
        )?;
        let pinned_local_dev_sha = GitSha::try_from(feature_sha.as_str())?;
        let feature_sha = GitSha::try_from(feature_sha.as_str())?;

        let error = LocalDevEvidence {
            repository: repository.path(),
            origin_main_sha: &origin_main_sha,
            pinned_local_dev_sha: &pinned_local_dev_sha,
            feature_sha: &feature_sha,
        }
        .validate()
        .await
        .err()
        .ok_or_else(|| crate::HiveError::message("missing local dev ref was accepted"))?;
        assert!(error.to_string().contains("originMainSha is not an ancestor"));
        Ok(())
    }
}
