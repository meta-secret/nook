use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

use anyhow::Context;
use tokio::process::Command;

use crate::model::{EnqueueTask, TaskId};
use crate::store::TaskStore;

const MAIN_FAILURE_PREFIX: &str = "main-failure-";
const MAIN_FAILURE_SUFFIX: &str = ".md";

pub async fn run_workbench_dispatcher<S: TaskStore>(
    store: S,
    repository_url: &str,
    checkout: &Path,
    poll_seconds: u64,
) -> anyhow::Result<()> {
    if poll_seconds < 60 {
        anyhow::bail!("Workbench polling must not run more often than once per minute");
    }
    store.migrate().await?;
    let mut reconciled_revision = None;
    let mut reconciled_incidents = HashMap::new();
    loop {
        match sync_workbench_checkout(repository_url, checkout).await {
            Ok(revision) if reconciled_revision.as_deref() == Some(revision.as_str()) => {}
            Ok(revision) => {
                if let Err(error) = dispatch_once(&store, checkout, &mut reconciled_incidents).await
                {
                    eprintln!("Hive Workbench reconciliation failed and will retry: {error:#}");
                } else {
                    reconciled_revision = Some(revision);
                }
            }
            Err(error) => {
                eprintln!("Hive Workbench synchronization failed and will retry: {error:#}");
            }
        }
        tokio::time::sleep(Duration::from_secs(poll_seconds)).await;
    }
}

async fn sync_workbench_checkout(repository_url: &str, checkout: &Path) -> anyhow::Result<String> {
    if checkout.join(".git").is_dir() {
        git(
            checkout,
            &[
                "fetch",
                "--depth=1",
                "origin",
                "+main:refs/remotes/origin/main",
            ],
        )
        .await?;
        git(
            checkout,
            &["checkout", "--detach", "--force", "origin/main"],
        )
        .await?;
    } else {
        if checkout.exists() {
            anyhow::bail!(
                "Workbench checkout {} exists without Git metadata",
                checkout.display()
            );
        }
        let parent = checkout
            .parent()
            .context("Workbench checkout has no parent directory")?;
        tokio::fs::create_dir_all(parent).await?;
        let output = Command::new("git")
            .args(["clone", "--depth=1", "--branch=main", "--"])
            .arg(repository_url)
            .arg(checkout)
            .output()
            .await
            .context("start Workbench clone")?;
        if !output.status.success() {
            anyhow::bail!(
                "Workbench clone failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            );
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
    git(checkout, &["gc", "--prune=now"]).await?;
    let output = git(checkout, &["rev-parse", "HEAD"]).await?;
    let revision = String::from_utf8(output)
        .context("Workbench revision is not UTF-8")?
        .trim()
        .to_owned();
    if revision.len() != 40 || !revision.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        anyhow::bail!("Workbench checkout returned an invalid revision");
    }
    Ok(revision)
}

async fn git(checkout: &Path, args: &[&str]) -> anyhow::Result<Vec<u8>> {
    let output = Command::new("git")
        .arg("-C")
        .arg(checkout)
        .args(args)
        .output()
        .await
        .context("start Workbench Git operation")?;
    if !output.status.success() {
        anyhow::bail!(
            "Workbench Git operation failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(output.stdout)
}

async fn dispatch_once<S: TaskStore>(
    store: &S,
    checkout: &Path,
    reconciled_incidents: &mut HashMap<String, String>,
) -> anyhow::Result<()> {
    let incidents = checkout.join("issues/hive-isolated-agent-platform");
    let mut entries = tokio::fs::read_dir(&incidents)
        .await
        .with_context(|| format!("read Workbench incidents at {}", incidents.display()))?;
    while let Some(entry) = entries.next_entry().await? {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(source_commit) = main_failure_commit(&name) else {
            continue;
        };
        if !entry.file_type().await?.is_file() {
            continue;
        }
        let body = String::from_utf8(tokio::fs::read(entry.path()).await?)
            .context("Workbench issue is not UTF-8")?;
        if !incident_needs_reconciliation(reconciled_incidents, &name, &body) {
            continue;
        }
        if !is_ready_agent_issue(&body) {
            reconciled_incidents.insert(name, body);
            continue;
        }
        let run_id = main_failure_run_id(&body)
            .context("ready Main failure issue has no workflow-run marker")?;
        let run: serde_json::Value = serde_json::from_slice(
            &fetch(&format!(
                "https://api.github.com/repos/meta-secret/nook/actions/runs/{run_id}"
            ))
            .await?,
        )
        .context("decode current Main workflow-run state")?;
        if !main_run_requires_repair(&run, &source_commit) {
            reconciled_incidents.insert(name, body);
            continue;
        }
        let task = EnqueueTask {
            id: TaskId::new(name.trim_end_matches(MAIN_FAILURE_SUFFIX))
                .map_err(anyhow::Error::msg)?,
            kind: "main-repair".to_owned(),
            prompt: body.clone(),
            source_commit,
            priority: 100,
            max_attempts: 3,
            dependencies: Vec::new(),
        };
        if let Err(error) = store.enqueue(&task).await
            && !format!("{error:#}").contains("already exists")
        {
            return Err(error).with_context(|| format!("enqueue {}", task.id));
        }
        reconciled_incidents.insert(name, body);
    }
    Ok(())
}

fn incident_needs_reconciliation(
    reconciled_incidents: &HashMap<String, String>,
    name: &str,
    body: &str,
) -> bool {
    reconciled_incidents.get(name).map(String::as_str) != Some(body)
}

fn main_failure_commit(name: &str) -> Option<String> {
    let value = name
        .strip_prefix(MAIN_FAILURE_PREFIX)?
        .strip_suffix(MAIN_FAILURE_SUFFIX)?;
    (value.len() == 40 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then(|| value.to_ascii_lowercase())
}

fn is_ready_agent_issue(body: &str) -> bool {
    body.lines().any(|line| line.trim() == "status: ready")
        && body.lines().any(|line| line.trim() == "automation: hive")
}

fn main_failure_run_id(body: &str) -> Option<u64> {
    body.split("<!-- main-run:")
        .nth(1)?
        .split(":attempt:")
        .next()?
        .parse()
        .ok()
}

fn main_run_requires_repair(run: &serde_json::Value, source_commit: &str) -> bool {
    run.get("name").and_then(serde_json::Value::as_str) == Some("Main")
        && run.get("event").and_then(serde_json::Value::as_str) == Some("push")
        && run.get("head_branch").and_then(serde_json::Value::as_str) == Some("main")
        && run.get("head_sha").and_then(serde_json::Value::as_str) == Some(source_commit)
        && run
            .pointer("/repository/full_name")
            .and_then(serde_json::Value::as_str)
            == Some("meta-secret/nook")
        && run.get("status").and_then(serde_json::Value::as_str) == Some("completed")
        && !matches!(
            run.get("conclusion").and_then(serde_json::Value::as_str),
            Some("success" | "neutral" | "skipped")
        )
}

async fn fetch(url: &str) -> anyhow::Result<Vec<u8>> {
    let output = Command::new("curl")
        .args([
            "--fail",
            "--silent",
            "--show-error",
            "--location",
            "--retry",
            "3",
            "--header",
            "Accept: application/vnd.github+json",
            "--header",
            "X-GitHub-Api-Version: 2022-11-28",
            "--user-agent",
            "nook-hive-workbench-dispatcher",
            url,
        ])
        .output()
        .await
        .context("start Workbench fetch")?;
    if !output.status.success() {
        anyhow::bail!("Workbench fetch failed with status {}", output.status);
    }
    Ok(output.stdout)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::process::Command as StdCommand;

    use serde_json::json;

    use super::{
        incident_needs_reconciliation, is_ready_agent_issue, main_failure_commit,
        main_failure_run_id, main_run_requires_repair, sync_workbench_checkout,
    };

    #[test]
    fn recognizes_only_ready_automated_main_incidents() {
        let source_commit = "0123456789abcdef0123456789abcdef01234567";
        let failed_main = json!({
            "name": "Main",
            "event": "push",
            "head_branch": "main",
            "head_sha": source_commit,
            "repository": {"full_name": "meta-secret/nook"},
            "status": "completed",
            "conclusion": "failure"
        });
        let sha = "abcdef0123456789abcdef0123456789abcdef01";
        assert_eq!(
            main_failure_commit(&format!("main-failure-{sha}.md")).as_deref(),
            Some(sha)
        );
        assert!(is_ready_agent_issue(
            "---\nstatus: ready\nautomation: hive\n---\n"
        ));
        assert!(!is_ready_agent_issue(
            "---\nstatus: in_progress\nautomation: hive\n---\n"
        ));
        assert!(main_failure_commit("unrelated.md").is_none());
        assert_eq!(
            main_failure_run_id("<!-- main-run:123456:attempt:2 -->\n- failed workflow evidence"),
            Some(123456)
        );
        assert!(main_run_requires_repair(&failed_main, source_commit));
        assert!(!main_run_requires_repair(
            &json!({
                "name": "Main",
                "event": "push",
                "head_branch": "main",
                "head_sha": source_commit,
                "repository": {"full_name": "meta-secret/nook"},
                "status": "completed",
                "conclusion": "success"
            }),
            source_commit
        ));
        assert!(!main_run_requires_repair(
            &json!({
                "name": "Main",
                "event": "push",
                "head_branch": "main",
                "head_sha": source_commit,
                "repository": {"full_name": "meta-secret/nook"},
                "status": "in_progress",
                "conclusion": null
            }),
            source_commit
        ));
        let mut unrelated = failed_main;
        unrelated["head_sha"] = json!("ffffffffffffffffffffffffffffffffffffffff");
        assert!(!main_run_requires_repair(&unrelated, source_commit));
    }

    #[test]
    fn changed_incident_body_is_reconciled_again() {
        let mut reconciled = HashMap::new();
        reconciled.insert(
            "main-failure-deadbeef.md".to_owned(),
            "attempt: 1".to_owned(),
        );

        assert!(!incident_needs_reconciliation(
            &reconciled,
            "main-failure-deadbeef.md",
            "attempt: 1"
        ));
        assert!(incident_needs_reconciliation(
            &reconciled,
            "main-failure-deadbeef.md",
            "attempt: 2"
        ));
    }

    #[tokio::test]
    async fn workbench_checkout_reuses_the_same_public_git_snapshot() -> anyhow::Result<()> {
        let origin = tempfile::tempdir()?;
        let checkout = tempfile::tempdir()?;
        let checkout_path = checkout.path().join("workbench");
        let git = |args: &[&str]| -> anyhow::Result<()> {
            let status = StdCommand::new("git")
                .arg("-C")
                .arg(origin.path())
                .args(args)
                .status()?;
            anyhow::ensure!(status.success(), "test Git command failed: {args:?}");
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
}
