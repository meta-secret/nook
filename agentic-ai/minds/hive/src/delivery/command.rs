use std::path::Path;
use std::process::Stdio;

use tokio::process::Command;

use crate::HiveContext;

pub(super) async fn gh_output(repository: &Path, arguments: &[&str]) -> crate::HiveResult<String> {
    let output = Command::new("gh")
        .args(arguments)
        .current_dir(repository)
        .stdin(Stdio::null())
        .output()
        .await
        .hive_context("failed to execute gh")?;
    if !output.status.success() {
        return Err(crate::error::HiveError::message(format!(
            "gh {:?} failed with status {}",
            arguments, output.status
        )));
    }
    String::from_utf8(output.stdout)
        .hive_context("gh output is not UTF-8")
        .map(|value| value.trim().to_owned())
}

pub(super) async fn git_output(repository: &Path, arguments: &[&str]) -> crate::HiveResult<String> {
    let output = Command::new("git")
        .args(arguments)
        .current_dir(repository)
        .stdin(Stdio::null())
        .output()
        .await
        .hive_context("failed to execute git")?;
    if !output.status.success() {
        return Err(crate::error::HiveError::message(format!(
            "git {:?} failed with status {}",
            arguments, output.status
        )));
    }
    String::from_utf8(output.stdout)
        .hive_context("git output is not UTF-8")
        .map(|value| value.trim().to_owned())
}

pub(super) async fn run_git_status(
    repository: &Path,
    arguments: &[&str],
    operation: &str,
) -> crate::HiveResult<()> {
    let status = Command::new("git")
        .args(arguments)
        .current_dir(repository)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .status()
        .await
        .with_hive_context(|| format!("failed to {operation}"))?;
    if !status.success() {
        return Err(crate::error::HiveError::message(format!(
            "{operation} failed with status {status}"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{git_output, run_git_status};

    #[tokio::test]
    async fn git_helpers_preserve_output_and_reject_failed_commands() -> crate::HiveResult<()> {
        let repository = tempfile::tempdir()?;
        run_git_status(
            repository.path(),
            &["init", "--quiet"],
            "initialize fixture",
        )
        .await?;
        let inside = git_output(repository.path(), &["rev-parse", "--is-inside-work-tree"]).await?;
        assert_eq!(inside, "true");

        let failure = git_output(repository.path(), &["rev-parse", "--verify", "missing-ref"])
            .await
            .expect_err("missing revision must fail");
        assert!(failure.to_string().contains("git"));
        assert!(failure.to_string().contains("failed with status"));

        let failure = run_git_status(
            repository.path(),
            &["checkout", "--detach", "missing-ref"],
            "detach missing revision",
        )
        .await
        .expect_err("status helper must reject a failed command");
        assert!(
            failure
                .to_string()
                .contains("detach missing revision failed")
        );
        Ok(())
    }
}
