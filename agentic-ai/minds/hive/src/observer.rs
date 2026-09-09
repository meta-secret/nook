mod classification;
use crate::observer::presentation::ObservedAlert;
use crate::observer::presentation::ObservedTask;
use axum::response;
pub use classification::{ObservedTaskState, ObservedTaskTrigger};
use std::collections::BTreeMap;
use std::io;
use std::net::SocketAddr;
use std::path::{Path as FilePath, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::fs as async_fs;
use tokio::net as async_net;

use crate::HiveContext;
use async_trait::async_trait;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use neo4rs::query;
use time::OffsetDateTime;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::Mutex;
use tower_http::services::{ServeDir, ServeFile};

use crate::neo4j::Neo4jTaskStore;
use crate::store::TaskStore;

const TASK_LIMIT: i64 = 200;
const ALERT_LIMIT: usize = 100;
const AGENT_PRESENCE_WINDOW_MS: i64 = 120_000;
const STALE_ACTIVITY_MS: i64 = 5 * 60_000;
const STUCK_CANCELLATION_MS: i64 = 5 * 60_000;

mod presentation;
use presentation::TaskKindLabel;
mod protocol;
pub use presentation::*;

pub use protocol::*;

#[derive(Clone)]
struct ObserverState<S> {
    store: S,
}

pub struct ObserverServer<S> {
    pub store: S,
    pub address: SocketAddr,
    pub dashboard: PathBuf,
}
impl<S: ObserverStore> ObserverServer<S> {
    pub async fn run_observer(self) -> crate::HiveResult<()> {
        let Self {
            store,
            address,
            dashboard,
        } = self;
        let listener = async_net::TcpListener::bind(address)
            .await
            .with_hive_context(|| format!("bind Hive observer to {address}"))?;
        (BoundObserverServer {
            store,
            listener,
            dashboard,
        })
        .run_observer_on_listener()
        .await
    }
}

struct BoundObserverServer<S> {
    store: S,
    listener: async_net::TcpListener,
    dashboard: PathBuf,
}
impl<S: ObserverStore> BoundObserverServer<S> {
    pub async fn run_observer_on_listener(self) -> crate::HiveResult<()> {
        let Self {
            store,
            listener,
            dashboard,
        } = self;
        let index = dashboard.join("index.html");
        let assets = ServeDir::new(dashboard).fallback(ServeFile::new(index));
        let app = Router::new()
            .route("/healthz", get(health))
            .route("/api/overview", get(overview))
            .route("/api/tasks/{task_id}", get(task_detail))
            .fallback_service(assets)
            .with_state(ObserverState { store });
        axum::serve(listener, app)
            .await
            .hive_context("serve Hive observer")
    }
}

pub struct ObserverCoordinator {
    pub socket: PathBuf,
    pub store: Neo4jTaskStore,
}
impl ObserverCoordinator {
    pub async fn run_observer_coordinator(self) -> crate::HiveResult<()> {
        let Self { socket, store } = self;
        store.migrate().await?;
        if let Some(parent) = socket.parent() {
            async_fs::create_dir_all(parent).await?;
        }
        (ObserverSocket { path: &socket })
            .remove_if_present()
            .await?;
        let listener = UnixListener::bind(&socket)
            .with_hive_context(|| format!("bind Hive observer coordinator {}", socket.display()))?;
        let (stream, _) = listener
            .accept()
            .await
            .hive_context("accept Hive observer channel")?;
        drop(listener);
        (ObserverSocket { path: &socket })
            .remove_if_present()
            .await?;

        let (reader, mut writer) = stream.into_split();
        let mut lines = BufReader::new(reader).lines();
        while let Some(line) = lines.next_line().await? {
            let response = match serde_json::from_str::<ObserverRequest>(&line) {
                Ok(ObserverRequest::Snapshot { locale }) => store
                    .observer_snapshot_view(&locale)
                    .await
                    .map(ObserverResponse::Snapshot),
                Ok(ObserverRequest::Task { task_id, locale }) => store
                    .observer_task_view(&task_id, &locale)
                    .await
                    .map(ObserverResponse::Task),
                Err(error) => Err(crate::HiveError::message(format!(
                    "decode observer request: {error}"
                ))),
            }
            .unwrap_or_else(|error| ObserverResponse::Error(format!("{error:#}")));
            writer.write_all(&serde_json::to_vec(&response)?).await?;
            writer.write_all(b"\n").await?;
            writer.flush().await?;
        }
        Ok(())
    }
}

struct ObserverSocket<'a> {
    path: &'a FilePath,
}
impl ObserverSocket<'_> {
    async fn remove_if_present(&self) -> crate::HiveResult<()> {
        let path = self.path;
        match async_fs::remove_file(path).await {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => {
                Err(error).with_hive_context(|| format!("remove stale socket {}", path.display()))
            }
        }
    }
}

async fn health() -> StatusCode {
    StatusCode::NO_CONTENT
}

async fn overview<S: ObserverStore>(
    State(state): State<ObserverState<S>>,
    Query(locale): Query<LocaleQuery>,
) -> Result<Json<ObserverSnapshot>, ObserverError> {
    Ok(Json(
        state.store.observer_snapshot_view(&locale.locale).await?,
    ))
}

async fn task_detail<S: ObserverStore>(
    State(state): State<ObserverState<S>>,
    Path(task_id): Path<String>,
    Query(locale): Query<LocaleQuery>,
) -> Result<Json<ObservedTask>, ObserverError> {
    state
        .store
        .observer_task_view(&task_id, &locale.locale)
        .await?
        .map(Json)
        .ok_or_else(|| ObserverError::not_found("task was not found"))
}

struct ObserverError {
    status: StatusCode,
    message: String,
}

impl ObserverError {
    fn not_found(message: &str) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: message.to_owned(),
        }
    }
}

impl From<crate::HiveError> for ObserverError {
    fn from(_error: crate::HiveError) -> Self {
        Self {
            status: StatusCode::SERVICE_UNAVAILABLE,
            message: "Hive observer is unavailable".to_owned(),
        }
    }
}

impl IntoResponse for ObserverError {
    fn into_response(self) -> response::Response {
        (
            self.status,
            Json(ObserverErrorBody {
                error: self.message,
            }),
        )
            .into_response()
    }
}

impl Neo4jTaskStore {
    pub async fn observer_snapshot(&self, locale: &str) -> crate::HiveResult<ObserverSnapshot> {
        let overview_tasks = self
            .observer_tasks(ObserverTaskQuery {
                task_id: "",
                limit: TASK_LIMIT,
                locale,
                selection: ObserverTaskSelection::All,
            })
            .await?;
        let mut attention_tasks = self
            .observer_tasks(ObserverTaskQuery {
                task_id: "",
                limit: ALERT_LIMIT as i64 + 1,
                locale,
                selection: ObserverTaskSelection::Attention,
            })
            .await?;
        let alerts_truncated = attention_tasks.len() > ALERT_LIMIT;
        attention_tasks.truncate(ALERT_LIMIT);
        let generated_at = OffsetDateTime::now_utc().unix_timestamp() * 1000;
        let alerts = ObservedAlert::derive_alerts(&attention_tasks, generated_at, locale);
        let mut tasks = attention_tasks;
        for task in overview_tasks {
            if tasks.len() >= TASK_LIMIT as usize {
                break;
            }
            if !tasks.iter().any(|candidate| candidate.id == task.id) {
                tasks.push(task);
            }
        }
        self.attach_dependencies(&mut tasks).await?;
        self.attach_triggers(&mut tasks, locale).await?;
        self.attach_activity(&mut tasks, locale).await?;
        Ok(ObserverSnapshot {
            generated_at,
            copy: ObserverCopy::for_locale(locale),
            agents: self.observer_agents().await?,
            active_task_count: self.observer_active_task_count().await?,
            tasks,
            alerts,
            alerts_truncated,
        })
    }

    async fn observer_task(
        &self,
        task_id: &str,
        locale: &str,
    ) -> crate::HiveResult<Option<ObservedTask>> {
        let mut tasks = self
            .observer_tasks(ObserverTaskQuery {
                task_id,
                limit: 1,
                locale,
                selection: ObserverTaskSelection::All,
            })
            .await?;
        self.attach_dependencies(&mut tasks).await?;
        self.attach_triggers(&mut tasks, locale).await?;
        self.attach_activity(&mut tasks, locale).await?;
        Ok(tasks.pop())
    }

    async fn observer_agents(&self) -> crate::HiveResult<Vec<ObservedAgent>> {
        let mut rows = self
            .graph
            .execute(
                query(
                    "MATCH (agent:Agent)
                 WHERE coalesce(agent.last_seen_at, agent.started_at, 0)
                       >= timestamp() - $presence_window
                 RETURN agent.id AS id,
                        coalesce(agent.pod_name, '') AS pod_name,
                        coalesce(agent.status, 'IDLE') AS status,
                        coalesce(agent.last_seen_at, agent.started_at, 0) AS last_seen_at
                 ORDER BY pod_name, id",
                )
                .param("presence_window", AGENT_PRESENCE_WINDOW_MS),
            )
            .await?;
        let mut agents = Vec::new();
        while let Some(row) = rows.next().await? {
            let last_seen_at = row.get("last_seen_at")?;
            agents.push(ObservedAgent {
                id: row.get("id")?,
                pod_name: row.get("pod_name")?,
                status: row.get::<String>("status")?.into(),
                last_seen_at,
                presence_expires_at: ObservedAgent::presence_expires_at(last_seen_at),
            });
        }
        Ok(agents)
    }

    async fn observer_active_task_count(&self) -> crate::HiveResult<i64> {
        let mut rows = self
            .graph
            .execute(query(
                "MATCH (task:Task)
                 WHERE task.status IN ['RUNNING', 'READY', 'BLOCKED', 'CANCELLING']
                 RETURN count(task) AS count",
            ))
            .await?;
        let row = rows
            .next()
            .await?
            .hive_context("active task count query returned no row")?;
        Ok(row.get("count")?)
    }

    async fn observer_tasks(
        &self,
        request: ObserverTaskQuery<'_>,
    ) -> crate::HiveResult<Vec<ObservedTask>> {
        let ObserverTaskQuery {
            task_id,
            limit,
            locale,
            selection,
        } = request;
        let mut rows = self
            .graph
            .execute(
                query(
                    "MATCH (task:Task)
                     WHERE ($attention_only = false AND ($task_id = '' OR task.id = $task_id))
                        OR ($attention_only = true
                          AND task.status IN ['FAILED', 'BLOCKED', 'RUNNING', 'CANCELLING'])
                     OPTIONAL MATCH (task)<-[:FOR_TASK]-(attempt:Attempt)
                     OPTIONAL MATCH (agent:Agent)-[:EXECUTED]->(attempt)
                     WITH task, attempt, agent
                     ORDER BY attempt.started_at DESC
                     WITH task, collect({attempt: attempt, agent: agent})[0] AS latest
                     WITH task, latest,
                       CASE
                         WHEN coalesce(task.latest_activity_at, 0)
                           >= coalesce(latest.attempt.started_at, 0)
                         THEN coalesce(task.latest_activity_at, 0)
                         ELSE coalesce(latest.attempt.started_at, task.created_at, 0)
                       END AS latest_progress_at
                     WHERE $attention_only = false
                        OR (
                          task.status IN ['FAILED', 'BLOCKED']
                          OR (
                            task.status = 'RUNNING'
                            AND latest_progress_at < timestamp() - $attention_age
                          )
                          OR (
                            task.status = 'CANCELLING'
                            AND coalesce(task.updated_at, task.created_at, 0)
                              < timestamp() - $attention_age
                          )
                        )
                     RETURN task.id AS id,
                            coalesce(task.kind, '') AS kind,
                            coalesce(task.trigger_kind, 'legacy-unknown') AS trigger_kind,
                            task.status AS status,
                            coalesce(task.source_commit, '') AS source_commit,
                            coalesce(task.priority, 0) AS priority,
                            coalesce(task.attempt_count, 0) AS attempt_count,
                            coalesce(task.max_attempts, 0) AS max_attempts,
                            coalesce(task.created_at, 0) AS created_at,
                            coalesce(task.updated_at, task.created_at, 0) AS updated_at,
                            coalesce(task.lease_until, 0) AS lease_until,
                            coalesce(latest.agent.id, '') AS agent_id,
                            coalesce(latest.agent.pod_name, '') AS pod_name,
                            coalesce(latest.attempt.status, '') AS latest_attempt_status,
                            coalesce(latest.attempt.started_at, 0) AS latest_attempt_started_at,
                            coalesce(latest.attempt.completed_at, 0) AS latest_attempt_completed_at,
                            coalesce(task.latest_activity_at, 0) AS latest_activity_at,
                            substring(replace(CASE
                              WHEN task.status = 'BLOCKED' THEN coalesce(
                                task.blocked_reason,
                                latest.attempt.error,
                                task.failure_reason,
                                ''
                              )
                              ELSE coalesce(
                                latest.attempt.error,
                                task.failure_reason,
                                task.blocked_reason,
                                ''
                              )
                            END, '\n', ' '), 0, 600)
                              AS latest_error,
                            substring(replace(coalesce(latest.attempt.summary, ''), '\n', ' '), 0, 1200)
                              AS latest_summary,
                            coalesce(task.blocked_reason, '') STARTS WITH 'dependency '
                              OR coalesce(task.blocked_reason, '') STARTS WITH 'upstream dependency '
                              OR coalesce(task.failure_reason, '') =
                                'discovered blocker has already exhausted its retry budget'
                              OR coalesce(task.failure_reason, '') =
                                'upstream task reused an exhausted blocker'
                              OR coalesce(task.failure_reason, '') =
                                'dependency failed before task enqueue'
                              AS dependency_failure
                     ORDER BY
                       CASE WHEN $attention_only = true THEN
                         CASE task.status
                           WHEN 'FAILED' THEN 0
                           ELSE 1
                         END
                       ELSE
                         CASE task.status
                           WHEN 'RUNNING' THEN 0
                           WHEN 'READY' THEN 1
                           WHEN 'BLOCKED' THEN 2
                           WHEN 'CANCELLING' THEN 3
                           ELSE 4
                         END
                       END,
                       CASE WHEN task.status = 'READY' THEN task.priority ELSE 0 END DESC,
                       CASE WHEN task.status = 'READY' THEN task.created_at ELSE 0 END ASC,
                       CASE WHEN task.status = 'READY' THEN task.id ELSE '' END ASC,
                       CASE
                         WHEN $attention_only = true
                           AND task.status = 'FAILED'
                           AND dependency_failure
                           THEN coalesce(task.updated_at, task.created_at, 0)
                         WHEN $attention_only = true AND task.status = 'FAILED'
                           THEN coalesce(latest.attempt.completed_at, task.updated_at, task.created_at, 0)
                         WHEN $attention_only = true AND task.status = 'RUNNING'
                           THEN latest_progress_at + $attention_age
                         WHEN $attention_only = true AND task.status = 'CANCELLING'
                           THEN coalesce(task.updated_at, task.created_at, 0) + $attention_age
                         WHEN $attention_only = true
                           THEN coalesce(task.updated_at, task.created_at, 0)
                         ELSE 0
                       END ASC,
                       updated_at DESC,
                       created_at DESC
                     LIMIT $limit",
                )
                .param("task_id", task_id)
                .param("limit", limit)
                .param("attention_only", matches!(selection, ObserverTaskSelection::Attention))
                .param("attention_age", STALE_ACTIVITY_MS),
            )
            .await?;
        let mut tasks = Vec::new();
        while let Some(row) = rows.next().await? {
            tasks.push(ObservedTask {
                id: row.get("id")?,
                kind: row.get::<String>("kind")?.into(),
                kind_label: ObservedTask::localized_task_kind(TaskKindLabel {
                    kind: &row.get::<String>("kind")?.into(),
                    locale: locale,
                }),
                trigger_kind: row.get::<String>("trigger_kind")?.into(),
                trigger: String::new(),
                status: row.get("status")?,
                source_commit: row.get("source_commit")?,
                priority: row.get("priority")?,
                attempt_count: row.get("attempt_count")?,
                max_attempts: row.get("max_attempts")?,
                created_at: row.get("created_at")?,
                updated_at: row.get("updated_at")?,
                lease_until: row.get("lease_until")?,
                agent_id: row.get("agent_id")?,
                pod_name: row.get("pod_name")?,
                latest_attempt_status: row.get("latest_attempt_status")?,
                latest_attempt_started_at: row.get("latest_attempt_started_at")?,
                latest_attempt_completed_at: row.get("latest_attempt_completed_at")?,
                latest_activity_at: row.get("latest_activity_at")?,
                latest_error: row.get("latest_error")?,
                latest_summary: row.get("latest_summary")?,
                dependency_failure: row.get("dependency_failure")?,
                dependencies: Vec::new(),
                activity: Vec::new(),
            });
        }
        Ok(tasks)
    }

    async fn attach_dependencies(&self, tasks: &mut [ObservedTask]) -> crate::HiveResult<()> {
        let mut by_id = tasks
            .iter()
            .enumerate()
            .map(|(index, task)| (task.id.clone(), index))
            .collect::<BTreeMap<_, _>>();
        if by_id.is_empty() {
            return Ok(());
        }
        let task_ids = by_id.keys().cloned().collect::<Vec<_>>();
        let mut rows = self
            .graph
            .execute(
                query(
                    "UNWIND $task_ids AS task_id
                 MATCH (task:Task {id: task_id})-[:DEPENDS_ON]->(dependency:Task)
                 RETURN task.id AS task_id,
                        dependency.id AS dependency_id,
                        dependency.status AS dependency_status
                 ORDER BY dependency.created_at, dependency.id",
                )
                .param("task_ids", task_ids),
            )
            .await?;
        while let Some(row) = rows.next().await? {
            let task_id: String = row.get("task_id")?;
            if let Some(index) = by_id.remove(&task_id) {
                tasks[index].dependencies.push(ObservedDependency {
                    id: row.get("dependency_id")?,
                    status: row.get("dependency_status")?,
                });
                by_id.insert(task_id, index);
            }
        }
        Ok(())
    }

    async fn attach_triggers(
        &self,
        tasks: &mut [ObservedTask],
        locale: &str,
    ) -> crate::HiveResult<()> {
        let russian =
            locale.eq_ignore_ascii_case("ru") || locale.to_ascii_lowercase().starts_with("ru-");
        for task in tasks {
            task.trigger = match (&task.trigger_kind, russian) {
                (ObservedTaskTrigger::GitHubMainFailure, true) => {
                    "GitHub Actions · ошибка workflow в main".to_owned()
                }
                (ObservedTaskTrigger::GitHubMainFailure, false) => {
                    "GitHub Actions · failed main workflow".to_owned()
                }
                (ObservedTaskTrigger::AgentDependency, true) => {
                    "Задача агента · зависимость".to_owned()
                }
                (ObservedTaskTrigger::AgentDependency, false) => {
                    "Agent task · dependency".to_owned()
                }
                (ObservedTaskTrigger::ManualCli, true) => "Ручной запуск · Hive CLI".to_owned(),
                (ObservedTaskTrigger::ManualCli, false) => "Manual dispatch · Hive CLI".to_owned(),
                (_, true) => "Источник не записан".to_owned(),
                (_, false) => "Source not recorded".to_owned(),
            };
        }
        Ok(())
    }

    async fn attach_activity(
        &self,
        tasks: &mut [ObservedTask],
        locale: &str,
    ) -> crate::HiveResult<()> {
        let by_id = tasks
            .iter()
            .enumerate()
            .map(|(index, task)| (task.id.clone(), index))
            .collect::<BTreeMap<_, _>>();
        if by_id.is_empty() {
            return Ok(());
        }
        let task_ids = by_id.keys().cloned().collect::<Vec<_>>();
        let mut rows = self
            .graph
            .execute(
                query(
                    "UNWIND $task_ids AS task_id
                 MATCH (task:Task {id: task_id})
                 CALL {
                   WITH task
                   MATCH (activity:TaskActivity)-[:FOR_TASK]->(task)
                   OPTIONAL MATCH (activity)-[:FOR_ATTEMPT]->(attempt:Attempt)
                   RETURN activity, attempt
                   ORDER BY activity.created_at DESC, activity.id DESC
                   LIMIT 100
                 }
                 RETURN task.id AS task_id,
                        activity.id AS id,
                        activity.kind AS kind,
                        activity.message AS message,
                        coalesce(activity.detail, '') AS detail,
                        activity.created_at AS created_at,
                        coalesce(attempt.id, '') AS attempt_id,
                        coalesce(attempt.number, 0) AS attempt_number
                 ORDER BY task_id, activity.created_at DESC, activity.id DESC",
                )
                .param("task_ids", task_ids),
            )
            .await?;
        while let Some(row) = rows.next().await? {
            let task_id: String = row.get("task_id")?;
            let Some(index) = by_id.get(&task_id).copied() else {
                continue;
            };
            let message: String = row.get("message")?;
            tasks[index].activity.push(ObservedActivity {
                id: row.get("id")?,
                kind: row.get("kind")?,
                message: ObservedTask::localized_activity(&message, locale).to_owned(),
                detail: row.get("detail")?,
                created_at: row.get("created_at")?,
                attempt_id: row.get("attempt_id")?,
                attempt_number: row.get("attempt_number")?,
            });
        }
        Ok(())
    }
}

#[async_trait]
impl ObserverStore for Neo4jTaskStore {
    async fn observer_snapshot_view(&self, locale: &str) -> crate::HiveResult<ObserverSnapshot> {
        self.observer_snapshot(locale).await
    }

    async fn observer_task_view(
        &self,
        task_id: &str,
        locale: &str,
    ) -> crate::HiveResult<Option<ObservedTask>> {
        self.observer_task(task_id, locale).await
    }
}

#[cfg(test)]
mod tests {
    use super::{ObservedTask, ObserverSnapshot};
    use async_trait::async_trait;
    use axum::extract::{Path, Query, State};
    use axum::http::StatusCode;
    use axum::response::IntoResponse;
    use std::io;
    use std::net;
    use std::time;
    use tokio::fs as async_fs;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net as async_net;
    use tokio::time as async_time;

    use super::{
        LocaleQuery, ObserverRequest, ObserverState, ObserverStore, health, overview, task_detail,
    };

    #[derive(Clone)]
    enum FixtureStore {
        Ready,
        Failed,
    }

    #[async_trait]
    impl ObserverStore for FixtureStore {
        async fn observer_snapshot_view(
            &self,
            locale: &str,
        ) -> crate::HiveResult<ObserverSnapshot> {
            match self {
                Self::Ready => Ok(ObserverSnapshot::fixture(locale)),
                Self::Failed => Err(crate::HiveError::message("database unavailable")),
            }
        }

        async fn observer_task_view(
            &self,
            task_id: &str,
            locale: &str,
        ) -> crate::HiveResult<Option<ObservedTask>> {
            match self {
                Self::Ready if task_id == "task-1" => Ok(Some(ObservedTask::fixture(task_id))),
                Self::Ready => Ok(None),
                Self::Failed => Err(crate::HiveError::message("database unavailable")),
            }
        }
    }

    async fn http_get(address: net::SocketAddr, path: &str) -> crate::HiveResult<String> {
        let mut attempts = 0;
        let mut stream = loop {
            attempts += 1;
            match async_net::TcpStream::connect(address).await {
                Ok(stream) => break stream,
                Err(error)
                    if error.kind() == io::ErrorKind::ConnectionRefused && attempts < 100 =>
                {
                    async_time::sleep(time::Duration::from_millis(10)).await;
                }
                Err(error) => return Err(error.into()),
            }
        };
        stream
            .write_all(
                format!("GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
                    .as_bytes(),
            )
            .await?;
        let mut response = Vec::new();
        stream.read_to_end(&mut response).await?;
        Ok(String::from_utf8(response)?)
    }

    #[test]
    fn observer_protocol_exposes_only_bounded_read_operations() -> crate::HiveResult<()> {
        let snapshot = serde_json::to_string(&ObserverRequest::Snapshot {
            locale: "en".to_owned(),
        })?;
        let task = serde_json::to_string(&ObserverRequest::Task {
            task_id: "task-1".to_owned(),
            locale: "en".to_owned(),
        })?;
        for payload in [snapshot, task] {
            assert!(!payload.contains("migrate"));
            assert!(!payload.contains("claim"));
            assert!(!payload.contains("complete"));
            assert!(!payload.contains("enqueue"));
            assert!(!payload.contains("activity"));
        }
        Ok(())
    }

    #[tokio::test]
    async fn observer_handlers_preserve_success_not_found_and_unavailable_statuses()
    -> crate::HiveResult<()> {
        assert_eq!(health().await, StatusCode::NO_CONTENT);
        let state = ObserverState {
            store: FixtureStore::Ready,
        };
        let snapshot = match overview(
            State(state.clone()),
            Query(LocaleQuery {
                locale: "ru".into(),
            }),
        )
        .await
        {
            Ok(snapshot) => snapshot.0,
            Err(_) => return Err(crate::HiveError::message("ready overview failed")),
        };
        assert_eq!(snapshot.active_task_count, 2);
        assert_eq!(snapshot.copy.overview, "Обзор");
        let task = match task_detail(
            State(state.clone()),
            Path("task-1".into()),
            Query(LocaleQuery {
                locale: "en".into(),
            }),
        )
        .await
        {
            Ok(task) => task.0,
            Err(_) => return Err(crate::HiveError::message("known task was not returned")),
        };
        assert_eq!(task.id, "task-1");

        let Err(missing) = task_detail(
            State(state),
            Path("missing".into()),
            Query(LocaleQuery {
                locale: "en".into(),
            }),
        )
        .await
        else {
            return Err(crate::HiveError::message(
                "missing observer task was returned",
            ));
        };
        let missing = missing.into_response();
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);

        let Err(unavailable) = overview(
            State(ObserverState {
                store: FixtureStore::Failed,
            }),
            Query(LocaleQuery {
                locale: "en".into(),
            }),
        )
        .await
        else {
            return Err(crate::HiveError::message(
                "failed observer store returned an overview",
            ));
        };
        let unavailable = unavailable.into_response();
        assert_eq!(unavailable.status(), StatusCode::SERVICE_UNAVAILABLE);
        Ok(())
    }

    #[tokio::test]
    async fn observer_server_routes_health_api_and_dashboard_requests() -> crate::HiveResult<()> {
        let root = tempfile::tempdir()?;
        let dashboard = root.path().join("dashboard");
        async_fs::create_dir(&dashboard).await?;
        async_fs::write(dashboard.join("index.html"), "Hive dashboard fixture").await?;
        let listener = async_net::TcpListener::bind("127.0.0.1:0").await?;
        let address = listener.local_addr()?;
        let server = tokio::spawn(super::run_observer_on_listener(
            FixtureStore::Ready,
            listener,
            dashboard,
        ));

        let health = http_get(address, "/healthz").await?;
        assert!(health.starts_with("HTTP/1.1 204 No Content"));
        let overview = http_get(address, "/api/overview?locale=ru").await?;
        assert!(overview.starts_with("HTTP/1.1 200 OK"));
        assert!(overview.contains(r#""overview":"Обзор""#));
        let task = http_get(address, "/api/tasks/task-1?locale=en").await?;
        assert!(task.starts_with("HTTP/1.1 200 OK"));
        assert!(task.contains(r#""id":"task-1""#));
        let missing = http_get(address, "/api/tasks/missing?locale=en").await?;
        assert!(missing.starts_with("HTTP/1.1 404 Not Found"));
        let dashboard = http_get(address, "/").await?;
        assert!(dashboard.contains("Hive dashboard fixture"));

        server.abort();
        let Err(cancelled) = server.await else {
            return Err(crate::HiveError::message(
                "observer server stopped without cancellation",
            ));
        };
        assert!(cancelled.is_cancelled());
        Ok(())
    }
}

#[derive(serde::Serialize)]
struct ObserverErrorBody {
    error: String,
}

#[derive(Clone, Copy)]
enum ObserverTaskSelection {
    All,
    Attention,
}

struct ObserverTaskQuery<'a> {
    task_id: &'a str,
    limit: i64,
    locale: &'a str,
    selection: ObserverTaskSelection,
}
