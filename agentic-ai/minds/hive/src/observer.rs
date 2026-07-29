use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::path::{Path as FilePath, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use crate::HiveContext;
use async_trait::async_trait;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use neo4rs::query;
use serde::{Deserialize, Serialize};
use serde_json::Value;
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

#[derive(Debug, Clone, Serialize)]
pub struct ObserverSnapshot {
    pub generated_at: i64,
    pub copy: ObserverCopy,
    pub agents: Vec<ObservedAgent>,
    pub active_task_count: i64,
    pub tasks: Vec<ObservedTask>,
    pub alerts: Vec<ObservedAlert>,
    pub alerts_truncated: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ObservedAlert {
    pub id: String,
    pub kind: AlertKind,
    pub severity: AlertSeverity,
    pub task_id: String,
    pub first_observed_at: i64,
    pub reason: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AlertKind {
    TaskFailed,
    DependencyFailed,
    DependencyBlocked,
    ActivityStale,
    CancellationStuck,
}

impl AlertKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::TaskFailed => "task-failed",
            Self::DependencyFailed => "dependency-failed",
            Self::DependencyBlocked => "dependency-blocked",
            Self::ActivityStale => "activity-stale",
            Self::CancellationStuck => "cancellation-stuck",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum AlertSeverity {
    Critical,
    Warning,
}

#[derive(Debug, Clone, Serialize)]
pub struct ObservedAgent {
    pub id: String,
    pub pod_name: String,
    pub status: String,
    pub last_seen_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ObservedTask {
    pub id: String,
    pub kind: String,
    pub kind_label: String,
    #[serde(skip)]
    pub trigger_kind: String,
    pub trigger: String,
    pub status: String,
    pub source_commit: String,
    pub priority: i64,
    pub attempt_count: i64,
    pub max_attempts: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub lease_until: i64,
    pub agent_id: String,
    pub pod_name: String,
    pub latest_attempt_status: String,
    pub latest_attempt_started_at: i64,
    pub latest_attempt_completed_at: i64,
    pub latest_activity_at: i64,
    pub latest_error: String,
    pub latest_summary: String,
    #[serde(skip)]
    pub dependency_failure: bool,
    pub dependencies: Vec<ObservedDependency>,
    pub activity: Vec<ObservedActivity>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ObservedDependency {
    pub id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ObservedActivity {
    pub id: String,
    pub kind: String,
    pub message: String,
    pub detail: String,
    pub created_at: i64,
    pub attempt_id: String,
    pub attempt_number: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ObserverCopy {
    pub product_name: &'static str,
    pub product_description: &'static str,
    pub overview: &'static str,
    pub workers: &'static str,
    pub queue: &'static str,
    pub needs_attention: &'static str,
    pub recent_activity: &'static str,
    pub all_tasks: &'static str,
    pub search_tasks: &'static str,
    pub no_tasks: &'static str,
    pub no_tasks_description: &'static str,
    pub no_search_results: &'static str,
    pub no_search_results_description: &'static str,
    pub no_attention: &'static str,
    pub no_attention_description: &'static str,
    pub task_details: &'static str,
    pub trigger: &'static str,
    pub source_revision: &'static str,
    pub current_attempt: &'static str,
    pub dependencies: &'static str,
    pub timeline: &'static str,
    pub no_activity: &'static str,
    pub no_dependencies: &'static str,
    pub attempt: &'static str,
    pub last_seen: &'static str,
    pub updated: &'static str,
    pub stale: &'static str,
    pub healthy: &'static str,
    pub idle: &'static str,
    pub running: &'static str,
    pub ready: &'static str,
    pub blocked: &'static str,
    pub failed: &'static str,
    pub critical: &'static str,
    pub warning: &'static str,
    pub alert_task_failed: &'static str,
    pub alert_dependency_failed: &'static str,
    pub alert_dependency_blocked: &'static str,
    pub alert_activity_stale: &'static str,
    pub alert_cancellation_stuck: &'static str,
    pub cancelling: &'static str,
    pub cancelled: &'static str,
    pub completed: &'static str,
    pub unavailable: &'static str,
    pub unavailable_description: &'static str,
    pub retry_connection: &'static str,
    pub close_details: &'static str,
}

impl ObserverCopy {
    fn for_locale(locale: &str) -> Self {
        if locale.eq_ignore_ascii_case("ru") || locale.to_ascii_lowercase().starts_with("ru-") {
            return Self {
                product_name: "Центр управления Hive",
                product_description: "Задачи агентов, исполнители и история работы в одном месте",
                overview: "Обзор",
                workers: "Исполнители",
                queue: "Очередь",
                needs_attention: "Требует внимания",
                recent_activity: "Последние действия",
                all_tasks: "Все задачи",
                search_tasks: "Поиск задач",
                no_tasks: "Задач пока нет",
                no_tasks_description: "Новые задачи появятся здесь после запуска Hive.",
                no_search_results: "Ничего не найдено",
                no_search_results_description: "Измените запрос, чтобы увидеть другие задачи.",
                no_attention: "Вмешательство не требуется",
                no_attention_description: "Заблокированных, устаревших или неудачных задач нет.",
                task_details: "Сведения о задаче",
                trigger: "Источник",
                source_revision: "Исходная ревизия",
                current_attempt: "Текущая попытка",
                dependencies: "Зависимости",
                timeline: "Ход работы",
                no_activity: "Агент ещё не записал действий.",
                no_dependencies: "У этой задачи нет зависимостей.",
                attempt: "Попытка",
                last_seen: "Последняя активность",
                updated: "Обновлено",
                stale: "Нет связи",
                healthy: "На связи",
                idle: "Ожидает",
                running: "Выполняется",
                ready: "Готова",
                blocked: "Заблокирована",
                failed: "Ошибка",
                critical: "Критично",
                warning: "Предупреждение",
                alert_task_failed: "Все разрешённые попытки завершились ошибкой",
                alert_dependency_failed: "Задача не запустилась из-за ошибки зависимости",
                alert_dependency_blocked: "Задача ожидает завершения зависимости",
                alert_activity_stale: "Агент давно не записывал действий",
                alert_cancellation_stuck: "Отмена не была подтверждена вовремя",
                cancelling: "Отменяется",
                cancelled: "Отменена",
                completed: "Завершена",
                unavailable: "Hive сейчас недоступен",
                unavailable_description: "Не удалось получить состояние наблюдателя.",
                retry_connection: "Повторить",
                close_details: "Закрыть сведения",
            };
        }
        Self {
            product_name: "Hive Control Center",
            product_description: "Agent tasks, workers, and execution history in one place",
            overview: "Overview",
            workers: "Workers",
            queue: "Queue",
            needs_attention: "Needs attention",
            recent_activity: "Recent activity",
            all_tasks: "All tasks",
            search_tasks: "Search tasks",
            no_tasks: "No tasks yet",
            no_tasks_description: "New work will appear here when Hive is triggered.",
            no_search_results: "No matching tasks",
            no_search_results_description: "Adjust the search to see other tasks.",
            no_attention: "Nothing needs intervention",
            no_attention_description: "There are no blocked, stale, or failed tasks.",
            task_details: "Task details",
            trigger: "Trigger",
            source_revision: "Source revision",
            current_attempt: "Current attempt",
            dependencies: "Dependencies",
            timeline: "Timeline",
            no_activity: "The agent has not recorded any activity yet.",
            no_dependencies: "This task has no dependencies.",
            attempt: "Attempt",
            last_seen: "Last seen",
            updated: "Updated",
            stale: "Stale",
            healthy: "Healthy",
            idle: "Idle",
            running: "Running",
            ready: "Ready",
            blocked: "Blocked",
            failed: "Failed",
            critical: "Critical",
            warning: "Warning",
            alert_task_failed: "All permitted attempts have failed",
            alert_dependency_failed: "Task could not start because a dependency failed",
            alert_dependency_blocked: "Task is waiting for a dependency",
            alert_activity_stale: "Agent activity has gone stale",
            alert_cancellation_stuck: "Cancellation was not acknowledged in time",
            cancelling: "Cancelling",
            cancelled: "Cancelled",
            completed: "Completed",
            unavailable: "Hive is unavailable",
            unavailable_description: "The observer state could not be loaded.",
            retry_connection: "Try again",
            close_details: "Close details",
        }
    }
}

#[derive(Debug, Deserialize)]
struct LocaleQuery {
    #[serde(default = "default_locale")]
    locale: String,
}

fn default_locale() -> String {
    "en".to_owned()
}

#[async_trait]
pub trait ObserverStore: Clone + Send + Sync + 'static {
    async fn observer_snapshot_value(&self, locale: &str) -> crate::HiveResult<Value>;
    async fn observer_task_value(
        &self,
        task_id: &str,
        locale: &str,
    ) -> crate::HiveResult<Option<Value>>;
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case")]
enum ObserverRequest {
    Snapshot { locale: String },
    Task { task_id: String, locale: String },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "result", content = "value", rename_all = "snake_case")]
enum ObserverResponse {
    Snapshot(Value),
    Task(Option<Value>),
    Error(String),
}

#[derive(Clone)]
pub struct ObserverCoordinatorStore {
    channel: Arc<Mutex<BufReader<UnixStream>>>,
}

impl ObserverCoordinatorStore {
    pub async fn connect(path: &FilePath) -> crate::HiveResult<Self> {
        let stream = loop {
            match UnixStream::connect(path).await {
                Ok(stream) => break stream,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    tokio::time::sleep(Duration::from_millis(250)).await;
                }
                Err(error) => {
                    return Err(error).with_hive_context(|| {
                        format!("connect to Hive observer coordinator {}", path.display())
                    });
                }
            }
        };
        Ok(Self {
            channel: Arc::new(Mutex::new(BufReader::new(stream))),
        })
    }

    async fn request(&self, request: ObserverRequest) -> crate::HiveResult<ObserverResponse> {
        let mut channel = self.channel.lock().await;
        channel
            .get_mut()
            .write_all(&serde_json::to_vec(&request)?)
            .await?;
        channel.get_mut().write_all(b"\n").await?;
        channel.get_mut().flush().await?;
        let mut response = String::new();
        if channel.read_line(&mut response).await? == 0 {
            crate::hive_bail!("Hive observer coordinator closed its private channel");
        }
        match serde_json::from_str(&response)? {
            ObserverResponse::Error(error) => Err(crate::HiveError::message(error)),
            response => Ok(response),
        }
    }
}

#[async_trait]
impl ObserverStore for ObserverCoordinatorStore {
    async fn observer_snapshot_value(&self, locale: &str) -> crate::HiveResult<Value> {
        match self
            .request(ObserverRequest::Snapshot {
                locale: locale.to_owned(),
            })
            .await?
        {
            ObserverResponse::Snapshot(snapshot) => Ok(snapshot),
            response => crate::hive_bail!("unexpected observer coordinator response: {response:?}"),
        }
    }

    async fn observer_task_value(
        &self,
        task_id: &str,
        locale: &str,
    ) -> crate::HiveResult<Option<Value>> {
        match self
            .request(ObserverRequest::Task {
                task_id: task_id.to_owned(),
                locale: locale.to_owned(),
            })
            .await?
        {
            ObserverResponse::Task(task) => Ok(task),
            response => crate::hive_bail!("unexpected observer coordinator response: {response:?}"),
        }
    }
}

#[derive(Clone)]
struct ObserverState<S> {
    store: S,
}

pub async fn run_observer<S: ObserverStore>(
    store: S,
    address: SocketAddr,
    dashboard: PathBuf,
) -> crate::HiveResult<()> {
    let index = dashboard.join("index.html");
    let assets = ServeDir::new(dashboard).fallback(ServeFile::new(index));
    let app = Router::new()
        .route("/healthz", get(health))
        .route("/api/overview", get(overview))
        .route("/api/tasks/{task_id}", get(task_detail))
        .fallback_service(assets)
        .with_state(ObserverState { store });
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .with_hive_context(|| format!("bind Hive observer to {address}"))?;
    axum::serve(listener, app)
        .await
        .hive_context("serve Hive observer")
}

pub async fn run_observer_coordinator(
    socket: PathBuf,
    store: Neo4jTaskStore,
) -> crate::HiveResult<()> {
    store.migrate().await?;
    if let Some(parent) = socket.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    remove_socket_if_present(&socket).await?;
    let listener = UnixListener::bind(&socket)
        .with_hive_context(|| format!("bind Hive observer coordinator {}", socket.display()))?;
    let (stream, _) = listener
        .accept()
        .await
        .hive_context("accept Hive observer channel")?;
    drop(listener);
    remove_socket_if_present(&socket).await?;

    let (reader, mut writer) = stream.into_split();
    let mut lines = BufReader::new(reader).lines();
    while let Some(line) = lines.next_line().await? {
        let response = match serde_json::from_str::<ObserverRequest>(&line) {
            Ok(ObserverRequest::Snapshot { locale }) => store
                .observer_snapshot_value(&locale)
                .await
                .map(ObserverResponse::Snapshot),
            Ok(ObserverRequest::Task { task_id, locale }) => store
                .observer_task_value(&task_id, &locale)
                .await
                .map(ObserverResponse::Task),
            Err(error) => Err(crate::hive_error!("decode observer request: {error}")),
        }
        .unwrap_or_else(|error| ObserverResponse::Error(format!("{error:#}")));
        writer.write_all(&serde_json::to_vec(&response)?).await?;
        writer.write_all(b"\n").await?;
        writer.flush().await?;
    }
    Ok(())
}

async fn remove_socket_if_present(path: &FilePath) -> crate::HiveResult<()> {
    match tokio::fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => {
            Err(error).with_hive_context(|| format!("remove stale socket {}", path.display()))
        }
    }
}

async fn health() -> StatusCode {
    StatusCode::NO_CONTENT
}

async fn overview<S: ObserverStore>(
    State(state): State<ObserverState<S>>,
    Query(locale): Query<LocaleQuery>,
) -> Result<Json<Value>, ObserverError> {
    Ok(Json(
        state.store.observer_snapshot_value(&locale.locale).await?,
    ))
}

async fn task_detail<S: ObserverStore>(
    State(state): State<ObserverState<S>>,
    Path(task_id): Path<String>,
    Query(locale): Query<LocaleQuery>,
) -> Result<Json<Value>, ObserverError> {
    state
        .store
        .observer_task_value(&task_id, &locale.locale)
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
    fn into_response(self) -> axum::response::Response {
        (
            self.status,
            Json(serde_json::json!({ "error": self.message })),
        )
            .into_response()
    }
}

impl Neo4jTaskStore {
    pub async fn observer_snapshot(&self, locale: &str) -> crate::HiveResult<ObserverSnapshot> {
        let overview_tasks = self.observer_tasks("", TASK_LIMIT, locale, false).await?;
        let mut attention_tasks = self
            .observer_tasks("", ALERT_LIMIT as i64 + 1, locale, true)
            .await?;
        let alerts_truncated = attention_tasks.len() > ALERT_LIMIT;
        attention_tasks.truncate(ALERT_LIMIT);
        let generated_at = OffsetDateTime::now_utc().unix_timestamp() * 1000;
        let alerts = derive_alerts(&attention_tasks, generated_at, locale);
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
        let mut tasks = self.observer_tasks(task_id, 1, locale, false).await?;
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
            agents.push(ObservedAgent {
                id: row.get("id")?,
                pod_name: row.get("pod_name")?,
                status: row.get("status")?,
                last_seen_at: row.get("last_seen_at")?,
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
        task_id: &str,
        limit: i64,
        locale: &str,
        attention_only: bool,
    ) -> crate::HiveResult<Vec<ObservedTask>> {
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
                            substring(replace(coalesce(
                              latest.attempt.error,
                              task.failure_reason,
                              task.blocked_reason,
                              ''
                            ), '\n', ' '), 0, 600)
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
                .param("attention_only", attention_only)
                .param("attention_age", STALE_ACTIVITY_MS),
            )
            .await?;
        let mut tasks = Vec::new();
        while let Some(row) = rows.next().await? {
            tasks.push(ObservedTask {
                id: row.get("id")?,
                kind: row.get("kind")?,
                kind_label: localized_task_kind(&row.get::<String>("kind")?, locale),
                trigger_kind: row.get("trigger_kind")?,
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
            task.trigger = match (task.trigger_kind.as_str(), russian) {
                ("github-main-failure", true) => {
                    "GitHub Actions · ошибка workflow в main".to_owned()
                }
                ("github-main-failure", false) => {
                    "GitHub Actions · failed main workflow".to_owned()
                }
                ("agent-dependency", true) => "Задача агента · зависимость".to_owned(),
                ("agent-dependency", false) => "Agent task · dependency".to_owned(),
                ("manual-cli", true) => "Ручной запуск · Hive CLI".to_owned(),
                ("manual-cli", false) => "Manual dispatch · Hive CLI".to_owned(),
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
                message: localized_activity(&message, locale).to_owned(),
                detail: row.get("detail")?,
                created_at: row.get("created_at")?,
                attempt_id: row.get("attempt_id")?,
                attempt_number: row.get("attempt_number")?,
            });
        }
        Ok(())
    }
}

fn derive_alerts(tasks: &[ObservedTask], now: i64, locale: &str) -> Vec<ObservedAlert> {
    let copy = ObserverCopy::for_locale(locale);
    let mut alerts = tasks
        .iter()
        .filter_map(|task| {
            let (kind, severity, first_observed_at, reason) = match task.status.as_str() {
                "FAILED" if task.dependency_failure => (
                    AlertKind::DependencyFailed,
                    AlertSeverity::Critical,
                    task.updated_at,
                    copy.alert_dependency_failed,
                ),
                "FAILED" => (
                    AlertKind::TaskFailed,
                    AlertSeverity::Critical,
                    task.latest_attempt_completed_at.max(task.updated_at),
                    copy.alert_task_failed,
                ),
                "BLOCKED" => (
                    AlertKind::DependencyBlocked,
                    AlertSeverity::Warning,
                    task.updated_at,
                    copy.alert_dependency_blocked,
                ),
                "RUNNING"
                    if now
                        - task
                            .latest_activity_at
                            .max(task.latest_attempt_started_at)
                            .max(task.created_at)
                        > STALE_ACTIVITY_MS =>
                {
                    (
                        AlertKind::ActivityStale,
                        AlertSeverity::Warning,
                        task.latest_activity_at
                            .max(task.latest_attempt_started_at)
                            .max(task.created_at)
                            + STALE_ACTIVITY_MS,
                        copy.alert_activity_stale,
                    )
                }
                "CANCELLING" if now - task.updated_at > STUCK_CANCELLATION_MS => (
                    AlertKind::CancellationStuck,
                    AlertSeverity::Warning,
                    task.updated_at + STUCK_CANCELLATION_MS,
                    copy.alert_cancellation_stuck,
                ),
                _ => return None,
            };
            Some(ObservedAlert {
                id: format!("{}:{}", kind.as_str(), task.id),
                kind,
                severity,
                task_id: task.id.clone(),
                first_observed_at,
                reason: reason.to_owned(),
            })
        })
        .collect::<Vec<_>>();
    alerts.sort_by(|left, right| {
        left.severity
            .cmp(&right.severity)
            .then_with(|| left.first_observed_at.cmp(&right.first_observed_at))
            .then_with(|| left.task_id.cmp(&right.task_id))
    });
    alerts.truncate(ALERT_LIMIT);
    alerts
}

#[async_trait]
impl ObserverStore for Neo4jTaskStore {
    async fn observer_snapshot_value(&self, locale: &str) -> crate::HiveResult<Value> {
        Ok(serde_json::to_value(self.observer_snapshot(locale).await?)?)
    }

    async fn observer_task_value(
        &self,
        task_id: &str,
        locale: &str,
    ) -> crate::HiveResult<Option<Value>> {
        self.observer_task(task_id, locale)
            .await?
            .map(serde_json::to_value)
            .transpose()
            .map_err(Into::into)
    }
}

fn localized_task_kind(kind: &str, locale: &str) -> String {
    let russian =
        locale.eq_ignore_ascii_case("ru") || locale.to_ascii_lowercase().starts_with("ru-");
    match (kind, russian) {
        ("main-repair", true) => "Восстановление main".to_owned(),
        ("blocker", true) => "Блокирующая задача".to_owned(),
        ("main-repair", false) => "Main repair".to_owned(),
        ("blocker", false) => "Blocking task".to_owned(),
        (_, _) => kind.replace('-', " "),
    }
}

fn localized_activity<'a>(key: &'a str, locale: &str) -> &'a str {
    let russian =
        locale.eq_ignore_ascii_case("ru") || locale.to_ascii_lowercase().starts_with("ru-");
    match (key, russian) {
        ("activity.agent_started", true) => "Агент начал работу",
        ("activity.command_running", true) => "Выполняется команда репозитория",
        ("activity.command_completed", true) => "Команда репозитория завершена",
        ("activity.command_failed", true) => "Команда репозитория завершилась с ошибкой",
        ("activity.applying_changes", true) => "Применяются изменения репозитория",
        ("activity.change_failed", true) => "Не удалось применить изменение",
        ("activity.warning", true) => "Агент сообщил предупреждение",
        ("activity.connection_retry", true) => "Агент повторяет подключение",
        ("activity.model_rerouted", true) => "Модель агента переключена",
        ("activity.result_ready", true) => "Агент вернул структурированный результат",
        ("activity.execution_stopped", true) => "Выполнение агента остановлено",
        ("activity.agent_started", false) => "Agent started",
        ("activity.command_running", false) => "Running repository command",
        ("activity.command_completed", false) => "Repository command completed",
        ("activity.command_failed", false) => "Repository command failed",
        ("activity.applying_changes", false) => "Applying repository changes",
        ("activity.change_failed", false) => "Repository change could not be applied",
        ("activity.warning", false) => "Agent reported a warning",
        ("activity.connection_retry", false) => "Agent connection retry",
        ("activity.model_rerouted", false) => "Agent model rerouted",
        ("activity.result_ready", false) => "Agent returned a structured result",
        ("activity.execution_stopped", false) => "Agent execution stopped",
        _ => key,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        AlertKind, AlertSeverity, ObservedTask, ObserverCopy, ObserverRequest, STALE_ACTIVITY_MS,
        derive_alerts, localized_activity, localized_task_kind,
    };

    #[test]
    fn observer_copy_preserves_english_and_russian_operator_meaning() {
        let english = ObserverCopy::for_locale("en-US");
        let russian = ObserverCopy::for_locale("ru-RU");

        assert_eq!(english.product_name, "Hive Control Center");
        assert_eq!(russian.product_name, "Центр управления Hive");
        assert_eq!(
            localized_activity("activity.command_failed", "en"),
            "Repository command failed"
        );
        assert_eq!(
            localized_activity("activity.command_failed", "ru"),
            "Команда репозитория завершилась с ошибкой"
        );
        assert_eq!(localized_task_kind("main-repair", "en"), "Main repair");
        assert_eq!(
            localized_task_kind("main-repair", "ru"),
            "Восстановление main"
        );
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

    #[test]
    fn alerts_are_typed_ordered_and_clear_with_task_state() {
        let now = 1_000_000;
        let mut failed = observed_task("failed", "FAILED", now - 10_000);
        failed.latest_attempt_completed_at = now - 8_000;
        failed.latest_attempt_started_at = now - 12_000;
        let blocked = observed_task("blocked", "BLOCKED", now - 20_000);
        let mut stale = observed_task("stale", "RUNNING", now - 30_000);
        stale.created_at = now - 10 * 60_000;
        stale.latest_attempt_started_at = now - 7 * 60_000;
        stale.latest_activity_at = now - 6 * 60_000;
        let cancelling = observed_task("cancelling", "CANCELLING", now - 6 * 60_000);
        let healthy = observed_task("healthy", "RUNNING", now - 30_000);

        let alerts = derive_alerts(
            &[blocked, stale, cancelling, healthy, failed.clone()],
            now,
            "en",
        );
        assert_eq!(alerts.len(), 4);
        assert_eq!(alerts[0].kind, AlertKind::TaskFailed);
        assert_eq!(alerts[0].severity, AlertSeverity::Critical);
        assert_eq!(alerts[1].task_id, "cancelling");
        assert_eq!(alerts[2].task_id, "stale");
        assert_eq!(
            alerts[2].first_observed_at,
            now - 6 * 60_000 + STALE_ACTIVITY_MS
        );
        assert_eq!(alerts[3].task_id, "blocked");

        failed.status = "COMPLETED".to_owned();
        assert!(derive_alerts(&[failed], now, "en").is_empty());
    }

    #[test]
    fn dependency_failure_does_not_claim_the_task_exhausted_attempts() {
        let now = 1_000_000;
        let mut failed = observed_task("dependent", "FAILED", now - 10_000);
        failed.latest_error = "dependency upstream exhausted its retry budget".to_owned();
        failed.latest_attempt_started_at = now - 20_000;
        failed.dependency_failure = true;

        let alerts = derive_alerts(&[failed], now, "en");
        assert_eq!(alerts[0].kind, AlertKind::DependencyFailed);
        assert_eq!(
            alerts[0].reason,
            "Task could not start because a dependency failed"
        );
    }

    #[test]
    fn alerts_are_bounded_and_localized() {
        let now = 1_000_000;
        let tasks = (0..140)
            .map(|index| observed_task(&format!("failed-{index:03}"), "FAILED", now - index))
            .collect::<Vec<_>>();
        let alerts = derive_alerts(&tasks, now, "ru");
        assert_eq!(alerts.len(), 100);
        assert_eq!(
            alerts[0].reason,
            "Все разрешённые попытки завершились ошибкой"
        );
    }

    fn observed_task(id: &str, status: &str, updated_at: i64) -> ObservedTask {
        ObservedTask {
            id: id.to_owned(),
            kind: "main-repair".to_owned(),
            kind_label: "Main repair".to_owned(),
            trigger_kind: "manual-cli".to_owned(),
            trigger: "Manual dispatch".to_owned(),
            status: status.to_owned(),
            source_commit: String::new(),
            priority: 0,
            attempt_count: 1,
            max_attempts: 3,
            created_at: updated_at - 1_000,
            updated_at,
            lease_until: 0,
            agent_id: String::new(),
            pod_name: String::new(),
            latest_attempt_status: status.to_owned(),
            latest_attempt_started_at: 0,
            latest_attempt_completed_at: 0,
            latest_activity_at: 0,
            latest_error: String::new(),
            latest_summary: String::new(),
            dependency_failure: false,
            dependencies: Vec::new(),
            activity: Vec::new(),
        }
    }
}
