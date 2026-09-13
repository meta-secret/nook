pub struct DeliveryCommand<'scan> {
    pub repository: &'scan Path,
    pub arguments: &'scan [&'scan str],
}
use std::path::Path;
use std::process::Stdio;

use tokio::process::Command;

use crate::HiveContext;

impl DeliveryCommand<'_> {
    pub async fn gh_output(self) -> crate::HiveResult<String> {
        let Self {
            repository,
            arguments,
        } = self;
        let output = Command::new("gh")
            .args(arguments)
            .current_dir(repository)
            .stdin(Stdio::null())
            .output()
            .await
            .hive_context("failed to execute gh")?;
        if !output.status.success() {
            return Err(crate::HiveError::message(format!(
                "gh {:?} failed with status {}",
                arguments, output.status
            )));
        }
        String::from_utf8(output.stdout)
            .hive_context("gh output is not UTF-8")
            .map(|value| value.trim().to_owned())
    }
}

impl DeliveryCommand<'_> {
    fn isolated_git(repository: &Path, arguments: &[&str]) -> Command {
        let mut command = Command::new("git");
        command
            .args(arguments)
            .current_dir(repository)
            .env("GIT_NO_REPLACE_OBJECTS", "1")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .env("GIT_CONFIG_GLOBAL", "/dev/null");
        command
    }

    pub(super) async fn git_output(
        repository: &Path,
        arguments: &[&str],
    ) -> crate::HiveResult<String> {
        let output = Self::isolated_git(repository, arguments)
            .stdin(Stdio::null())
            .output()
            .await
            .hive_context("failed to execute git")?;
        if !output.status.success() {
            return Err(crate::HiveError::message(format!(
                "git {:?} failed with status {}",
                arguments, output.status
            )));
        }
        String::from_utf8(output.stdout)
            .hive_context("git output is not UTF-8")
            .map(|value| value.trim().to_owned())
    }
}

impl DeliveryCommand<'_> {
    pub(super) async fn run_git_status(
        repository: &Path,
        arguments: &[&str],
        operation: &str,
    ) -> crate::HiveResult<()> {
        let status = Self::isolated_git(repository, arguments)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .status()
            .await
            .with_hive_context(|| format!("failed to {operation}"))?;
        if !status.success() {
            return Err(crate::HiveError::message(format!(
                "{operation} failed with status {status}"
            )));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::DeliveryCommand;

    #[tokio::test]
    async fn git_helpers_preserve_output_and_reject_failed_commands() -> crate::HiveResult<()> {
        let repository = tempfile::tempdir()?;
        DeliveryCommand::run_git_status(
            repository.path(),
            &["init", "--quiet"],
            "initialize fixture",
        )
        .await?;
        let inside =
            DeliveryCommand::git_output(repository.path(), &["rev-parse", "--is-inside-work-tree"])
                .await?;
        assert_eq!(inside, "true");

        let Err(failure) = DeliveryCommand::git_output(
            repository.path(),
            &["rev-parse", "--verify", "missing-ref"],
        )
        .await
        else {
            return Err(crate::HiveError::message(
                "missing revision unexpectedly resolved",
            ));
        };
        assert!(failure.to_string().contains("git"));
        assert!(failure.to_string().contains("failed with status"));

        let Err(failure) = DeliveryCommand::run_git_status(
            repository.path(),
            &["checkout", "--detach", "missing-ref"],
            "detach missing revision",
        )
        .await
        else {
            return Err(crate::HiveError::message(
                "failed git status unexpectedly succeeded",
            ));
        };
        assert!(
            failure
                .to_string()
                .contains("detach missing revision failed")
        );
        Ok(())
    }
}
