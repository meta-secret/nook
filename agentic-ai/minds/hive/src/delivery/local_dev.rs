use std::path::Path;

use super::command::DeliveryCommand;
use crate::model::GitSha;

pub(super) struct LocalDevEvidence<'a> {
    pub(super) repository: &'a Path,
    pub(super) origin_main_sha: &'a GitSha,
    pub(super) pinned_local_dev_sha: &'a GitSha,
    pub(super) observed_feature_head_sha: &'a GitSha,
    pub(super) local_dev_sha: &'a GitSha,
}

impl LocalDevEvidence<'_> {
    pub(super) async fn validate(self) -> crate::HiveResult<()> {
        let Self {
            repository,
            origin_main_sha,
            pinned_local_dev_sha,
            observed_feature_head_sha,
            local_dev_sha,
        } = self;
        let origin_main_sha = origin_main_sha.as_str();
        let pinned_local_dev_sha = pinned_local_dev_sha.as_str();
        let observed_feature_head_sha = observed_feature_head_sha.as_str();
        let local_dev_sha = local_dev_sha.as_str();
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
            &[
                "merge-base",
                "--is-ancestor",
                pinned_local_dev_sha,
                observed_feature_head_sha,
            ],
            "verify the observed feature branch head descends from the pinned local-dev base",
        )
        .await
        .map_err(|error| {
            crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: observed feature branch head {observed_feature_head_sha} is not a fast-forward descendant of pinnedLocalDevSha {pinned_local_dev_sha}: {error}"
            ))
        })?;
        DeliveryCommand::run_git_status(
            repository,
            &[
                "merge-base",
                "--is-ancestor",
                observed_feature_head_sha,
                local_dev_sha,
            ],
            "verify serialized local-dev landing contains the observed feature branch head",
        )
        .await
        .map_err(|error| {
            crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: serialized local-dev head {local_dev_sha} does not contain observed feature branch head {observed_feature_head_sha}: {error}"
            ))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::LocalDevEvidence;
    use crate::HiveResult;
    use crate::model::GitSha;
    use std::fs;
    use std::path::Path;
    use std::process::Command;

    struct LocalDevFixture {
        repository: tempfile::TempDir,
    }

    impl LocalDevFixture {
        fn new() -> HiveResult<Self> {
            let fixture = Self {
                repository: tempfile::tempdir()?,
            };
            fixture.configure()?;
            Ok(fixture)
        }

        fn path(&self) -> &Path {
            self.repository.path()
        }

        fn git(&self, arguments: &[&str]) -> HiveResult<String> {
            let output = Command::new("git")
                .args(arguments)
                .current_dir(self.path())
                .env("GIT_NO_REPLACE_OBJECTS", "1")
                .env("GIT_CONFIG_NOSYSTEM", "1")
                .env("GIT_CONFIG_SYSTEM", "/dev/null")
                .env("GIT_CONFIG_GLOBAL", "/dev/null")
                .output()?;
            if !output.status.success() {
                return Err(crate::HiveError::message(format!(
                    "local-dev fixture git {arguments:?} failed with {}",
                    output.status
                )));
            }
            Ok(String::from_utf8(output.stdout)?.trim().to_owned())
        }

        fn configure(&self) -> HiveResult<()> {
            self.git(&["init", "--quiet"])?;
            self.git(&["config", "user.name", "Hive Test"])?;
            self.git(&["config", "user.email", "hive@example.invalid"])?;
            Ok(())
        }
    }

    #[tokio::test]
    async fn local_dev_accepts_an_exact_feature_landing_after_pinned_base() -> HiveResult<()> {
        let fixture = LocalDevFixture::new()?;
        fs::write(fixture.path().join("repair.txt"), "base\n")?;
        fixture.git(&["add", "repair.txt"])?;
        fixture.git(&["commit", "--quiet", "-m", "base"])?;
        let base_sha = fixture.git(&["rev-parse", "HEAD"])?;
        fixture.git(&["branch", "dev"])?;
        fixture.git(&["checkout", "--quiet", "-b", "codex/hive-repair"])?;
        fs::write(fixture.path().join("repair.txt"), "base\nrepair\n")?;
        fixture.git(&["add", "repair.txt"])?;
        fixture.git(&["commit", "--quiet", "-m", "repair"])?;
        let feature_sha = fixture.git(&["rev-parse", "HEAD"])?;
        fixture.git(&["checkout", "--quiet", "dev"])?;
        fixture.git(&["merge", "--quiet", "--ff-only", "codex/hive-repair"])?;
        let dev_sha = fixture.git(&["rev-parse", "dev"])?;
        let origin_main_sha = GitSha::try_from(base_sha.as_str())?;
        let pinned_local_dev_sha = GitSha::try_from(base_sha.as_str())?;
        let feature_sha = GitSha::try_from(feature_sha.as_str())?;
        let local_dev_sha = GitSha::try_from(dev_sha.as_str())?;

        LocalDevEvidence {
            repository: fixture.path(),
            origin_main_sha: &origin_main_sha,
            pinned_local_dev_sha: &pinned_local_dev_sha,
            observed_feature_head_sha: &feature_sha,
            local_dev_sha: &local_dev_sha,
        }
        .validate()
        .await?;
        Ok(())
    }

    #[tokio::test]
    async fn local_dev_rejects_a_pinned_base_without_feature_landing() -> HiveResult<()> {
        let fixture = LocalDevFixture::new()?;
        fs::write(fixture.path().join("repair.txt"), "base\n")?;
        fixture.git(&["add", "repair.txt"])?;
        fixture.git(&["commit", "--quiet", "-m", "base"])?;
        let base_sha = fixture.git(&["rev-parse", "HEAD"])?;
        fixture.git(&["checkout", "--quiet", "-b", "codex/hive-repair"])?;
        fs::write(fixture.path().join("repair.txt"), "base\nrepair\n")?;
        fixture.git(&["add", "repair.txt"])?;
        fixture.git(&["commit", "--quiet", "-m", "repair"])?;
        let feature_sha = fixture.git(&["rev-parse", "HEAD"])?;

        let origin_main_sha = GitSha::try_from(base_sha.as_str())?;
        let pinned_local_dev_sha = GitSha::try_from(base_sha.as_str())?;
        let feature_sha = GitSha::try_from(feature_sha.as_str())?;
        let local_dev_sha = GitSha::try_from(base_sha.as_str())?;

        let error = LocalDevEvidence {
            repository: fixture.path(),
            origin_main_sha: &origin_main_sha,
            pinned_local_dev_sha: &pinned_local_dev_sha,
            observed_feature_head_sha: &feature_sha,
            local_dev_sha: &local_dev_sha,
        }
        .validate()
        .await
        .err()
        .ok_or_else(|| crate::HiveError::message("unlanded feature was accepted"))?;
        assert!(error.to_string().contains("serialized local-dev head"));
        Ok(())
    }

    #[tokio::test]
    async fn local_dev_requires_the_bootstrap_chain_and_landed_head() -> HiveResult<()> {
        let fixture = LocalDevFixture::new()?;
        fs::write(fixture.path().join("repair.txt"), "base\n")?;
        fixture.git(&["add", "repair.txt"])?;
        fixture.git(&["commit", "--quiet", "-m", "base"])?;
        let feature_sha = fixture.git(&["rev-parse", "HEAD"])?;
        let origin_main_sha = GitSha::try_from("ffffffffffffffffffffffffffffffffffffffff")?;
        let pinned_local_dev_sha = GitSha::try_from(feature_sha.as_str())?;
        let feature_sha = GitSha::try_from(feature_sha.as_str())?;
        let local_dev_sha = GitSha::try_from(feature_sha.as_str())?;

        let error = LocalDevEvidence {
            repository: fixture.path(),
            origin_main_sha: &origin_main_sha,
            pinned_local_dev_sha: &pinned_local_dev_sha,
            observed_feature_head_sha: &feature_sha,
            local_dev_sha: &local_dev_sha,
        }
        .validate()
        .await
        .err()
        .ok_or_else(|| crate::HiveError::message("missing local dev ref was accepted"))?;
        assert!(
            error
                .to_string()
                .contains("originMainSha is not an ancestor")
        );
        Ok(())
    }
}
