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
    use crate::HiveContext;

    const SHA: &str = "1783e5db6458451a3ce30f16b8b64f87a8e148cf";

    #[derive(Debug, serde::Deserialize)]
    struct RunEvidence {
        id: u64,
        head_sha: String,
        status: String,
        conclusion: Option<String>,
    }

    fn run_page(status: &str) -> String {
        format!(
            r#"<a href="/meta-secret/nook/actions/workflows/main.yml">Main</a>
<a href="/meta-secret/nook/commit/{SHA}">commit</a>
<a title="main" href="/meta-secret/nook/tree/refs/heads/main">main</a>
<div>on: push</div><span data-favicon-override="{status}"></span>"#
        )
    }

    fn parse_typed_run(status: &str) -> crate::HiveResult<RunEvidence> {
        let run = super::parse_run_page(42, &run_page(status))?;
        serde_json::from_value(run).hive_context("deserialize parsed run evidence")
    }

    fn expect_rejection(page: &str, evidence: &str) -> crate::HiveResult<()> {
        match super::parse_run_page(42, page) {
            Ok(run) => Err(crate::error::HiveError::message(format!(
                "page without {evidence} unexpectedly parsed as {run}"
            ))),
            Err(error) if format!("{error:#}").contains(evidence) => Ok(()),
            Err(error) => Err(crate::error::HiveError::message(format!(
                "page without {evidence} returned the wrong error: {error:#}"
            ))),
        }
    }

    #[test]
    fn public_failure_page_binds_exact_main_push() -> crate::HiveResult<()> {
        let run = parse_typed_run("favicons/favicon-failure.svg")?;
        assert_eq!(run.id, 42);
        assert_eq!(run.head_sha, SHA);
        assert_eq!(run.conclusion.as_deref(), Some("failure"));
        Ok(())
    }

    #[test]
    fn public_success_page_retires_repair() -> crate::HiveResult<()> {
        let run = parse_typed_run("favicons/favicon-success.svg")?;
        assert_eq!(run.status, "completed");
        assert_eq!(run.conclusion.as_deref(), Some("success"));
        Ok(())
    }

    #[test]
    fn every_missing_provenance_marker_fails_closed() -> crate::HiveResult<()> {
        let page = run_page("favicons/favicon-failure.svg");
        expect_rejection(
            &page.replace(&format!("/meta-secret/nook/commit/{SHA}"), "/commit/short"),
            "full commit identity",
        )?;
        expect_rejection(
            &page.replace(
                "title=\"main\" href=\"/meta-secret/nook/tree/refs/heads/main\"",
                "title=\"feature\" href=\"/meta-secret/nook/tree/refs/heads/feature\"",
            ),
            "main branch",
        )?;
        expect_rejection(
            &page.replace(
                "href=\"/meta-secret/nook/actions/workflows/main.yml\"",
                "href=\"/meta-secret/nook/actions/workflows/pr.yml\"",
            ),
            "Main workflow",
        )?;
        expect_rejection(
            &page.replace(">on: push</div>", ">on: pull_request</div>"),
            "push trigger",
        )
    }
}
