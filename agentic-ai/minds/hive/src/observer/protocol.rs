use super::*;
use serde::{Deserialize, Serialize};
use std::io;
use tokio::time as async_time;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    feature = "observer-contract-export",
    derive(ts_rs::TS, schemars::JsonSchema)
)]
pub struct ObserverCopy {
    pub product_name: String,
    pub product_description: String,
    pub overview: String,
    pub workers: String,
    pub queue: String,
    pub needs_attention: String,
    pub recent_activity: String,
    pub all_tasks: String,
    pub search_tasks: String,
    pub no_tasks: String,
    pub no_tasks_description: String,
    pub no_search_results: String,
    pub no_search_results_description: String,
    pub no_attention: String,
    pub no_attention_description: String,
    pub task_details: String,
    pub trigger: String,
    pub source_revision: String,
    pub current_attempt: String,
    pub dependencies: String,
    pub timeline: String,
    pub no_activity: String,
    pub no_dependencies: String,
    pub attempt: String,
    pub last_seen: String,
    pub updated: String,
    pub stale: String,
    pub healthy: String,
    pub idle: String,
    pub running: String,
    pub ready: String,
    pub blocked: String,
    pub failed: String,
    pub critical: String,
    pub warning: String,
    pub alert_task_failed: String,
    pub alert_dependency_failed: String,
    pub alert_dependency_blocked: String,
    pub alert_activity_stale: String,
    pub alert_cancellation_stuck: String,
    pub cancelling: String,
    pub cancelled: String,
    pub completed: String,
    pub unavailable: String,
    pub unavailable_description: String,
    pub retry_connection: String,
    pub close_details: String,
}

impl ObserverCopy {
    pub(super) fn for_locale(locale: &str) -> Self {
        if locale.eq_ignore_ascii_case("ru") || locale.to_ascii_lowercase().starts_with("ru-") {
            return Self {
                product_name: "Центр управления Hive".to_owned(),
                product_description: "Задачи агентов, исполнители и история работы в одном месте"
                    .to_owned(),
                overview: "Обзор".to_owned(),
                workers: "Исполнители".to_owned(),
                queue: "Очередь".to_owned(),
                needs_attention: "Требует внимания".to_owned(),
                recent_activity: "Последние действия".to_owned(),
                all_tasks: "Все задачи".to_owned(),
                search_tasks: "Поиск задач".to_owned(),
                no_tasks: "Задач пока нет".to_owned(),
                no_tasks_description: "Новые задачи появятся здесь после запуска Hive.".to_owned(),
                no_search_results: "Ничего не найдено".to_owned(),
                no_search_results_description: "Измените запрос, чтобы увидеть другие задачи."
                    .to_owned(),
                no_attention: "Вмешательство не требуется".to_owned(),
                no_attention_description: "Заблокированных, устаревших или неудачных задач нет."
                    .to_owned(),
                task_details: "Сведения о задаче".to_owned(),
                trigger: "Источник".to_owned(),
                source_revision: "Исходная ревизия".to_owned(),
                current_attempt: "Текущая попытка".to_owned(),
                dependencies: "Зависимости".to_owned(),
                timeline: "Ход работы".to_owned(),
                no_activity: "Агент ещё не записал действий.".to_owned(),
                no_dependencies: "У этой задачи нет зависимостей.".to_owned(),
                attempt: "Попытка".to_owned(),
                last_seen: "Последняя активность".to_owned(),
                updated: "Обновлено".to_owned(),
                stale: "Нет связи".to_owned(),
                healthy: "На связи".to_owned(),
                idle: "Ожидает".to_owned(),
                running: "Выполняется".to_owned(),
                ready: "Готова".to_owned(),
                blocked: "Заблокирована".to_owned(),
                failed: "Ошибка".to_owned(),
                critical: "Критично".to_owned(),
                warning: "Предупреждение".to_owned(),
                alert_task_failed: "Все разрешённые попытки завершились ошибкой".to_owned(),
                alert_dependency_failed: "Задача не запустилась из-за ошибки зависимости"
                    .to_owned(),
                alert_dependency_blocked: "Задача ожидает завершения зависимости".to_owned(),
                alert_activity_stale: "Агент давно не записывал действий".to_owned(),
                alert_cancellation_stuck: "Отмена не была подтверждена вовремя".to_owned(),
                cancelling: "Отменяется".to_owned(),
                cancelled: "Отменена".to_owned(),
                completed: "Завершена".to_owned(),
                unavailable: "Hive сейчас недоступен".to_owned(),
                unavailable_description: "Не удалось получить состояние наблюдателя.".to_owned(),
                retry_connection: "Повторить".to_owned(),
                close_details: "Закрыть сведения".to_owned(),
            };
        }
        Self {
            product_name: "Hive Control Center".to_owned(),
            product_description: "Agent tasks, workers, and execution history in one place"
                .to_owned(),
            overview: "Overview".to_owned(),
            workers: "Workers".to_owned(),
            queue: "Queue".to_owned(),
            needs_attention: "Needs attention".to_owned(),
            recent_activity: "Recent activity".to_owned(),
            all_tasks: "All tasks".to_owned(),
            search_tasks: "Search tasks".to_owned(),
            no_tasks: "No tasks yet".to_owned(),
            no_tasks_description: "New work will appear here when Hive is triggered.".to_owned(),
            no_search_results: "No matching tasks".to_owned(),
            no_search_results_description: "Adjust the search to see other tasks.".to_owned(),
            no_attention: "Nothing needs intervention".to_owned(),
            no_attention_description: "There are no blocked, stale, or failed tasks.".to_owned(),
            task_details: "Task details".to_owned(),
            trigger: "Trigger".to_owned(),
            source_revision: "Source revision".to_owned(),
            current_attempt: "Current attempt".to_owned(),
            dependencies: "Dependencies".to_owned(),
            timeline: "Timeline".to_owned(),
            no_activity: "The agent has not recorded any activity yet.".to_owned(),
            no_dependencies: "This task has no dependencies.".to_owned(),
            attempt: "Attempt".to_owned(),
            last_seen: "Last seen".to_owned(),
            updated: "Updated".to_owned(),
            stale: "Stale".to_owned(),
            healthy: "Healthy".to_owned(),
            idle: "Idle".to_owned(),
            running: "Running".to_owned(),
            ready: "Ready".to_owned(),
            blocked: "Blocked".to_owned(),
            failed: "Failed".to_owned(),
            critical: "Critical".to_owned(),
            warning: "Warning".to_owned(),
            alert_task_failed: "All permitted attempts have failed".to_owned(),
            alert_dependency_failed: "Task could not start because a dependency failed".to_owned(),
            alert_dependency_blocked: "Task is waiting for a dependency".to_owned(),
            alert_activity_stale: "Agent activity has gone stale".to_owned(),
            alert_cancellation_stuck: "Cancellation was not acknowledged in time".to_owned(),
            cancelling: "Cancelling".to_owned(),
            cancelled: "Cancelled".to_owned(),
            completed: "Completed".to_owned(),
            unavailable: "Hive is unavailable".to_owned(),
            unavailable_description: "The observer state could not be loaded.".to_owned(),
            retry_connection: "Try again".to_owned(),
            close_details: "Close details".to_owned(),
        }
    }
}

#[derive(Debug, Deserialize)]
pub(super) struct LocaleQuery {
    #[serde(default = "ObserverCopy::default_locale")]
    pub(super) locale: String,
}

impl ObserverCopy {
    pub(super) fn default_locale() -> String {
        "en".to_owned()
    }
}

/// A missing lookup retains the coordinator's existing JSON null payload.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(untagged)]
pub enum TaskObservation {
    Observed(ObservedTask),
    #[default]
    Missing,
}

#[async_trait]
pub trait ObserverStore: Clone + Send + Sync + 'static {
    async fn observer_snapshot_view(&self, locale: &str) -> crate::HiveResult<ObserverSnapshot>;
    async fn observer_task_view(
        &self,
        task_id: &str,
        locale: &str,
    ) -> crate::HiveResult<TaskObservation>;
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
    Snapshot(ObserverSnapshot),
    Task(#[serde(default)] TaskObservation),
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
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    async_time::sleep(Duration::from_millis(250)).await;
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
            return Err(crate::HiveError::message(
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
    async fn observer_snapshot_view(&self, locale: &str) -> crate::HiveResult<ObserverSnapshot> {
        match self
            .request(ObserverRequest::Snapshot {
                locale: locale.to_owned(),
            })
            .await?
        {
            ObserverResponse::Snapshot(snapshot) => Ok(snapshot),
            response => {
                return Err(crate::HiveError::message(format!(
                    "unexpected observer coordinator response: {response:?}"
                )));
            }
        }
    }

    async fn observer_task_view(
        &self,
        task_id: &str,
        locale: &str,
    ) -> crate::HiveResult<TaskObservation> {
        match self
            .request(ObserverRequest::Task {
                task_id: task_id.to_owned(),
                locale: locale.to_owned(),
            })
            .await?
        {
            ObserverResponse::Task(task) => Ok(task),
            response => {
                return Err(crate::HiveError::message(format!(
                    "unexpected observer coordinator response: {response:?}"
                )));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ObserverCoordinatorStore, ObserverCopy, ObserverRequest, ObserverResponse, ObserverStore,
        TaskObservation,
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
                ObserverResponse::Snapshot(super::super::ObserverSnapshot::fixture("en")),
                ObserverResponse::Task(TaskObservation::Observed(
                    super::super::ObservedTask::fixture("task-7"),
                )),
                ObserverResponse::Task(TaskObservation::Missing),
                ObserverResponse::Error("coordinator unavailable".into()),
            ];
            for response in responses {
                let Some(request) = requests.next_line().await? else {
                    return Err(crate::HiveError::message(
                        "observer client closed before sending its request",
                    ));
                };
                serde_json::from_str::<ObserverRequest>(&request)?;
                writer.write_all(&serde_json::to_vec(&response)?).await?;
                writer.write_all(b"\n").await?;
                writer.flush().await?;
            }
            let Some(final_request) = requests.next_line().await? else {
                return Err(crate::HiveError::message(
                    "observer client closed before the final request",
                ));
            };
            serde_json::from_str::<ObserverRequest>(&final_request)?;
            Ok::<(), crate::HiveError>(())
        });
        let client = ObserverCoordinatorStore::connect(&socket).await?;

        assert_eq!(ObserverCopy::default_locale(), "en");
        assert_eq!(
            client.observer_snapshot_view("en").await?.active_task_count,
            2
        );
        assert!(
            matches!(client.observer_task_view("task-7", "ru").await?, TaskObservation::Observed(task) if task.id == "task-7")
        );
        let Err(mismatch) = client.observer_snapshot_view("en").await else {
            return Err(crate::HiveError::message(
                "task response satisfied a snapshot request",
            ));
        };
        assert!(
            mismatch
                .to_string()
                .contains("unexpected observer coordinator response")
        );
        let Err(remote_error) = client.observer_task_view("task-8", "en").await else {
            return Err(crate::HiveError::message(
                "remote observer error did not cross the private channel",
            ));
        };
        assert!(remote_error.to_string().contains("coordinator unavailable"));
        let Err(closed) = client.observer_snapshot_view("en").await else {
            return Err(crate::HiveError::message(
                "closed observer channel returned state",
            ));
        };
        let crate::HiveError::Message { message } = closed else {
            return Err(crate::HiveError::message(
                "observer channel closure lost its typed protocol error",
            ));
        };
        assert_eq!(
            message,
            "Hive observer coordinator closed its private channel"
        );
        server.await??;
        Ok(())
    }
}
