use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use anyhow::{Context, anyhow};
use rand::RngExt;
use tokio::process::Command;
use tokio::sync::watch;

use crate::codex::{CodexOptions, InProcessCodexRunner};
use crate::model::{AgentId, ClaimedTask, TerminalResult, TerminalStatus};
use crate::store::TaskStore;

const MAX_PERSISTED_RESULT_BYTES: usize = 64 * 1024;

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
            return Err(error);
        }
        tokio::fs::write(&lifecycle_marker, task.id.as_str())
            .await
            .context("failed to mark the Pod for replacement")?;
        Ok(())
    }

    async fn execute(&self, task: &ClaimedTask) -> anyhow::Result<()> {
        let (stop_tx, stop_rx) = watch::channel(false);
        let heartbeat = tokio::spawn(heartbeat_loop(
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
                codex_options
                    .reasoning_effort
                    .clone_from(&self.config.reasoning_effort);
                InProcessCodexRunner::new(codex_options)
                    .execute_task(task.id.as_str(), &prompt)
                    .await
                    .context("embedded Codex execution failed")
            },
        )
        .await;
        let _ = stop_tx.send(true);
        heartbeat
            .await
            .context("heartbeat task panicked")?
            .context("lease heartbeat failed")?;

        let raw_result = execution.map_err(|_| anyhow!("task timed out"))??;
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
        let accepted = self
            .store
            .complete(task, &self.config.agent_id, &summary)
            .await?;
        if !accepted {
            return Err(anyhow!(
                "task completion was rejected because the lease is stale"
            ));
        }
        Ok(())
    }
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
        return Ok(());
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
    use super::{MAX_PERSISTED_RESULT_BYTES, bounded};

    #[test]
    fn persisted_results_are_utf8_safe_and_bounded() {
        let value = "🦀".repeat(MAX_PERSISTED_RESULT_BYTES);
        let bounded = bounded(&value);

        assert!(bounded.is_char_boundary(bounded.len()));
        assert!(bounded.len() <= MAX_PERSISTED_RESULT_BYTES + "\n[truncated]".len());
        assert!(bounded.ends_with("[truncated]"));
    }
}
