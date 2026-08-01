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
