use std::future::Future;
use std::io::Write as _;
use std::path::Path;
use std::time::Duration;

use tokio::sync::watch;

use crate::model::{AgentId, ClaimOutcome, ClaimedTask};
use crate::store::TaskStore;
use crate::{HiveContext, HiveResult};

pub(super) enum ClaimWindow<T> {
    Completed(T),
    CompletedDuringShutdown(T),
    Stopped,
}

pub(super) enum ClaimStep {
    Claimed(Box<ClaimedTask>),
    NoTask,
    Stopped,
}

pub(super) async fn claim_once<S: TaskStore>(
    store: &S,
    agent_id: &AgentId,
    lease_seconds: i64,
    shutdown: watch::Receiver<bool>,
    lifecycle_marker: &Path,
) -> HiveResult<ClaimStep> {
    let claim = store.claim(agent_id, lease_seconds);
    match finish_claim_during_shutdown(claim, shutdown).await {
        ClaimWindow::Stopped => {
            mark_interrupted(lifecycle_marker).await?;
            Ok(ClaimStep::Stopped)
        }
        ClaimWindow::CompletedDuringShutdown(outcome) => {
            match outcome {
                Ok(ClaimOutcome::Claimed(task)) => {
                    release_during_shutdown(store, &task, agent_id).await;
                }
                Ok(ClaimOutcome::NoTask) => {}
                Err(error) => {
                    mark_interrupted(lifecycle_marker).await?;
                    return Err(error);
                }
            }
            mark_interrupted(lifecycle_marker).await?;
            Ok(ClaimStep::Stopped)
        }
        ClaimWindow::Completed(Ok(ClaimOutcome::Claimed(task))) => Ok(ClaimStep::Claimed(task)),
        ClaimWindow::Completed(Ok(ClaimOutcome::NoTask)) => Ok(ClaimStep::NoTask),
        ClaimWindow::Completed(Err(error)) => Err(error),
    }
}

async fn release_during_shutdown<S: TaskStore>(store: &S, task: &ClaimedTask, agent_id: &AgentId) {
    loop {
        match store.release(task, agent_id).await {
            Ok(_) => return,
            Err(_) => tokio::time::sleep(Duration::from_millis(250)).await,
        }
    }
}

pub(super) async fn mark_interrupted(lifecycle_marker: &Path) -> HiveResult<()> {
    tokio::fs::write(lifecycle_marker, b"rollout-before-execution")
        .await
        .hive_context("mark interrupted Pod for replacement")
}

pub(super) async fn finish_claim_during_shutdown<F, T>(
    claim: F,
    shutdown: watch::Receiver<bool>,
) -> ClaimWindow<T>
where
    F: Future<Output = T>,
{
    if *shutdown.borrow() {
        return ClaimWindow::Stopped;
    }
    tokio::pin!(claim);
    tokio::select! {
        biased;
        requested = shutdown_requested(shutdown) => {
            if requested.is_err() {
                return ClaimWindow::Stopped;
            }
            ClaimWindow::CompletedDuringShutdown(claim.await)
        }
        result = &mut claim => ClaimWindow::Completed(result),
    }
}

pub(super) async fn shutdown_requested(mut shutdown: watch::Receiver<bool>) -> HiveResult<()> {
    shutdown
        .wait_for(|requested| *requested)
        .await
        .map(|_| ())
        .hive_context("worker termination signal relay stopped")
}

pub(super) fn establish_worker_lifecycle(workspace: &Path, pod_name: &str) -> HiveResult<()> {
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
            return Err(error)
                .hive_context("refusing to restart a Hive worker inside an existing Pod");
        }
        Err(error) => {
            return Err(error).hive_context("failed to establish Hive worker lifecycle");
        }
    };
    startup_file.write_all(pod_name.as_bytes())?;
    startup_file.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    use async_trait::async_trait;
    use tokio::sync::Notify;

    use super::{
        ClaimStep, ClaimWindow, claim_once, establish_worker_lifecycle,
        finish_claim_during_shutdown,
    };
    use crate::model::{
        ActivityLease, AgentId, AttemptId, CancellationTarget, ClaimOutcome, ClaimedTask,
        CompletionArtifact, EnqueueTask, LeaseToken, TaskActivity, TaskId,
    };
    use crate::store::TaskStore;

    #[tokio::test]
    async fn shutdown_finishes_an_inflight_claim_before_releasing_control() -> anyhow::Result<()> {
        let (claim_tx, claim_rx) = tokio::sync::oneshot::channel();
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
        let claim = tokio::spawn(finish_claim_during_shutdown(
            async move {
                let _ = started_tx.send(());
                claim_rx.await
            },
            shutdown_rx,
        ));

        started_rx.await?;
        shutdown_tx.send(true)?;
        tokio::task::yield_now().await;
        assert!(
            !claim.is_finished(),
            "shutdown must not cancel a claim that can still commit in Neo4j"
        );
        claim_tx
            .send("claimed")
            .map_err(|_| anyhow::anyhow!("claim receiver stopped before completion"))?;

        assert!(matches!(
            claim.await?,
            ClaimWindow::CompletedDuringShutdown(Ok("claimed"))
        ));
        Ok(())
    }

    #[tokio::test]
    async fn shutdown_before_polling_does_not_start_a_new_claim() -> anyhow::Result<()> {
        let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
        shutdown_tx.send(true)?;

        assert!(matches!(
            finish_claim_during_shutdown(async { panic!("claim was polled") }, shutdown_rx).await,
            ClaimWindow::Stopped
        ));
        Ok(())
    }

    #[tokio::test]
    async fn shutdown_releases_an_inflight_claim_before_writing_the_marker() -> anyhow::Result<()> {
        let workspace = tempfile::tempdir()?;
        let marker = workspace.path().join(".hive-task-finished");
        let store = RecordingStore::new(marker.clone())?;
        let agent = AgentId::new("agent-a")?;
        let (_shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
        let shutdown_tx = _shutdown_tx;
        let claim_store = store.clone();
        let claim_agent = agent.clone();
        let claim_marker = marker.clone();
        let claim = tokio::spawn(async move {
            claim_once(&claim_store, &claim_agent, 3600, shutdown_rx, &claim_marker).await
        });

        store.claim_started.notified().await;
        shutdown_tx.send(true)?;
        store.finish_claim.notify_one();

        assert!(matches!(claim.await??, ClaimStep::Stopped));
        assert!(store.released.load(Ordering::SeqCst));
        assert_eq!(store.release_attempts.load(Ordering::SeqCst), 2);
        assert!(marker.is_file());
        Ok(())
    }

    #[test]
    fn a_restarted_process_cannot_reuse_the_same_pod_workspace() -> anyhow::Result<()> {
        let workspace = tempfile::tempdir()?;

        establish_worker_lifecycle(workspace.path(), "pod-a")?;
        let error = establish_worker_lifecycle(workspace.path(), "pod-a")
            .err()
            .ok_or_else(|| anyhow::anyhow!("the second worker process must be rejected"))?;

        assert!(
            error
                .to_string()
                .contains("refusing to restart a Hive worker")
        );
        assert!(workspace.path().join(".hive-task-finished").is_file());
        Ok(())
    }

    #[derive(Clone)]
    struct RecordingStore {
        task: ClaimedTask,
        marker: PathBuf,
        claim_started: Arc<Notify>,
        finish_claim: Arc<Notify>,
        released: Arc<AtomicBool>,
        release_attempts: Arc<AtomicUsize>,
    }

    impl RecordingStore {
        fn new(marker: PathBuf) -> anyhow::Result<Self> {
            Ok(Self {
                task: ClaimedTask {
                    id: TaskId::new("task-a")?,
                    kind: "main-repair".to_owned(),
                    prompt: "repair Main".to_owned(),
                    source_commit: "0123456789abcdef0123456789abcdef01234567".to_owned(),
                    attempt_id: AttemptId::new("attempt-a")?,
                    attempt_number: 1,
                    lease_token: LeaseToken::new("lease-a")?,
                    owning_repairs: Vec::new(),
                    dependency_context: Vec::new(),
                    dependency_artifacts: Vec::new(),
                },
                marker,
                claim_started: Arc::new(Notify::new()),
                finish_claim: Arc::new(Notify::new()),
                released: Arc::new(AtomicBool::new(false)),
                release_attempts: Arc::new(AtomicUsize::new(0)),
            })
        }
    }

    #[async_trait]
    impl TaskStore for RecordingStore {
        async fn migrate(&self) -> crate::HiveResult<()> {
            unreachable!("not used by claim lifecycle test")
        }

        async fn register_agent(
            &self,
            _agent_id: &AgentId,
            _pod_name: &str,
        ) -> crate::HiveResult<()> {
            unreachable!("not used by claim lifecycle test")
        }

        async fn enqueue(&self, _task: &EnqueueTask) -> crate::HiveResult<()> {
            unreachable!("not used by claim lifecycle test")
        }

        async fn active_delivery(
            &self,
            _source_commit: &str,
            _kind: &str,
        ) -> crate::HiveResult<Option<TaskId>> {
            unreachable!("not used by claim lifecycle test")
        }

        async fn cancel(&self, _task_id: &TaskId, _reason: &str) -> crate::HiveResult<bool> {
            unreachable!("not used by claim lifecycle test")
        }

        async fn cancellation_targets(
            &self,
            _task_id: &TaskId,
        ) -> crate::HiveResult<Vec<CancellationTarget>> {
            unreachable!("not used by claim lifecycle test")
        }

        async fn finalize_cancellation(&self, _task_id: &TaskId) -> crate::HiveResult<bool> {
            unreachable!("not used by claim lifecycle test")
        }

        async fn acknowledge_cancellation(
            &self,
            _task: &ClaimedTask,
            _agent_id: &AgentId,
        ) -> crate::HiveResult<bool> {
            unreachable!("not used by claim lifecycle test")
        }

        async fn claim(
            &self,
            _agent_id: &AgentId,
            _lease_seconds: i64,
        ) -> crate::HiveResult<ClaimOutcome> {
            self.claim_started.notify_one();
            self.finish_claim.notified().await;
            Ok(ClaimOutcome::Claimed(Box::new(self.task.clone())))
        }

        async fn heartbeat(
            &self,
            _task_id: &TaskId,
            _agent_id: &AgentId,
            _lease_token: &LeaseToken,
            _lease_seconds: i64,
        ) -> crate::HiveResult<bool> {
            unreachable!("not used by claim lifecycle test")
        }

        async fn record_activity(
            &self,
            _lease: &ActivityLease,
            _agent_id: &AgentId,
            _activity: &TaskActivity,
        ) -> crate::HiveResult<bool> {
            unreachable!("not used by claim lifecycle test")
        }

        async fn release(
            &self,
            task: &ClaimedTask,
            _agent_id: &AgentId,
        ) -> crate::HiveResult<bool> {
            assert_eq!(task.id, self.task.id);
            assert!(
                !self.marker.exists(),
                "worker lifecycle marker must follow the lease release"
            );
            if self.release_attempts.fetch_add(1, Ordering::SeqCst) == 0 {
                return Err(crate::error::HiveError::message(
                    "transient coordinator transport failure",
                ));
            }
            self.released.store(true, Ordering::SeqCst);
            Ok(true)
        }

        async fn complete(
            &self,
            _task: &ClaimedTask,
            _agent_id: &AgentId,
            _obsolete: bool,
            _summary: &str,
            _artifact: &CompletionArtifact,
        ) -> crate::HiveResult<bool> {
            unreachable!("not used by claim lifecycle test")
        }

        async fn fail(
            &self,
            _task: &ClaimedTask,
            _agent_id: &AgentId,
            _error: &str,
        ) -> crate::HiveResult<bool> {
            unreachable!("not used by claim lifecycle test")
        }

        async fn block(
            &self,
            _task: &ClaimedTask,
            _agent_id: &AgentId,
            _blocker: &EnqueueTask,
            _reason: &str,
        ) -> crate::HiveResult<bool> {
            unreachable!("not used by claim lifecycle test")
        }
    }
}
