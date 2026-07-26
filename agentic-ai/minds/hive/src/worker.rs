use std::fmt::Write as _;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use anyhow::{Context, anyhow};
use codex::Arg0DispatchPaths;
use rand::RngExt;
use sha2::{Digest, Sha256};
use tokio::process::Command;
use tokio::sync::watch;

use crate::codex::{CodexOptions, InProcessCodexRunner};
use crate::model::{AgentId, Artifact, ClaimedTask, TerminalResult, TerminalStatus};
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

        let result = self.execute(&task).await;
        if let Err(error) = result {
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

    async fn execute(&self, task: &ClaimedTask) -> anyhow::Result<()> {
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
                prepare_workspace(&self.config.workspace, &self.config.repository_url).await?;
                let repository = self.config.workspace.join("repository");
                let prompt = task_prompt(task);
                let mut codex_options = CodexOptions::new(repository).with_workspace_write();
                if let Some(model) = &self.config.model {
                    codex_options.model = Some(model.clone());
                }
                codex_options.arg0_paths.clone_from(&self.config.arg0_paths);
                codex_options
                    .reasoning_effort
                    .clone_from(&self.config.reasoning_effort);
                InProcessCodexRunner::new(codex_options)
                    .execute_task(task.id.as_str(), &prompt)
                    .await
                    .context("embedded Codex execution failed")
            },
        );
        tokio::pin!(execution);
        let raw_result = tokio::select! {
            execution = &mut execution => {
                let _ = stop_tx.send(true);
                heartbeat
                    .await
                    .context("heartbeat task panicked")?
                    .context("lease heartbeat failed")?;
                execution.map_err(|_| anyhow!("task timed out"))??
            }
            heartbeat_result = &mut heartbeat => {
                heartbeat_result
                    .context("heartbeat task panicked")?
                    .context("lease heartbeat failed")?;
                return Err(anyhow!("lease heartbeat stopped before task execution"));
            }
        };
        let result: TerminalResult = serde_json::from_str(&raw_result)
            .context("Codex returned an invalid terminal result")?;
        if result.status == TerminalStatus::Blocked {
            return Err(anyhow!("Codex reported a blocked task: {}", result.summary));
        }
        let summary = bounded(&format!(
            "{}\n\nChanged files:\n{}\n\nTests:\n{}",
            result.summary,
            bullet_list(&result.changed_files),
            bullet_list(&result.tests)
        ));
        let repository = self.config.workspace.join("repository");
        let artifact = persistable_patch(&repository, task, &result).await?;
        let accepted = self
            .store
            .complete(task, &self.config.agent_id, &summary, artifact.as_ref())
            .await?;
        if !accepted {
            return Err(anyhow!(
                "task completion was rejected because the lease is stale"
            ));
        }
        Ok(())
    }
}

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

async fn prepare_workspace(workspace: &Path, repository_url: &str) -> anyhow::Result<()> {
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
        .arg("clone")
        .arg("--depth=1")
        .arg("--")
        .arg(repository_url)
        .arg(&repository)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .await
        .context("failed to start git clone")?;
    if !status.success() {
        return Err(anyhow!("git clone failed with status {status}"));
    }
    Ok(())
}

async fn persistable_patch(
    repository: &Path,
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
        .args(["diff", "--binary", "--no-ext-diff", "--", "."])
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
    format!(
        "You are Hive worker attempt {} for task {}.\n\
         Work only inside the supplied repository workspace.\n\
         Complete the task and return the required structured terminal result.\n\n\
         Task kind: {}\n\
         Task:\n{}\n\n\
         Completed dependency context:\n{}",
        task.attempt_number, task.id, task.kind, task.prompt, dependencies
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
    use super::{
        MAX_PERSISTED_RESULT_BYTES, bounded, establish_worker_lifecycle, persistable_patch,
    };
    use crate::model::{
        AttemptId, ClaimedTask, LeaseToken, TaskId, TerminalResult, TerminalStatus,
    };

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

        let task = ClaimedTask {
            id: TaskId::new("task-1").unwrap(),
            kind: "code".to_owned(),
            prompt: "change files".to_owned(),
            attempt_id: AttemptId::new("attempt-1").unwrap(),
            attempt_number: 1,
            lease_token: LeaseToken::new("lease-1").unwrap(),
            dependency_context: Vec::new(),
        };
        let result = TerminalResult {
            status: TerminalStatus::Completed,
            summary: "changed files".to_owned(),
            changed_files: vec!["tracked.txt".to_owned(), "new.txt".to_owned()],
            tests: Vec::new(),
        };

        let artifact = persistable_patch(repository.path(), &task, &result)
            .await
            .unwrap()
            .expect("patch artifact");

        assert_eq!(artifact.kind, "git-patch");
        assert!(artifact.digest.starts_with("sha256:"));
        assert!(artifact.content.contains("diff --git a/tracked.txt"));
        assert!(artifact.content.contains("diff --git a/new.txt"));
    }
}
