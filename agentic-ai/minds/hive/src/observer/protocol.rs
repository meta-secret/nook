use super::*;
use serde::{Deserialize, Serialize};

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
    pub(super) fn for_locale(locale: &str) -> Self {
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
pub(super) struct LocaleQuery {
    #[serde(default = "default_locale")]
    pub(super) locale: String,
}

pub(super) fn default_locale() -> String {
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
pub(super) enum ObserverRequest {
    Snapshot { locale: String },
    Task { task_id: String, locale: String },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "result", content = "value", rename_all = "snake_case")]
pub(super) enum ObserverResponse {
    Snapshot(Value),
    Task(Option<Value>),
    Error(String),
}

#[derive(Clone)]
pub struct ObserverCoordinatorStore {
    pub(super) channel: Arc<Mutex<BufReader<UnixStream>>>,
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
            return Err(crate::error::HiveError::message(
                "Hive observer coordinator closed its private channel",
            ));
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
            response => {
                return Err(crate::error::HiveError::message(format!(
                    "unexpected observer coordinator response: {response:?}"
                )));
            }
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
            response => {
                return Err(crate::error::HiveError::message(format!(
                    "unexpected observer coordinator response: {response:?}"
                )));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ObserverCoordinatorStore, ObserverRequest, ObserverResponse, ObserverStore, default_locale,
    };
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::UnixListener;

    #[tokio::test]
    async fn observer_client_round_trips_values_and_rejects_protocol_mismatches()
    -> crate::HiveResult<()> {
        let root = tempfile::tempdir()?;
        let socket = root.path().join("observer.sock");
        let listener = UnixListener::bind(&socket)?;
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await?;
            let (reader, mut writer) = stream.into_split();
            let mut requests = BufReader::new(reader).lines();
            let responses = [
                ObserverResponse::Snapshot(serde_json::json!({"ready": 2})),
                ObserverResponse::Task(Some(serde_json::json!({"id": "task-7"}))),
                ObserverResponse::Task(None),
                ObserverResponse::Error("coordinator unavailable".into()),
            ];
            for response in responses {
                let request = requests
                    .next_line()
                    .await?
                    .expect("request must be present");
                serde_json::from_str::<ObserverRequest>(&request)?;
                writer.write_all(&serde_json::to_vec(&response)?).await?;
                writer.write_all(b"\n").await?;
                writer.flush().await?;
            }
            Ok::<(), crate::HiveError>(())
        });
        let client = ObserverCoordinatorStore::connect(&socket).await?;

        assert_eq!(default_locale(), "en");
        assert_eq!(
            client.observer_snapshot_value("en").await?,
            serde_json::json!({"ready": 2})
        );
        assert_eq!(
            client.observer_task_value("task-7", "ru").await?,
            Some(serde_json::json!({"id": "task-7"}))
        );
        let mismatch = client
            .observer_snapshot_value("en")
            .await
            .expect_err("task response must not satisfy a snapshot request");
        assert!(
            mismatch
                .to_string()
                .contains("unexpected observer coordinator response")
        );
        let remote_error = client
            .observer_task_value("task-8", "en")
            .await
            .expect_err("remote error must cross the private channel");
        assert!(remote_error.to_string().contains("coordinator unavailable"));
        let closed = client
            .observer_snapshot_value("en")
            .await
            .expect_err("closed channel must not return empty state");
        assert!(closed.to_string().contains("closed its private channel"));
        server.await??;
        Ok(())
    }
}
