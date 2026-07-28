use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::path::PathBuf;

use anyhow::Context;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use neo4rs::query;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use tower_http::services::{ServeDir, ServeFile};

use crate::neo4j::Neo4jTaskStore;
use crate::store::TaskStore;

const TASK_LIMIT: i64 = 200;
const AGENT_PRESENCE_WINDOW_MS: i64 = 120_000;

#[derive(Debug, Clone, Serialize)]
pub struct ObserverSnapshot {
    pub generated_at: i64,
    pub copy: ObserverCopy,
    pub agents: Vec<ObservedAgent>,
    pub tasks: Vec<ObservedTask>,
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
    pub latest_error: String,
    pub latest_summary: String,
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

#[derive(Clone)]
struct ObserverState {
    store: Neo4jTaskStore,
}

pub async fn run_observer(
    store: Neo4jTaskStore,
    address: SocketAddr,
    dashboard: PathBuf,
) -> anyhow::Result<()> {
    store.migrate().await?;
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
        .with_context(|| format!("bind Hive observer to {address}"))?;
    axum::serve(listener, app)
        .await
        .context("serve Hive observer")
}

async fn health() -> StatusCode {
    StatusCode::NO_CONTENT
}

async fn overview(
    State(state): State<ObserverState>,
    Query(locale): Query<LocaleQuery>,
) -> Result<Json<ObserverSnapshot>, ObserverError> {
    Ok(Json(state.store.observer_snapshot(&locale.locale).await?))
}

async fn task_detail(
    State(state): State<ObserverState>,
    Path(task_id): Path<String>,
    Query(locale): Query<LocaleQuery>,
) -> Result<Json<ObservedTask>, ObserverError> {
    state
        .store
        .observer_task(&task_id, &locale.locale)
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

impl From<anyhow::Error> for ObserverError {
    fn from(_error: anyhow::Error) -> Self {
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
    pub async fn observer_snapshot(&self, locale: &str) -> anyhow::Result<ObserverSnapshot> {
        let mut tasks = self.observer_tasks("", TASK_LIMIT, locale).await?;
        self.attach_dependencies(&mut tasks).await?;
        self.attach_triggers(&mut tasks, locale).await?;
        self.attach_activity(&mut tasks, locale).await?;
        Ok(ObserverSnapshot {
            generated_at: OffsetDateTime::now_utc().unix_timestamp() * 1000,
            copy: ObserverCopy::for_locale(locale),
            agents: self.observer_agents().await?,
            tasks,
        })
    }

    async fn observer_task(
        &self,
        task_id: &str,
        locale: &str,
    ) -> anyhow::Result<Option<ObservedTask>> {
        let mut tasks = self.observer_tasks(task_id, 1, locale).await?;
        self.attach_dependencies(&mut tasks).await?;
        self.attach_triggers(&mut tasks, locale).await?;
        self.attach_activity(&mut tasks, locale).await?;
        Ok(tasks.pop())
    }

    async fn observer_agents(&self) -> anyhow::Result<Vec<ObservedAgent>> {
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

    async fn observer_tasks(
        &self,
        task_id: &str,
        limit: i64,
        locale: &str,
    ) -> anyhow::Result<Vec<ObservedTask>> {
        let mut rows = self
            .graph
            .execute(
                query(
                    "MATCH (task:Task)
                     WHERE $task_id = '' OR task.id = $task_id
                     OPTIONAL MATCH (task)<-[:FOR_TASK]-(attempt:Attempt)
                     OPTIONAL MATCH (agent:Agent)-[:EXECUTED]->(attempt)
                     WITH task, attempt, agent
                     ORDER BY attempt.started_at DESC
                     WITH task, collect({attempt: attempt, agent: agent})[0] AS latest
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
                            substring(replace(coalesce(
                              latest.attempt.error,
                              task.failure_reason,
                              task.blocked_reason,
                              ''
                            ), '\n', ' '), 0, 600)
                              AS latest_error,
                            substring(replace(coalesce(latest.attempt.summary, ''), '\n', ' '), 0, 1200)
                              AS latest_summary
                     ORDER BY
                       CASE task.status
                         WHEN 'READY' THEN 0
                         WHEN 'RUNNING' THEN 1
                         WHEN 'BLOCKED' THEN 2
                         WHEN 'CANCELLING' THEN 3
                         ELSE 4
                       END,
                       CASE WHEN task.status = 'READY' THEN task.priority ELSE 0 END DESC,
                       CASE WHEN task.status = 'READY' THEN task.created_at ELSE 0 END ASC,
                       CASE WHEN task.status = 'READY' THEN task.id ELSE '' END ASC,
                       updated_at DESC,
                       created_at DESC
                     LIMIT $limit",
                )
                .param("task_id", task_id)
                .param("limit", limit),
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
                latest_error: row.get("latest_error")?,
                latest_summary: row.get("latest_summary")?,
                dependencies: Vec::new(),
                activity: Vec::new(),
            });
        }
        Ok(tasks)
    }

    async fn attach_dependencies(&self, tasks: &mut [ObservedTask]) -> anyhow::Result<()> {
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
    ) -> anyhow::Result<()> {
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
    ) -> anyhow::Result<()> {
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
    use super::{ObserverCopy, localized_activity, localized_task_kind};

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
}
