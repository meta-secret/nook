use std::time::Duration;

use tokio::process::Command;

use crate::HiveContext;

const NOOK_RUN_URL: &str = "https://github.com/meta-secret/nook/actions/runs";
const COMMIT_LINK_PREFIX: &str = "href=\"/meta-secret/nook/commit/";

#[derive(Debug, Eq, PartialEq)]
pub(super) struct RunEvidence {
    head_sha: String,
    lifecycle: RunLifecycle,
}

#[derive(Debug, Eq, PartialEq)]
enum RunLifecycle {
    InProgress,
    Completed(RunConclusion),
}

#[derive(Debug, Eq, PartialEq)]
enum RunConclusion {
    Success,
    Failure,
    Cancelled,
    Skipped,
}

impl RunEvidence {
    pub(super) fn requires_repair(&self, source_commit: &str) -> bool {
        self.head_sha == source_commit
            && matches!(
                self.lifecycle,
                RunLifecycle::Completed(RunConclusion::Failure | RunConclusion::Cancelled)
            )
    }
}

pub(super) async fn fetch_run(run_id: u64) -> crate::HiveResult<RunEvidence> {
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

fn parse_run_page(run_id: u64, page: &str) -> crate::HiveResult<RunEvidence> {
    let header = run_scope(page, run_id, "header_partial", "</page-header>", "header")?;
    let summary = run_scope(
        page,
        run_id,
        "summary_partial",
        "aria-label=\"Workflow run graph\"",
        "summary",
    )?;
    let graph = run_scope(page, run_id, "graph_partial", "</action-graph>", "graph")?;

    let head_sha = summary
        .split_once(COMMIT_LINK_PREFIX)
        .and_then(|(_, remainder)| remainder.get(..40))
        .filter(|value| value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .hive_context("GitHub run page has no full commit identity")?;
    require_marker(
        summary,
        "title=\"main\" href=\"/meta-secret/nook/tree/refs/heads/main\"",
        "main branch",
    )?;
    require_marker(
        header,
        "href=\"/meta-secret/nook/actions/workflows/main.yml\"",
        "Main workflow",
    )?;
    require_marker(
        graph,
        &format!("href=\"/meta-secret/nook/actions/runs/{run_id}/workflow\""),
        "run workflow",
    )?;
    require_marker(graph, ">on: push</div>", "push trigger")?;

    let lifecycle = if header.contains("favicons/favicon-success.svg") {
        RunLifecycle::Completed(RunConclusion::Success)
    } else if header.contains("favicons/favicon-failure.svg") {
        RunLifecycle::Completed(RunConclusion::Failure)
    } else if header.contains("aria-label=\"cancelled: \"") {
        RunLifecycle::Completed(RunConclusion::Cancelled)
    } else if header.contains("aria-label=\"skipped: \"") {
        RunLifecycle::Completed(RunConclusion::Skipped)
    } else if header.contains("favicons/favicon-pending.svg") {
        RunLifecycle::InProgress
    } else {
        return Err(crate::error::HiveError::message(
            "GitHub run page has no recognized workflow status",
        ));
    };

    Ok(RunEvidence {
        head_sha: head_sha.to_owned(),
        lifecycle,
    })
}

fn run_scope<'a>(
    page: &'a str,
    run_id: u64,
    partial: &str,
    end: &str,
    evidence: &str,
) -> crate::HiveResult<&'a str> {
    let start = format!("data-url=\"/meta-secret/nook/actions/runs/{run_id}/{partial}\"");
    let (_, remainder) = page
        .split_once(&start)
        .with_hive_context(|| format!("GitHub run page has no run-scoped {evidence}"))?;
    remainder
        .split_once(end)
        .map(|(scope, _)| scope)
        .with_hive_context(|| format!("GitHub run page has no bounded {evidence}"))
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

    fn run_page(run_id: u64, status: &str) -> String {
        format!(
            r#"<div data-url="/meta-secret/nook/actions/runs/{run_id}/header_partial">
<span data-favicon-override="{status}"></span>
<a href="/meta-secret/nook/actions/workflows/main.yml">Main</a></page-header>
<div aria-label="Workflow run summary" data-url="/meta-secret/nook/actions/runs/{run_id}/summary_partial">
<a href="/meta-secret/nook/commit/{SHA}">commit</a>
<a title="main" href="/meta-secret/nook/tree/refs/heads/main">main</a></div>
<div aria-label="Workflow run graph" data-url="/meta-secret/nook/actions/runs/{run_id}/graph_partial">
<a href="/meta-secret/nook/actions/runs/{run_id}/workflow">main.yml</a>
<div>on: push</div></action-graph>"#
        )
    }

    fn parse_run(status: &str) -> crate::HiveResult<super::RunEvidence> {
        super::parse_run_page(42, &run_page(42, status))
    }

    fn expect_rejection(page: &str, evidence: &str) -> crate::HiveResult<()> {
        match super::parse_run_page(42, page) {
            Ok(run) => Err(crate::error::HiveError::message(format!(
                "page without {evidence} unexpectedly parsed as {run:?}"
            ))),
            Err(error) if format!("{error:#}").contains(evidence) => Ok(()),
            Err(error) => Err(crate::error::HiveError::message(format!(
                "page without {evidence} returned the wrong error: {error:#}"
            ))),
        }
    }

    #[test]
    fn public_failure_page_binds_exact_main_push() -> crate::HiveResult<()> {
        let run = parse_run("favicons/favicon-failure.svg")?;
        assert_eq!(run.head_sha, SHA);
        assert_eq!(
            run.lifecycle,
            super::RunLifecycle::Completed(super::RunConclusion::Failure)
        );
        assert!(run.requires_repair(SHA));
        Ok(())
    }

    #[test]
    fn public_success_page_retires_repair() -> crate::HiveResult<()> {
        let run = parse_run("favicons/favicon-success.svg")?;
        assert_eq!(
            run.lifecycle,
            super::RunLifecycle::Completed(super::RunConclusion::Success)
        );
        assert!(!run.requires_repair(SHA));
        Ok(())
    }

    #[test]
    fn every_workflow_status_branch_is_classified() -> crate::HiveResult<()> {
        for (marker, expected_lifecycle) in [
            (
                "favicons/favicon-failure.svg",
                super::RunLifecycle::Completed(super::RunConclusion::Failure),
            ),
            (
                "aria-label=\"cancelled: \"",
                super::RunLifecycle::Completed(super::RunConclusion::Cancelled),
            ),
            (
                "aria-label=\"skipped: \"",
                super::RunLifecycle::Completed(super::RunConclusion::Skipped),
            ),
            (
                "favicons/favicon-pending.svg",
                super::RunLifecycle::InProgress,
            ),
        ] {
            let run = parse_run(marker)?;
            assert_eq!(run.lifecycle, expected_lifecycle);
        }
        expect_rejection(
            &run_page(42, "favicons/favicon-unknown.svg"),
            "recognized workflow status",
        )
    }

    #[test]
    fn every_missing_provenance_marker_fails_closed() -> crate::HiveResult<()> {
        let page = run_page(42, "favicons/favicon-failure.svg");
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

    #[test]
    fn every_marker_is_bound_to_the_requested_run() -> crate::HiveResult<()> {
        let page = run_page(42, "favicons/favicon-failure.svg");
        expect_rejection(
            &page.replace("runs/42/header_partial", "runs/41/header_partial"),
            "run-scoped header",
        )?;
        expect_rejection(
            &page.replace("runs/42/summary_partial", "runs/41/summary_partial"),
            "run-scoped summary",
        )?;
        expect_rejection(
            &page.replace("runs/42/graph_partial", "runs/41/graph_partial"),
            "run-scoped graph",
        )?;
        expect_rejection(
            &page.replace("runs/42/workflow", "runs/41/workflow"),
            "run workflow",
        )?;

        let unrelated_main_link =
            r#"<nav><a href="/meta-secret/nook/actions/workflows/main.yml">Main</a></nav>"#;
        let other_workflow = run_page(42, "favicons/favicon-failure.svg").replace(
            "href=\"/meta-secret/nook/actions/workflows/main.yml\"",
            "href=\"/meta-secret/nook/actions/workflows/other.yml\"",
        );
        expect_rejection(
            &format!("{unrelated_main_link}{other_workflow}"),
            "Main workflow",
        )
    }
}
