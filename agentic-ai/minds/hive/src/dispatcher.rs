use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

use anyhow::Context;
use tokio::process::Command;

use crate::model::{EnqueueTask, TaskId};
use crate::store::TaskStore;

const MAIN_FAILURE_PREFIX: &str = "main-failure-";
const MAIN_FAILURE_SUFFIX: &str = ".md";
const DEFERRED_E2E_RETIREMENT_MARKER: &str = "<!-- hive-retired:deferred-e2e -->";

pub async fn run_workbench_dispatcher<S: TaskStore>(
    store: S,
    repository_url: &str,
    checkout: &Path,
    poll_seconds: u64,
) -> anyhow::Result<()> {
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
        let task_base = name.trim_end_matches(MAIN_FAILURE_SUFFIX);
        if body.contains(DEFERRED_E2E_RETIREMENT_MARKER) {
            for task_id in main_failure_task_ids(task_base, &body)? {
                let cancelled = store
                    .cancel(&task_id, "Main rerun failed only deferred E2E jobs")
                    .await
                    .with_context(|| format!("cancel {}", task_id))?;
                eprintln!(
                    "Hive Workbench retirement task={} cancelled={cancelled}",
                    task_id
                );
            }
            reconciled_incidents.insert(name, body);
            continue;
        }
        if !is_ready_agent_issue(&body) {
            reconciled_incidents.insert(name, body);
            continue;
        }
        let (run_id, run_attempt) = main_failure_run(&body)
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
        reconcile_delivery(store, &source_commit, task_base, &body, run_id, run_attempt).await?;
        reconciled_incidents.insert(name, body);
    }
    Ok(())
}

async fn reconcile_delivery<S: TaskStore>(
    store: &S,
    source_commit: &str,
    task_base: &str,
    body: &str,
    run_id: u64,
    run_attempt: u64,
) -> anyhow::Result<()> {
    let task_id = main_failure_task_id(task_base, run_id, run_attempt)?;
    if let Some(active_id) = store.active_delivery(&source_commit, "main-repair").await? {
        if active_id == task_id {
            eprintln!(
                "Hive Workbench delivery already current task={} source_commit={source_commit}",
                active_id,
            );
            return Ok(());
        }
        let cancelled = store
            .cancel(&active_id, "Superseded by a newer failed Main attempt")
            .await
            .with_context(|| format!("cancel superseded delivery {}", active_id))?;
        anyhow::bail!(
            "superseded Hive delivery {active_id} cancellation_requested={cancelled}; retry after the worker acknowledges termination"
        );
    }
    let task = EnqueueTask {
        id: task_id,
        kind: "main-repair".to_owned(),
        prompt: body.to_owned(),
        source_commit: source_commit.to_owned(),
        priority: 100,
        max_attempts: 3,
        dependencies: Vec::new(),
    };
    if let Err(error) = store.enqueue(&task).await
        && !format!("{error:#}").contains("already exists")
    {
        return Err(error).with_context(|| format!("enqueue {}", task.id));
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

fn main_failure_runs(body: &str) -> Vec<(u64, u64)> {
    body.split("<!-- main-run:")
        .skip(1)
        .filter_map(|marker| {
            let (run_id, attempt) = marker.split_once(":attempt:")?;
            let attempt = attempt.split_whitespace().next()?;
            Some((run_id.parse().ok()?, attempt.parse().ok()?))
        })
        .collect()
}

fn main_failure_run(body: &str) -> Option<(u64, u64)> {
    main_failure_runs(body).into_iter().last()
}

fn main_failure_task_id(task_base: &str, run_id: u64, run_attempt: u64) -> anyhow::Result<TaskId> {
    TaskId::new(format!("{task_base}-run-{run_id}-attempt-{run_attempt}"))
        .map_err(anyhow::Error::msg)
}

fn main_failure_task_ids(task_base: &str, body: &str) -> anyhow::Result<Vec<TaskId>> {
    let mut task_ids = vec![TaskId::new(task_base).map_err(anyhow::Error::msg)?];
    for (run_id, run_attempt) in main_failure_runs(body) {
        task_ids.push(main_failure_task_id(task_base, run_id, run_attempt)?);
    }
    Ok(task_ids)
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
    use std::sync::{Arc, Mutex};

    use async_trait::async_trait;
    use serde_json::json;

    use crate::model::{
        AgentId, ClaimOutcome, ClaimedTask, CompletionArtifact, EnqueueTask, LeaseToken, TaskId,
    };
    use crate::store::TaskStore;

    use super::{
        DEFERRED_E2E_RETIREMENT_MARKER, incident_needs_reconciliation, is_ready_agent_issue,
        main_failure_commit, main_failure_run, main_failure_task_id, main_failure_task_ids,
        main_run_requires_repair, reconcile_delivery, sync_workbench_checkout,
    };

    #[derive(Clone, Default)]
    struct RecordingStore {
        active: Arc<Mutex<Option<TaskId>>>,
        cancelled: Arc<Mutex<Vec<TaskId>>>,
        enqueued: Arc<Mutex<Vec<TaskId>>>,
    }

    #[async_trait]
    impl TaskStore for RecordingStore {
        async fn migrate(&self) -> anyhow::Result<()> {
            Ok(())
        }
        async fn register_agent(&self, _: &AgentId, _: &str) -> anyhow::Result<()> {
            unreachable!()
        }
        async fn enqueue(&self, task: &EnqueueTask) -> anyhow::Result<()> {
            self.enqueued
                .lock()
                .expect("enqueued")
                .push(task.id.clone());
            Ok(())
        }
        async fn active_delivery(&self, _: &str, _: &str) -> anyhow::Result<Option<TaskId>> {
            Ok(self.active.lock().expect("active").clone())
        }
        async fn cancel(&self, task_id: &TaskId, _: &str) -> anyhow::Result<bool> {
            self.cancelled
                .lock()
                .expect("cancelled")
                .push(task_id.clone());
            Ok(true)
        }
        async fn acknowledge_cancellation(
            &self,
            _: &ClaimedTask,
            _: &AgentId,
        ) -> anyhow::Result<bool> {
            unreachable!()
        }
        async fn claim(&self, _: &AgentId, _: i64) -> anyhow::Result<ClaimOutcome> {
            unreachable!()
        }
        async fn heartbeat(
            &self,
            _: &TaskId,
            _: &AgentId,
            _: &LeaseToken,
            _: i64,
        ) -> anyhow::Result<bool> {
            unreachable!()
        }
        async fn release(&self, _: &ClaimedTask, _: &AgentId) -> anyhow::Result<bool> {
            unreachable!()
        }
        async fn complete(
            &self,
            _: &ClaimedTask,
            _: &AgentId,
            _: &str,
            _: &CompletionArtifact,
        ) -> anyhow::Result<bool> {
            unreachable!()
        }
        async fn fail(&self, _: &ClaimedTask, _: &AgentId, _: &str) -> anyhow::Result<bool> {
            unreachable!()
        }
        async fn block(
            &self,
            _: &ClaimedTask,
            _: &AgentId,
            _: &EnqueueTask,
            _: &str,
        ) -> anyhow::Result<bool> {
            unreachable!()
        }
    }

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
        assert!(
            "---\nstatus: done\nautomation: hive\n---\n<!-- hive-retired:deferred-e2e -->"
                .contains(DEFERRED_E2E_RETIREMENT_MARKER)
        );
        assert!(main_failure_commit("unrelated.md").is_none());
        assert_eq!(
            main_failure_run(
                "<!-- main-run:123456:attempt:2 -->\n<!-- main-run:789012:attempt:3 -->"
            ),
            Some((789012, 3))
        );
        assert_eq!(
            main_failure_task_ids("main-failure-abcdef", "<!-- main-run:123456:attempt:2 -->")
                .expect("task ids")
                .iter()
                .map(TaskId::as_str)
                .collect::<Vec<_>>(),
            [
                "main-failure-abcdef",
                "main-failure-abcdef-run-123456-attempt-2"
            ]
        );
        assert_eq!(
            main_failure_task_id("main-failure-abcdef", 123456, 2)
                .expect("current task id")
                .as_str(),
            "main-failure-abcdef-run-123456-attempt-2"
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

    #[test]
    fn suppressed_incident_remains_reconcilable_after_active_delivery_finishes() {
        let reconciled = HashMap::new();

        assert!(incident_needs_reconciliation(
            &reconciled,
            "main-failure-deadbeef.md",
            "attempt: 2"
        ));
        assert!(incident_needs_reconciliation(
            &reconciled,
            "main-failure-deadbeef.md",
            "attempt: 2"
        ));
    }

    #[tokio::test]
    async fn current_generation_is_idempotent() -> anyhow::Result<()> {
        let store = RecordingStore::default();
        let current = main_failure_task_id("main-failure-abcdef", 123, 2)?;
        *store.active.lock().expect("active") = Some(current);

        reconcile_delivery(&store, "abcdef", "main-failure-abcdef", "issue", 123, 2).await?;

        assert!(store.cancelled.lock().expect("cancelled").is_empty());
        assert!(store.enqueued.lock().expect("enqueued").is_empty());
        Ok(())
    }

    #[tokio::test]
    async fn replacement_waits_for_superseded_worker_acknowledgement() -> anyhow::Result<()> {
        let store = RecordingStore::default();
        let old = main_failure_task_id("main-failure-abcdef", 123, 1)?;
        *store.active.lock().expect("active") = Some(old.clone());

        assert!(
            reconcile_delivery(&store, "abcdef", "main-failure-abcdef", "issue", 123, 2)
                .await
                .is_err()
        );
        assert_eq!(
            store.cancelled.lock().expect("cancelled").as_slice(),
            &[old]
        );
        assert!(store.enqueued.lock().expect("enqueued").is_empty());

        *store.active.lock().expect("active") = None;
        reconcile_delivery(&store, "abcdef", "main-failure-abcdef", "issue", 123, 2).await?;
        assert_eq!(
            store
                .enqueued
                .lock()
                .expect("enqueued")
                .iter()
                .map(TaskId::as_str)
                .collect::<Vec<_>>(),
            ["main-failure-abcdef-run-123-attempt-2"]
        );
        Ok(())
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
