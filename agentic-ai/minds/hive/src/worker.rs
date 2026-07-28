use std::fmt::Write as _;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use anyhow::{Context, anyhow};
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
    ActivityLease, AgentId, Artifact, ClaimOutcome, ClaimedTask, CompletionArtifact, EnqueueTask,
    TaskActivity, TaskTrigger, TerminalResult,
};
use crate::store::TaskStore;

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

    pub async fn run(self) -> anyhow::Result<()> {
        establish_worker_lifecycle(&self.config.workspace, &self.config.pod_name)?;
        let external_auth = BrokerExternalAuth::connect(&self.config.auth_socket).await?;
        let lifecycle_marker = self.config.workspace.join(".hive-task-finished");
        if lifecycle_marker.exists() {
            return Err(anyhow!(
                "refusing to reuse a Pod that already finished a Hive task"
            ));
        }
        self.store.migrate().await?;
        self.store
            .register_agent(&self.config.agent_id, &self.config.pod_name)
            .await?;
        tokio::fs::write(self.config.workspace.join(".hive-worker-ready"), b"ready")
            .await
            .context("failed to publish worker readiness")?;

        let task = loop {
            if let Err(error) = external_auth.validate().await {
                let _ =
                    tokio::fs::remove_file(self.config.workspace.join(".hive-worker-ready")).await;
                tokio::fs::write(&lifecycle_marker, b"auth-channel-unavailable")
                    .await
                    .context("mark failed auth channel for Pod replacement")?;
                return Err(anyhow!(
                    "Hive auth channel failed before a task claim; replacing the Pod without \
                     consuming an attempt: {error}"
                ));
            }
            match self
                .store
                .claim(&self.config.agent_id, self.config.lease_seconds)
                .await?
            {
                ClaimOutcome::Claimed(task) => break task,
                ClaimOutcome::NoTask => {
                    self.store
                        .register_agent(&self.config.agent_id, &self.config.pod_name)
                        .await?;
                }
            }
            let wait = rand::rng()
                .random_range(self.config.poll_min_seconds..=self.config.poll_max_seconds);
            tokio::time::sleep(Duration::from_secs(wait)).await;
        };
        let result = self.execute(&task, external_auth).await;
        if let Err(error) = result {
            if error.downcast_ref::<WorkerBlocked>().is_some() {
                tokio::fs::write(&lifecycle_marker, task.id.as_str())
                    .await
                    .context("failed to mark the blocked Pod for replacement")?;
                return Ok(());
            }
            if error.downcast_ref::<WorkerInterrupted>().is_some() {
                tokio::fs::write(&lifecycle_marker, task.id.as_str())
                    .await
                    .context("failed to mark the interrupted Pod for replacement")?;
                return Ok(());
            }
            if error
                .downcast_ref::<WorkerCancellationRequested>()
                .is_some()
            {
                let acknowledged = self
                    .store
                    .acknowledge_cancellation(&task, &self.config.agent_id)
                    .await
                    .context("failed to acknowledge task cancellation")?;
                if !acknowledged {
                    return Err(anyhow!(
                        "task cancellation acknowledgement was rejected because the lease is stale"
                    ));
                }
                tokio::fs::write(&lifecycle_marker, task.id.as_str())
                    .await
                    .context("failed to mark the cancelled Pod for replacement")?;
                return Ok(());
            }
            let message = bounded(&format!("{error:#}"));
            let _ = self
                .store
                .fail(&task, &self.config.agent_id, &message)
                .await;
            tokio::fs::write(&lifecycle_marker, task.id.as_str())
                .await
                .context("failed to mark the Pod for replacement")?;
            return Err(anyhow!(
                "Hive task failed; bounded details were persisted in Neo4j"
            ));
        }
        tokio::fs::write(&lifecycle_marker, task.id.as_str())
            .await
            .context("failed to mark the Pod for replacement")?;
        Ok(())
    }

    async fn execute(
        &self,
        task: &ClaimedTask,
        external_auth: std::sync::Arc<BrokerExternalAuth>,
    ) -> anyhow::Result<()> {
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
                        .context("embedded Codex dependency resolution failed")?;
                        let result: TerminalResult = serde_json::from_str(&resolution)
                            .context("Codex returned an invalid dependency resolution result")?;
                        if !matches!(result, TerminalResult::Completed { .. }) {
                            return Err(anyhow!("Codex could not integrate dependency artifacts"));
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
                            .context("embedded Codex execution failed")?;
                    let result: TerminalResult = serde_json::from_str(&raw_result)
                        .context("Codex returned an invalid terminal result")?;
                    if let TerminalResult::Blocked {
                        summary, blocker, ..
                    } = &result
                    {
                        if blocker.id == task.id {
                            return Err(anyhow!(
                                "a blocked task cannot name itself as its blocker"
                            ));
                        }
                        let blocker = EnqueueTask {
                            id: blocker.id.clone(),
                            kind: "blocker".to_owned(),
                            trigger: TaskTrigger::AgentDependency,
                            prompt: format!("{}\n\n{}", blocker.title, blocker.prompt),
                            source_commit: task.source_commit.clone(),
                            priority: if task.kind == "main-repair" { 200 } else { 10 },
                            max_attempts: 3,
                            dependencies: Vec::new(),
                        };
                        return Ok(TaskDisposition::Blocked {
                            blocker,
                            reason: bounded(summary),
                        });
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
                    Ok::<TaskDisposition, anyhow::Error>(TaskDisposition::Completed {
                        summary,
                        artifact,
                    })
                }
                .await;
                drop(activity_tx);
                activity_persistence
                    .await
                    .context("task activity persistence panicked")??;
                let terminal_result: anyhow::Result<()> = match task_result? {
                    TaskDisposition::Completed { summary, artifact } => {
                        if !self
                            .store
                            .complete(task, &self.config.agent_id, &summary, &artifact)
                            .await?
                        {
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
                };
                terminal_result
            },
        );
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .context("failed to install the worker termination handler")?;
        tokio::pin!(execution);
        tokio::select! {
            biased;
            execution = &mut execution => {
                let _ = stop_tx.send(true);
                let completion_committed = matches!(&execution, Ok(Ok(())));
                let heartbeat_result = heartbeat
                    .await
                    .context("heartbeat task panicked")?;
                if !completion_committed {
                    heartbeat_result.context("lease heartbeat failed")?;
                }
                execution.map_err(|_| anyhow!("task timed out"))??
            }
            heartbeat_result = &mut heartbeat => {
                let heartbeat_result = heartbeat_result
                    .context("heartbeat task panicked")?
                    .context("lease heartbeat failed");
                if heartbeat_result
                    .as_ref()
                    .is_err_and(|error| error.downcast_ref::<WorkerCancellationRequested>().is_some())
                {
                    return Err(WorkerCancellationRequested.into());
                }
                heartbeat_result?;
                return Err(anyhow!("lease heartbeat stopped before task execution"));
            }
            signal = terminate.recv() => {
                if signal.is_none() {
                    return Err(anyhow!("worker termination signal stream closed"));
                }
                let _ = stop_tx.send(true);
                heartbeat
                    .await
                    .context("heartbeat task panicked")?
                    .context("lease heartbeat failed during termination")?;
                let released = self
                    .store
                    .release(task, &self.config.agent_id)
                    .await
                    .context("failed to release the task during termination")?;
                if !released {
                    return Err(anyhow!("task release was rejected because the lease is stale"));
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
) -> anyhow::Result<()> {
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
    },
    Blocked {
        blocker: EnqueueTask,
        reason: String,
    },
}

#[derive(Debug, thiserror::Error)]
#[error("worker cancellation requested")]
struct WorkerCancellationRequested;

fn establish_worker_lifecycle(workspace: &Path, pod_name: &str) -> anyhow::Result<()> {
    std::fs::create_dir_all(workspace)?;
    let startup_marker = workspace.join(".hive-worker-started");
    let startup_file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&startup_marker);
    let mut startup_file = match startup_file {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            std::fs::write(workspace.join(".hive-task-finished"), pod_name)?;
            return Err(error).context("refusing to restart a Hive worker inside an existing Pod");
        }
        Err(error) => return Err(error).context("failed to establish Hive worker lifecycle"),
    };
    startup_file.write_all(pod_name.as_bytes())?;
    startup_file.sync_all()?;
    Ok(())
}

async fn heartbeat_loop<S: TaskStore>(
    store: S,
    agent_id: AgentId,
    task: ClaimedTask,
    lease_seconds: i64,
    heartbeat_seconds: u64,
    mut stop: watch::Receiver<bool>,
) -> anyhow::Result<()> {
    let mut interval = tokio::time::interval(Duration::from_secs(heartbeat_seconds));
    let mut renewal = 0_u64;
    interval.tick().await;
    loop {
        tokio::select! {
            changed = stop.changed() => {
                if changed.is_err() || *stop.borrow() {
                    return Ok(());
                }
            }
            _ = interval.tick() => {
                let accepted = store
                    .heartbeat(
                        &task.id,
                        &agent_id,
                        &task.lease_token,
                        lease_seconds,
                    )
                    .await?;
                if !accepted {
                    return Err(WorkerCancellationRequested.into());
                }
                renewal += 1;
                eprintln!(
                    "Hive lease heartbeat accepted task={} renewal={renewal}",
                    task.id
                );
            }
        }
    }
}

async fn prepare_workspace(
    workspace: &Path,
    repository_url: &str,
    source_commit: &str,
    resume_branch: Option<&str>,
    dependency_artifacts: &[Artifact],
) -> anyhow::Result<WorkspacePreparation> {
    tokio::fs::create_dir_all(workspace.join("task")).await?;
    tokio::fs::create_dir_all(workspace.join("output")).await?;
    tokio::fs::create_dir_all(workspace.join("temporary")).await?;
    let repository = workspace.join("repository");
    if repository.join(".git").is_dir() {
        return Err(anyhow!(
            "refusing to reuse a repository left by an earlier worker process"
        ));
    }
    tokio::fs::create_dir_all(&repository).await?;
    let status = Command::new("git")
        .arg("init")
        .arg("--quiet")
        .arg(&repository)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .await
        .context("failed to initialize the task repository")?;
    if !status.success() {
        return Err(anyhow!("git init failed with status {status}"));
    }
    run_git_status(
        &repository,
        &["remote", "add", "origin", repository_url],
        "configure the task repository remote",
    )
    .await?;
    run_git_status(
        &repository,
        &["fetch", "--depth=1", "origin", source_commit],
        "fetch the pinned task revision",
    )
    .await?;
    let mut did_resume = false;
    if let Some(branch) = resume_branch {
        let resumed = Command::new("git")
            .args([
                "fetch",
                "--depth=100",
                "origin",
                &format!("refs/heads/{branch}"),
            ])
            .current_dir(&repository)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await?;
        if resumed.success() {
            run_git_status(
                &repository,
                &["checkout", "--quiet", "-B", branch, "FETCH_HEAD"],
                "resume the durable Hive repair branch",
            )
            .await?;
            run_git_status(
                &repository,
                &["merge-base", "--is-ancestor", source_commit, "HEAD"],
                "verify the repair branch descends from its pinned revision",
            )
            .await?;
            did_resume = true;
        }
    }
    if !did_resume {
        run_git_status(
            &repository,
            &["checkout", "--quiet", "--detach", source_commit],
            "check out the pinned task revision",
        )
        .await?;
    }
    validate_dependency_artifacts(dependency_artifacts)?;
    let mut applied_dependency = false;
    for (index, artifact) in dependency_artifacts.iter().enumerate() {
        if did_resume && patch_is_already_applied(&repository, artifact).await? {
            continue;
        }
        let mut child = Command::new("git")
            .args(["apply", "--3way", "--index", "--binary", "-"])
            .current_dir(&repository)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .spawn()
            .context("failed to apply a dependency artifact")?;
        child
            .stdin
            .take()
            .context("dependency patch stdin was unavailable")?
            .write_all(artifact.content.as_bytes())
            .await
            .context("failed to stream a dependency patch")?;
        let status = child
            .wait()
            .await
            .context("dependency patch process failed")?;
        if !status.success() {
            let unmerged = git_output(&repository, &["diff", "--name-only", "--diff-filter=U"])
                .await
                .context("inspect dependency conflicts")?;
            if unmerged.trim().is_empty() {
                return Err(anyhow!(
                    "dependency artifact {} failed to apply with status {status}",
                    artifact.id
                ));
            }
            let pending = repository.join(".hive-pending");
            tokio::fs::create_dir(&pending).await?;
            for (pending_index, pending_artifact) in
                dependency_artifacts.iter().enumerate().skip(index + 1)
            {
                tokio::fs::write(
                    pending.join(format!("{pending_index:04}.patch")),
                    pending_artifact.content.as_bytes(),
                )
                .await?;
            }
            return Ok(WorkspacePreparation {
                baseline: String::new(),
                conflicted: true,
                resumed: did_resume,
            });
        }
        applied_dependency = true;
    }
    if applied_dependency {
        let baseline = commit_dependency_baseline(&repository).await?;
        return Ok(WorkspacePreparation {
            baseline,
            conflicted: false,
            resumed: did_resume,
        });
    }
    Ok(WorkspacePreparation {
        baseline: git_output(&repository, &["rev-parse", "HEAD"]).await?,
        conflicted: false,
        resumed: did_resume,
    })
}

fn validate_dependency_artifacts(dependency_artifacts: &[Artifact]) -> anyhow::Result<()> {
    for artifact in dependency_artifacts {
        if artifact.kind != "git-patch" {
            return Err(anyhow!(
                "dependency artifact {} has unsupported kind {}",
                artifact.id,
                artifact.kind
            ));
        }
        let digest = Sha256::digest(artifact.content.as_bytes());
        let digest = format!(
            "sha256:{}",
            digest.iter().fold(
                String::with_capacity(digest.len() * 2),
                |mut encoded, byte| {
                    let _ = write!(encoded, "{byte:02x}");
                    encoded
                },
            )
        );
        if digest != artifact.digest {
            return Err(anyhow!(
                "dependency artifact {} failed digest verification",
                artifact.id
            ));
        }
    }
    Ok(())
}

async fn patch_is_already_applied(repository: &Path, artifact: &Artifact) -> anyhow::Result<bool> {
    let mut child = Command::new("git")
        .args(["apply", "--reverse", "--check", "--binary", "-"])
        .current_dir(repository)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .context("failed to inspect a resumed dependency artifact")?;
    child
        .stdin
        .take()
        .context("dependency reverse-check stdin was unavailable")?
        .write_all(artifact.content.as_bytes())
        .await
        .context("failed to stream a dependency reverse check")?;
    Ok(child
        .wait()
        .await
        .context("dependency reverse-check process failed")?
        .success())
}

#[derive(Debug, PartialEq, Eq)]
struct WorkspacePreparation {
    baseline: String,
    conflicted: bool,
    resumed: bool,
}

async fn ensure_dependencies_resolved(repository: &Path) -> anyhow::Result<()> {
    let unmerged = git_output(repository, &["diff", "--name-only", "--diff-filter=U"]).await?;
    if !unmerged.trim().is_empty() {
        anyhow::bail!("dependency integration left unresolved Git conflicts");
    }
    if repository.join(".hive-pending").exists() {
        anyhow::bail!("dependency integration did not apply every pending patch");
    }
    Ok(())
}

async fn commit_dependency_baseline(repository: &Path) -> anyhow::Result<String> {
    run_git_status(
        repository,
        &["add", "--all", "--", "."],
        "stage dependency artifacts",
    )
    .await?;
    run_git_status(
        repository,
        &[
            "-c",
            "user.name=Hive",
            "-c",
            "user.email=hive@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "Apply completed Hive dependencies",
        ],
        "commit dependency artifact baseline",
    )
    .await?;
    git_output(repository, &["rev-parse", "HEAD"]).await
}

async fn git_output(repository: &Path, arguments: &[&str]) -> anyhow::Result<String> {
    let output = Command::new("git")
        .args(arguments)
        .current_dir(repository)
        .stdin(Stdio::null())
        .output()
        .await
        .context("failed to execute git")?;
    if !output.status.success() {
        anyhow::bail!("git {:?} failed with status {}", arguments, output.status);
    }
    String::from_utf8(output.stdout)
        .context("git output is not UTF-8")
        .map(|value| value.trim().to_owned())
}

async fn run_git_status(
    repository: &Path,
    arguments: &[&str],
    operation: &str,
) -> anyhow::Result<()> {
    let status = Command::new("git")
        .args(arguments)
        .current_dir(repository)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .status()
        .await
        .with_context(|| format!("failed to {operation}"))?;
    if !status.success() {
        anyhow::bail!("{operation} failed with status {status}");
    }
    Ok(())
}

async fn persistable_patch(
    repository: &Path,
    baseline: &str,
    task: &ClaimedTask,
    result: &TerminalResult,
    resumed: bool,
) -> anyhow::Result<CompletionArtifact> {
    let add_status = Command::new("git")
        .args(["add", "--intent-to-add", "--", "."])
        .current_dir(repository)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .context("failed to stage untracked files for patch persistence")?;
    if !add_status.success() {
        return Err(anyhow!(
            "git add --intent-to-add failed with status {add_status}"
        ));
    }

    let output = Command::new("git")
        .args(["diff", "--binary", "--no-ext-diff", baseline, "--", "."])
        .current_dir(repository)
        .stdin(Stdio::null())
        .output()
        .await
        .context("failed to collect the durable task patch")?;
    if !output.status.success() {
        return Err(anyhow!("git diff failed with status {}", output.status));
    }
    if output.stdout.len() > MAX_PERSISTED_PATCH_BYTES {
        return Err(anyhow!(
            "task patch exceeds the {} byte prototype limit",
            MAX_PERSISTED_PATCH_BYTES
        ));
    }
    if output.stdout.is_empty() {
        if !resumed && !result.changed_files().is_empty() {
            return Err(anyhow!(
                "Codex reported changed files but produced no persistable git patch"
            ));
        }
        return Ok(CompletionArtifact::NotProduced);
    }

    let content = String::from_utf8(output.stdout).context("task patch is not UTF-8")?;
    let digest = Sha256::digest(content.as_bytes());
    let digest = digest.iter().fold(
        String::with_capacity(digest.len() * 2),
        |mut encoded, byte| {
            let _ = write!(encoded, "{byte:02x}");
            encoded
        },
    );
    let id = format!("{}:git-patch", task.attempt_id);
    Ok(CompletionArtifact::Produced(Artifact {
        uri: format!("hive://artifact/{id}"),
        id,
        kind: "git-patch".to_owned(),
        digest: format!("sha256:{digest}"),
        content,
    }))
}

fn task_prompt(task: &ClaimedTask) -> String {
    let dependencies = if task.dependency_context.is_empty() {
        "No dependency results.".to_owned()
    } else {
        task.dependency_context
            .iter()
            .map(|dependency| format!("- {}: {}", dependency.id, dependency.summary))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let delivery = if task.kind == "main-repair" {
        let branch = repair_branch_name(task.id.as_str());
        format!(
            "\n\nThis is an end-to-end Main repair. You own it until delivery is complete. \
         You are a trusted operator with direct GitHub access through `GH_TOKEN`. Use standard \
         `git`, `gh`, and repository Taskfile commands; run `gh auth setup-git` before the first \
         authenticated Git push. Reuse or create the deterministic branch \
         `{branch}` (or the next `-gN` generation after a closed or red-Main delivery), publish \
         the repair PR with a `[Hive]` title and both the `hive` and \
         `ci:full-e2e` labels, traverse all \
         checks and review feedback, fix and reply \
         to every actionable item, run `task hive:guest:pr:ready PR=<number>` for the exact-head \
         readiness audit, squash-merge, verify the \
         resulting Main workflow is green, and publish the required Workbench completion records \
         and statistics. Inspect GitHub first because a replacement Pod may be resuming a branch, \
         PR, merge, or Main verification completed by an earlier attempt. Do not report completed \
         before the squash merge and green Main verification. If blocked by another change, report \
         structured blocked status and identify the blocker precisely."
        )
    } else {
        String::new()
    };
    format!(
        "You are Hive worker attempt {} for task {}.\n\
         Work only inside the supplied repository workspace.\n\
         Complete the task and return the required structured terminal result.\n\n\
         Task kind: {}\n\
         Task:\n{}\n\n\
         Completed dependency context:\n{}{}",
        task.attempt_number, task.id, task.kind, task.prompt, dependencies, delivery
    )
}

fn repair_branch_name(task_id: &str) -> String {
    let slug = task_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>();
    format!("codex/hive-{}", slug.trim_matches('-'))
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
        MAX_PERSISTED_RESULT_BYTES, bounded, establish_worker_lifecycle, persistable_patch,
        prepare_workspace, task_prompt, validate_dependency_artifacts,
    };
    use crate::model::{
        Artifact, AttemptId, ClaimedTask, CompletionArtifact, LeaseToken, TaskId, TerminalResult,
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
    fn a_restarted_process_cannot_reuse_the_same_pod_workspace() -> anyhow::Result<()> {
        let workspace = tempfile::tempdir()?;

        establish_worker_lifecycle(workspace.path(), "pod-a")?;
        let error = establish_worker_lifecycle(workspace.path(), "pod-a")
            .expect_err("the second worker process must be rejected");

        assert!(
            error
                .to_string()
                .contains("refusing to restart a Hive worker")
        );
        assert!(workspace.path().join(".hive-task-finished").is_file());
        Ok(())
    }

    #[test]
    fn replacement_worker_inspects_direct_github_delivery_state() -> anyhow::Result<()> {
        let task = ClaimedTask {
            id: TaskId::new("main-failure-recovery")?,
            kind: "main-repair".to_owned(),
            prompt: "restore Main".to_owned(),
            source_commit: "0123456789abcdef0123456789abcdef01234567".to_owned(),
            attempt_id: AttemptId::new("attempt-recovery")?,
            attempt_number: 2,
            lease_token: LeaseToken::new("lease-recovery")?,
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
        Ok(())
    }

    #[test]
    fn every_dependency_artifact_is_verified_before_application() {
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
            .expect_err("a corrupt later patch must fail before the first patch is applied");
        assert!(error.to_string().contains("later-corrupt"));
    }

    #[tokio::test]
    async fn implementation_patch_is_durable_before_completion() -> anyhow::Result<()> {
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
            dependency_context: Vec::new(),
            dependency_artifacts: Vec::new(),
        };
        let result = TerminalResult::Completed {
            summary: "changed files".to_owned(),
            changed_files: vec!["tracked.txt".to_owned(), "new.txt".to_owned()],
            tests: Vec::new(),
        };

        let artifact =
            persistable_patch(repository.path(), baseline, &task, &result, false).await?;
        let CompletionArtifact::Produced(artifact) = artifact else {
            panic!("patch artifact");
        };

        assert_eq!(artifact.kind, "git-patch");
        assert!(artifact.digest.starts_with("sha256:"));
        assert!(artifact.content.contains("diff --git a/tracked.txt"));
        assert!(artifact.content.contains("diff --git a/new.txt"));
        assert!(artifact.content.contains("diff --git a/committed.txt"));
        Ok(())
    }

    #[tokio::test]
    async fn resumed_repair_accepts_changes_already_published_on_its_branch() -> anyhow::Result<()>
    {
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
            dependency_context: Vec::new(),
            dependency_artifacts: Vec::new(),
        };
        let result = TerminalResult::Completed {
            summary: "published repair delivered".to_owned(),
            changed_files: vec!["repair.txt".to_owned()],
            tests: Vec::new(),
        };

        assert!(matches!(
            persistable_patch(repository.path(), baseline.trim(), &task, &result, true).await?,
            CompletionArtifact::NotProduced
        ));
        Ok(())
    }

    #[tokio::test]
    async fn completed_dependency_patch_becomes_the_task_baseline() -> anyhow::Result<()> {
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
            dependency_context: Vec::new(),
            dependency_artifacts: Vec::new(),
        };
        let result = TerminalResult::Completed {
            summary: "task complete".to_owned(),
            changed_files: vec!["task.txt".to_owned()],
            tests: Vec::new(),
        };
        let artifact = persistable_patch(&repository, &baseline, &task, &result, false).await?;
        let CompletionArtifact::Produced(artifact) = artifact else {
            panic!("task patch");
        };
        assert!(artifact.content.contains("diff --git a/task.txt"));
        assert!(!artifact.content.contains("dependency.txt"));
        Ok(())
    }
}
