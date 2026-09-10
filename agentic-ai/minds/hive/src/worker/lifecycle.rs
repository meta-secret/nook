use std::fs;
use std::future::Future;
use std::io;
use std::io::Write as _;
use std::path::Path;
use std::time::Duration;
use tokio::fs as async_fs;
use tokio::time as async_time;

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

impl<S: TaskStore> TaskClaim<'_, S> {
    pub(super) async fn claim(self) -> HiveResult<ClaimStep> {
        let Self {
            store,
            agent_id,
            lease_seconds,
            shutdown,
            lifecycle_marker,
        } = self;
        let claim = store.claim(agent_id, lease_seconds);
        match ClaimWindow::finish(ClaimCompletion { claim, shutdown }).await {
            ClaimWindow::Stopped => {
                WorkerCompletionMarker {
                    path: lifecycle_marker,
                }
                .mark_interrupted()
                .await?;
                Ok(ClaimStep::Stopped)
            }
            ClaimWindow::CompletedDuringShutdown(outcome) => {
                match outcome {
                    Ok(ClaimOutcome::Claimed(task)) => {
                        ShutdownLease { store, agent_id }
                            .release_during_shutdown(&task)
                            .await;
                    }
                    Ok(ClaimOutcome::NoTask) => {}
                    Err(error) => {
                        WorkerCompletionMarker {
                            path: lifecycle_marker,
                        }
                        .mark_interrupted()
                        .await?;
                        return Err(error);
                    }
                }
                WorkerCompletionMarker {
                    path: lifecycle_marker,
                }
                .mark_interrupted()
                .await?;
                Ok(ClaimStep::Stopped)
            }
            ClaimWindow::Completed(Ok(ClaimOutcome::Claimed(task))) => Ok(ClaimStep::Claimed(task)),
            ClaimWindow::Completed(Ok(ClaimOutcome::NoTask)) => Ok(ClaimStep::NoTask),
            ClaimWindow::Completed(Err(error)) => Err(error),
        }
    }
}

impl<S: TaskStore> ShutdownLease<'_, S> {
    async fn release_during_shutdown(&self, task: &ClaimedTask) {
        let store = self.store;
        let agent_id = self.agent_id;
        loop {
            match store.release(task, agent_id).await {
                Ok(_) => return,
                Err(_) => async_time::sleep(Duration::from_millis(250)).await,
            }
        }
    }
}

impl WorkerCompletionMarker<'_> {
    pub(super) async fn mark_interrupted(&self) -> HiveResult<()> {
        let lifecycle_marker = self.path;
        async_fs::write(lifecycle_marker, b"rollout-before-execution")
            .await
            .hive_context("mark interrupted Pod for replacement")
    }
}

impl<T> ClaimWindow<T> {
    pub(super) async fn finish<F>(request: ClaimCompletion<F>) -> ClaimWindow<T>
    where
        F: Future<Output = T>,
    {
        let ClaimCompletion { claim, shutdown } = request;
        if *shutdown.borrow() {
            return ClaimWindow::Stopped;
        }
        tokio::pin!(claim);
        tokio::select! {
            biased;
            requested = WorkerShutdown { receiver: shutdown }.requested() => {
                if requested.is_err() {
                    return ClaimWindow::Stopped;
                }
                ClaimWindow::CompletedDuringShutdown(claim.await)
            }
            result = &mut claim => ClaimWindow::Completed(result),
        }
    }
}

impl WorkerShutdown {
    pub(super) async fn requested(self) -> HiveResult<()> {
        let mut shutdown = self.receiver;
        shutdown
            .wait_for(|requested| *requested)
            .await
            .map(|_| ())
            .hive_context("worker termination signal relay stopped")
    }
}

impl WorkerStartup<'_> {
    pub(super) fn establish(&self) -> HiveResult<()> {
        let workspace = self.workspace;
        let pod_name = self.pod_name;
        fs::create_dir_all(workspace)?;
        let startup_marker = workspace.join(".hive-worker-started");
        let startup_file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&startup_marker);
        let mut startup_file = match startup_file {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                fs::write(workspace.join(".hive-task-finished"), pod_name)?;
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
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use tokio::sync::{Notify, oneshot, watch};
    use tokio::task;

    use async_trait::async_trait;

    use super::{
        ClaimCompletion, ClaimStep, ClaimWindow, TaskClaim, WorkerCompletionMarker, WorkerShutdown,
        WorkerStartup,
    };
    use crate::model::{
        ActivityLease, AgentId, AttemptId, CancellationTarget, ClaimOutcome, ClaimedTask,
        CompletionArtifact, EnqueueTask, LeaseToken, TaskActivity, TaskId,
    };
    use crate::store::TaskStore;

    #[tokio::test]
    async fn shutdown_finishes_an_inflight_claim_before_releasing_control() -> anyhow::Result<()> {
        let (claim_tx, claim_rx) = oneshot::channel();
        let (started_tx, started_rx) = oneshot::channel();
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        let claim = tokio::spawn(ClaimWindow::finish(ClaimCompletion {
            claim: async move {
                let _ = started_tx.send(());
                claim_rx.await
            },
            shutdown: shutdown_rx,
        }));

        started_rx.await?;
        shutdown_tx.send(true)?;
        task::yield_now().await;
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
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        shutdown_tx.send(true)?;

        assert!(matches!(
            ClaimWindow::finish(ClaimCompletion {
                claim: async { panic!("claim was polled") },
                shutdown: shutdown_rx
            })
            .await,
            ClaimWindow::Stopped
        ));
        Ok(())
    }

    #[tokio::test]
    async fn shutdown_releases_an_inflight_claim_before_writing_the_marker() -> anyhow::Result<()> {
        let workspace = tempfile::tempdir()?;
        let marker = workspace.path().join(".hive-task-finished");
        let store = RecordingStore::new(marker.clone())?;
        let agent = AgentId::try_from("agent-a")?;
        let (_shutdown_tx, shutdown_rx) = watch::channel(false);
        let shutdown_tx = _shutdown_tx;
        let claim_store = store.clone();
        let claim_agent = agent.clone();
        let claim_marker = marker.clone();
        let claim = tokio::spawn(async move {
            TaskClaim {
                store: &claim_store,
                agent_id: &claim_agent,
                lease_seconds: 3600,
                shutdown: shutdown_rx,
                lifecycle_marker: &claim_marker,
            }
            .claim()
            .await
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

        WorkerStartup {
            workspace: workspace.path(),
            pod_name: "pod-a",
        }
        .establish()?;
        let error = WorkerStartup {
            workspace: workspace.path(),
            pod_name: "pod-a",
        }
        .establish()
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
                    id: TaskId::try_from("task-a")?,
                    kind: "main-repair".into(),
                    prompt: "repair Main".to_owned(),
                    source_commit: "0123456789abcdef0123456789abcdef01234567".to_owned(),
                    attempt_id: AttemptId::try_from("attempt-a")?,
                    attempt_number: 1,
                    lease_token: LeaseToken::try_from("lease-a")?,
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
            request: crate::model::ActiveDeliveryQuery<'_>,
        ) -> crate::HiveResult<crate::model::ActiveDelivery> {
            let crate::model::ActiveDeliveryQuery {
                source_commit: _source_commit,
                kind: _kind,
            } = request;
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
                return Err(crate::HiveError::message(
                    "transient coordinator transport failure",
                ));
            }
            self.released.store(true, Ordering::SeqCst);
            Ok(true)
        }

        async fn complete(
            &self,
            completion: crate::model::Completion<'_>,
        ) -> crate::HiveResult<bool> {
            let crate::model::Completion {
                task: _task,
                agent_id: _agent_id,
                relevance: _obsolete,
                summary: _summary,
                artifact: _artifact,
            } = completion;
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

pub(super) struct TaskClaim<'a, S> {
    pub(super) store: &'a S,
    pub(super) agent_id: &'a AgentId,
    pub(super) lease_seconds: i64,
    pub(super) shutdown: watch::Receiver<bool>,
    pub(super) lifecycle_marker: &'a Path,
}
struct ShutdownLease<'a, S> {
    store: &'a S,
    agent_id: &'a AgentId,
}
pub(super) struct WorkerCompletionMarker<'a> {
    pub(super) path: &'a Path,
}
pub(super) struct WorkerStartup<'a> {
    pub(super) workspace: &'a Path,
    pub(super) pod_name: &'a str,
}
pub(super) struct WorkerShutdown {
    pub(super) receiver: watch::Receiver<bool>,
}
pub(super) struct ClaimCompletion<F> {
    pub(super) claim: F,
    pub(super) shutdown: watch::Receiver<bool>,
}
