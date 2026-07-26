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
use tokio::sync::watch;

use crate::auth::BrokerExternalAuth;
use crate::codex::{CodexOptions, InProcessCodexRunner};
use crate::model::{AgentId, Artifact, ClaimedTask, EnqueueTask, TerminalResult, TerminalStatus};
use crate::publication::{bind_publication_task, publication_delivery_verified};
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
    pub model: Option<String>,
    pub reasoning_effort: String,
    pub arg0_paths: Arg0DispatchPaths,
    pub auth_socket: PathBuf,
    pub publication_socket: PathBuf,
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
            if let Some(task) = self
                .store
                .claim(&self.config.agent_id, self.config.lease_seconds)
                .await?
            {
                break task;
            }
            let wait = rand::rng()
                .random_range(self.config.poll_min_seconds..=self.config.poll_max_seconds);
            tokio::time::sleep(Duration::from_secs(wait)).await;
        };
        let publication_branch = match bind_publication_task(
            &self.config.publication_socket,
            &task,
            task.kind == "main-repair",
        )
        .await
        {
            Ok(branch) => branch,
            Err(error) => {
                let released = self
                    .store
                    .release(&task, &self.config.agent_id)
                    .await
                    .context("release task after publication broker binding failed")?;
                tokio::fs::write(&lifecycle_marker, task.id.as_str())
                    .await
                    .context("mark publication-binding failure for Pod replacement")?;
                if !released {
                    return Err(anyhow!(
                        "publication broker binding failed after the task lease expired: \
                             {error:#}"
                    ));
                }
                return Err(anyhow!(
                    "publication broker binding failed; the task claim was released without \
                        consuming an attempt: {error:#}"
                ));
            }
        };

        let result = self
            .execute(&task, external_auth, &publication_branch)
            .await;
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
        publication_branch: &str,
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
                let resume_branch = (task.kind == "main-repair").then_some(publication_branch);
                let preparation = prepare_workspace(
                    &self.config.workspace,
                    &self.config.repository_url,
                    &task.source_commit,
                    resume_branch.as_deref(),
                    &task.dependency_artifacts,
                )
                .await?;
                let repository = self.config.workspace.join("repository");
                let baseline = if preparation.conflicted {
                    let mut codex_options =
                        CodexOptions::new(repository.clone()).with_workspace_write();
                    if let Some(model) = &self.config.model {
                        codex_options.model = Some(model.clone());
                    }
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
                    if result.status != TerminalStatus::Completed {
                        return Err(anyhow!("Codex could not integrate dependency artifacts"));
                    }
                    ensure_dependencies_resolved(&repository).await?;
                    commit_dependency_baseline(&repository).await?
                } else {
                    preparation.baseline
                };
                let prompt = task_prompt(task);
                let mut codex_options = CodexOptions::new(repository).with_workspace_write();
                if let Some(model) = &self.config.model {
                    codex_options.model = Some(model.clone());
                }
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
                if result.status == TerminalStatus::Blocked {
                    let blocker = result
                        .blocker
                        .as_ref()
                        .context("Codex blocked the task without a structured blocker")?;
                    if blocker.id == task.id {
                        return Err(anyhow!("a blocked task cannot name itself as its blocker"));
                    }
                    let blocker = EnqueueTask {
                        id: blocker.id.clone(),
                        kind: "blocker".to_owned(),
                        prompt: format!("{}\n\n{}", blocker.title, blocker.prompt),
                        source_commit: task.source_commit.clone(),
                        priority: if task.kind == "main-repair" { 200 } else { 10 },
                        max_attempts: 3,
                        dependencies: Vec::new(),
                    };
                    let accepted = self
                        .store
                        .block(
                            task,
                            &self.config.agent_id,
                            &blocker,
                            &bounded(&result.summary),
                        )
                        .await?;
                    if !accepted {
                        return Err(anyhow!(
                            "task blocker was rejected because the lease is stale"
                        ));
                    }
                    return Err(WorkerBlocked.into());
                }
                if result.blocker.is_some() {
                    return Err(anyhow!("Codex returned a blocker for a completed task"));
                }
                if task.kind == "main-repair"
                    && !publication_delivery_verified(&self.config.publication_socket).await?
                {
                    return Err(anyhow!(
                        "Main repair cannot complete before its squash merge and green Main run"
                    ));
                }
                let summary = bounded(&format!(
                    "{}\n\nChanged files:\n{}\n\nTests:\n{}",
                    result.summary,
                    bullet_list(&result.changed_files),
                    bullet_list(&result.tests)
                ));
                let repository = self.config.workspace.join("repository");
                let artifact = persistable_patch(&repository, &baseline, task, &result).await?;
                let accepted = self
                    .store
                    .complete(task, &self.config.agent_id, &summary, artifact.as_ref())
                    .await?;
                if !accepted {
                    return Err(anyhow!(
                        "task completion was rejected because the lease is stale"
                    ));
                }
                Ok::<(), anyhow::Error>(())
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
                heartbeat_result
                    .context("heartbeat task panicked")?
                    .context("lease heartbeat failed")?;
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

#[derive(Debug, thiserror::Error)]
#[error("worker interrupted for rollout")]
struct WorkerInterrupted;

#[derive(Debug, thiserror::Error)]
#[error("worker persisted a blocking dependency")]
struct WorkerBlocked;

fn establish_worker_lifecycle(workspace: &Path, pod_name: &str) -> anyhow::Result<()> {
    std::fs::create_dir_all(workspace)?;
    let startup_marker = workspace.join(".hive-worker-started");
    let mut startup_file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&startup_marker)
        .context("refusing to restart a Hive worker inside an existing Pod")?;
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
                    return Err(anyhow!("lease was replaced or expired"));
                }
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
    let mut applied_dependency = false;
    for (index, artifact) in dependency_artifacts.iter().enumerate() {
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
            });
        }
        applied_dependency = true;
    }
    if applied_dependency {
        let baseline = commit_dependency_baseline(&repository).await?;
        return Ok(WorkspacePreparation {
            baseline,
            conflicted: false,
        });
    }
    Ok(WorkspacePreparation {
        baseline: git_output(&repository, &["rev-parse", "HEAD"]).await?,
        conflicted: false,
    })
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
) -> anyhow::Result<Option<Artifact>> {
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
        if !result.changed_files.is_empty() {
            return Err(anyhow!(
                "Codex reported changed files but produced no persistable git patch"
            ));
        }
        return Ok(None);
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
    Ok(Some(Artifact {
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
        "\n\nThis is an end-to-end Main repair. You own it until delivery is complete. \
         Use only repository Taskfile commands for formatting and validation. Use \
         `hive github publish --title <title> --body <body>` to push the deterministic \
         task branch and create or update its PR, `hive github inspect` to wait for and \
         address exact-head checks and every review surface, `hive github reply-thread`, \
         `hive github resolve-thread`, and `hive github reply-feedback` after each targeted \
         fix, `hive github merge \
         --expected-head <sha>` \
         only after every check succeeds, and `hive github verify-main --merge-commit <sha>` \
         until the resulting Main run succeeds. Do not report completed before the squash \
         merge and green Main verification. If blocked by another change, report structured \
         blocked status and identify the blocker precisely."
    } else {
        ""
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
        prepare_workspace,
    };
    use crate::model::{
        Artifact, AttemptId, ClaimedTask, LeaseToken, TaskId, TerminalResult, TerminalStatus,
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
    fn a_restarted_process_cannot_reuse_the_same_pod_workspace() {
        let workspace = tempfile::tempdir().unwrap();

        establish_worker_lifecycle(workspace.path(), "pod-a").unwrap();
        let error = establish_worker_lifecycle(workspace.path(), "pod-a")
            .expect_err("the second worker process must be rejected");

        assert!(
            error
                .to_string()
                .contains("refusing to restart a Hive worker")
        );
    }

    #[tokio::test]
    async fn implementation_patch_is_durable_before_completion() {
        let repository = tempfile::tempdir().unwrap();
        let run_git = |arguments: &[&str]| {
            let status = std::process::Command::new("git")
                .args(arguments)
                .current_dir(repository.path())
                .status()
                .unwrap();
            assert!(status.success());
        };
        run_git(&["init", "--quiet"]);
        std::fs::write(repository.path().join("tracked.txt"), "before\n").unwrap();
        run_git(&["add", "tracked.txt"]);
        run_git(&[
            "-c",
            "user.name=Hive Test",
            "-c",
            "user.email=hive@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "fixture",
        ]);
        std::fs::write(repository.path().join("tracked.txt"), "after\n").unwrap();
        std::fs::write(repository.path().join("new.txt"), "new\n").unwrap();

        let baseline = std::process::Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(repository.path())
            .output()
            .unwrap();
        let baseline = String::from_utf8(baseline.stdout).unwrap();
        let baseline = baseline.trim();
        std::fs::write(repository.path().join("committed.txt"), "committed\n").unwrap();
        run_git(&["add", "committed.txt"]);
        run_git(&[
            "-c",
            "user.name=Hive Test",
            "-c",
            "user.email=hive@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "task commit",
        ]);
        std::fs::write(repository.path().join("tracked.txt"), "after\n").unwrap();
        run_git(&["add", "tracked.txt"]);
        std::fs::write(repository.path().join("new.txt"), "new\n").unwrap();

        let task = ClaimedTask {
            id: TaskId::new("task-1").unwrap(),
            kind: "code".to_owned(),
            prompt: "change files".to_owned(),
            source_commit: "0123456789abcdef0123456789abcdef01234567".to_owned(),
            attempt_id: AttemptId::new("attempt-1").unwrap(),
            attempt_number: 1,
            lease_token: LeaseToken::new("lease-1").unwrap(),
            dependency_context: Vec::new(),
            dependency_artifacts: Vec::new(),
        };
        let result = TerminalResult {
            status: TerminalStatus::Completed,
            summary: "changed files".to_owned(),
            changed_files: vec!["tracked.txt".to_owned(), "new.txt".to_owned()],
            tests: Vec::new(),
            blocker: None,
        };

        let artifact = persistable_patch(repository.path(), baseline, &task, &result)
            .await
            .unwrap()
            .expect("patch artifact");

        assert_eq!(artifact.kind, "git-patch");
        assert!(artifact.digest.starts_with("sha256:"));
        assert!(artifact.content.contains("diff --git a/tracked.txt"));
        assert!(artifact.content.contains("diff --git a/new.txt"));
        assert!(artifact.content.contains("diff --git a/committed.txt"));
    }

    #[tokio::test]
    async fn completed_dependency_patch_becomes_the_task_baseline() {
        let source = tempfile::tempdir().unwrap();
        let run_git = |arguments: &[&str]| {
            let output = std::process::Command::new("git")
                .args(arguments)
                .current_dir(source.path())
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            output.stdout
        };
        run_git(&["init", "--quiet"]);
        std::fs::write(source.path().join("dependency.txt"), "before\n").unwrap();
        run_git(&["add", "dependency.txt"]);
        run_git(&[
            "-c",
            "user.name=Hive Test",
            "-c",
            "user.email=hive@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "fixture",
        ]);
        let source_commit = String::from_utf8(run_git(&["rev-parse", "HEAD"]))
            .unwrap()
            .trim()
            .to_owned();
        std::fs::write(source.path().join("dependency.txt"), "from dependency\n").unwrap();
        let patch = String::from_utf8(run_git(&["diff", "--binary"])).unwrap();
        std::fs::write(source.path().join("dependency.txt"), "before\n").unwrap();
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
        run_git(&["checkout", "--quiet", "-b", resume_branch, &source_commit]);
        std::fs::write(source.path().join("resumed.txt"), "durable branch\n").unwrap();
        run_git(&["add", "resumed.txt"]);
        run_git(&[
            "-c",
            "user.name=Hive Test",
            "-c",
            "user.email=hive@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "durable branch",
        ]);
        let workspace = tempfile::tempdir().unwrap();
        let preparation = prepare_workspace(
            workspace.path(),
            source.path().to_str().unwrap(),
            &source_commit,
            None,
            std::slice::from_ref(&dependency),
        )
        .await
        .unwrap();
        assert!(!preparation.conflicted);
        let baseline = preparation.baseline;
        let repository = workspace.path().join("repository");
        assert_eq!(
            std::fs::read_to_string(repository.join("dependency.txt")).unwrap(),
            "from dependency\n"
        );
        let resumed_workspace = tempfile::tempdir().unwrap();
        let resumed_preparation = prepare_workspace(
            resumed_workspace.path(),
            source.path().to_str().unwrap(),
            &source_commit,
            Some(resume_branch),
            std::slice::from_ref(&dependency),
        )
        .await
        .unwrap();
        assert!(!resumed_preparation.conflicted);
        let resumed_repository = resumed_workspace.path().join("repository");
        assert_eq!(
            std::fs::read_to_string(resumed_repository.join("dependency.txt")).unwrap(),
            "from dependency\n"
        );
        assert_eq!(
            std::fs::read_to_string(resumed_repository.join("resumed.txt")).unwrap(),
            "durable branch\n"
        );
        std::fs::write(repository.join("task.txt"), "task result\n").unwrap();
        let task = ClaimedTask {
            id: TaskId::new("task-2").unwrap(),
            kind: "code".to_owned(),
            prompt: "build on dependency".to_owned(),
            source_commit,
            attempt_id: AttemptId::new("attempt-2").unwrap(),
            attempt_number: 1,
            lease_token: LeaseToken::new("lease-2").unwrap(),
            dependency_context: Vec::new(),
            dependency_artifacts: Vec::new(),
        };
        let result = TerminalResult {
            status: TerminalStatus::Completed,
            summary: "task complete".to_owned(),
            changed_files: vec!["task.txt".to_owned()],
            tests: Vec::new(),
            blocker: None,
        };
        let artifact = persistable_patch(&repository, &baseline, &task, &result)
            .await
            .unwrap()
            .expect("task patch");
        assert!(artifact.content.contains("diff --git a/task.txt"));
        assert!(!artifact.content.contains("dependency.txt"));
    }
}
