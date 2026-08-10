use std::path::Path;
use std::time::Duration;

use tokio::process::Command;

use crate::HiveContext;

pub(super) async fn sync_workbench_checkout(
    repository_url: &str,
    checkout: &Path,
) -> crate::HiveResult<String> {
    if checkout.join(".git").is_dir() {
        git(checkout, workbench_fetch_arguments()).await?;
        git(
            checkout,
            &["checkout", "--detach", "--force", "origin/main"],
        )
        .await?;
    } else {
        if checkout.exists() {
            return Err(crate::error::HiveError::message(format!(
                "Workbench checkout {} exists without Git metadata",
                checkout.display()
            )));
        }
        let parent = checkout
            .parent()
            .hive_context("Workbench checkout has no parent directory")?;
        tokio::fs::create_dir_all(parent).await?;
        let mut command = Command::new("git");
        command
            .args(workbench_git_transport_arguments())
            .args(["clone", "--depth=1", "--branch=main", "--"])
            .arg(repository_url)
            .arg(checkout);
        let output = bounded_command_output(command, "Workbench clone").await?;
        if !output.status.success() {
            return Err(crate::error::HiveError::message(format!(
                "Workbench clone failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }
        git(
            checkout,
            &["checkout", "--detach", "--force", "origin/main"],
        )
        .await?;
    }
    let local_main = git(checkout, &["branch", "--list", "main"]).await?;
    if !local_main.is_empty() {
        git(checkout, &["branch", "--delete", "--force", "main"]).await?;
    }
    git(checkout, &["reflog", "expire", "--expire=now", "--all"]).await?;
    git(checkout, workbench_cleanup_arguments()).await?;
    let output = git(checkout, &["rev-parse", "HEAD"]).await?;
    let revision = String::from_utf8(output)
        .hive_context("Workbench revision is not UTF-8")?
        .trim()
        .to_owned();
    if revision.len() != 40 || !revision.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(crate::error::HiveError::message(
            "Workbench checkout returned an invalid revision",
        ));
    }
    Ok(revision)
}

fn workbench_cleanup_arguments() -> &'static [&'static str] {
    &["gc", "--prune=now", "--no-detach"]
}

fn workbench_fetch_arguments() -> &'static [&'static str] {
    &[
        "fetch",
        "--no-auto-maintenance",
        "--depth=1",
        "origin",
        "+main:refs/remotes/origin/main",
    ]
}

async fn git(checkout: &Path, args: &[&str]) -> crate::HiveResult<Vec<u8>> {
    let mut command = Command::new("git");
    command
        .args(workbench_git_transport_arguments())
        .arg("-C")
        .arg(checkout)
        .args(args);
    let output = bounded_command_output(command, "Workbench Git operation").await?;
    if !output.status.success() {
        return Err(crate::error::HiveError::message(format!(
            "Workbench Git operation failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(output.stdout)
}

fn workbench_git_transport_arguments() -> &'static [&'static str] {
    &[
        "-c",
        "http.lowSpeedLimit=1",
        "-c",
        "http.lowSpeedTime=60",
        "-c",
        "maintenance.auto=false",
        "-c",
        "gc.auto=0",
    ]
}

async fn bounded_command_output(
    mut command: Command,
    operation: &str,
) -> crate::HiveResult<std::process::Output> {
    command.kill_on_drop(true);
    tokio::time::timeout(Duration::from_secs(300), command.output())
        .await
        .map_err(|_| crate::HiveError::message(format!("{operation} exceeded 300 seconds")))?
        .with_hive_context(|| format!("start {operation}"))
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "linux")]
    use std::collections::HashSet;
    use std::process::Command as StdCommand;

    use super::{
        sync_workbench_checkout, workbench_cleanup_arguments, workbench_fetch_arguments,
        workbench_git_transport_arguments,
    };

    #[tokio::test]
    async fn workbench_checkout_reuses_the_same_public_git_snapshot() -> crate::HiveResult<()> {
        let _git_process_guard = crate::GIT_PROCESS_TEST_LOCK.lock().await;
        let origin = tempfile::tempdir()?;
        let checkout = tempfile::tempdir()?;
        let checkout_path = checkout.path().join("workbench");
        let git = |args: &[&str]| -> crate::HiveResult<()> {
            let status = StdCommand::new("git")
                .arg("-C")
                .arg(origin.path())
                .args(args)
                .status()?;
            if !status.success() {
                return Err(crate::error::HiveError::message(format!(
                    "test Git command failed: {args:?}"
                )));
            }
            Ok(())
        };
        git(&["init", "--initial-branch=main"])?;
        std::fs::write(origin.path().join("README.md"), "first\n")?;
        git(&["add", "README.md"])?;
        git(&[
            "-c",
            "user.name=Hive Test",
            "-c",
            "user.email=hive@example.invalid",
            "commit",
            "-m",
            "first",
        ])?;

        let repository_url = origin.path().to_string_lossy();
        let first = sync_workbench_checkout(&repository_url, &checkout_path).await?;
        let unchanged = sync_workbench_checkout(&repository_url, &checkout_path).await?;
        assert_eq!(first, unchanged);

        std::fs::write(origin.path().join("README.md"), "second\n")?;
        git(&["add", "README.md"])?;
        git(&[
            "-c",
            "user.name=Hive Test",
            "-c",
            "user.email=hive@example.invalid",
            "commit",
            "-m",
            "second",
        ])?;
        let changed = sync_workbench_checkout(&repository_url, &checkout_path).await?;
        assert_ne!(first, changed);
        assert_eq!(
            std::fs::read_to_string(checkout_path.join("README.md"))?,
            "second\n"
        );
        let reachable = StdCommand::new("git")
            .arg("-C")
            .arg(&checkout_path)
            .args(["rev-list", "--all", "--count"])
            .output()?;
        assert!(reachable.status.success());
        assert_eq!(String::from_utf8(reachable.stdout)?.trim(), "1");
        Ok(())
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn workbench_cleanup_leaves_no_git_process_behind() -> crate::HiveResult<()> {
        let _git_process_guard = crate::GIT_PROCESS_TEST_LOCK.lock().await;
        let repository = tempfile::tempdir()?;
        let status = StdCommand::new("git")
            .arg("-C")
            .arg(repository.path())
            .args(["init", "--initial-branch=main"])
            .status()?;
        assert!(status.success());
        let (before_zombies, _) = git_process_ids(repository.path())?;
        super::git(repository.path(), workbench_cleanup_arguments()).await?;
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        let (after_zombies, matching_repository) = git_process_ids(repository.path())?;
        assert!(
            after_zombies.is_subset(&before_zombies),
            "cleanup left a new Git zombie: {after_zombies:?}"
        );
        assert!(
            matching_repository.is_empty(),
            "cleanup left Git running for its repository: {matching_repository:?}"
        );
        Ok(())
    }

    #[cfg(target_os = "linux")]
    fn git_process_ids(
        repository: &std::path::Path,
    ) -> crate::HiveResult<(HashSet<u32>, HashSet<u32>)> {
        let mut zombies = HashSet::new();
        let mut matching_repository = HashSet::new();
        let repository = repository.to_string_lossy();
        for entry in std::fs::read_dir("/proc")? {
            let entry = entry?;
            let name = entry.file_name();
            let Ok(process_id) = name.to_string_lossy().parse::<u32>() else {
                continue;
            };
            let command = match std::fs::read_to_string(entry.path().join("comm")) {
                Ok(command) => command,
                Err(error) if process_vanished(&error) => continue,
                Err(error) => return Err(error.into()),
            };
            if command.trim() == "git" {
                let stat = match std::fs::read_to_string(entry.path().join("stat")) {
                    Ok(stat) => stat,
                    Err(error) if process_vanished(&error) => continue,
                    Err(error) => return Err(error.into()),
                };
                if stat
                    .rfind(") ")
                    .and_then(|position| stat.as_bytes().get(position + 2))
                    == Some(&b'Z')
                {
                    zombies.insert(process_id);
                }
                let command_line = match std::fs::read(entry.path().join("cmdline")) {
                    Ok(command_line) => command_line,
                    Err(error) if process_vanished(&error) => continue,
                    Err(error) => return Err(error.into()),
                };
                if String::from_utf8_lossy(&command_line).contains(repository.as_ref()) {
                    matching_repository.insert(process_id);
                }
            }
        }
        Ok((zombies, matching_repository))
    }

    #[cfg(target_os = "linux")]
    fn process_vanished(error: &std::io::Error) -> bool {
        error.kind() == std::io::ErrorKind::NotFound || error.raw_os_error() == Some(3)
    }

    #[test]
    fn workbench_cleanup_cannot_detach_from_the_dispatcher() {
        assert_eq!(
            workbench_cleanup_arguments(),
            ["gc", "--prune=now", "--no-detach"]
        );
    }

    #[test]
    fn workbench_fetch_cannot_start_automatic_maintenance() {
        assert!(
            workbench_fetch_arguments().contains(&"--no-auto-maintenance"),
            "Workbench fetch must not orphan automatic Git maintenance"
        );
        assert!(
            workbench_git_transport_arguments()
                .windows(2)
                .any(|arguments| arguments == ["-c", "maintenance.auto=false"]),
            "all Workbench Git commands must disable automatic maintenance"
        );
    }
}
