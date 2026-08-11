use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use crate::HiveContext;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::model::{EnqueueTask, TaskId, TaskTrigger};
use crate::store::TaskStore;

mod github;
mod health;
mod workbench;
use workbench::sync_workbench_checkout;

pub use health::{
    check_workbench_dispatcher_health, check_workbench_dispatcher_progress,
    prepare_dispatcher_health,
};
use health::{
    record_dispatcher_health, sleep_while_recording_dispatcher_progress,
    while_recording_dispatcher_progress,
};

const MAIN_FAILURE_PREFIX: &str = "main-failure-";
const MAIN_FAILURE_SUFFIX: &str = ".md";
const DEFERRED_E2E_RETIREMENT_MARKER: &str = "<!-- hive-retired:deferred-e2e -->";
const SUCCESSFUL_RERUN_RETIREMENT_MARKER: &str = "<!-- hive-retired:successful-rerun -->";
const WORKER_HEARTBEAT_SECONDS: u64 = 60;

pub async fn run_workbench_dispatcher<S: TaskStore>(
    store: S,
    repository_url: &str,
    checkout: &Path,
    health_path: &Path,
    poll_seconds: u64,
) -> crate::HiveResult<()> {
    if poll_seconds <= WORKER_HEARTBEAT_SECONDS {
        return Err(crate::error::HiveError::message(
            "Workbench polling must exceed the worker heartbeat interval",
        ));
    }
    while_recording_dispatcher_progress(health_path, store.migrate()).await?;
    let mut reconciled_revision = None;
    let mut reconciled_incidents = HashMap::new();
    loop {
        let reconciled = while_recording_dispatcher_progress(health_path, async {
            match sync_workbench_checkout(repository_url, checkout).await {
                Ok(revision) if reconciled_revision.as_deref() == Some(revision.as_str()) => {
                    Ok(true)
                }
                Ok(revision) => {
                    if let Err(error) =
                        dispatch_once(&store, checkout, &mut reconciled_incidents).await
                    {
                        eprintln!("Hive Workbench reconciliation failed and will retry: {error:#}");
                        Ok(false)
                    } else {
                        reconciled_revision = Some(revision);
                        Ok(true)
                    }
                }
                Err(error) => {
                    eprintln!("Hive Workbench synchronization failed and will retry: {error:#}");
                    Ok(false)
                }
            }
        })
        .await?;
        if reconciled && let Err(error) = record_dispatcher_health(health_path).await {
            eprintln!("Hive Workbench health heartbeat failed and will retry: {error:#}");
        }
        sleep_while_recording_dispatcher_progress(health_path, Duration::from_secs(poll_seconds))
            .await?;
    }
}

async fn dispatch_once<S: TaskStore>(
    store: &S,
    checkout: &Path,
    reconciled_incidents: &mut HashMap<String, String>,
) -> crate::HiveResult<()> {
    let incidents = checkout.join("issues/hive-isolated-agent-platform");
    let mut entries = tokio::fs::read_dir(&incidents)
        .await
        .with_hive_context(|| format!("read Workbench incidents at {}", incidents.display()))?;
    while let Some(entry) = entries.next_entry().await? {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(source_commit) = main_failure_commit(&name) else {
            continue;
        };
        if !entry.file_type().await?.is_file() {
            continue;
        }
        let body = String::from_utf8(tokio::fs::read(entry.path()).await?)
            .hive_context("Workbench issue is not UTF-8")?;
        if !incident_needs_reconciliation(reconciled_incidents, &name, &body) {
            continue;
        }
        let task_base = name.trim_end_matches(MAIN_FAILURE_SUFFIX);
        if body.contains(SUCCESSFUL_RERUN_RETIREMENT_MARKER) {
            if let Some(task_id) = store.active_delivery(&source_commit, "main-repair").await? {
                let cancelled = store
                    .cancel(&task_id, "Main rerun succeeded")
                    .await
                    .with_hive_context(|| format!("cancel {}", task_id))?;
                eprintln!(
                    "Hive Workbench successful rerun task={} cancelled={cancelled}",
                    task_id
                );
                terminate_cancelled_workers(store, &task_id).await?;
            }
            reconciled_incidents.insert(name, body);
            continue;
        }
        if body.contains(DEFERRED_E2E_RETIREMENT_MARKER) {
            for task_id in main_failure_task_ids(task_base, &body)? {
                let cancelled = store
                    .cancel(&task_id, "Main rerun failed only deferred E2E jobs")
                    .await
                    .with_hive_context(|| format!("cancel {}", task_id))?;
                eprintln!(
                    "Hive Workbench retirement task={} cancelled={cancelled}",
                    task_id
                );
                terminate_cancelled_workers(store, &task_id).await?;
            }
            reconciled_incidents.insert(name, body);
            continue;
        }
        if !is_ready_agent_issue(&body) {
            reconciled_incidents.insert(name, body);
            continue;
        }
        let (run_id, run_attempt) = main_failure_run(&body)
            .hive_context("ready Main failure issue has no workflow-run marker")?;
        let run = github::fetch_run(run_id).await?;
        if !run.requires_repair(&source_commit) {
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
) -> crate::HiveResult<()> {
    let task_id = main_failure_task_id(task_base, run_id, run_attempt)?;
    if let Some(active_id) = store.active_delivery(source_commit, "main-repair").await? {
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
            .with_hive_context(|| format!("cancel superseded delivery {}", active_id))?;
        terminate_cancelled_workers(store, &active_id).await?;
        return Err(crate::error::HiveError::message(format!(
            "superseded Hive delivery {active_id} cancellation_requested={cancelled}; retry after the worker acknowledges termination"
        )));
    }
    let task = EnqueueTask {
        id: task_id,
        kind: "main-repair".to_owned(),
        trigger: TaskTrigger::GitHubMainFailure,
        prompt: body.to_owned(),
        source_commit: source_commit.to_owned(),
        priority: 100,
        max_attempts: 3,
        dependencies: Vec::new(),
    };
    if let Err(error) = store.enqueue(&task).await
        && !format!("{error:#}").contains("already exists")
    {
        return Err(error).with_hive_context(|| format!("enqueue {}", task.id));
    }
    Ok(())
}

async fn terminate_cancelled_workers<S: TaskStore>(
    store: &S,
    root_task_id: &TaskId,
) -> crate::HiveResult<()> {
    for target in store.cancellation_targets(root_task_id).await? {
        delete_worker_pod(&target.pod_name).await?;
        let finalized = store.finalize_cancellation(&target.task_id).await?;
        if !finalized {
            return Err(crate::error::HiveError::message(format!(
                "cancelled worker {} terminated but task {} could not be finalized",
                target.pod_name, target.task_id
            )));
        }
    }
    Ok(())
}

async fn delete_worker_pod(pod_name: &str) -> crate::HiveResult<()> {
    if !pod_name.starts_with("hive-")
        || !pod_name.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'.')
        })
    {
        return Err(crate::error::HiveError::message(
            "refusing invalid Hive worker Pod name",
        ));
    }
    let token = tokio::fs::read_to_string("/run/reaper-auth/token").await?;
    let url = format!("http://hive-reaper.hive-system.svc.cluster.local:8080/reap/{pod_name}");
    let mut child = Command::new("curl")
        .args([
            "--silent",
            "--show-error",
            "--output",
            "/dev/null",
            "--write-out",
            "%{http_code}",
            "--request",
            "POST",
            "--connect-timeout",
            "5",
            "--max-time",
            "130",
            "--config",
            "-",
            url.as_str(),
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .hive_context("start Hive lifecycle-controller request")?;
    child
        .stdin
        .take()
        .hive_context("open Kubernetes request configuration")?
        .write_all(format!("header = \"Authorization: Bearer {}\"\n", token.trim()).as_bytes())
        .await
        .hive_context("write Hive lifecycle-controller request configuration")?;
    let output = child
        .wait_with_output()
        .await
        .hive_context("call Hive lifecycle controller")?;
    if !output.status.success() {
        return Err(crate::error::HiveError::message(
            "Hive lifecycle-controller request failed",
        ));
    }
    let status: u16 = String::from_utf8(output.stdout)?
        .parse()
        .hive_context("decode Hive lifecycle-controller status")?;
    if status != 204 {
        return Err(crate::error::HiveError::message(format!(
            "Hive lifecycle controller returned status {status}"
        )));
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

fn main_failure_task_id(
    task_base: &str,
    run_id: u64,
    run_attempt: u64,
) -> crate::HiveResult<TaskId> {
    Ok(TaskId::new(format!(
        "{task_base}-run-{run_id}-attempt-{run_attempt}"
    ))?)
}

fn main_failure_task_ids(task_base: &str, body: &str) -> crate::HiveResult<Vec<TaskId>> {
    let mut task_ids = vec![TaskId::new(task_base)?];
    for (run_id, run_attempt) in main_failure_runs(body) {
        task_ids.push(main_failure_task_id(task_base, run_id, run_attempt)?);
    }
    Ok(task_ids)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    use async_trait::async_trait;

    use crate::model::{
        AgentId, CancellationTarget, ClaimOutcome, ClaimedTask, CompletionArtifact, EnqueueTask,
        LeaseToken, TaskId,
    };
    use crate::store::TaskStore;

    use super::{
        DEFERRED_E2E_RETIREMENT_MARKER, incident_needs_reconciliation, is_ready_agent_issue,
        main_failure_commit, main_failure_run, main_failure_task_id, main_failure_task_ids,
        reconcile_delivery, run_workbench_dispatcher,
    };

    #[derive(Clone, Default)]
    struct RecordingStore {
        active: Arc<Mutex<Option<TaskId>>>,
        cancelled: Arc<Mutex<Vec<TaskId>>>,
        enqueued: Arc<Mutex<Vec<TaskId>>>,
    }

    #[async_trait]
    impl TaskStore for RecordingStore {
        async fn migrate(&self) -> crate::HiveResult<()> {
            Ok(())
        }
        async fn register_agent(&self, _: &AgentId, _: &str) -> crate::HiveResult<()> {
            unreachable!()
        }
        async fn enqueue(&self, task: &EnqueueTask) -> crate::HiveResult<()> {
            self.enqueued
                .lock()
                .map_err(|_| {
                    crate::error::HiveError::message("shared test state mutex was poisoned")
                })?
                .push(task.id.clone());
            Ok(())
        }
        async fn active_delivery(&self, _: &str, _: &str) -> crate::HiveResult<Option<TaskId>> {
            Ok(self
                .active
                .lock()
                .map_err(|_| {
                    crate::error::HiveError::message("shared test state mutex was poisoned")
                })?
                .clone())
        }
        async fn cancel(&self, task_id: &TaskId, _: &str) -> crate::HiveResult<bool> {
            self.cancelled
                .lock()
                .map_err(|_| {
                    crate::error::HiveError::message("shared test state mutex was poisoned")
                })?
                .push(task_id.clone());
            Ok(true)
        }
        async fn acknowledge_cancellation(
            &self,
            _: &ClaimedTask,
            _: &AgentId,
        ) -> crate::HiveResult<bool> {
            unreachable!()
        }
        async fn cancellation_targets(
            &self,
            _: &TaskId,
        ) -> crate::HiveResult<Vec<CancellationTarget>> {
            Ok(Vec::new())
        }
        async fn finalize_cancellation(&self, _: &TaskId) -> crate::HiveResult<bool> {
            unreachable!()
        }
        async fn claim(&self, _: &AgentId, _: i64) -> crate::HiveResult<ClaimOutcome> {
            unreachable!()
        }
        async fn heartbeat(
            &self,
            _: &TaskId,
            _: &AgentId,
            _: &LeaseToken,
            _: i64,
        ) -> crate::HiveResult<bool> {
            unreachable!()
        }
        async fn release(&self, _: &ClaimedTask, _: &AgentId) -> crate::HiveResult<bool> {
            unreachable!()
        }
        async fn complete(
            &self,
            _: &ClaimedTask,
            _: &AgentId,
            _: bool,
            _: &str,
            _: &CompletionArtifact,
        ) -> crate::HiveResult<bool> {
            unreachable!()
        }
        async fn fail(&self, _: &ClaimedTask, _: &AgentId, _: &str) -> crate::HiveResult<bool> {
            unreachable!()
        }
        async fn block(
            &self,
            _: &ClaimedTask,
            _: &AgentId,
            _: &EnqueueTask,
            _: &str,
        ) -> crate::HiveResult<bool> {
            unreachable!()
        }
    }

    #[test]
    fn recognizes_only_ready_automated_main_incidents() -> crate::HiveResult<()> {
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
            main_failure_task_ids("main-failure-abcdef", "<!-- main-run:123456:attempt:2 -->")?
                .iter()
                .map(TaskId::as_str)
                .collect::<Vec<_>>(),
            [
                "main-failure-abcdef",
                "main-failure-abcdef-run-123456-attempt-2"
            ]
        );
        assert_eq!(
            main_failure_task_id("main-failure-abcdef", 123456, 2)?.as_str(),
            "main-failure-abcdef-run-123456-attempt-2"
        );
        Ok(())
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
    async fn current_generation_is_idempotent() -> crate::HiveResult<()> {
        let store = RecordingStore::default();
        let current = main_failure_task_id("main-failure-abcdef", 123, 2)?;
        *store.active.lock().map_err(|_| {
            crate::error::HiveError::message("shared test state mutex was poisoned")
        })? = Some(current);

        reconcile_delivery(&store, "abcdef", "main-failure-abcdef", "issue", 123, 2).await?;

        assert!(
            store
                .cancelled
                .lock()
                .map_err(|_| crate::error::HiveError::message(
                    "shared test state mutex was poisoned"
                ))?
                .is_empty()
        );
        assert!(
            store
                .enqueued
                .lock()
                .map_err(|_| crate::error::HiveError::message(
                    "shared test state mutex was poisoned"
                ))?
                .is_empty()
        );
        Ok(())
    }

    #[tokio::test]
    async fn dispatcher_rejects_sub_heartbeat_polling() -> crate::HiveResult<()> {
        let checkout = tempfile::tempdir()?;
        let health = checkout.path().join("health");
        let error = run_workbench_dispatcher(
            RecordingStore::default(),
            "https://example.invalid/workbench.git",
            checkout.path(),
            &health,
            60,
        )
        .await
        .err()
        .ok_or_else(|| crate::error::HiveError::message("sub-heartbeat polling must fail"))?;
        assert!(
            error
                .to_string()
                .contains("must exceed the worker heartbeat")
        );
        Ok(())
    }

    #[tokio::test]
    async fn replacement_waits_for_superseded_worker_acknowledgement() -> crate::HiveResult<()> {
        let store = RecordingStore::default();
        let old = main_failure_task_id("main-failure-abcdef", 123, 1)?;
        *store.active.lock().map_err(|_| {
            crate::error::HiveError::message("shared test state mutex was poisoned")
        })? = Some(old.clone());

        assert!(
            reconcile_delivery(&store, "abcdef", "main-failure-abcdef", "issue", 123, 2)
                .await
                .is_err()
        );
        assert_eq!(
            store
                .cancelled
                .lock()
                .map_err(|_| crate::error::HiveError::message(
                    "shared test state mutex was poisoned"
                ))?
                .as_slice(),
            &[old]
        );
        assert!(
            store
                .enqueued
                .lock()
                .map_err(|_| crate::error::HiveError::message(
                    "shared test state mutex was poisoned"
                ))?
                .is_empty()
        );

        *store.active.lock().map_err(|_| {
            crate::error::HiveError::message("shared test state mutex was poisoned")
        })? = None;
        reconcile_delivery(&store, "abcdef", "main-failure-abcdef", "issue", 123, 2).await?;
        assert_eq!(
            store
                .enqueued
                .lock()
                .map_err(|_| crate::error::HiveError::message(
                    "shared test state mutex was poisoned"
                ))?
                .iter()
                .map(TaskId::as_str)
                .collect::<Vec<_>>(),
            ["main-failure-abcdef-run-123-attempt-2"]
        );
        Ok(())
    }
}
