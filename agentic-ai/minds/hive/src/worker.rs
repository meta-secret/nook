use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use crate::HiveContext;
use codex::Arg0DispatchPaths;
use rand::RngExt;
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt as _;
use tokio::process::Command;
use tokio::sync::{mpsc, watch};

use crate::auth::BrokerExternalAuth;
use crate::codex::{CodexOptions, InProcessCodexRunner};
use crate::delivery::verify_main_repair_delivery;
use crate::model::{
    ActivityLease, AgentId, Artifact, BlockerRequest, ClaimedTask, CompletionArtifact, EnqueueTask,
    TaskActivity, TaskTrigger, TerminalResult,
};
use crate::store::TaskStore;

mod lifecycle;
mod task_prompt;
mod workspace;
use lifecycle::{
    ClaimStep, claim_once, establish_worker_lifecycle, mark_interrupted, shutdown_requested,
};
use task_prompt::*;
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
        establish_worker_lifecycle(&self.config.workspace, &self.config.pod_name)?;
        let external_auth = BrokerExternalAuth::connect(&self.config.auth_socket).await?;
        let lifecycle_marker = self.config.workspace.join(".hive-task-finished");
        if lifecycle_marker.exists() {
            return Err(crate::error::HiveError::message(
                "refusing to reuse a Pod that already finished a Hive task",
            ));
        }
        self.store.migrate().await?;
        self.store
            .register_agent(&self.config.agent_id, &self.config.pod_name)
            .await?;
        tokio::fs::write(self.config.workspace.join(".hive-worker-ready"), b"ready")
            .await
            .hive_context("failed to publish worker readiness")?;
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
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
                    tokio::fs::remove_file(self.config.workspace.join(".hive-worker-ready")).await;
                tokio::fs::write(&lifecycle_marker, b"auth-channel-unavailable")
                    .await
                    .hive_context("mark failed auth channel for Pod replacement")?;
                return Err(crate::error::HiveError::message(format!(
                    "Hive auth channel failed before a task claim; replacing the Pod without \
                     consuming an attempt: {error}"
                )));
            }
            match claim_once(
                &self.store,
                &self.config.agent_id,
                self.config.lease_seconds,
                shutdown_rx.clone(),
                &lifecycle_marker,
            )
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
                shutdown = shutdown_requested(shutdown_rx.clone()) => {
                    shutdown?;
                    mark_interrupted(&lifecycle_marker).await?;
                    return Ok(());
                }
                () = tokio::time::sleep(Duration::from_secs(wait)) => {}
            }
        };
        let result = self.execute(&task, external_auth, shutdown_rx).await;
        if let Err(error) = result {
            if matches!(error, crate::HiveError::WorkerBlocked) {
                tokio::fs::write(&lifecycle_marker, task.id.as_str())
                    .await
                    .hive_context("failed to mark the blocked Pod for replacement")?;
                return Ok(());
            }
            if matches!(error, crate::HiveError::WorkerInterrupted) {
                tokio::fs::write(&lifecycle_marker, task.id.as_str())
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
                    return Err(crate::error::HiveError::message(
                        "task cancellation acknowledgement was rejected because the lease is stale",
                    ));
                }
                tokio::fs::write(&lifecycle_marker, task.id.as_str())
                    .await
                    .hive_context("failed to mark the cancelled Pod for replacement")?;
                return Ok(());
            }
            let message = bounded(&format!("{error:#}"));
            let _ = self
                .store
                .fail(&task, &self.config.agent_id, &message)
                .await;
            tokio::fs::write(&lifecycle_marker, task.id.as_str())
                .await
                .hive_context("failed to mark the Pod for replacement")?;
            return Err(crate::error::HiveError::message(
                "Hive task failed; bounded details were persisted in Neo4j",
            ));
        }
        tokio::fs::write(&lifecycle_marker, task.id.as_str())
            .await
            .hive_context("failed to mark the Pod for replacement")?;
        Ok(())
    }

    async fn execute(
        &self,
        task: &ClaimedTask,
        external_auth: std::sync::Arc<BrokerExternalAuth>,
        shutdown: watch::Receiver<bool>,
    ) -> crate::HiveResult<()> {
        let (stop_tx, stop_rx) = watch::channel(false);
        let mut heartbeat = tokio::spawn(heartbeat_loop(
            self.store.clone(),
            self.config.agent_id.clone(),
            task.clone(),
            self.config.lease_seconds,
            self.config.heartbeat_seconds,
            stop_rx,
        ));

        let execution = tokio::time::timeout(
            Duration::from_secs(self.config.task_timeout_seconds),
            async {
                let (activity_tx, activity_rx) = mpsc::unbounded_channel();
                let activity_persistence = tokio::spawn(persist_activity(
                    self.store.clone(),
                    self.config.agent_id.clone(),
                    task.clone(),
                    activity_rx,
                ));
                let task_result = async {
                    let repair_branch =
                        (task.kind == "main-repair").then(|| repair_branch_name(task.id.as_str()));
                    let preparation = prepare_workspace(
                        &self.config.workspace,
                        &self.config.repository_url,
                        &task.source_commit,
                        repair_branch.as_deref(),
                        &task.dependency_artifacts,
                    )
                    .await?;
                    let repository = self.config.workspace.join("repository");
                    let baseline = if preparation.conflicted {
                        let mut codex_options = CodexOptions::new(repository.clone())
                            .with_workspace_write()
                            .with_activity_sender(activity_tx.clone());
                        codex_options.model.clone_from(&self.config.model);
                        codex_options.arg0_paths.clone_from(&self.config.arg0_paths);
                        codex_options
                            .reasoning_effort
                            .clone_from(&self.config.reasoning_effort);
                        let resolution = InProcessCodexRunner::with_external_auth(
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
                        let result: TerminalResult = serde_json::from_str(&resolution)
                            .hive_context(
                                "Codex returned an invalid dependency resolution result",
                            )?;
                        if !matches!(result, TerminalResult::Completed { .. }) {
                            return Err(crate::error::HiveError::message(
                                "Codex could not integrate dependency artifacts",
                            ));
                        }
                        ensure_dependencies_resolved(&repository).await?;
                        commit_dependency_baseline(&repository).await?
                    } else {
                        preparation.baseline
                    };
                    let prompt = task_prompt(task);
                    let mut codex_options = CodexOptions::new(repository.clone())
                        .with_workspace_write()
                        .with_activity_sender(activity_tx.clone());
                    codex_options.model.clone_from(&self.config.model);
                    codex_options.arg0_paths.clone_from(&self.config.arg0_paths);
                    codex_options
                        .reasoning_effort
                        .clone_from(&self.config.reasoning_effort);
                    let raw_result =
                        InProcessCodexRunner::with_external_auth(codex_options, external_auth)
                            .execute_task(task.id.as_str(), &prompt)
                            .await
                            .hive_context("embedded Codex execution failed")?;
                    let result: TerminalResult = serde_json::from_str(&raw_result)
                        .hive_context("Codex returned an invalid terminal result")?;
                    if let TerminalResult::Blocked {
                        summary, blocker, ..
                    } = &result
                    {
                        return Ok(blocked_disposition(task, summary, blocker));
                    }
                    let obsolete = completion_is_obsolete(task, &result);
                    if obsolete {
                        if task.owning_repairs.is_empty() {
                            return Err(crate::error::HiveError::message(
                                "obsolete blocker retirement requires active owning Main repairs",
                            ));
                        }
                        if !result.changed_files().is_empty() {
                            return Err(crate::error::HiveError::message(
                                "obsolete blocker retirement cannot report changed files",
                            ));
                        }
                        verify_obsolete_owner_deliveries(&repository, &task.owning_repairs).await?;
                    }
                    if task.kind == "main-repair" {
                        verify_main_repair_delivery(
                            &repository,
                            &repair_branch_name(task.id.as_str()),
                            task.id.as_str(),
                        )
                        .await?;
                    }
                    let summary = bounded(&format!(
                        "{}\n\nChanged files:\n{}\n\nTests:\n{}",
                        result.summary(),
                        bullet_list(result.changed_files()),
                        bullet_list(result.tests())
                    ));
                    let repository = self.config.workspace.join("repository");
                    let artifact = persistable_patch(
                        &repository,
                        &baseline,
                        task,
                        &result,
                        preparation.resumed,
                    )
                    .await?;
                    if obsolete && !matches!(artifact, CompletionArtifact::NotProduced) {
                        return Err(crate::error::HiveError::message(
                            "obsolete blocker retirement cannot persist a patch artifact",
                        ));
                    }
                    Ok::<TaskDisposition, crate::HiveError>(TaskDisposition::Completed {
                        summary,
                        artifact,
                        obsolete,
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
                        obsolete,
                    } => {
                        let accepted = self
                            .store
                            .complete(task, &self.config.agent_id, obsolete, &summary, &artifact)
                            .await?;
                        if !accepted && obsolete {
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
                            bounded(&reason)
                        );
                        if !self.store.release(task, &self.config.agent_id).await? {
                            return Err(WorkerCancellationRequested.into());
                        }
                        Err(WorkerBlocked.into())
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
                execution.map_err(|_| crate::error::HiveError::message("task timed out"))??
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
                return Err(crate::error::HiveError::message("lease heartbeat stopped before task execution"));
            }
            shutdown = shutdown_requested(shutdown) => {
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
                    return Err(crate::error::HiveError::message("task release was rejected because the lease is stale"));
                }
                return Err(WorkerInterrupted.into());
            }
        }
        Ok(())
    }
}

async fn persist_activity<S: TaskStore>(
    store: S,
    agent_id: AgentId,
    task: ClaimedTask,
    mut receiver: mpsc::UnboundedReceiver<TaskActivity>,
) -> crate::HiveResult<()> {
    let lease = ActivityLease::from(&task);
    while let Some(activity) = receiver.recv().await {
        if !store.record_activity(&lease, &agent_id, &activity).await? {
            return Err(WorkerCancellationRequested.into());
        }
    }
    Ok(())
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
        obsolete: bool,
    },
    Blocked {
        blocker: EnqueueTask,
        reason: String,
    },
    Deferred {
        reason: String,
    },
}

fn blocked_disposition(
    task: &ClaimedTask,
    summary: &str,
    blocker: &BlockerRequest,
) -> TaskDisposition {
    if blocker.id == task.id {
        return TaskDisposition::Deferred {
            reason: bounded(summary),
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
        reason: bounded(summary),
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

#[cfg(test)]
mod tests {
    use std::fmt::Write as _;

    use super::{
        MAX_PERSISTED_RESULT_BYTES, TaskDisposition, blocked_disposition, bounded,
        completion_is_obsolete, obsolete_owner_delivery_targets, persistable_patch,
        prepare_workspace, task_prompt, validate_dependency_artifacts,
    };
    use crate::model::{
        Artifact, AttemptId, BlockerRequest, ClaimedTask, CompletionArtifact, LeaseToken, TaskId,
        TerminalResult,
    };
    use sha2::{Digest, Sha256};

    #[test]
    fn persisted_results_are_utf8_safe_and_bounded() {
        let value = "🦀".repeat(MAX_PERSISTED_RESULT_BYTES);
        let bounded = bounded(&value);

        assert!(bounded.is_char_boundary(bounded.len()));
        assert!(bounded.len() <= MAX_PERSISTED_RESULT_BYTES + "\n[truncated]".len());
        assert!(bounded.ends_with("[truncated]"));
    }

    #[test]
    fn obsolete_completion_is_normalized_for_non_blocker_tasks() -> anyhow::Result<()> {
        let mut task = ClaimedTask {
            id: TaskId::new("main-failure-recovery")?,
            kind: "main-repair".to_owned(),
            prompt: "verify the delivered repair".to_owned(),
            source_commit: "0123456789abcdef0123456789abcdef01234567".to_owned(),
            attempt_id: AttemptId::new("attempt-1")?,
            attempt_number: 1,
            lease_token: LeaseToken::new("lease-1")?,
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

        assert!(!completion_is_obsolete(&task, &result));
        task.kind = "blocker".to_owned();
        assert!(completion_is_obsolete(&task, &result));
        Ok(())
    }

    #[test]
    fn self_named_external_blocker_defers_without_creating_a_dependency() -> anyhow::Result<()> {
        let task = ClaimedTask {
            id: TaskId::new("github-actions-pr-42")?,
            kind: "blocker".to_owned(),
            prompt: "Wait for the exact-head workflow".to_owned(),
            source_commit: "0123456789abcdef0123456789abcdef01234567".to_owned(),
            attempt_id: AttemptId::new("attempt-1")?,
            attempt_number: 1,
            lease_token: LeaseToken::new("lease-1")?,
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
            blocked_disposition(&task, "workflow pending", &blocker),
            TaskDisposition::Deferred { reason } if reason == "workflow pending"
        ));
        Ok(())
    }

    #[test]
    fn blocker_prompt_requires_active_pr_ownership() -> anyhow::Result<()> {
        let task = ClaimedTask {
            id: TaskId::new("github-actions-pr-42")?,
            kind: "blocker".to_owned(),
            prompt: "Resolve failed workflow 42".to_owned(),
            source_commit: "0123456789abcdef0123456789abcdef01234567".to_owned(),
            attempt_id: AttemptId::new("attempt-1")?,
            attempt_number: 1,
            lease_token: LeaseToken::new("lease-1")?,
            owning_repairs: vec![TaskId::new("main-failure-abc-run-42-attempt-1")?],
            dependency_context: Vec::new(),
            dependency_artifacts: Vec::new(),
        };

        let prompt = task_prompt(&task);
        assert!(prompt.contains("prerequisite-ownership task"));
        assert!(prompt.contains("check out that existing PR branch"));
        assert!(prompt.contains("Never report this task's own id as its blocker"));
        assert!(prompt.contains("this prerequisite obsolete"));
        assert!(prompt.contains("Never extend an obsolete blocker chain"));
        assert!(prompt.contains("main-failure-abc-run-42-attempt-1"));
        assert!(prompt.contains("codex/hive-main-failure-abc-run-42-attempt-1"));
        let targets = obsolete_owner_delivery_targets(&[
            task.owning_repairs[0].clone(),
            TaskId::new("main-failure-def-run-43-attempt-1")?,
        ]);
        assert_eq!(targets.len(), 2);
        assert_eq!(targets[1].1, "codex/hive-main-failure-def-run-43-attempt-1");
        Ok(())
    }

    #[test]
    fn replacement_worker_inspects_direct_github_delivery_state() -> crate::HiveResult<()> {
        let task = ClaimedTask {
            id: TaskId::new("main-failure-recovery")?,
            kind: "main-repair".to_owned(),
            prompt: "restore Main".to_owned(),
            source_commit: "0123456789abcdef0123456789abcdef01234567".to_owned(),
            attempt_id: AttemptId::new("attempt-recovery")?,
            attempt_number: 2,
            lease_token: LeaseToken::new("lease-recovery")?,
            owning_repairs: Vec::new(),
            dependency_context: Vec::new(),
            dependency_artifacts: Vec::new(),
        };
        let prompt = task_prompt(&task);

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
        Ok(())
    }

    #[test]
    fn every_dependency_artifact_is_verified_before_application() -> anyhow::Result<()> {
        let valid_content = "valid patch";
        let valid_digest = Sha256::digest(valid_content.as_bytes());
        let valid_digest = valid_digest.iter().fold(
            String::with_capacity(valid_digest.len() * 2),
            |mut encoded, byte| {
                let _ = write!(encoded, "{byte:02x}");
                encoded
            },
        );
        let artifacts = vec![
            Artifact {
                id: "first".to_owned(),
                kind: "git-patch".to_owned(),
                uri: "hive://artifact/first".to_owned(),
                digest: format!("sha256:{valid_digest}"),
                content: valid_content.to_owned(),
            },
            Artifact {
                id: "later-corrupt".to_owned(),
                kind: "git-patch".to_owned(),
                uri: "hive://artifact/later-corrupt".to_owned(),
                digest: "sha256:not-the-content-digest".to_owned(),
                content: "substituted patch".to_owned(),
            },
        ];

        let error = validate_dependency_artifacts(&artifacts)
            .err()
            .ok_or_else(|| {
                crate::error::HiveError::message(
                    "a corrupt later patch must fail before the first patch is applied",
                )
            })?;
        assert!(error.to_string().contains("later-corrupt"));
        Ok(())
    }

    #[tokio::test]
    async fn implementation_patch_is_durable_before_completion() -> crate::HiveResult<()> {
        let repository = tempfile::tempdir()?;
        let run_git = |arguments: &[&str]| -> std::io::Result<()> {
            let status = std::process::Command::new("git")
                .args(arguments)
                .current_dir(repository.path())
                .status()?;
            assert!(status.success());
            Ok(())
        };
        run_git(&["init", "--quiet"])?;
        std::fs::write(repository.path().join("tracked.txt"), "before\n")?;
        run_git(&["add", "tracked.txt"])?;
        run_git(&[
            "-c",
            "user.name=Hive Test",
            "-c",
            "user.email=hive@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "fixture",
        ])?;
        std::fs::write(repository.path().join("tracked.txt"), "after\n")?;
        std::fs::write(repository.path().join("new.txt"), "new\n")?;

        let baseline = std::process::Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(repository.path())
            .output()?;
        let baseline = String::from_utf8(baseline.stdout)?;
        let baseline = baseline.trim();
        std::fs::write(repository.path().join("committed.txt"), "committed\n")?;
        run_git(&["add", "committed.txt"])?;
        run_git(&[
            "-c",
            "user.name=Hive Test",
            "-c",
            "user.email=hive@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "task commit",
        ])?;
        std::fs::write(repository.path().join("tracked.txt"), "after\n")?;
        run_git(&["add", "tracked.txt"])?;
        std::fs::write(repository.path().join("new.txt"), "new\n")?;

        let task = ClaimedTask {
            id: TaskId::new("task-1")?,
            kind: "code".to_owned(),
            prompt: "change files".to_owned(),
            source_commit: "0123456789abcdef0123456789abcdef01234567".to_owned(),
            attempt_id: AttemptId::new("attempt-1")?,
            attempt_number: 1,
            lease_token: LeaseToken::new("lease-1")?,
            owning_repairs: Vec::new(),
            dependency_context: Vec::new(),
            dependency_artifacts: Vec::new(),
        };
        let result = TerminalResult::Completed {
            summary: "changed files".to_owned(),
            changed_files: vec!["tracked.txt".to_owned(), "new.txt".to_owned()],
            tests: Vec::new(),
            obsolete: false,
        };

        let artifact =
            persistable_patch(repository.path(), baseline, &task, &result, false).await?;
        let CompletionArtifact::Produced(artifact) = artifact else {
            return Err(crate::error::HiveError::message(
                "patch artifact must be produced",
            ));
        };

        assert_eq!(artifact.kind, "git-patch");
        assert!(artifact.digest.starts_with("sha256:"));
        assert!(artifact.content.contains("diff --git a/tracked.txt"));
        assert!(artifact.content.contains("diff --git a/new.txt"));
        assert!(artifact.content.contains("diff --git a/committed.txt"));
        Ok(())
    }

    #[tokio::test]
    async fn resumed_repair_accepts_changes_already_published_on_its_branch()
    -> crate::HiveResult<()> {
        let repository = tempfile::tempdir()?;
        let run_git = |arguments: &[&str]| -> std::io::Result<()> {
            let status = std::process::Command::new("git")
                .args(arguments)
                .current_dir(repository.path())
                .status()?;
            assert!(status.success());
            Ok(())
        };
        run_git(&["init", "--quiet"])?;
        std::fs::write(repository.path().join("repair.txt"), "published\n")?;
        run_git(&["add", "repair.txt"])?;
        run_git(&[
            "-c",
            "user.name=Hive Test",
            "-c",
            "user.email=hive@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "published repair",
        ])?;
        let baseline = std::process::Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(repository.path())
            .output()?;
        let baseline = String::from_utf8(baseline.stdout)?;
        let task = ClaimedTask {
            id: TaskId::new("resumed-task")?,
            kind: "main-repair".to_owned(),
            prompt: "finish delivery".to_owned(),
            source_commit: "0123456789abcdef0123456789abcdef01234567".to_owned(),
            attempt_id: AttemptId::new("resumed-attempt")?,
            attempt_number: 1,
            lease_token: LeaseToken::new("resumed-lease")?,
            owning_repairs: Vec::new(),
            dependency_context: Vec::new(),
            dependency_artifacts: Vec::new(),
        };
        let result = TerminalResult::Completed {
            summary: "published repair delivered".to_owned(),
            changed_files: vec!["repair.txt".to_owned()],
            tests: Vec::new(),
            obsolete: false,
        };

        assert!(matches!(
            persistable_patch(repository.path(), baseline.trim(), &task, &result, true).await?,
            CompletionArtifact::NotProduced
        ));
        Ok(())
    }

    #[tokio::test]
    async fn completed_dependency_patch_becomes_the_task_baseline() -> crate::HiveResult<()> {
        let source = tempfile::tempdir()?;
        let run_git = |arguments: &[&str]| -> std::io::Result<Vec<u8>> {
            let output = std::process::Command::new("git")
                .args(arguments)
                .current_dir(source.path())
                .output()?;
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            Ok(output.stdout)
        };
        run_git(&["init", "--quiet"])?;
        std::fs::write(source.path().join("dependency.txt"), "before\n")?;
        run_git(&["add", "dependency.txt"])?;
        run_git(&[
            "-c",
            "user.name=Hive Test",
            "-c",
            "user.email=hive@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "fixture",
        ])?;
        let source_commit = String::from_utf8(run_git(&["rev-parse", "HEAD"])?)?
            .trim()
            .to_owned();
        std::fs::write(source.path().join("dependency.txt"), "from dependency\n")?;
        let patch = String::from_utf8(run_git(&["diff", "--binary"])?)?;
        std::fs::write(source.path().join("dependency.txt"), "before\n")?;
        let digest = Sha256::digest(patch.as_bytes());
        let digest = digest.iter().fold(
            String::with_capacity(digest.len() * 2),
            |mut encoded, byte| {
                let _ = write!(encoded, "{byte:02x}");
                encoded
            },
        );
        let dependency = Artifact {
            id: "dependency:git-patch".to_owned(),
            kind: "git-patch".to_owned(),
            uri: "hive://artifact/dependency:git-patch".to_owned(),
            digest: format!("sha256:{digest}"),
            content: patch,
        };
        let resume_branch = "codex/hive-resume-test";
        run_git(&["checkout", "--quiet", "-b", resume_branch, &source_commit])?;
        std::fs::write(source.path().join("resumed.txt"), "durable branch\n")?;
        run_git(&["add", "resumed.txt"])?;
        run_git(&[
            "-c",
            "user.name=Hive Test",
            "-c",
            "user.email=hive@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "durable branch",
        ])?;
        let workspace = tempfile::tempdir()?;
        let preparation = prepare_workspace(
            workspace.path(),
            source
                .path()
                .to_str()
                .ok_or_else(|| std::io::Error::other("source path must be UTF-8"))?,
            &source_commit,
            None,
            std::slice::from_ref(&dependency),
        )
        .await?;
        assert!(!preparation.conflicted);
        let baseline = preparation.baseline;
        let repository = workspace.path().join("repository");
        assert_eq!(
            std::fs::read_to_string(repository.join("dependency.txt"))?,
            "from dependency\n"
        );
        let resumed_workspace = tempfile::tempdir()?;
        let resumed_preparation = prepare_workspace(
            resumed_workspace.path(),
            source
                .path()
                .to_str()
                .ok_or_else(|| std::io::Error::other("source path must be UTF-8"))?,
            &source_commit,
            Some(resume_branch),
            std::slice::from_ref(&dependency),
        )
        .await?;
        assert!(!resumed_preparation.conflicted);
        let resumed_repository = resumed_workspace.path().join("repository");
        assert_eq!(
            std::fs::read_to_string(resumed_repository.join("dependency.txt"))?,
            "from dependency\n"
        );
        assert_eq!(
            std::fs::read_to_string(resumed_repository.join("resumed.txt"))?,
            "durable branch\n"
        );
        std::fs::write(repository.join("task.txt"), "task result\n")?;
        let task = ClaimedTask {
            id: TaskId::new("task-2")?,
            kind: "code".to_owned(),
            prompt: "build on dependency".to_owned(),
            source_commit,
            attempt_id: AttemptId::new("attempt-2")?,
            attempt_number: 1,
            lease_token: LeaseToken::new("lease-2")?,
            owning_repairs: Vec::new(),
            dependency_context: Vec::new(),
            dependency_artifacts: Vec::new(),
        };
        let result = TerminalResult::Completed {
            summary: "task complete".to_owned(),
            changed_files: vec!["task.txt".to_owned()],
            tests: Vec::new(),
            obsolete: false,
        };
        let artifact = persistable_patch(&repository, &baseline, &task, &result, false).await?;
        let CompletionArtifact::Produced(artifact) = artifact else {
            return Err(crate::error::HiveError::message(
                "task patch must be produced",
            ));
        };
        assert!(artifact.content.contains("diff --git a/task.txt"));
        assert!(!artifact.content.contains("dependency.txt"));
        Ok(())
    }
}
