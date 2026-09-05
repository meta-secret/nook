use std::path::Path;
use std::time as std_time;
use tokio::fs as async_fs;

use codex::EventMsg;
use serde::Serialize;
use time::{Duration as SignedDuration, OffsetDateTime, format_description::well_known::Rfc3339};
use tokio::io::AsyncWriteExt;

use crate::model::{ActivityKind, TaskActivity};

pub(super) fn task_activity_from_event(event: &EventMsg) -> Option<TaskActivity> {
    let activity = match event {
        EventMsg::TurnStarted(_) => TaskActivity {
            kind: ActivityKind::Started,
            message: "activity.agent_started".to_owned(),
            detail: String::new(),
        },
        EventMsg::ExecCommandBegin(_) => TaskActivity {
            kind: ActivityKind::Action,
            message: "activity.command_running".to_owned(),
            detail: String::new(),
        },
        EventMsg::ExecCommandEnd(event) => {
            let category = local_execution_category(&event.command).unwrap_or("action");
            let command = sanitized_execution_command(&event.command, category);
            TaskActivity {
                kind: if event.exit_code == 0 {
                    ActivityKind::Result
                } else {
                    ActivityKind::Error
                },
                message: if event.exit_code == 0 {
                    "activity.command_completed".to_owned()
                } else {
                    "activity.command_failed".to_owned()
                },
                detail: if event.exit_code == 0 {
                    format!("{command} · {:.1}s", event.duration.as_secs_f64())
                } else {
                    format!(
                        "{command} · status {} · {:.1}s",
                        event.exit_code,
                        event.duration.as_secs_f64()
                    )
                },
            }
        }
        EventMsg::PatchApplyBegin(_) => TaskActivity {
            kind: ActivityKind::Edit,
            message: "activity.applying_changes".to_owned(),
            detail: String::new(),
        },
        EventMsg::PatchApplyEnd(event) if !event.success => TaskActivity {
            kind: ActivityKind::Error,
            message: "activity.change_failed".to_owned(),
            detail: String::new(),
        },
        EventMsg::Warning(_) | EventMsg::GuardianWarning(_) => TaskActivity {
            kind: ActivityKind::Warning,
            message: "activity.warning".to_owned(),
            detail: String::new(),
        },
        EventMsg::StreamError(_) => TaskActivity {
            kind: ActivityKind::Retry,
            message: "activity.connection_retry".to_owned(),
            detail: String::new(),
        },
        EventMsg::ModelReroute(_) => TaskActivity {
            kind: ActivityKind::Retry,
            message: "activity.model_rerouted".to_owned(),
            detail: String::new(),
        },
        EventMsg::TurnComplete(_) => TaskActivity {
            kind: ActivityKind::Report,
            message: "activity.result_ready".to_owned(),
            detail: String::new(),
        },
        EventMsg::Error(_) | EventMsg::TurnAborted(_) => TaskActivity {
            kind: ActivityKind::Error,
            message: "activity.execution_stopped".to_owned(),
            detail: String::new(),
        },
        _ => return None,
    };
    Some(activity)
}

#[derive(Serialize)]
struct LocalExecutionRecord {
    command: String,
    category: &'static str,
    started_at: String,
    finished_at: String,
    duration_seconds: u64,
    outcome: &'static str,
    reason: &'static str,
}

pub(super) async fn record_local_execution(
    path: &Path,
    command: &[String],
    exit_code: i32,
    duration: std_time::Duration,
) -> crate::HiveResult<()> {
    let Some(category) = local_execution_category(command) else {
        return Ok(());
    };
    let finished = OffsetDateTime::now_utc();
    let duration_seconds = duration.as_secs();
    let started = finished - SignedDuration::seconds(i64::try_from(duration_seconds)?);
    let record = LocalExecutionRecord {
        command: sanitized_execution_command(command, category),
        category,
        started_at: started.format(&Rfc3339)?,
        finished_at: finished.format(&Rfc3339)?,
        duration_seconds,
        outcome: if exit_code == 0 { "passed" } else { "failed" },
        reason: "embedded_codex_validation",
    };
    let mut line = serde_json::to_vec(&record)?;
    line.push(b'\n');
    let mut output = async_fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await?;
    output.write_all(&line).await?;
    output.flush().await?;
    Ok(())
}

fn local_execution_category(command: &[String]) -> Option<&'static str> {
    let command = command.join(" ").to_ascii_lowercase();
    let tests = [
        " test",
        "test ",
        "nextest",
        "pytest",
        "e2e",
        "playwright",
        "vitest",
    ]
    .iter()
    .any(|marker| command.contains(marker));
    let checks = [
        "task ",
        "cargo check",
        "cargo clippy",
        "cargo fmt",
        "format",
        " lint",
        "build",
        "deploy",
        "validate",
        "verify",
    ]
    .iter()
    .any(|marker| command.contains(marker));
    match (checks, tests) {
        (true, true) => Some("combined"),
        (true, false) => Some("check"),
        (false, true) => Some("test"),
        (false, false) => None,
    }
}

fn sanitized_execution_command(command: &[String], category: &str) -> String {
    let joined = command.join(" ");
    let lower = joined.to_ascii_lowercase();
    if ["token", "secret", "password", "credential", "authorization"]
        .iter()
        .any(|marker| lower.contains(marker))
    {
        return format!("[redacted {category} command]");
    }
    for tool in ["task", "cargo", "bun", "npm", "pytest", "go"] {
        let Some(index) = lower.find(&format!("{tool} ")) else {
            continue;
        };
        let public = joined[index..]
            .split_whitespace()
            .take(2)
            .map(|part| {
                part.trim_matches(|character: char| {
                    !character.is_ascii_alphanumeric()
                        && !matches!(character, '-' | '_' | ':' | '/' | '.')
                })
            })
            .collect::<Vec<_>>();
        if public.len() == 2 && public.iter().all(|part| !part.is_empty()) {
            return public.join(" ");
        }
    }
    format!("[{category} repository command]")
}

#[cfg(test)]
mod tests {
    use super::{local_execution_category, sanitized_execution_command};

    #[test]
    fn classifies_and_sanitizes_local_validation_executions() {
        let check = vec![
            "/bin/zsh".into(),
            "-lc".into(),
            "task infra:k0s:manifests:check".into(),
        ];
        let combined = vec!["/bin/zsh".into(), "-lc".into(), "task test:hive".into()];
        let unrelated = vec!["git".into(), "status".into()];

        assert_eq!(local_execution_category(&check), Some("check"));
        assert_eq!(local_execution_category(&combined), Some("combined"));
        assert_eq!(local_execution_category(&unrelated), None);
        assert_eq!(
            sanitized_execution_command(&check, "check"),
            "task infra:k0s:manifests:check"
        );
    }

    #[test]
    fn redacts_secret_bearing_local_validation_commands() {
        let command = vec![
            "/bin/zsh".into(),
            "-lc".into(),
            "task deploy TOKEN=do-not-publish".into(),
        ];

        assert_eq!(
            sanitized_execution_command(&command, "check"),
            "[redacted check command]"
        );
    }
}
