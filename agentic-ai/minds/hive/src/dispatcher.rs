use std::time::Duration;

use anyhow::Context;
use serde::Deserialize;
use tokio::process::Command;

use crate::model::{EnqueueTask, TaskId};
use crate::store::TaskStore;

const MAIN_FAILURE_PREFIX: &str = "main-failure-";
const MAIN_FAILURE_SUFFIX: &str = ".md";

#[derive(Debug, Deserialize)]
struct WorkbenchEntry {
    name: String,
    download_url: Option<String>,
    #[serde(rename = "type")]
    kind: String,
}

pub async fn run_workbench_dispatcher<S: TaskStore>(
    store: S,
    contents_url: &str,
    poll_seconds: u64,
) -> anyhow::Result<()> {
    if poll_seconds < 60 {
        anyhow::bail!("Workbench polling must not run more often than once per minute");
    }
    store.migrate().await?;
    loop {
        if let Err(error) = dispatch_once(&store, contents_url).await {
            eprintln!("Hive Workbench reconciliation failed and will retry: {error:#}");
        }
        tokio::time::sleep(Duration::from_secs(poll_seconds)).await;
    }
}

async fn dispatch_once<S: TaskStore>(store: &S, contents_url: &str) -> anyhow::Result<()> {
    let listing = fetch(contents_url).await?;
    let entries: Vec<WorkbenchEntry> =
        serde_json::from_slice(&listing).context("decode Workbench issue listing")?;
    for entry in entries {
        if entry.kind != "file" {
            continue;
        }
        let Some(source_commit) = main_failure_commit(&entry.name) else {
            continue;
        };
        let Some(download_url) = entry.download_url else {
            continue;
        };
        let body = String::from_utf8(fetch(&download_url).await?)
            .context("Workbench issue is not UTF-8")?;
        if !is_ready_agent_issue(&body) {
            continue;
        }
        let run_id = main_failure_run_id(&body)
            .context("ready Main failure issue has no workflow-run marker")?;
        let run: serde_json::Value = serde_json::from_slice(
            &fetch(&format!(
                "https://api.github.com/repos/meta-secret/nook/actions/runs/{run_id}"
            ))
            .await?,
        )
        .context("decode current Main workflow-run state")?;
        if !main_run_requires_repair(&run) {
            continue;
        }
        let task = EnqueueTask {
            id: TaskId::new(entry.name.trim_end_matches(MAIN_FAILURE_SUFFIX))
                .map_err(anyhow::Error::msg)?,
            kind: "main-repair".to_owned(),
            prompt: body,
            source_commit,
            priority: 100,
            max_attempts: 3,
            dependencies: Vec::new(),
        };
        if let Err(error) = store.enqueue(&task).await
            && !format!("{error:#}").contains("already exists")
        {
            return Err(error).with_context(|| format!("enqueue {}", task.id));
        }
    }
    Ok(())
}

fn main_failure_commit(name: &str) -> Option<String> {
    let value = name
        .strip_prefix(MAIN_FAILURE_PREFIX)?
        .strip_suffix(MAIN_FAILURE_SUFFIX)?;
    (value.len() == 40 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then(|| value.to_ascii_lowercase())
}

fn is_ready_agent_issue(body: &str) -> bool {
    body.lines().any(|line| line.trim() == "status: ready")
        && body.lines().any(|line| line.trim() == "automation: hive")
}

fn main_failure_run_id(body: &str) -> Option<u64> {
    body.split("<!-- main-run:")
        .nth(1)?
        .split(":attempt:")
        .next()?
        .parse()
        .ok()
}

fn main_run_requires_repair(run: &serde_json::Value) -> bool {
    run.get("status").and_then(serde_json::Value::as_str) == Some("completed")
        && !matches!(
            run.get("conclusion").and_then(serde_json::Value::as_str),
            Some("success" | "neutral" | "skipped")
        )
}

async fn fetch(url: &str) -> anyhow::Result<Vec<u8>> {
    let output = Command::new("curl")
        .args([
            "--fail",
            "--silent",
            "--show-error",
            "--location",
            "--retry",
            "3",
            "--header",
            "Accept: application/vnd.github+json",
            "--header",
            "X-GitHub-Api-Version: 2022-11-28",
            "--user-agent",
            "nook-hive-workbench-dispatcher",
            url,
        ])
        .output()
        .await
        .context("start Workbench fetch")?;
    if !output.status.success() {
        anyhow::bail!("Workbench fetch failed with status {}", output.status);
    }
    Ok(output.stdout)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        is_ready_agent_issue, main_failure_commit, main_failure_run_id, main_run_requires_repair,
    };

    #[test]
    fn recognizes_only_ready_automated_main_incidents() {
        let sha = "abcdef0123456789abcdef0123456789abcdef01";
        assert_eq!(
            main_failure_commit(&format!("main-failure-{sha}.md")).as_deref(),
            Some(sha)
        );
        assert!(is_ready_agent_issue(
            "---\nstatus: ready\nautomation: hive\n---\n"
        ));
        assert!(!is_ready_agent_issue(
            "---\nstatus: in_progress\nautomation: hive\n---\n"
        ));
        assert!(main_failure_commit("unrelated.md").is_none());
        assert_eq!(
            main_failure_run_id("<!-- main-run:123456:attempt:2 -->\n- failed workflow evidence"),
            Some(123456)
        );
        assert!(main_run_requires_repair(
            &json!({"status": "completed", "conclusion": "failure"})
        ));
        assert!(!main_run_requires_repair(
            &json!({"status": "completed", "conclusion": "success"})
        ));
        assert!(!main_run_requires_repair(
            &json!({"status": "in_progress", "conclusion": null})
        ));
    }
}
