use serde::Serialize;

use super::{ALERT_LIMIT, STALE_ACTIVITY_MS, STUCK_CANCELLATION_MS};
use crate::observer::ObserverCopy;

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

pub(super) fn derive_alerts(tasks: &[ObservedTask], now: i64, locale: &str) -> Vec<ObservedAlert> {
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

pub(super) fn localized_task_kind(kind: &str, locale: &str) -> String {
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

pub(super) fn localized_activity<'a>(key: &'a str, locale: &str) -> &'a str {
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
        AlertKind, AlertSeverity, ObservedTask, STALE_ACTIVITY_MS, derive_alerts,
        localized_activity, localized_task_kind,
    };
    use crate::observer::ObserverCopy;

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
