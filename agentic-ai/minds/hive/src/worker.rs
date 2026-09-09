use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync;
use std::time::Duration;
use tokio::fs as async_fs;
use tokio::signal::unix as unix_signal;
use tokio::time as async_time;

use crate::HiveContext;
use codex::Arg0DispatchPaths;
use rand::RngExt;
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt as _;
use tokio::process::Command;
use tokio::sync::{mpsc, watch};

use crate::auth::{AuthBroker, BrokerExternalAuth};
use crate::codex::{CodexOptions, InProcessCodexRunner};
use crate::delivery::MainRepairDelivery;
use crate::model::{
    ActivityLease, AgentId, Artifact, BlockerRequest, ClaimedTask, CompletionArtifact, EnqueueTask,
    TaskActivity, TaskTrigger, TerminalResult,
};
use crate::store::TaskStore;

mod lifecycle;
mod task_prompt;
mod workspace;
use lifecycle::{ClaimStep, TaskClaim, WorkerCompletionMarker, WorkerShutdown, WorkerStartup};

use workspace::*;

const MAX_PERSISTED_RESULT_BYTES: usize = 64 * 1024;
const MAX_PERSISTED_PATCH_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone)]
pub struct WorkerConfig {
    pub agent_id: AgentId,
    pub pod_name: String,
    pub repository_url: String,
    pub workspace: PathBuf,
    pub lease_seconds: i64,
    pub heartbeat_seconds: u64,
    pub task_timeout_seconds: u64,
    pub poll_min_seconds: u64,
    pub poll_max_seconds: u64,
    pub model: String,
    pub reasoning_effort: String,
    pub arg0_paths: Arg0DispatchPaths,
    pub auth_socket: PathBuf,
}

pub struct Worker<S> {
    store: S,
    config: WorkerConfig,
}

impl<S: TaskStore> Worker<S> {
    pub fn new(store: S, config: WorkerConfig) -> Self {
        Self { store, config }
    }

    pub async fn run(self) -> crate::HiveResult<()> {
        WorkerStartup {
            workspace: &self.config.workspace,
            pod_name: &self.config.pod_name,
        }
        .establish()?;
        let external_auth = BrokerExternalAuth::connect(&self.config.auth_socket).await?;
        let lifecycle_marker = self.config.workspace.join(".hive-task-finished");
        if lifecycle_marker.exists() {
            return Err(crate::HiveError::message(
                "refusing to reuse a Pod that already finished a Hive task",
            ));
        }
        self.store.migrate().await?;
        self.store
            .register_agent(&self.config.agent_id, &self.config.pod_name)
            .await?;
        AuthBroker::prepare_worker_auth_and_readiness(&external_auth, &self.config.workspace)
            .await?;
        let mut terminate = unix_signal::signal(unix_signal::SignalKind::terminate())
            .hive_context("failed to install the worker termination handler")?;
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        tokio::spawn(async move {
            if terminate.recv().await.is_some() {
                let _ = shutdown_tx.send(true);
            }
        });

        let task = loop {
            if let Err(error) = external_auth.validate().await {
                let _ =
                    async_fs::remove_file(self.config.workspace.join(".hive-worker-ready")).await;
                async_fs::write(&lifecycle_marker, b"auth-channel-unavailable")
                    .await
                    .hive_context("mark failed auth channel for Pod replacement")?;
                return Err(crate::HiveError::message(format!(
                    "Hive auth channel failed before a task claim; replacing the Pod without \
                     consuming an attempt: {error}"
                )));
            }
            match (TaskClaim {
                store: &self.store,
                agent_id: &self.config.agent_id,
                lease_seconds: self.config.lease_seconds,
                shutdown: shutdown_rx.clone(),
                lifecycle_marker: &lifecycle_marker,
            })
            .claim()
            .await?
            {
                ClaimStep::Stopped => return Ok(()),
                ClaimStep::Claimed(task) => break *task,
                ClaimStep::NoTask => {
                    self.store
                        .register_agent(&self.config.agent_id, &self.config.pod_name)
                        .await?;
                }
            }
            let wait = rand::rng()
                .random_range(self.config.poll_min_seconds..=self.config.poll_max_seconds);
            tokio::select! {
                biased;
                shutdown = WorkerShutdown { receiver: shutdown_rx.clone() }.requested() => {
                    shutdown?;
                    WorkerCompletionMarker { path: &lifecycle_marker }.mark_interrupted().await?;
                    return Ok(());
                }
                () = async_time::sleep(Duration::from_secs(wait)) => {}
            }
        };
        let result = self.execute(&task, external_auth, shutdown_rx).await;
        if let Err(error) = result {
            if matches!(error, crate::HiveError::WorkerBlocked) {
                async_fs::write(&lifecycle_marker, task.id.as_str())
                    .await
                    .hive_context("failed to mark the blocked Pod for replacement")?;
                return Ok(());
            }
            if matches!(error, crate::HiveError::WorkerInterrupted) {
                async_fs::write(&lifecycle_marker, task.id.as_str())
                    .await
                    .hive_context("failed to mark the interrupted Pod for replacement")?;
                return Ok(());
            }
            if matches!(error, crate::HiveError::WorkerCancellationRequested) {
                let acknowledged = self
                    .store
                    .acknowledge_cancellation(&task, &self.config.agent_id)
                    .await
                    .hive_context("failed to acknowledge task cancellation")?;
                if !acknowledged {
                    return Err(crate::HiveError::message(
                        "task cancellation acknowledgement was rejected because the lease is stale",
                    ));
                }
                async_fs::write(&lifecycle_marker, task.id.as_str())
                    .await
                    .hive_context("failed to mark the cancelled Pod for replacement")?;
                return Ok(());
            }
            let message = TaskDisposition::bounded(&format!("{error:#}"));
            let _ = self
                .store
                .fail(&task, &self.config.agent_id, &message)
                .await;
            async_fs::write(&lifecycle_marker, task.id.as_str())
                .await
                .hive_context("failed to mark the Pod for replacement")?;
            return Err(crate::HiveError::message(
                "Hive task failed; bounded details were persisted in Neo4j",
            ));
        }
        async_fs::write(&lifecycle_marker, task.id.as_str())
            .await
            .hive_context("failed to mark the Pod for replacement")?;
        Ok(())
    }

    async fn execute(
        &self,
        task: &ClaimedTask,
        external_auth: sync::Arc<BrokerExternalAuth>,
        shutdown: watch::Receiver<bool>,
    ) -> crate::HiveResult<()> {
        let (stop_tx, stop_rx) = watch::channel(false);
        let mut heartbeat = tokio::spawn(TaskWorkspace::heartbeat_loop(
            self.store.clone(),
            self.config.agent_id.clone(),
            task.clone(),
            self.config.lease_seconds,
            self.config.heartbeat_seconds,
            stop_rx,
        ));

        let execution = async_time::timeout(
            Duration::from_secs(self.config.task_timeout_seconds),
            async {
                let (activity_tx, activity_rx) = mpsc::unbounded_channel();
                let activity_persistence = tokio::spawn(
                    (TaskActivityStream {
                        store: self.store.clone(),
                        agent_id: self.config.agent_id.clone(),
                        task: task.clone(),
                        receiver: activity_rx,
                    })
                    .persist_activity(),
                );
                let task_result = async {
                    let repair_branch = (task.kind == "main-repair")
                        .then(|| ClaimedTask::repair_branch_name(task.id.as_str()));
                    let preparation = (TaskWorkspace {
                        workspace: &self.config.workspace,
                        repository_url: &self.config.repository_url,
                        source_commit: &task.source_commit,
                        resume_branch: repair_branch.as_deref(),
                        dependency_artifacts: &task.dependency_artifacts,
                    })
                    .prepare_workspace()
                    .await?;
                    let repository = self.config.workspace.join("repository");
                    let prepared = match preparation {
                        WorkspacePreparation::Conflicted(conflicted) => {
                            let mut codex_options = CodexOptions::new(repository.clone())
                                .with_workspace_write()
                                .with_activity_sender(activity_tx.clone());
                            codex_options.model.clone_from(&self.config.model);
                            codex_options.arg0_paths.clone_from(&self.config.arg0_paths);
                            codex_options
                                .reasoning_effort
                                .clone_from(&self.config.reasoning_effort);
                            let result = InProcessCodexRunner::with_external_auth(
                            codex_options,
                            external_auth.clone(),
                        )
                        .execute_task(
                            task.id.as_str(),
                            "Resolve only the dependency integration conflicts in this repository. \
                         Apply every patch in .hive-pending in lexical order, resolve all Git \
                         conflicts correctly, remove .hive-pending, and do not implement the \
                         actual task yet. Return the required completed terminal result.",
                        )
                        .await
                        .hive_context("embedded Codex dependency resolution failed")?;
                            if !matches!(result, TerminalResult::Completed { .. }) {
                                return Err(crate::HiveError::message(
                                    "Codex could not integrate dependency artifacts",
                                ));
                            }
                            conflicted.finish_dependency_resolution().await?
                        }
                        WorkspacePreparation::Prepared(prepared) => prepared,
                    };
                    let repository = prepared.repository().to_owned();
                    let prompt = ClaimedTask::task_prompt(task);
                    let mut codex_options = CodexOptions::new(repository.clone())
                        .with_workspace_write()
                        .with_activity_sender(activity_tx.clone());
                    codex_options.model.clone_from(&self.config.model);
                    codex_options.arg0_paths.clone_from(&self.config.arg0_paths);
                    codex_options
                        .reasoning_effort
                        .clone_from(&self.config.reasoning_effort);
                    let result =
                        InProcessCodexRunner::with_external_auth(codex_options, external_auth)
                            .execute_task(task.id.as_str(), &prompt)
                            .await
                            .hive_context("embedded Codex execution failed")?;
                    if let TerminalResult::Blocked {
                        summary, blocker, ..
                    } = &result
                    {
                        return Ok(TaskDisposition::blocked_disposition(task, summary, blocker));
                    }
                    if let TerminalResult::Failed { summary, .. } = &result {
                        if task.kind != "blocker" {
                            return Err(crate::HiveError::message(
                                "only a blocker dependency leaf may return failed",
                            ));
                        }
                        return Ok(TaskDisposition::Failed {
                            reason: TaskDisposition::bounded(summary),
                        });
                    }
                    let obsolete = ClaimedTask::completion_is_obsolete(task, &result);
                    if obsolete {
                        if task.owning_repairs.is_empty() {
                            return Err(crate::HiveError::message(
                                "obsolete blocker retirement requires active owning Main repairs",
                            ));
                        }
                        if !result.changed_files().is_empty() {
                            return Err(crate::HiveError::message(
                                "obsolete blocker retirement cannot report changed files",
                            ));
                        }
                        ClaimedTask::verify_obsolete_owner_deliveries(
                            &repository,
                            &task.owning_repairs,
                        )
                        .await?;
                    }
                    if task.kind == "main-repair" {
                        (MainRepairDelivery {
                            repository: &repository,
                            branch: &ClaimedTask::repair_branch_name(task.id.as_str()),
                        })
                        .verify_main_repair_delivery(task.id.as_str())
                        .await?;
                    }
                    let summary = TaskDisposition::bounded(&format!(
                        "{}\n\nChanged files:\n{}\n\nTests:\n{}",
                        result.summary(),
                        TaskDisposition::bullet_list(result.changed_files()),
                        TaskDisposition::bullet_list(result.tests())
                    ));
                    let artifact = prepared.persistable_patch(task, &result).await?;
                    if obsolete && !matches!(artifact, CompletionArtifact::NotProduced) {
                        return Err(crate::HiveError::message(
                            "obsolete blocker retirement cannot persist a patch artifact",
                        ));
                    }
                    Ok::<TaskDisposition, crate::HiveError>(TaskDisposition::Completed {
                        summary,
                        artifact,
                        relevance: if obsolete {
                            crate::model::CompletionRelevance::Obsolete
                        } else {
                            crate::model::CompletionRelevance::Current
                        },
                    })
                }
                .await;
                drop(activity_tx);
                activity_persistence
                    .await
                    .hive_context("task activity persistence panicked")??;
                let terminal_result: crate::HiveResult<()> = match task_result? {
                    TaskDisposition::Completed {
                        summary,
                        artifact,
                        relevance,
                    } => {
                        let accepted = self
                            .store
                            .complete(crate::model::Completion {
                                task,
                                agent_id: &self.config.agent_id,
                                relevance,
                                summary: &summary,
                                artifact: &artifact,
                            })
                            .await?;
                        if !accepted && relevance == crate::model::CompletionRelevance::Obsolete {
                            if !self.store.release(task, &self.config.agent_id).await? {
                                return Err(WorkerCancellationRequested.into());
                            }
                            return Err(WorkerBlocked.into());
                        }
                        if !accepted {
                            return Err(WorkerCancellationRequested.into());
                        }
                        Ok(())
                    }
                    TaskDisposition::Blocked { blocker, reason } => {
                        if !self
                            .store
                            .block(task, &self.config.agent_id, &blocker, &reason)
                            .await?
                        {
                            return Err(WorkerCancellationRequested.into());
                        }
                        Err(WorkerBlocked.into())
                    }
                    TaskDisposition::Deferred { reason } => {
                        eprintln!(
                            "Hive task {} deferred without consuming an attempt: {}",
                            task.id,
                            TaskDisposition::bounded(&reason)
                        );
                        if !self.store.release(task, &self.config.agent_id).await? {
                            return Err(WorkerCancellationRequested.into());
                        }
                        Err(WorkerBlocked.into())
                    }
                    TaskDisposition::Failed { reason } => {
                        if !self
                            .store
                            .fail(task, &self.config.agent_id, &reason)
                            .await?
                        {
                            return Err(WorkerCancellationRequested.into());
                        }
                        Ok(())
                    }
                };
                terminal_result
            },
        );
        tokio::pin!(execution);
        tokio::select! {
            biased;
            execution = &mut execution => {
                let _ = stop_tx.send(true);
                let completion_committed = matches!(&execution, Ok(Ok(())));
                let heartbeat_result = heartbeat
                    .await
                    .hive_context("heartbeat task panicked")?;
                if !completion_committed {
                    heartbeat_result.hive_context("lease heartbeat failed")?;
                }
                execution.map_err(|_| crate::HiveError::message("task timed out"))??
            }
            heartbeat_result = &mut heartbeat => {
                let heartbeat_result = heartbeat_result
                    .hive_context("heartbeat task panicked")?
                    .hive_context("lease heartbeat failed");
                if heartbeat_result
                    .as_ref()
                    .is_err_and(|error| {
                        matches!(error, crate::HiveError::WorkerCancellationRequested)
                    })
                {
                    return Err(WorkerCancellationRequested.into());
                }
                heartbeat_result?;
                return Err(crate::HiveError::message("lease heartbeat stopped before task execution"));
            }
            shutdown = WorkerShutdown { receiver: shutdown }.requested() => {
                shutdown?;
                let _ = stop_tx.send(true);
                heartbeat
                    .await
                    .hive_context("heartbeat task panicked")?
                    .hive_context("lease heartbeat failed during termination")?;
                let released = self
                    .store
                    .release(task, &self.config.agent_id)
                    .await
                    .hive_context("failed to release the task during termination")?;
                if !released {
                    return Err(crate::HiveError::message("task release was rejected because the lease is stale"));
                }
                return Err(WorkerInterrupted.into());
            }
        }
        Ok(())
    }
}

struct TaskActivityStream<S> {
    store: S,
    agent_id: AgentId,
    task: ClaimedTask,
    receiver: mpsc::UnboundedReceiver<TaskActivity>,
}
impl<S: TaskStore> TaskActivityStream<S> {
    async fn persist_activity(self) -> crate::HiveResult<()> {
        let Self {
            store,
            agent_id,
            task,
            mut receiver,
        } = self;
        let lease = ActivityLease::from(&task);
        while let Some(activity) = receiver.recv().await {
            if !store.record_activity(&lease, &agent_id, &activity).await? {
                return Err(WorkerCancellationRequested.into());
            }
        }
        Ok(())
    }
}

#[derive(Debug, thiserror::Error)]
#[error("worker interrupted for rollout")]
struct WorkerInterrupted;

#[derive(Debug, thiserror::Error)]
#[error("worker persisted a blocking dependency")]
struct WorkerBlocked;

enum TaskDisposition {
    Completed {
        summary: String,
        artifact: CompletionArtifact,
        relevance: crate::model::CompletionRelevance,
    },
    Blocked {
        blocker: EnqueueTask,
        reason: String,
    },
    Deferred {
        reason: String,
    },
    Failed {
        reason: String,
    },
}

impl TaskDisposition {
    fn blocked_disposition(
        task: &ClaimedTask,
        summary: &str,
        blocker: &BlockerRequest,
    ) -> TaskDisposition {
        if task.kind == "blocker" {
            return TaskDisposition::Failed {
                reason: TaskDisposition::bounded(&format!(
                    "prerequisite task could not complete without another dependency: {summary}"
                )),
            };
        }
        if blocker.id == task.id {
            return TaskDisposition::Deferred {
                reason: TaskDisposition::bounded(summary),
            };
        }
        TaskDisposition::Blocked {
            blocker: EnqueueTask {
                id: blocker.id.clone(),
                kind: "blocker".to_owned(),
                trigger: TaskTrigger::AgentDependency,
                prompt: format!("{}\n\n{}", blocker.title, blocker.prompt),
                source_commit: task.source_commit.clone(),
                priority: if task.kind == "main-repair" { 200 } else { 10 },
                max_attempts: 3,
                dependencies: Vec::new(),
            },
            reason: TaskDisposition::bounded(summary),
        }
    }
}

#[derive(Debug, thiserror::Error)]
#[error("worker cancellation requested")]
struct WorkerCancellationRequested;

impl From<WorkerInterrupted> for crate::HiveError {
    fn from(_: WorkerInterrupted) -> Self {
        Self::WorkerInterrupted
    }
}

impl From<WorkerBlocked> for crate::HiveError {
    fn from(_: WorkerBlocked) -> Self {
        Self::WorkerBlocked
    }
}

impl From<WorkerCancellationRequested> for crate::HiveError {
    fn from(_: WorkerCancellationRequested) -> Self {
        Self::WorkerCancellationRequested
    }
}

impl TaskDisposition {
    fn bounded(value: &str) -> String {
        if value.len() <= MAX_PERSISTED_RESULT_BYTES {
            return value.to_owned();
        }
        let mut boundary = MAX_PERSISTED_RESULT_BYTES;
        while !value.is_char_boundary(boundary) {
            boundary -= 1;
        }
        format!("{}\n[truncated]", &value[..boundary])
    }
}

impl TaskDisposition {
    fn bullet_list(values: &[String]) -> String {
        if values.is_empty() {
            return "- none".to_owned();
        }
        values
            .iter()
            .map(|value| format!("- {value}"))
            .collect::<Vec<_>>()
            .join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::{MAX_PERSISTED_RESULT_BYTES, TaskActivityStream, TaskDisposition, TaskWorkspace};
    use crate::model::{
        ActivityKind, AgentId, AttemptId, BlockerRequest, ClaimedTask, CompletionArtifact,
        LeaseToken, TaskActivity, TaskId, TerminalResult,
    };
    use crate::store::TaskStore;
    use crate::store::tests::{MemoryStore, task};
    use std::fs;
    use std::io;
    use std::process;
    use tokio::sync::mpsc;

    #[test]
    fn persisted_results_are_utf8_safe_and_bounded() {
        let value = "🦀".repeat(MAX_PERSISTED_RESULT_BYTES);
        let bounded = TaskDisposition::bounded(&value);

        assert!(bounded.is_char_boundary(bounded.len()));
        assert!(bounded.len() <= MAX_PERSISTED_RESULT_BYTES + "\n[truncated]".len());
        assert!(bounded.ends_with("[truncated]"));
    }

    #[test]
    fn obsolete_completion_is_normalized_for_non_blocker_tasks() -> anyhow::Result<()> {
        let mut task = ClaimedTask {
            id: TaskId::try_from("main-failure-recovery")?,
            kind: "main-repair".to_owned(),
            prompt: "verify the delivered repair".to_owned(),
            source_commit: "0123456789abcdef0123456789abcdef01234567".to_owned(),
            attempt_id: AttemptId::try_from("attempt-1")?,
            attempt_number: 1,
            lease_token: LeaseToken::try_from("lease-1")?,
            owning_repairs: Vec::new(),
            dependency_context: Vec::new(),
            dependency_artifacts: Vec::new(),
        };
        let result = TerminalResult::Completed {
            summary: "repair delivered".to_owned(),
            changed_files: Vec::new(),
            tests: Vec::new(),
            obsolete: true,
        };

        assert!(!ClaimedTask::completion_is_obsolete(&task, &result));
        task.kind = "blocker".to_owned();
        assert!(ClaimedTask::completion_is_obsolete(&task, &result));
        Ok(())
    }

    #[test]
    fn self_named_external_blocker_defers_without_creating_a_dependency() -> anyhow::Result<()> {
        let task = ClaimedTask {
            id: TaskId::try_from("github-actions-pr-42")?,
            kind: "main-repair".to_owned(),
            prompt: "Wait for the exact-head workflow".to_owned(),
            source_commit: "0123456789abcdef0123456789abcdef01234567".to_owned(),
            attempt_id: AttemptId::try_from("attempt-1")?,
            attempt_number: 1,
            lease_token: LeaseToken::try_from("lease-1")?,
            owning_repairs: Vec::new(),
            dependency_context: Vec::new(),
            dependency_artifacts: Vec::new(),
        };
        let blocker = BlockerRequest {
            id: task.id.clone(),
            title: "Workflow still running".to_owned(),
            prompt: "Check the same workflow again later.".to_owned(),
        };

        assert!(matches!(
            TaskDisposition::blocked_disposition(&task, "workflow pending", &blocker),
            TaskDisposition::Deferred { reason } if reason == "workflow pending"
        ));
        Ok(())
    }

    #[test]
    fn prerequisite_task_cannot_create_a_child_dependency() -> anyhow::Result<()> {
        let task = ClaimedTask {
            id: TaskId::try_from("github-actions-pr-42")?,
            kind: "blocker".to_owned(),
            prompt: "Resolve failed workflow 42".to_owned(),
            source_commit: "0123456789abcdef0123456789abcdef01234567".to_owned(),
            attempt_id: AttemptId::try_from("attempt-1")?,
            attempt_number: 1,
            lease_token: LeaseToken::try_from("lease-1")?,
            owning_repairs: Vec::new(),
            dependency_context: Vec::new(),
            dependency_artifacts: Vec::new(),
        };
        let blocker = BlockerRequest {
            id: TaskId::try_from("github-workflow-token")?,
            title: "Provision workflow token".to_owned(),
            prompt: "Provide a credential with workflow scope.".to_owned(),
        };

        assert!(matches!(
            TaskDisposition::blocked_disposition(&task, "the available token lacks workflow scope", &blocker),
            TaskDisposition::Failed { reason }
                if reason.contains("prerequisite task could not complete")
                    && reason.contains("lacks workflow scope")
        ));
        Ok(())
    }

    #[test]
    fn main_repair_can_create_one_prerequisite_task() -> anyhow::Result<()> {
        let task = ClaimedTask {
            id: TaskId::try_from("main-failure-recovery")?,
            kind: "main-repair".to_owned(),
            prompt: "restore Main".to_owned(),
            source_commit: "0123456789abcdef0123456789abcdef01234567".to_owned(),
            attempt_id: AttemptId::try_from("attempt-1")?,
            attempt_number: 1,
            lease_token: LeaseToken::try_from("lease-1")?,
            owning_repairs: Vec::new(),
            dependency_context: Vec::new(),
            dependency_artifacts: Vec::new(),
        };
        let blocker = BlockerRequest {
            id: TaskId::try_from("repair-buildkit-cache")?,
            title: "Repair BuildKit cache".to_owned(),
            prompt: "Fix the repository-owned cache path.".to_owned(),
        };

        assert!(matches!(
            TaskDisposition::blocked_disposition(&task, "cache repair required", &blocker),
            TaskDisposition::Blocked { blocker, reason }
                if blocker.kind == "blocker"
                    && blocker.priority == 200
                    && reason == "cache repair required"
        ));
        Ok(())
    }

    #[test]
    fn blocker_prompt_requires_active_pr_ownership() -> anyhow::Result<()> {
        let task = ClaimedTask {
            id: TaskId::try_from("github-actions-pr-42")?,
            kind: "blocker".to_owned(),
            prompt: "Resolve failed workflow 42".to_owned(),
            source_commit: "0123456789abcdef0123456789abcdef01234567".to_owned(),
            attempt_id: AttemptId::try_from("attempt-1")?,
            attempt_number: 1,
            lease_token: LeaseToken::try_from("lease-1")?,
            owning_repairs: vec![TaskId::try_from("main-failure-abc-run-42-attempt-1")?],
            dependency_context: Vec::new(),
            dependency_artifacts: Vec::new(),
        };

        let prompt = ClaimedTask::task_prompt(&task);
        assert!(prompt.contains("prerequisite-ownership task"));
        assert!(prompt.contains("check out that existing PR branch"));
        assert!(prompt.contains("This task is a dependency leaf"));
        assert!(prompt.contains("this prerequisite obsolete"));
        assert!(prompt.contains("Never request another blocker"));
        assert!(!prompt.contains("reporting another blocker"));
        assert!(prompt.contains("report failed with a precise explanation"));
        assert!(prompt.contains("`blocker.present` set to false"));
        assert!(prompt.contains("bounded failed attempt"));
        assert!(prompt.contains("main-failure-abc-run-42-attempt-1"));
        assert!(prompt.contains("codex/hive-main-failure-abc-run-42-attempt-1"));
        let targets = ClaimedTask::obsolete_owner_delivery_targets(&[
            task.owning_repairs[0].clone(),
            TaskId::try_from("main-failure-def-run-43-attempt-1")?,
        ]);
        assert_eq!(targets.len(), 2);
        assert_eq!(targets[1].1, "codex/hive-main-failure-def-run-43-attempt-1");
        Ok(())
    }

    #[test]
    fn replacement_worker_inspects_direct_github_delivery_state() -> crate::HiveResult<()> {
        let task = ClaimedTask {
            id: TaskId::try_from("main-failure-recovery")?,
            kind: "main-repair".to_owned(),
            prompt: "restore Main".to_owned(),
            source_commit: "0123456789abcdef0123456789abcdef01234567".to_owned(),
            attempt_id: AttemptId::try_from("attempt-recovery")?,
            attempt_number: 2,
            lease_token: LeaseToken::try_from("lease-recovery")?,
            owning_repairs: Vec::new(),
            dependency_context: Vec::new(),
            dependency_artifacts: Vec::new(),
        };
        let prompt = ClaimedTask::task_prompt(&task);

        assert!(prompt.contains("GH_TOKEN"));
        assert!(prompt.contains("codex/hive-main-failure-recovery"));
        assert!(prompt.contains("replacement Pod"));
        assert!(prompt.contains("Main verification"));
        assert!(prompt.contains("[Hive]"));
        assert!(prompt.contains("`hive`"));
        assert!(prompt.contains("ci:full-e2e"));
        assert!(prompt.contains("task hive:guest:pr:ready PR=<number>"));
        assert!(prompt.contains("unresolved actionable review"));
        assert!(prompt.contains("next `-gN` delivery branch"));
        assert!(prompt.contains("Do not repeatedly audit an immutable merged branch"));
        assert!(prompt.contains("Never return the failed status"));
        assert!(prompt.contains("exactly one prerequisite request"));
        Ok(())
    }

    #[tokio::test]
    async fn activity_persistence_accepts_current_leases_and_rejects_stale_ones()
    -> crate::HiveResult<()> {
        let store = MemoryStore::default();
        store.enqueue(&task("activity-task", Vec::new())?).await?;
        let agent = AgentId::try_from("activity-agent")?;
        let claimed = crate::model::ClaimedTask::try_from(store.claim(&agent, 300).await?)?;
        let (sender, receiver) = mpsc::unbounded_channel();
        assert!(
            sender
                .send(TaskActivity {
                    kind: ActivityKind::Action,
                    message: "activity.command_running".into(),
                    detail: "focused test".into(),
                })
                .is_ok()
        );
        assert!(
            sender
                .send(TaskActivity {
                    kind: ActivityKind::Result,
                    message: "activity.command_completed".into(),
                    detail: "cargo test".into(),
                })
                .is_ok()
        );
        drop(sender);
        (TaskActivityStream {
            store: store.clone(),
            agent_id: agent.clone(),
            task: claimed.clone(),
            receiver,
        })
        .persist_activity()
        .await?;
        assert!(
            store
                .heartbeat(&claimed.id, &agent, &claimed.lease_token, 300)
                .await?
        );

        assert!(
            store
                .complete(crate::model::Completion {
                    task: &claimed,
                    agent_id: &agent,
                    relevance: crate::model::CompletionRelevance::Current,
                    summary: "activity captured",
                    artifact: &CompletionArtifact::NotProduced
                })
                .await?
        );
        let (sender, receiver) = mpsc::unbounded_channel();
        assert!(
            sender
                .send(TaskActivity {
                    kind: ActivityKind::Warning,
                    message: "activity.warning".into(),
                    detail: "stale writer".into(),
                })
                .is_ok()
        );
        drop(sender);
        let error = (TaskActivityStream {
            store,
            agent_id: agent,
            task: claimed,
            receiver,
        })
        .persist_activity()
        .await
        .err()
        .ok_or_else(|| crate::HiveError::message("stale activity writer was accepted"))?;
        assert!(matches!(
            error,
            crate::HiveError::WorkerCancellationRequested
        ));
        Ok(())
    }
}
