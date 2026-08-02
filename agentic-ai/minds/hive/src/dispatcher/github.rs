use std::time::Duration;

use serde_json::json;
use tokio::process::Command;

use crate::HiveContext;

const NOOK_RUN_URL: &str = "https://github.com/meta-secret/nook/actions/runs";
const COMMIT_LINK_PREFIX: &str = "href=\"/meta-secret/nook/commit/";

pub(super) async fn fetch_run(run_id: u64) -> crate::HiveResult<serde_json::Value> {
    let url = format!("{NOOK_RUN_URL}/{run_id}");
    let mut command = Command::new("curl");
    command
        .args([
            "--fail",
            "--silent",
            "--show-error",
            "--location",
            "--retry",
            "3",
            "--connect-timeout",
            "10",
            "--max-time",
            "90",
            "--max-filesize",
            "1048576",
            "--user-agent",
            "nook-hive-workbench-dispatcher",
            &url,
        ])
        .kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(100), command.output())
        .await
        .map_err(|_| crate::error::HiveError::message("Workbench fetch exceeded 100 seconds"))?
        .hive_context("start Workbench fetch")?;
    if !output.status.success() {
        return Err(crate::error::HiveError::message(format!(
            "Workbench fetch failed with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    let page = String::from_utf8(output.stdout).hive_context("GitHub run page is not UTF-8")?;
    parse_run_page(run_id, &page)
}

fn parse_run_page(run_id: u64, page: &str) -> crate::HiveResult<serde_json::Value> {
    let head_sha = page
        .split_once(COMMIT_LINK_PREFIX)
        .and_then(|(_, remainder)| remainder.get(..40))
        .filter(|value| value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .hive_context("GitHub run page has no full commit identity")?;
    require_marker(
        page,
        "title=\"main\" href=\"/meta-secret/nook/tree/refs/heads/main\"",
        "main branch",
    )?;
    require_marker(
        page,
        "href=\"/meta-secret/nook/actions/workflows/main.yml\"",
        "Main workflow",
    )?;
    require_marker(page, ">on: push</div>", "push trigger")?;

    let (status, conclusion) = if page.contains("favicons/favicon-success.svg") {
        ("completed", Some("success"))
    } else if page.contains("favicons/favicon-failure.svg") {
        ("completed", Some("failure"))
    } else if page.contains("aria-label=\"cancelled: \"") {
        ("completed", Some("cancelled"))
    } else if page.contains("aria-label=\"skipped: \"") {
        ("completed", Some("skipped"))
    } else if page.contains("favicons/favicon-pending.svg") {
        ("in_progress", None)
    } else {
        return Err(crate::error::HiveError::message(
            "GitHub run page has no recognized workflow status",
        ));
    };

    Ok(json!({
        "id": run_id,
        "name": "Main",
        "head_branch": "main",
        "head_sha": head_sha,
        "event": "push",
        "status": status,
        "conclusion": conclusion,
        "repository": { "full_name": "meta-secret/nook" }
    }))
}

fn require_marker(page: &str, marker: &str, evidence: &str) -> crate::HiveResult<()> {
    if page.contains(marker) {
        Ok(())
    } else {
        Err(crate::error::HiveError::message(format!(
            "GitHub run page has no {evidence} evidence"
        )))
    }
}

#[cfg(test)]
mod tests {
    const SHA: &str = "1783e5db6458451a3ce30f16b8b64f87a8e148cf";

    fn run_page(status: &str) -> String {
        format!(
            r#"<a href="/meta-secret/nook/actions/workflows/main.yml">Main</a>
<a href="/meta-secret/nook/commit/{SHA}">commit</a>
<a title="main" href="/meta-secret/nook/tree/refs/heads/main">main</a>
<div>on: push</div><span data-favicon-override="{status}"></span>"#
        )
    }

    #[test]
    fn public_failure_page_binds_exact_main_push() -> crate::HiveResult<()> {
        let run = super::parse_run_page(42, &run_page("favicons/favicon-failure.svg"))?;
        assert_eq!(run["id"], 42);
        assert_eq!(run["head_sha"], SHA);
        assert_eq!(run["conclusion"], "failure");
        Ok(())
    }

    #[test]
    fn public_success_page_retires_repair() -> crate::HiveResult<()> {
        let run = super::parse_run_page(42, &run_page("favicons/favicon-success.svg"))?;
        assert_eq!(run["status"], "completed");
        assert_eq!(run["conclusion"], "success");
        Ok(())
    }

    #[test]
    fn page_without_exact_provenance_fails_closed() {
        match super::parse_run_page(42, "favicons/favicon-failure.svg") {
            Ok(run) => panic!("page unexpectedly parsed as {run}"),
            Err(error) => assert!(format!("{error:#}").contains("full commit identity")),
        }
    }
}
