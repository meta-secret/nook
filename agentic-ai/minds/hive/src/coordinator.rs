use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use crate::HiveContext;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::Mutex;

use crate::model::{
    ActivityLease, AgentId, CancellationTarget, ClaimOutcome, ClaimedTask, CompletionArtifact,
    EnqueueTask, LeaseToken, TaskActivity, TaskId,
};
use crate::store::TaskStore;

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case")]
enum Request {
    Migrate,
    RegisterAgent {
        agent_id: AgentId,
        pod_name: String,
    },
    Claim {
        agent_id: AgentId,
        lease_seconds: i64,
    },
    Heartbeat {
        task_id: TaskId,
        agent_id: AgentId,
        lease_token: LeaseToken,
        lease_seconds: i64,
    },
    RecordActivity {
        lease: ActivityLease,
        agent_id: AgentId,
        activity: TaskActivity,
    },
    AcknowledgeCancellation {
        task: ClaimedTask,
        agent_id: AgentId,
    },
    Release {
        task: ClaimedTask,
        agent_id: AgentId,
    },
    Complete {
        task: ClaimedTask,
        agent_id: AgentId,
        obsolete: bool,
        summary: String,
        artifact: CompletionArtifact,
    },
    Fail {
        task: ClaimedTask,
        agent_id: AgentId,
        error: String,
    },
    Block {
        task: ClaimedTask,
        agent_id: AgentId,
        blocker: EnqueueTask,
        reason: String,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "result", content = "value", rename_all = "snake_case")]
enum Response {
    Unit,
    Claim(ClaimOutcome),
    Accepted(bool),
    Error(String),
}

#[derive(Clone)]
pub struct CoordinatorTaskStore {
    channel: Arc<Mutex<BufReader<UnixStream>>>,
}

impl CoordinatorTaskStore {
    pub async fn connect(path: &Path) -> crate::HiveResult<Self> {
        let stream = loop {
            match UnixStream::connect(path).await {
                Ok(stream) => break stream,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    tokio::time::sleep(Duration::from_millis(250)).await;
                }
                Err(error) => {
                    return Err(error).with_hive_context(|| {
                        format!("connect to Hive coordinator socket {}", path.display())
                    });
                }
            }
        };
        Ok(Self {
            channel: Arc::new(Mutex::new(BufReader::new(stream))),
        })
    }

    async fn request(&self, request: Request) -> crate::HiveResult<Response> {
        let mut channel = self.channel.lock().await;
        let payload = serde_json::to_vec(&request).hive_context("serialize coordinator request")?;
        channel
            .get_mut()
            .write_all(&payload)
            .await
            .hive_context("write coordinator request")?;
        channel
            .get_mut()
            .write_all(b"\n")
            .await
            .hive_context("terminate coordinator request")?;
        channel
            .get_mut()
            .flush()
            .await
            .hive_context("flush coordinator request")?;

        let mut response = String::new();
        let bytes = channel
            .read_line(&mut response)
            .await
            .hive_context("read coordinator response")?;
        if bytes == 0 {
            return Err(crate::error::HiveError::message(
                "Hive coordinator closed its private channel",
            ));
        }
        match serde_json::from_str(&response).hive_context("decode coordinator response")? {
            Response::Error(error) => Err(crate::HiveError::message(error)),
            response => Ok(response),
        }
    }

    async fn unit(&self, request: Request) -> crate::HiveResult<()> {
        match self.request(request).await? {
            Response::Unit => Ok(()),
            response => Err(crate::error::HiveError::message(format!(
                "unexpected coordinator response: {response:?}"
            ))),
        }
    }

    async fn accepted(&self, request: Request) -> crate::HiveResult<bool> {
        match self.request(request).await? {
            Response::Accepted(accepted) => Ok(accepted),
            response => Err(crate::error::HiveError::message(format!(
                "unexpected coordinator response: {response:?}"
            ))),
        }
    }
}

#[async_trait]
impl TaskStore for CoordinatorTaskStore {
    async fn migrate(&self) -> crate::HiveResult<()> {
        self.unit(Request::Migrate).await
    }

    async fn register_agent(&self, agent_id: &AgentId, pod_name: &str) -> crate::HiveResult<()> {
        self.unit(Request::RegisterAgent {
            agent_id: agent_id.clone(),
            pod_name: pod_name.to_owned(),
        })
        .await
    }

    async fn enqueue(&self, _task: &EnqueueTask) -> crate::HiveResult<()> {
        return Err(crate::error::HiveError::message(
            "workers are not authorized to enqueue tasks",
        ));
    }

    async fn active_delivery(
        &self,
        _source_commit: &str,
        _kind: &str,
    ) -> crate::HiveResult<Option<TaskId>> {
        return Err(crate::error::HiveError::message(
            "workers are not authorized to inspect delivery tasks",
        ));
    }

    async fn cancel(&self, _task_id: &TaskId, _reason: &str) -> crate::HiveResult<bool> {
        return Err(crate::error::HiveError::message(
            "workers are not authorized to cancel tasks",
        ));
    }

    async fn cancellation_targets(
        &self,
        _task_id: &TaskId,
    ) -> crate::HiveResult<Vec<CancellationTarget>> {
        return Err(crate::error::HiveError::message(
            "workers are not authorized to inspect cancellation targets",
        ));
    }

    async fn finalize_cancellation(&self, _task_id: &TaskId) -> crate::HiveResult<bool> {
        return Err(crate::error::HiveError::message(
            "workers are not authorized to finalize cancellation",
        ));
    }

    async fn acknowledge_cancellation(
        &self,
        task: &ClaimedTask,
        agent_id: &AgentId,
    ) -> crate::HiveResult<bool> {
        self.accepted(Request::AcknowledgeCancellation {
            task: task.clone(),
            agent_id: agent_id.clone(),
        })
        .await
    }

    async fn claim(
        &self,
        agent_id: &AgentId,
        lease_seconds: i64,
    ) -> crate::HiveResult<ClaimOutcome> {
        match self
            .request(Request::Claim {
                agent_id: agent_id.clone(),
                lease_seconds,
            })
            .await?
        {
            Response::Claim(task) => Ok(task),
            response => {
                return Err(crate::error::HiveError::message(format!(
                    "unexpected coordinator response: {response:?}"
                )));
            }
        }
    }

    async fn heartbeat(
        &self,
        task_id: &TaskId,
        agent_id: &AgentId,
        lease_token: &LeaseToken,
        lease_seconds: i64,
    ) -> crate::HiveResult<bool> {
        self.accepted(Request::Heartbeat {
            task_id: task_id.clone(),
            agent_id: agent_id.clone(),
            lease_token: lease_token.clone(),
            lease_seconds,
        })
        .await
    }

    async fn record_activity(
        &self,
        lease: &ActivityLease,
        agent_id: &AgentId,
        activity: &TaskActivity,
    ) -> crate::HiveResult<bool> {
        self.accepted(Request::RecordActivity {
            lease: lease.clone(),
            agent_id: agent_id.clone(),
            activity: activity.clone(),
        })
        .await
    }

    async fn release(&self, task: &ClaimedTask, agent_id: &AgentId) -> crate::HiveResult<bool> {
        self.accepted(Request::Release {
            task: task.clone(),
            agent_id: agent_id.clone(),
        })
        .await
    }

    async fn complete(
        &self,
        task: &ClaimedTask,
        agent_id: &AgentId,
        obsolete: bool,
        summary: &str,
        artifact: &CompletionArtifact,
    ) -> crate::HiveResult<bool> {
        self.accepted(Request::Complete {
            task: task.clone(),
            agent_id: agent_id.clone(),
            obsolete,
            summary: summary.to_owned(),
            artifact: artifact.clone(),
        })
        .await
    }

    async fn fail(
        &self,
        task: &ClaimedTask,
        agent_id: &AgentId,
        error: &str,
    ) -> crate::HiveResult<bool> {
        self.accepted(Request::Fail {
            task: task.clone(),
            agent_id: agent_id.clone(),
            error: error.to_owned(),
        })
        .await
    }

    async fn block(
        &self,
        task: &ClaimedTask,
        agent_id: &AgentId,
        blocker: &EnqueueTask,
        reason: &str,
    ) -> crate::HiveResult<bool> {
        self.accepted(Request::Block {
            task: task.clone(),
            agent_id: agent_id.clone(),
            blocker: blocker.clone(),
            reason: reason.to_owned(),
        })
        .await
    }
}

pub async fn run_coordinator<S: TaskStore>(socket: PathBuf, store: S) -> crate::HiveResult<()> {
    if let Some(parent) = socket.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .with_hive_context(|| {
                format!("create coordinator socket directory {}", parent.display())
            })?;
    }
    remove_socket_if_present(&socket).await?;
    let listener = UnixListener::bind(&socket)
        .with_hive_context(|| format!("bind Hive coordinator socket {}", socket.display()))?;
    let (stream, _) = listener
        .accept()
        .await
        .hive_context("accept worker coordinator channel")?;
    drop(listener);
    remove_socket_if_present(&socket).await?;

    let (reader, mut writer) = stream.into_split();
    let mut lines = BufReader::new(reader).lines();
    while let Some(line) = lines
        .next_line()
        .await
        .hive_context("read worker coordinator request")?
    {
        let response = match serde_json::from_str::<Request>(&line) {
            Ok(request) => handle_request(&store, request)
                .await
                .unwrap_or_else(|error| Response::Error(format!("{error:#}"))),
            Err(error) => Response::Error(format!("decode coordinator request: {error}")),
        };
        writer
            .write_all(
                &serde_json::to_vec(&response).hive_context("serialize coordinator response")?,
            )
            .await
            .hive_context("write coordinator response")?;
        writer.write_all(b"\n").await?;
        writer.flush().await?;
    }
    Ok(())
}

async fn handle_request<S: TaskStore>(store: &S, request: Request) -> crate::HiveResult<Response> {
    match request {
        Request::Migrate => {
            store.migrate().await?;
            Ok(Response::Unit)
        }
        Request::RegisterAgent { agent_id, pod_name } => {
            store.register_agent(&agent_id, &pod_name).await?;
            Ok(Response::Unit)
        }
        Request::Claim {
            agent_id,
            lease_seconds,
        } => Ok(Response::Claim(
            store.claim(&agent_id, lease_seconds).await?,
        )),
        Request::Heartbeat {
            task_id,
            agent_id,
            lease_token,
            lease_seconds,
        } => Ok(Response::Accepted(
            store
                .heartbeat(&task_id, &agent_id, &lease_token, lease_seconds)
                .await?,
        )),
        Request::RecordActivity {
            lease,
            agent_id,
            activity,
        } => Ok(Response::Accepted(
            store.record_activity(&lease, &agent_id, &activity).await?,
        )),
        Request::AcknowledgeCancellation { task, agent_id } => Ok(Response::Accepted(
            store.acknowledge_cancellation(&task, &agent_id).await?,
        )),
        Request::Release { task, agent_id } => {
            Ok(Response::Accepted(store.release(&task, &agent_id).await?))
        }
        Request::Complete {
            task,
            agent_id,
            obsolete,
            summary,
            artifact,
        } => Ok(Response::Accepted(
            store
                .complete(&task, &agent_id, obsolete, &summary, &artifact)
                .await?,
        )),
        Request::Fail {
            task,
            agent_id,
            error,
        } => Ok(Response::Accepted(
            store.fail(&task, &agent_id, &error).await?,
        )),
        Request::Block {
            task,
            agent_id,
            blocker,
            reason,
        } => Ok(Response::Accepted(
            store.block(&task, &agent_id, &blocker, &reason).await?,
        )),
    }
}

async fn remove_socket_if_present(path: &Path) -> crate::HiveResult<()> {
    match tokio::fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => {
            Err(error).with_hive_context(|| format!("remove stale socket {}", path.display()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Request;
    use crate::model::{
        ActivityKind, ActivityLease, AgentId, AttemptId, LeaseToken, TaskActivity, TaskId,
    };

    #[test]
    fn worker_protocol_has_no_enqueue_or_raw_query_operation() -> crate::HiveResult<()> {
        let serialized = serde_json::to_string(&Request::Migrate)?;
        assert!(!serialized.contains("enqueue"));
        assert!(!serialized.contains("query"));
        assert!(!serialized.contains("password"));
        Ok(())
    }

    #[test]
    fn activity_request_carries_only_lease_identity() -> crate::HiveResult<()> {
        let serialized = serde_json::to_string(&Request::RecordActivity {
            lease: ActivityLease {
                task_id: TaskId::new("task-1")?,
                attempt_id: AttemptId::new("attempt-1")?,
                lease_token: LeaseToken::new("lease-1")?,
            },
            agent_id: AgentId::new("agent-1")?,
            activity: TaskActivity {
                kind: ActivityKind::Action,
                message: "activity.command_running".to_owned(),
                detail: "task format".to_owned(),
            },
        })?;
        assert!(!serialized.contains("prompt"));
        assert!(!serialized.contains("dependency"));
        assert!(!serialized.contains("source_commit"));
        Ok(())
    }
}
