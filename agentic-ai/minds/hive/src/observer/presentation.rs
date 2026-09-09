use super::classification::{ObservedTaskState, ObservedTaskTrigger};
use crate::model::TaskKind;
use serde::{Deserialize, Serialize};

use super::{AGENT_PRESENCE_WINDOW_MS, ALERT_LIMIT, STALE_ACTIVITY_MS, STUCK_CANCELLATION_MS};
use crate::observer::ObserverCopy;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    feature = "observer-contract-export",
    derive(ts_rs::TS, schemars::JsonSchema)
)]
pub struct ObserverSnapshot {
    #[cfg_attr(feature = "observer-contract-export", ts(type = "number"))]
    pub generated_at: i64,
    pub copy: ObserverCopy,
    pub agents: Vec<ObservedAgent>,
    #[cfg_attr(feature = "observer-contract-export", ts(type = "number"))]
    pub active_task_count: i64,
    pub tasks: Vec<ObservedTask>,
    pub alerts: Vec<ObservedAlert>,
    pub alerts_truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(
    feature = "observer-contract-export",
    derive(ts_rs::TS, schemars::JsonSchema)
)]
pub struct ObservedAlert {
    pub id: String,
    pub kind: AlertKind,
    pub severity: AlertSeverity,
    pub task_id: String,
    #[cfg_attr(feature = "observer-contract-export", ts(type = "number"))]
    pub first_observed_at: i64,
    pub reason: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(
    feature = "observer-contract-export",
    derive(ts_rs::TS, schemars::JsonSchema)
)]
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[cfg_attr(
    feature = "observer-contract-export",
    derive(ts_rs::TS, schemars::JsonSchema)
)]
#[serde(rename_all = "lowercase")]
pub enum AlertSeverity {
    Critical,
    Warning,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    feature = "observer-contract-export",
    derive(ts_rs::TS, schemars::JsonSchema)
)]
pub struct ObservedAgent {
    pub id: String,
    pub pod_name: String,
    pub status: String,
    #[cfg_attr(feature = "observer-contract-export", ts(type = "number"))]
    pub last_seen_at: i64,
    /// Observation deadline in Unix milliseconds; consumers still compare their live clock.
    #[cfg_attr(feature = "observer-contract-export", ts(type = "number"))]
    pub presence_expires_at: i64,
}

impl ObservedAgent {
    pub(super) fn presence_expires_at(last_seen_at: i64) -> i64 {
        last_seen_at.saturating_add(AGENT_PRESENCE_WINDOW_MS)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    feature = "observer-contract-export",
    derive(ts_rs::TS, schemars::JsonSchema)
)]
pub struct ObservedTask {
    pub id: String,
    #[cfg_attr(feature = "observer-contract-export", ts(type = "string"))]
    #[cfg_attr(feature = "observer-contract-export", schemars(with = "String"))]
    pub kind: TaskKind,
    pub kind_label: String,
    #[serde(skip)]
    pub trigger_kind: ObservedTaskTrigger,
    pub trigger: String,
    #[cfg_attr(feature = "observer-contract-export", ts(type = "string"))]
    #[cfg_attr(feature = "observer-contract-export", schemars(with = "String"))]
    pub status: ObservedTaskState,
    pub source_commit: String,
    #[cfg_attr(feature = "observer-contract-export", ts(type = "number"))]
    pub priority: i64,
    #[cfg_attr(feature = "observer-contract-export", ts(type = "number"))]
    pub attempt_count: i64,
    #[cfg_attr(feature = "observer-contract-export", ts(type = "number"))]
    pub max_attempts: i64,
    #[cfg_attr(feature = "observer-contract-export", ts(type = "number"))]
    pub created_at: i64,
    #[cfg_attr(feature = "observer-contract-export", ts(type = "number"))]
    pub updated_at: i64,
    #[cfg_attr(feature = "observer-contract-export", ts(type = "number"))]
    pub lease_until: i64,
    pub agent_id: String,
    pub pod_name: String,
    pub latest_attempt_status: String,
    #[cfg_attr(feature = "observer-contract-export", ts(type = "number"))]
    pub latest_attempt_started_at: i64,
    #[cfg_attr(feature = "observer-contract-export", ts(type = "number"))]
    pub latest_attempt_completed_at: i64,
    #[cfg_attr(feature = "observer-contract-export", ts(type = "number"))]
    pub latest_activity_at: i64,
    pub latest_error: String,
    pub latest_summary: String,
    #[serde(skip)]
    pub dependency_failure: bool,
    pub dependencies: Vec<ObservedDependency>,
    pub activity: Vec<ObservedActivity>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    feature = "observer-contract-export",
    derive(ts_rs::TS, schemars::JsonSchema)
)]
pub struct ObservedDependency {
    pub id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    feature = "observer-contract-export",
    derive(ts_rs::TS, schemars::JsonSchema)
)]
pub struct ObservedActivity {
    pub id: String,
    pub kind: String,
    pub message: String,
    pub detail: String,
    #[cfg_attr(feature = "observer-contract-export", ts(type = "number"))]
    pub created_at: i64,
    pub attempt_id: String,
    #[cfg_attr(feature = "observer-contract-export", ts(type = "number"))]
    pub attempt_number: i64,
}

impl ObservedAlert {
    pub(super) fn derive_alerts(
        tasks: &[ObservedTask],
        now: i64,
        locale: &str,
    ) -> Vec<ObservedAlert> {
        let copy = ObserverCopy::for_locale(locale);
        let mut alerts = tasks
            .iter()
            .filter_map(|task| {
                let TaskAttention::Required {
                    kind,
                    first_observed_at,
                } = task.attention_at(now)
                else {
                    return None;
                };
                let severity = kind.severity();
                let reason = kind.reason(&copy);
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
}

impl TaskKind {
    pub(super) fn localized_label(&self, locale: &str) -> String {
        let kind = self;
        let russian =
            locale.eq_ignore_ascii_case("ru") || locale.to_ascii_lowercase().starts_with("ru-");
        match (kind, russian) {
            (TaskKind::MainRepair, true) => "Восстановление main".to_owned(),
            (TaskKind::Blocker, true) => "Блокирующая задача".to_owned(),
            (TaskKind::MainRepair, false) => "Main repair".to_owned(),
            (TaskKind::Blocker, false) => "Blocking task".to_owned(),
            (_, _) => kind.as_str().replace('-', " "),
        }
    }
}

pub(super) struct ActivityLocalization<'a> {
    pub(super) key: &'a str,
    pub(super) locale: &'a str,
}
impl<'a> ActivityLocalization<'a> {
    pub(super) fn text(self) -> &'a str {
        let Self { key, locale } = self;
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
}

#[cfg(test)]
mod tests {
    use super::{
        ActivityLocalization, AlertKind, AlertSeverity, ObservedAgent, ObservedAlert, ObservedTask,
        ObservedTaskState, ObserverCopy, STALE_ACTIVITY_MS, TaskKind,
    };

    #[test]
    fn agent_presence_projects_the_shared_window_as_a_deadline() {
        assert_eq!(
            ObservedAgent::presence_expires_at(1_700_000_000_000),
            1_700_000_120_000
        );
        assert_eq!(ObservedAgent::presence_expires_at(i64::MAX - 1), i64::MAX);
    }
    use crate::observer::ObserverCopy;

    #[test]
    fn observer_copy_preserves_english_and_russian_operator_meaning() {
        let english = ObserverCopy::for_locale("en-US");
        let russian = ObserverCopy::for_locale("ru-RU");

        assert_eq!(english.product_name, "Hive Control Center");
        assert_eq!(russian.product_name, "Центр управления Hive");
        assert_eq!(
            (ActivityLocalization {
                key: "activity.command_failed",
                locale: "en"
            })
            .text(),
            "Repository command failed"
        );
        assert_eq!(
            (ActivityLocalization {
                key: "activity.command_failed",
                locale: "ru"
            })
            .text(),
            "Команда репозитория завершилась с ошибкой"
        );
        assert_eq!(TaskKind::MainRepair.localized_label("en"), "Main repair");
        assert_eq!(
            TaskKind::MainRepair.localized_label("ru"),
            "Восстановление main"
        );
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

        let alerts = ObservedAlert::derive_alerts(
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

        failed.status = ObservedTaskState::Completed;
        assert!(ObservedAlert::derive_alerts(&[failed], now, "en").is_empty());
    }

    #[test]
    fn dependency_failure_does_not_claim_the_task_exhausted_attempts() {
        let now = 1_000_000;
        let mut failed = observed_task("dependent", "FAILED", now - 10_000);
        failed.latest_error = "dependency upstream exhausted its retry budget".to_owned();
        failed.latest_attempt_started_at = now - 20_000;
        failed.dependency_failure = true;

        let alerts = ObservedAlert::derive_alerts(&[failed], now, "en");
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
        let alerts = ObservedAlert::derive_alerts(&tasks, now, "ru");
        assert_eq!(alerts.len(), 100);
        assert_eq!(
            alerts[0].reason,
            "Все разрешённые попытки завершились ошибкой"
        );
    }

    fn observed_task(id: &str, status: &str, updated_at: i64) -> ObservedTask {
        ObservedTask {
            id: id.to_owned(),
            kind: "main-repair".into(),
            kind_label: "Main repair".to_owned(),
            trigger_kind: "manual-cli".into(),
            trigger: "Manual dispatch".to_owned(),
            status: status.into(),
            source_commit: String::new(),
            priority: 0,
            attempt_count: 1,
            max_attempts: 3,
            created_at: updated_at - 1_000,
            updated_at,
            lease_until: 0,
            agent_id: String::new(),
            pod_name: String::new(),
            latest_attempt_status: status.into(),
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

#[cfg(test)]
impl ObservedTask {
    pub(super) fn fixture(id: &str) -> ObservedTask {
        let status = "RUNNING";
        let updated_at = 1000;
        ObservedTask {
            id: id.to_owned(),
            kind: "main-repair".into(),
            kind_label: "Main repair".to_owned(),
            trigger_kind: "manual-cli".into(),
            trigger: "Manual dispatch".to_owned(),
            status: status.into(),
            source_commit: String::new(),
            priority: 0,
            attempt_count: 1,
            max_attempts: 3,
            created_at: updated_at - 1_000,
            updated_at,
            lease_until: 0,
            agent_id: String::new(),
            pod_name: String::new(),
            latest_attempt_status: status.into(),
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
#[cfg(test)]
impl ObserverSnapshot {
    pub(super) fn fixture(locale: &str) -> Self {
        Self {
            generated_at: 1000,
            copy: ObserverCopy::for_locale(locale),
            agents: Vec::new(),
            active_task_count: 2,
            tasks: Vec::new(),
            alerts: Vec::new(),
            alerts_truncated: false,
        }
    }
}

enum TaskAttention {
    None,
    Required {
        kind: AlertKind,
        first_observed_at: i64,
    },
}
impl ObservedTask {
    fn attention_at(&self, now: i64) -> TaskAttention {
        match &self.status {
            ObservedTaskState::Failed if self.dependency_failure => TaskAttention::Required {
                kind: AlertKind::DependencyFailed,
                first_observed_at: self.updated_at,
            },
            ObservedTaskState::Failed => TaskAttention::Required {
                kind: AlertKind::TaskFailed,
                first_observed_at: self.latest_attempt_completed_at.max(self.updated_at),
            },
            ObservedTaskState::Blocked => TaskAttention::Required {
                kind: AlertKind::DependencyBlocked,
                first_observed_at: self.updated_at,
            },
            ObservedTaskState::Running => {
                let progress = self
                    .latest_activity_at
                    .max(self.latest_attempt_started_at)
                    .max(self.created_at);
                if now - progress > STALE_ACTIVITY_MS {
                    TaskAttention::Required {
                        kind: AlertKind::ActivityStale,
                        first_observed_at: progress + STALE_ACTIVITY_MS,
                    }
                } else {
                    TaskAttention::None
                }
            }
            ObservedTaskState::Cancelling if now - self.updated_at > STUCK_CANCELLATION_MS => {
                TaskAttention::Required {
                    kind: AlertKind::CancellationStuck,
                    first_observed_at: self.updated_at + STUCK_CANCELLATION_MS,
                }
            }
            ObservedTaskState::Ready
            | ObservedTaskState::Completed
            | ObservedTaskState::Cancelled
            | ObservedTaskState::Cancelling
            | ObservedTaskState::Other(_) => TaskAttention::None,
        }
    }
}
impl AlertKind {
    fn severity(self) -> AlertSeverity {
        match self {
            Self::TaskFailed | Self::DependencyFailed => AlertSeverity::Critical,
            Self::DependencyBlocked | Self::ActivityStale | Self::CancellationStuck => {
                AlertSeverity::Warning
            }
        }
    }
}
impl AlertKind {
    fn reason(self, copy: &ObserverCopy) -> &str {
        match self {
            AlertKind::TaskFailed => &copy.alert_task_failed,
            AlertKind::DependencyFailed => &copy.alert_dependency_failed,
            AlertKind::DependencyBlocked => &copy.alert_dependency_blocked,
            AlertKind::ActivityStale => &copy.alert_activity_stale,
            AlertKind::CancellationStuck => &copy.alert_cancellation_stuck,
        }
    }
}
