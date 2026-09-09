struct WorkbenchIncidentText<'a> {
    value: &'a str,
}
struct WorkerPod<'a> {
    pod_name: &'a str,
}
use crate::dispatcher::github::RunEvidence;
use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::fs as async_fs;

use crate::HiveContext;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::model::{EnqueueTask, TaskId, TaskTrigger};
use crate::store::TaskStore;

mod github;
mod health;
mod workbench;
use workbench::WorkbenchCheckout;

pub use health::DispatcherHealth;

const MAIN_FAILURE_PREFIX: &str = "main-failure-";
const MAIN_FAILURE_SUFFIX: &str = ".md";
const DEFERRED_E2E_RETIREMENT_MARKER: &str = "<!-- hive-retired:deferred-e2e -->";
const SUCCESSFUL_RERUN_RETIREMENT_MARKER: &str = "<!-- hive-retired:successful-rerun -->";
const WORKER_HEARTBEAT_SECONDS: u64 = 60;

pub struct WorkbenchDispatcher<'a, S> {
    pub store: S,
    pub repository_url: &'a str,
    pub checkout: &'a Path,
    pub health_path: &'a Path,
    pub poll_seconds: u64,
}
impl<S: TaskStore> WorkbenchDispatcher<'_, S> {
    pub async fn run_workbench_dispatcher(self) -> crate::HiveResult<()> {
        let Self {
            store,
            repository_url,
            checkout,
            health_path,
            poll_seconds,
        } = self;
        if poll_seconds <= WORKER_HEARTBEAT_SECONDS {
            return Err(crate::HiveError::message(
                "Workbench polling must exceed the worker heartbeat interval",
            ));
        }
        DispatcherHealth::while_recording_dispatcher_progress(health_path, store.migrate()).await?;
        let mut reconciled_revision = None;
        let mut reconciled_incidents = HashMap::new();
        loop {
            let reconciled =
                DispatcherHealth::while_recording_dispatcher_progress(health_path, async {
                    match (WorkbenchCheckout {
                        repository_url,
                        checkout,
                    })
                    .sync_workbench_checkout()
                    .await
                    {
                        Ok(revision)
                            if reconciled_revision.as_deref() == Some(revision.as_str()) =>
                        {
                            Ok(true)
                        }
                        Ok(revision) => {
                            if let Err(error) = WorkbenchDispatcher::dispatch_once(
                                &store,
                                checkout,
                                &mut reconciled_incidents,
                            )
                            .await
                            {
                                eprintln!(
                                    "Hive Workbench reconciliation failed and will retry: {error:#}"
                                );
                                Ok(false)
                            } else {
                                reconciled_revision = Some(revision);
                                Ok(true)
                            }
                        }
                        Err(error) => {
                            eprintln!(
                                "Hive Workbench synchronization failed and will retry: {error:#}"
                            );
                            Ok(false)
                        }
                    }
                })
                .await?;
            if reconciled
                && let Err(error) = DispatcherHealth::record_dispatcher_health(health_path).await
            {
                eprintln!("Hive Workbench health heartbeat failed and will retry: {error:#}");
            }
            DispatcherHealth::sleep_while_recording_dispatcher_progress(
                health_path,
                Duration::from_secs(poll_seconds),
            )
            .await?;
        }
    }
}

impl<S: TaskStore> WorkbenchDispatcher<'_, S> {
    async fn dispatch_once(
        store: &S,
        checkout: &Path,
        reconciled_incidents: &mut HashMap<String, String>,
    ) -> crate::HiveResult<()> {
        let incidents = checkout.join("issues/hive-isolated-agent-platform");
        let mut entries = async_fs::read_dir(&incidents)
            .await
            .with_hive_context(|| format!("read Workbench incidents at {}", incidents.display()))?;
        while let Some(entry) = entries.next_entry().await? {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(source_commit) =
                (WorkbenchIncidentText { value: &name }).main_failure_commit()
            else {
                continue;
            };
            if !entry.file_type().await?.is_file() {
                continue;
            }
            let body = String::from_utf8(async_fs::read(entry.path()).await?)
                .hive_context("Workbench issue is not UTF-8")?;
            if !(IncidentHistory {
                snapshots: reconciled_incidents,
            })
            .incident_needs_reconciliation(IncidentRevision {
                name: &name,
                body: &body,
            }) {
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
                    WorkbenchDispatcher::terminate_cancelled_workers(store, &task_id).await?;
                }
                reconciled_incidents.insert(name, body);
                continue;
            }
            if body.contains(DEFERRED_E2E_RETIREMENT_MARKER) {
                for task_id in
                    (WorkbenchIncidentText { value: &body }).main_failure_task_ids(task_base)?
                {
                    let cancelled = store
                        .cancel(&task_id, "Main rerun failed only deferred E2E jobs")
                        .await
                        .with_hive_context(|| format!("cancel {}", task_id))?;
                    eprintln!(
                        "Hive Workbench retirement task={} cancelled={cancelled}",
                        task_id
                    );
                    WorkbenchDispatcher::terminate_cancelled_workers(store, &task_id).await?;
                }
                reconciled_incidents.insert(name, body);
                continue;
            }
            if !(WorkbenchIncidentText { value: &body }).is_ready_agent_issue() {
                reconciled_incidents.insert(name, body);
                continue;
            }
            let (run_id, run_attempt) = (WorkbenchIncidentText { value: &body })
                .main_failure_run()
                .hive_context("ready Main failure issue has no workflow-run marker")?;
            let run = RunEvidence::fetch_run(run_id).await?;
            if !run.requires_repair(&source_commit) {
                reconciled_incidents.insert(name, body);
                continue;
            }
            WorkbenchDispatcher::reconcile_delivery(
                store,
                &source_commit,
                task_base,
                &body,
                run_id,
                run_attempt,
            )
            .await?;
            reconciled_incidents.insert(name, body);
        }
        Ok(())
    }
}

impl<S: TaskStore> WorkbenchDispatcher<'_, S> {
    async fn reconcile_delivery(
        store: &S,
        source_commit: &str,
        task_base: &str,
        body: &str,
        run_id: u64,
        run_attempt: u64,
    ) -> crate::HiveResult<()> {
        let task_id = TaskId::main_failure_task_id(task_base, run_id, run_attempt)?;
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
            WorkbenchDispatcher::terminate_cancelled_workers(store, &active_id).await?;
            return Err(crate::HiveError::message(format!(
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
}

impl<S: TaskStore> WorkbenchDispatcher<'_, S> {
    async fn terminate_cancelled_workers(
        store: &S,
        root_task_id: &TaskId,
    ) -> crate::HiveResult<()> {
        for target in store.cancellation_targets(root_task_id).await? {
            (WorkerPod {
                pod_name: &target.pod_name,
            })
            .delete_worker_pod()
            .await?;
            let finalized = store.finalize_cancellation(&target.task_id).await?;
            if !finalized {
                return Err(crate::HiveError::message(format!(
                    "cancelled worker {} terminated but task {} could not be finalized",
                    target.pod_name, target.task_id
                )));
            }
        }
        Ok(())
    }
}

impl WorkerPod<'_> {
    async fn delete_worker_pod(&self) -> crate::HiveResult<()> {
        let pod_name = self.pod_name;
        if !pod_name.starts_with("hive-")
            || !pod_name.bytes().all(|byte| {
                byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'.')
            })
        {
            return Err(crate::HiveError::message(
                "refusing invalid Hive worker Pod name",
            ));
        }
        let token = async_fs::read_to_string("/run/reaper-auth/token").await?;
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
            return Err(crate::HiveError::message(
                "Hive lifecycle-controller request failed",
            ));
        }
        let status: u16 = String::from_utf8(output.stdout)?
            .parse()
            .hive_context("decode Hive lifecycle-controller status")?;
        if status != 204 {
            return Err(crate::HiveError::message(format!(
                "Hive lifecycle controller returned status {status}"
            )));
        }
        Ok(())
    }
}

struct IncidentHistory<'a> {
    snapshots: &'a HashMap<String, String>,
}
struct IncidentRevision<'a> {
    name: &'a str,
    body: &'a str,
}
impl IncidentHistory<'_> {
    fn incident_needs_reconciliation(&self, revision: IncidentRevision<'_>) -> bool {
        let IncidentRevision { name, body } = revision;
        self.snapshots.get(name).map(String::as_str) != Some(body)
    }
}

impl WorkbenchIncidentText<'_> {
    fn main_failure_commit(&self) -> Option<String> {
        let name = self.value;
        let value = name
            .strip_prefix(MAIN_FAILURE_PREFIX)?
            .strip_suffix(MAIN_FAILURE_SUFFIX)?;
        (value.len() == 40 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
            .then(|| value.to_ascii_lowercase())
    }
}

impl WorkbenchIncidentText<'_> {
    fn is_ready_agent_issue(&self) -> bool {
        let body = self.value;
        body.lines().any(|line| line.trim() == "status: ready")
            && body.lines().any(|line| line.trim() == "automation: hive")
    }
}

impl WorkbenchIncidentText<'_> {
    fn main_failure_runs(&self) -> Vec<(u64, u64)> {
        let body = self.value;
        body.split("<!-- main-run:")
            .skip(1)
            .filter_map(|marker| {
                let (run_id, attempt) = marker.split_once(":attempt:")?;
                let attempt = attempt.split_whitespace().next()?;
                Some((run_id.parse().ok()?, attempt.parse().ok()?))
            })
            .collect()
    }
}

impl WorkbenchIncidentText<'_> {
    fn main_failure_run(&self) -> Option<(u64, u64)> {
        let body = self.value;
        (WorkbenchIncidentText { value: body })
            .main_failure_runs()
            .into_iter()
            .last()
    }
}

impl TaskId {
    fn main_failure_task_id(
        task_base: &str,
        run_id: u64,
        run_attempt: u64,
    ) -> crate::HiveResult<TaskId> {
        Ok(TaskId::try_from(format!(
            "{task_base}-run-{run_id}-attempt-{run_attempt}"
        ))?)
    }
}

impl WorkbenchIncidentText<'_> {
    fn main_failure_task_ids(&self, task_base: &str) -> crate::HiveResult<Vec<TaskId>> {
        let body = self.value;
        let mut task_ids = vec![TaskId::try_from(task_base)?];
        for (run_id, run_attempt) in (WorkbenchIncidentText { value: body }).main_failure_runs() {
            task_ids.push(TaskId::main_failure_task_id(
                task_base,
                run_id,
                run_attempt,
            )?);
        }
        Ok(task_ids)
    }
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
        DEFERRED_E2E_RETIREMENT_MARKER, IncidentHistory, IncidentRevision, WorkbenchDispatcher,
        WorkbenchIncidentText,
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
                .map_err(|_| crate::HiveError::message("shared test state mutex was poisoned"))?
                .push(task.id.clone());
            Ok(())
        }
        async fn active_delivery(&self, _: &str, _: &str) -> crate::HiveResult<Option<TaskId>> {
            Ok(self
                .active
                .lock()
                .map_err(|_| crate::HiveError::message("shared test state mutex was poisoned"))?
                .clone())
        }
        async fn cancel(&self, task_id: &TaskId, _: &str) -> crate::HiveResult<bool> {
            self.cancelled
                .lock()
                .map_err(|_| crate::HiveError::message("shared test state mutex was poisoned"))?
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
            completion: crate::model::Completion<'_>,
        ) -> crate::HiveResult<bool> {
            let crate::model::Completion {
                task: _,
                agent_id: _,
                relevance: _,
                summary: _,
                artifact: _,
            } = completion;
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
            (WorkbenchIncidentText {
                value: &format!("main-failure-{sha}.md")
            })
            .main_failure_commit()
            .as_deref(),
            Some(sha)
        );
        assert!(
            (WorkbenchIncidentText {
                value: "---\nstatus: ready\nautomation: hive\n---\n"
            })
            .is_ready_agent_issue()
        );
        assert!(
            !(WorkbenchIncidentText {
                value: "---\nstatus: in_progress\nautomation: hive\n---\n"
            })
            .is_ready_agent_issue()
        );
        assert!(
            "---\nstatus: done\nautomation: hive\n---\n<!-- hive-retired:deferred-e2e -->"
                .contains(DEFERRED_E2E_RETIREMENT_MARKER)
        );
        assert!(
            (WorkbenchIncidentText {
                value: "unrelated.md"
            })
            .main_failure_commit()
            .is_none()
        );
        assert_eq!(
            (WorkbenchIncidentText {
                value: "<!-- main-run:123456:attempt:2 -->\n<!-- main-run:789012:attempt:3 -->"
            })
            .main_failure_run(),
            Some((789012, 3))
        );
        assert_eq!(
            (WorkbenchIncidentText {
                value: "<!-- main-run:123456:attempt:2 -->"
            })
            .main_failure_task_ids("main-failure-abcdef")?
            .iter()
            .map(TaskId::as_str)
            .collect::<Vec<_>>(),
            [
                "main-failure-abcdef",
                "main-failure-abcdef-run-123456-attempt-2"
            ]
        );
        assert_eq!(
            TaskId::main_failure_task_id("main-failure-abcdef", 123456, 2)?.as_str(),
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

        assert!(
            !(IncidentHistory {
                snapshots: &reconciled
            })
            .incident_needs_reconciliation(IncidentRevision {
                name: "main-failure-deadbeef.md",
                body: "attempt: 1"
            })
        );
        assert!(
            (IncidentHistory {
                snapshots: &reconciled
            })
            .incident_needs_reconciliation(IncidentRevision {
                name: "main-failure-deadbeef.md",
                body: "attempt: 2"
            })
        );
    }

    #[test]
    fn suppressed_incident_remains_reconcilable_after_active_delivery_finishes() {
        let reconciled = HashMap::new();

        assert!(
            (IncidentHistory {
                snapshots: &reconciled
            })
            .incident_needs_reconciliation(IncidentRevision {
                name: "main-failure-deadbeef.md",
                body: "attempt: 2"
            })
        );
        assert!(
            (IncidentHistory {
                snapshots: &reconciled
            })
            .incident_needs_reconciliation(IncidentRevision {
                name: "main-failure-deadbeef.md",
                body: "attempt: 2"
            })
        );
    }

    #[tokio::test]
    async fn current_generation_is_idempotent() -> crate::HiveResult<()> {
        let store = RecordingStore::default();
        let current = TaskId::main_failure_task_id("main-failure-abcdef", 123, 2)?;
        *store
            .active
            .lock()
            .map_err(|_| crate::HiveError::message("shared test state mutex was poisoned"))? =
            Some(current);

        WorkbenchDispatcher::reconcile_delivery(
            &store,
            "abcdef",
            "main-failure-abcdef",
            "issue",
            123,
            2,
        )
        .await?;

        assert!(
            store
                .cancelled
                .lock()
                .map_err(|_| crate::HiveError::message("shared test state mutex was poisoned"))?
                .is_empty()
        );
        assert!(
            store
                .enqueued
                .lock()
                .map_err(|_| crate::HiveError::message("shared test state mutex was poisoned"))?
                .is_empty()
        );
        Ok(())
    }

    #[tokio::test]
    async fn dispatcher_rejects_sub_heartbeat_polling() -> crate::HiveResult<()> {
        let checkout = tempfile::tempdir()?;
        let health = checkout.path().join("health");
        let error = (WorkbenchDispatcher {
            store: RecordingStore::default(),
            repository_url: "https://example.invalid/workbench.git",
            checkout: checkout.path(),
            health_path: &health,
            poll_seconds: 60,
        })
        .run_workbench_dispatcher()
        .await
        .err()
        .ok_or_else(|| crate::HiveError::message("sub-heartbeat polling must fail"))?;
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
        let old = TaskId::main_failure_task_id("main-failure-abcdef", 123, 1)?;
        *store
            .active
            .lock()
            .map_err(|_| crate::HiveError::message("shared test state mutex was poisoned"))? =
            Some(old.clone());

        assert!(
            WorkbenchDispatcher::reconcile_delivery(
                &store,
                "abcdef",
                "main-failure-abcdef",
                "issue",
                123,
                2
            )
            .await
            .is_err()
        );
        assert_eq!(
            store
                .cancelled
                .lock()
                .map_err(|_| crate::HiveError::message("shared test state mutex was poisoned"))?
                .as_slice(),
            &[old]
        );
        assert!(
            store
                .enqueued
                .lock()
                .map_err(|_| crate::HiveError::message("shared test state mutex was poisoned"))?
                .is_empty()
        );

        *store
            .active
            .lock()
            .map_err(|_| crate::HiveError::message("shared test state mutex was poisoned"))? = None;
        WorkbenchDispatcher::reconcile_delivery(
            &store,
            "abcdef",
            "main-failure-abcdef",
            "issue",
            123,
            2,
        )
        .await?;
        assert_eq!(
            store
                .enqueued
                .lock()
                .map_err(|_| crate::HiveError::message("shared test state mutex was poisoned"))?
                .iter()
                .map(TaskId::as_str)
                .collect::<Vec<_>>(),
            ["main-failure-abcdef-run-123-attempt-2"]
        );
        Ok(())
    }
}
