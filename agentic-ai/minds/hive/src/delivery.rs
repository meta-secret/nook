use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;

use anyhow::Context;
use serde::Deserialize;
use tokio::process::Command;

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DeliveryPullRequest {
    number: u64,
    title: String,
    state: String,
    head_ref_name: String,
    head_ref_oid: String,
    is_cross_repository: bool,
    labels: Vec<DeliveryLabel>,
    merge_commit: Option<DeliveryCommit>,
    status_check_rollup: Vec<DeliveryCheck>,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
struct DeliveryLabel {
    name: String,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
struct DeliveryCommit {
    oid: String,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DeliveryCheck {
    name: String,
    status: String,
    conclusion: String,
    started_at: String,
    workflow_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeliveryRun {
    head_sha: String,
    status: String,
    conclusion: String,
    created_at: String,
}

pub(crate) async fn verify_main_repair_delivery(
    repository: &Path,
    branch: &str,
    task_id: &str,
) -> anyhow::Result<()> {
    let pull_requests: Vec<DeliveryPullRequest> = serde_json::from_str(
        &gh_output(
            repository,
            &[
                "pr",
                "list",
                "--state",
                "all",
                "--limit",
                "1000",
                "--json",
                "number,title,state,headRefName,headRefOid,isCrossRepository,labels,mergeCommit,statusCheckRollup",
            ],
        )
        .await?,
    )
    .context("GitHub returned invalid Hive pull request state")?;
    let pull_request = latest_delivery_generation(&pull_requests, branch)?
        .context("Hive repair delivery is incomplete: no pull request generation exists")?;

    validate_hive_marker(pull_request)?;
    validate_merged_hive_pull_request(pull_request)?;
    let merge_commit = pull_request
        .merge_commit
        .as_ref()
        .context("merged Hive pull request has no merge commit")?;

    run_git_status(
        repository,
        &["fetch", "--depth=2147483647", "origin", "main"],
        "fetch Main delivery state",
    )
    .await?;
    run_git_status(
        repository,
        &[
            "merge-base",
            "--is-ancestor",
            merge_commit.oid.as_str(),
            "FETCH_HEAD",
        ],
        "verify Main contains the Hive repair merge",
    )
    .await?;
    validate_squash_merge(repository, pull_request).await?;

    let mut runs: Vec<DeliveryRun> = serde_json::from_str(
        &gh_output(
            repository,
            &[
                "run",
                "list",
                "--workflow",
                "Main",
                "--branch",
                "main",
                "--limit",
                "100",
                "--json",
                "headSha,status,conclusion,createdAt",
            ],
        )
        .await?,
    )
    .context("GitHub returned invalid Main workflow state")?;
    runs.sort_by(|left, right| left.created_at.cmp(&right.created_at));
    let mut applicable_runs = Vec::new();
    for run in runs {
        let contains_merge = Command::new("git")
            .args([
                "merge-base",
                "--is-ancestor",
                merge_commit.oid.as_str(),
                run.head_sha.as_str(),
            ])
            .current_dir(repository)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .context("failed to inspect Main workflow ancestry")?;
        if !contains_merge.success() {
            continue;
        }
        applicable_runs.push(run);
    }
    let successful_main_sha = select_successful_main_run(&applicable_runs, &merge_commit.oid)?;
    validate_repository_checks(pull_request, true)?;
    validate_full_e2e_checks(pull_request, true)?;
    validate_review_and_deployment_readiness(repository, pull_request).await?;
    validate_workbench_completion(repository, task_id, pull_request, successful_main_sha).await?;
    Ok(())
}

fn select_successful_main_run<'a>(
    runs: &'a [DeliveryRun],
    merge_commit: &str,
) -> anyhow::Result<&'a str> {
    for run in runs {
        if run.status != "completed" {
            continue;
        }
        if run.conclusion == "success" {
            return Ok(run.head_sha.as_str());
        }
        if matches!(run.conclusion.as_str(), "cancelled" | "skipped" | "neutral") {
            continue;
        }
        anyhow::bail!(
            "Hive repair delivery failed on Main: run at {} concluded {}",
            run.head_sha,
            run.conclusion
        );
    }
    anyhow::bail!(
        "Hive repair delivery is incomplete: no successful Main workflow contains merge {}",
        merge_commit
    )
}

fn latest_delivery_generation<'a>(
    pull_requests: &'a [DeliveryPullRequest],
    branch: &str,
) -> anyhow::Result<Option<&'a DeliveryPullRequest>> {
    let mut generations = pull_requests
        .iter()
        .filter(|pull_request| !pull_request.is_cross_repository)
        .filter_map(|pull_request| {
            delivery_generation(branch, &pull_request.head_ref_name)
                .map(|generation| (generation, pull_request))
        })
        .collect::<Vec<_>>();
    generations.sort_by_key(|(generation, _)| *generation);
    let Some((latest_generation, latest)) = generations.last().copied() else {
        return Ok(None);
    };
    if generations
        .iter()
        .rev()
        .skip(1)
        .any(|(generation, _)| *generation == latest_generation)
    {
        anyhow::bail!(
            "Hive repair delivery is ambiguous: multiple PRs use generation {latest_generation}"
        );
    }
    Ok(Some(latest))
}

fn delivery_generation(base: &str, candidate: &str) -> Option<u64> {
    if candidate == base {
        return Some(1);
    }
    candidate
        .strip_prefix(&format!("{base}-g"))
        .and_then(|generation| generation.parse::<u64>().ok())
        .filter(|generation| *generation >= 2)
}

fn validate_hive_marker(pull_request: &DeliveryPullRequest) -> anyhow::Result<()> {
    if !pull_request.title.starts_with("[Hive] ") {
        anyhow::bail!(
            "Hive repair delivery is incomplete: PR #{} lacks the `[Hive]` title marker",
            pull_request.number
        );
    }
    if !pull_request.labels.iter().any(|label| label.name == "hive") {
        anyhow::bail!(
            "Hive repair delivery is incomplete: PR #{} lacks the `hive` label",
            pull_request.number
        );
    }
    Ok(())
}

async fn validate_squash_merge(
    repository: &Path,
    pull_request: &DeliveryPullRequest,
) -> anyhow::Result<()> {
    let merge_commit = pull_request
        .merge_commit
        .as_ref()
        .context("merged Hive pull request has no merge commit")?;
    let parents = git_output(
        repository,
        &["show", "-s", "--format=%P", merge_commit.oid.as_str()],
    )
    .await?;
    if parents.split_whitespace().count() != 1 {
        anyhow::bail!(
            "Hive repair delivery violated squash-only history: merge {} has multiple parents",
            merge_commit.oid
        );
    }
    let subject = git_output(
        repository,
        &["show", "-s", "--format=%s", merge_commit.oid.as_str()],
    )
    .await?;
    let expected_suffix = format!("(#{})", pull_request.number);
    if !subject.ends_with(&expected_suffix) {
        anyhow::bail!(
            "Hive repair delivery violated squash-only history: merge {} lacks PR suffix {}",
            merge_commit.oid,
            expected_suffix
        );
    }
    Ok(())
}

fn validate_merged_hive_pull_request(pull_request: &DeliveryPullRequest) -> anyhow::Result<()> {
    if pull_request.state != "MERGED" {
        anyhow::bail!(
            "Hive repair delivery is incomplete: PR #{} is {}",
            pull_request.number,
            pull_request.state
        );
    }
    if pull_request.merge_commit.is_none() {
        anyhow::bail!(
            "Hive repair delivery is incomplete: PR #{} has no squash merge",
            pull_request.number
        );
    }
    Ok(())
}

fn validate_full_e2e_checks(
    pull_request: &DeliveryPullRequest,
    successful_main_contains_merge: bool,
) -> anyhow::Result<()> {
    if !pull_request
        .labels
        .iter()
        .any(|label| label.name == "ci:full-e2e")
    {
        anyhow::bail!(
            "Hive repair delivery is incomplete: PR #{} at {} lacks `ci:full-e2e`",
            pull_request.number,
            pull_request.head_ref_oid
        );
    }
    for required_check in [
        "Full browser e2e (main fix)",
        "Full extension e2e (main fix)",
    ] {
        let matching = pull_request
            .status_check_rollup
            .iter()
            .filter(|check| check.name == required_check)
            .collect::<Vec<_>>();
        if !successful_or_merge_cancelled(&matching, successful_main_contains_merge) {
            anyhow::bail!(
                "Hive repair delivery is incomplete: PR #{} at {} lacks successful exact-head `{}`",
                pull_request.number,
                pull_request.head_ref_oid,
                required_check
            );
        }
    }
    Ok(())
}

fn validate_repository_checks(
    pull_request: &DeliveryPullRequest,
    successful_main_contains_merge: bool,
) -> anyhow::Result<()> {
    let verify_checks = pull_request
        .status_check_rollup
        .iter()
        .filter(|check| check.name == "Verify and preview")
        .collect::<Vec<_>>();
    if !successful_or_merge_cancelled(&verify_checks, successful_main_contains_merge) {
        anyhow::bail!(
            "Hive repair delivery is incomplete: PR #{} at {} lacks successful exact-head `Verify and preview`",
            pull_request.number,
            pull_request.head_ref_oid
        );
    }
    let mut repository_checks = HashMap::<&str, Vec<&DeliveryCheck>>::new();
    for check in &pull_request.status_check_rollup {
        if !check.workflow_name.is_empty() {
            repository_checks
                .entry(&check.name)
                .or_default()
                .push(check);
        }
    }
    for (name, checks) in repository_checks {
        if matches!(
            name,
            "Verify and preview" | "Full browser e2e (main fix)" | "Full extension e2e (main fix)"
        ) {
            continue;
        }
        if checks.iter().any(|check| successful_check(check)) {
            continue;
        }
        if checks.iter().any(|check| check.status != "COMPLETED") {
            anyhow::bail!(
                "Hive repair delivery is incomplete: repository check `{name}` is still running"
            );
        }
        if let Some(check) = checks
            .iter()
            .find(|check| !matches!(check.conclusion.as_str(), "SKIPPED" | "NEUTRAL"))
        {
            anyhow::bail!(
                "Hive repair delivery is incomplete: repository check `{name}` concluded {}",
                check.conclusion
            );
        }
    }
    Ok(())
}

fn successful_check(check: &DeliveryCheck) -> bool {
    check.status == "COMPLETED" && check.conclusion == "SUCCESS"
}

fn successful_or_merge_cancelled(
    checks: &[&DeliveryCheck],
    successful_main_contains_merge: bool,
) -> bool {
    if checks.iter().any(|check| successful_check(check)) {
        return true;
    }
    successful_main_contains_merge
        && checks
            .iter()
            .any(|check| check.status == "COMPLETED" && check.conclusion == "CANCELLED")
        && checks.iter().all(|check| {
            check.status == "COMPLETED"
                && matches!(
                    check.conclusion.as_str(),
                    "CANCELLED" | "SKIPPED" | "NEUTRAL"
                )
        })
}

async fn validate_review_and_deployment_readiness(
    repository: &Path,
    pull_request: &DeliveryPullRequest,
) -> anyhow::Result<()> {
    let number = pull_request.number.to_string();
    let repository_state: serde_json::Value = serde_json::from_str(
        &gh_output(repository, &["repo", "view", "--json", "nameWithOwner"]).await?,
    )
    .context("GitHub returned invalid repository identity")?;
    let name_with_owner = repository_state
        .get("nameWithOwner")
        .and_then(serde_json::Value::as_str)
        .context("GitHub repository identity omitted nameWithOwner")?;
    let (owner, name) = name_with_owner
        .split_once('/')
        .context("GitHub repository identity is malformed")?;
    let mut unresolved = 0;
    let mut cursor: Option<String> = None;
    loop {
        let review_query = format!(
            "query($number:Int!,$cursor:String){{repository(owner:\"{owner}\",name:\"{name}\"){{pullRequest(number:$number){{reviewThreads(first:100,after:$cursor){{nodes{{isResolved}} pageInfo{{hasNextPage endCursor}}}}}}}}}}"
        );
        let mut arguments = vec![
            "api".to_owned(),
            "graphql".to_owned(),
            "-F".to_owned(),
            format!("number={number}"),
            "-f".to_owned(),
            format!("query={review_query}"),
        ];
        if let Some(value) = cursor.as_deref() {
            arguments.extend(["-F".to_owned(), format!("cursor={value}")]);
        }
        let references = arguments.iter().map(String::as_str).collect::<Vec<_>>();
        let review: serde_json::Value =
            serde_json::from_str(&gh_output(repository, &references).await?)
                .context("GitHub returned invalid Hive review state")?;
        let threads = review
            .pointer("/data/repository/pullRequest/reviewThreads")
            .context("GitHub review response omitted review threads")?;
        unresolved += threads
            .get("nodes")
            .and_then(serde_json::Value::as_array)
            .context("GitHub review response omitted review thread nodes")?
            .iter()
            .filter(|thread| {
                thread
                    .get("isResolved")
                    .and_then(serde_json::Value::as_bool)
                    == Some(false)
            })
            .count();
        if threads
            .pointer("/pageInfo/hasNextPage")
            .and_then(serde_json::Value::as_bool)
            != Some(true)
        {
            break;
        }
        cursor = threads
            .pointer("/pageInfo/endCursor")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned);
        anyhow::ensure!(
            cursor.is_some(),
            "GitHub review pagination omitted its cursor"
        );
    }
    if unresolved > 0 {
        anyhow::bail!(
            "Hive repair delivery is incomplete: PR #{} has {} unresolved review thread(s)",
            pull_request.number,
            unresolved
        );
    }
    validate_non_thread_feedback(repository, pull_request.number).await?;

    let deployments: serde_json::Value = serde_json::from_str(
        &gh_output(
            repository,
            &[
                "api",
                "-X",
                "GET",
                "repos/{owner}/{repo}/deployments",
                "-f",
                "environment=github-pages",
                "-f",
                &format!("sha={}", pull_request.head_ref_oid),
                "-f",
                "per_page=20",
            ],
        )
        .await?,
    )
    .context("GitHub returned invalid deployment state")?;
    let mut state = None;
    for deployment_id in deployments
        .as_array()
        .context("GitHub deployment response is not an array")?
        .iter()
        .filter_map(|deployment| deployment.get("id").and_then(serde_json::Value::as_u64))
    {
        let statuses: serde_json::Value = serde_json::from_str(
            &gh_output(
                repository,
                &[
                    "api",
                    "-X",
                    "GET",
                    &format!("repos/{{owner}}/{{repo}}/deployments/{deployment_id}/statuses"),
                    "-f",
                    "per_page=1",
                ],
            )
            .await?,
        )
        .context("GitHub returned invalid deployment status")?;
        state = statuses
            .as_array()
            .and_then(|items| items.first())
            .and_then(|status| status.get("state"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned);
        if state.is_some() {
            break;
        }
    }
    if state.as_deref() != Some("success") {
        anyhow::bail!(
            "Hive repair delivery is incomplete: PR #{} exact-head github-pages deployment is {:?}",
            pull_request.number,
            state.as_deref()
        );
    }
    Ok(())
}

async fn validate_non_thread_feedback(repository: &Path, number: u64) -> anyhow::Result<()> {
    for surface in ["issues/{number}/comments", "pulls/{number}/reviews"] {
        let endpoint = format!(
            "repos/{{owner}}/{{repo}}/{}",
            surface.replace("{number}", &number.to_string())
        );
        let pages: serde_json::Value = serde_json::from_str(
            &gh_output(
                repository,
                &["api", "--paginate", "--slurp", endpoint.as_str()],
            )
            .await?,
        )
        .context("GitHub returned invalid paginated feedback")?;
        let actionable = pages
            .as_array()
            .into_iter()
            .flatten()
            .flat_map(|page| page.as_array().into_iter().flatten())
            .filter_map(|item| item.get("body").and_then(serde_json::Value::as_str))
            .any(is_actionable_feedback);
        if actionable {
            anyhow::bail!(
                "Hive repair delivery is incomplete: PR #{number} has actionable non-thread feedback"
            );
        }
    }
    Ok(())
}

fn is_actionable_feedback(body: &str) -> bool {
    [
        "[P0",
        "[P1",
        "[P2",
        "[P3",
        "changes requested",
        "request changes",
    ]
    .iter()
    .any(|marker| {
        body.to_ascii_lowercase()
            .contains(&marker.to_ascii_lowercase())
    })
}

async fn validate_workbench_completion(
    repository: &Path,
    task_id: &str,
    pull_request: &DeliveryPullRequest,
    main_sha: &str,
) -> anyhow::Result<()> {
    let task_base = task_id.split("-run-").next().unwrap_or(task_id);
    anyhow::ensure!(
        task_base.starts_with("main-failure-"),
        "Hive repair task id does not identify its Workbench incident"
    );
    let endpoint = format!(
        "repos/meta-secret/nook-workbench/contents/issues/hive-isolated-agent-platform/{task_base}.md"
    );
    let incident = gh_output(
        repository,
        &[
            "api",
            "-H",
            "Accept: application/vnd.github.raw+json",
            endpoint.as_str(),
        ],
    )
    .await
    .context("read Hive Workbench completion record")?;
    let completed_status = incident.lines().any(|line| {
        matches!(
            line.trim(),
            "status: completed" | "status: complete" | "status: done"
        )
    });
    anyhow::ensure!(
        completed_status,
        "Hive repair delivery is incomplete: Workbench incident {task_base}.md is not completed"
    );
    anyhow::ensure!(
        incident.contains(&format!("#{}", pull_request.number))
            || incident.contains(&format!("/pull/{}", pull_request.number)),
        "Hive repair delivery is incomplete: Workbench incident does not link PR #{}",
        pull_request.number
    );
    anyhow::ensure!(
        incident.contains(main_sha),
        "Hive repair delivery is incomplete: Workbench incident does not record green Main SHA {main_sha}"
    );
    anyhow::ensure!(
        incident.to_ascii_lowercase().contains("worklog"),
        "Hive repair delivery is incomplete: Workbench incident has no linked worklog"
    );
    Ok(())
}

async fn gh_output(repository: &Path, arguments: &[&str]) -> anyhow::Result<String> {
    let output = Command::new("gh")
        .args(arguments)
        .current_dir(repository)
        .stdin(Stdio::null())
        .output()
        .await
        .context("failed to execute gh")?;
    if !output.status.success() {
        anyhow::bail!("gh {:?} failed with status {}", arguments, output.status);
    }
    String::from_utf8(output.stdout)
        .context("gh output is not UTF-8")
        .map(|value| value.trim().to_owned())
}

async fn git_output(repository: &Path, arguments: &[&str]) -> anyhow::Result<String> {
    let output = Command::new("git")
        .args(arguments)
        .current_dir(repository)
        .stdin(Stdio::null())
        .output()
        .await
        .context("failed to execute git")?;
    if !output.status.success() {
        anyhow::bail!("git {:?} failed with status {}", arguments, output.status);
    }
    String::from_utf8(output.stdout)
        .context("git output is not UTF-8")
        .map(|value| value.trim().to_owned())
}

async fn run_git_status(
    repository: &Path,
    arguments: &[&str],
    operation: &str,
) -> anyhow::Result<()> {
    let status = Command::new("git")
        .args(arguments)
        .current_dir(repository)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .status()
        .await
        .with_context(|| format!("failed to {operation}"))?;
    if !status.success() {
        anyhow::bail!("{operation} failed with status {status}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        DeliveryCheck, DeliveryCommit, DeliveryLabel, DeliveryPullRequest, DeliveryRun,
        delivery_generation, latest_delivery_generation, select_successful_main_run,
        validate_full_e2e_checks, validate_merged_hive_pull_request, validate_repository_checks,
    };

    fn pull_request(
        number: u64,
        branch: &str,
        state: &str,
        merge_commit: Option<&str>,
    ) -> DeliveryPullRequest {
        DeliveryPullRequest {
            number,
            title: "[Hive] repair".to_owned(),
            state: state.to_owned(),
            head_ref_name: branch.to_owned(),
            head_ref_oid: format!("head-{number}"),
            is_cross_repository: false,
            labels: vec![
                DeliveryLabel {
                    name: "hive".to_owned(),
                },
                DeliveryLabel {
                    name: "ci:full-e2e".to_owned(),
                },
            ],
            merge_commit: merge_commit.map(|oid| DeliveryCommit {
                oid: oid.to_owned(),
            }),
            status_check_rollup: vec![
                DeliveryCheck {
                    name: "Full browser e2e (main fix)".to_owned(),
                    status: "COMPLETED".to_owned(),
                    conclusion: "SUCCESS".to_owned(),
                    started_at: "2026-07-28T01:00:00Z".to_owned(),
                    workflow_name: "PR".to_owned(),
                },
                DeliveryCheck {
                    name: "Full extension e2e (main fix)".to_owned(),
                    status: "COMPLETED".to_owned(),
                    conclusion: "SUCCESS".to_owned(),
                    started_at: "2026-07-28T01:00:00Z".to_owned(),
                    workflow_name: "PR".to_owned(),
                },
                DeliveryCheck {
                    name: "Verify and preview".to_owned(),
                    status: "COMPLETED".to_owned(),
                    conclusion: "SUCCESS".to_owned(),
                    started_at: "2026-07-28T01:00:00Z".to_owned(),
                    workflow_name: "PR".to_owned(),
                },
            ],
        }
    }

    #[test]
    fn delivery_requires_a_merged_pull_request() {
        let error = validate_merged_hive_pull_request(&pull_request(42, "repair", "OPEN", None))
            .expect_err("an open pull request cannot complete a Hive task");

        assert!(error.to_string().contains("PR #42 is OPEN"));
    }

    #[test]
    fn delivery_requires_the_squash_merge_commit() {
        let error = validate_merged_hive_pull_request(&pull_request(42, "repair", "MERGED", None))
            .expect_err("a merge without its commit cannot prove Main delivery");

        assert!(error.to_string().contains("no squash merge"));
    }

    #[test]
    fn delivery_accepts_a_merged_pull_request_with_its_commit() {
        validate_merged_hive_pull_request(&pull_request(42, "repair", "MERGED", Some("abc123")))
            .expect("the merged pull request should pass the local delivery invariant");
    }

    #[test]
    fn latest_follow_up_generation_is_selected() {
        let pull_requests = vec![
            pull_request(40, "codex/hive-task", "CLOSED", None),
            pull_request(42, "codex/hive-task-g3", "MERGED", Some("abc123")),
            pull_request(41, "codex/hive-task-g2", "CLOSED", None),
            pull_request(99, "codex/hive-other", "MERGED", Some("unrelated")),
        ];

        let latest = latest_delivery_generation(&pull_requests, "codex/hive-task")
            .expect("delivery generations should be unambiguous")
            .expect("the latest delivery generation should be found");

        assert_eq!(latest.number, 42);
        assert_eq!(
            delivery_generation("codex/hive-task", "codex/hive-task-g1"),
            None
        );
    }

    #[test]
    fn duplicate_delivery_generations_are_rejected() {
        let pull_requests = vec![
            pull_request(41, "codex/hive-task-g2", "CLOSED", None),
            pull_request(42, "codex/hive-task-g2", "MERGED", Some("abc123")),
        ];

        let error = latest_delivery_generation(&pull_requests, "codex/hive-task")
            .expect_err("duplicate generations cannot identify one delivery");

        assert!(error.to_string().contains("multiple PRs use generation 2"));
    }

    #[test]
    fn cross_repository_generation_is_ignored() {
        let mut fork = pull_request(99, "codex/hive-task-g99", "OPEN", None);
        fork.is_cross_repository = true;
        let pull_requests = vec![
            pull_request(42, "codex/hive-task-g2", "MERGED", Some("abc123")),
            fork,
        ];

        let latest = latest_delivery_generation(&pull_requests, "codex/hive-task")
            .expect("same-repository generations should be unambiguous")
            .expect("the legitimate generation should be found");

        assert_eq!(latest.number, 42);
    }

    #[test]
    fn delivery_requires_the_full_e2e_label() {
        let mut pull_request = pull_request(42, "repair", "MERGED", Some("abc123"));
        pull_request
            .labels
            .retain(|label| label.name != "ci:full-e2e");

        let error = validate_full_e2e_checks(&pull_request, false)
            .expect_err("a Hive repair without the opt-in label cannot complete");

        assert!(error.to_string().contains("lacks `ci:full-e2e`"));
    }

    #[test]
    fn merge_triggered_skipped_e2e_does_not_hide_pre_merge_success() {
        let mut pull_request = pull_request(42, "repair", "MERGED", Some("abc123"));
        pull_request.status_check_rollup.push(DeliveryCheck {
            name: "Full extension e2e (main fix)".to_owned(),
            status: "COMPLETED".to_owned(),
            conclusion: "SKIPPED".to_owned(),
            started_at: "2026-07-28T02:00:00Z".to_owned(),
            workflow_name: "PR".to_owned(),
        });

        validate_full_e2e_checks(&pull_request, false)
            .expect("a successful exact-head run remains valid after the merge-triggered skip");
    }

    #[test]
    fn repository_workflow_failure_without_success_is_rejected() {
        let mut pull_request = pull_request(42, "repair", "MERGED", Some("abc123"));
        pull_request.status_check_rollup.push(DeliveryCheck {
            name: "Hive Rust and infrastructure verification".to_owned(),
            status: "COMPLETED".to_owned(),
            conclusion: "FAILURE".to_owned(),
            started_at: "2026-07-28T02:00:00Z".to_owned(),
            workflow_name: "Hive".to_owned(),
        });

        let error = validate_repository_checks(&pull_request, false)
            .expect_err("a failed applicable repository workflow cannot complete a Hive task");
        assert!(error.to_string().contains("Hive Rust"));
    }

    #[test]
    fn successful_main_accepts_checks_cancelled_by_the_squash_merge() {
        let mut pull_request = pull_request(42, "repair", "MERGED", Some("abc123"));
        for check in &mut pull_request.status_check_rollup {
            check.conclusion = "CANCELLED".to_owned();
        }

        validate_repository_checks(&pull_request, true)
            .expect("green exact-merge Main replaces merge-cancelled preview proof");
        validate_full_e2e_checks(&pull_request, true)
            .expect("green exact-merge Main replaces merge-cancelled e2e proof");
    }

    #[test]
    fn successful_main_does_not_hide_a_failed_pr_check() {
        let mut pull_request = pull_request(42, "repair", "MERGED", Some("abc123"));
        pull_request.status_check_rollup[0].conclusion = "FAILURE".to_owned();
        pull_request.status_check_rollup[1].conclusion = "CANCELLED".to_owned();

        let error = validate_full_e2e_checks(&pull_request, true)
            .expect_err("a failed exact-head e2e run remains a delivery failure");
        assert!(error.to_string().contains("Full browser e2e"));
    }

    #[test]
    fn successful_main_does_not_replace_cancelled_hive_verification() {
        let mut pull_request = pull_request(42, "repair", "MERGED", Some("abc123"));
        pull_request.status_check_rollup.push(DeliveryCheck {
            name: "Hive Rust and infrastructure verification".to_owned(),
            status: "COMPLETED".to_owned(),
            conclusion: "CANCELLED".to_owned(),
            started_at: "2026-07-28T02:00:00Z".to_owned(),
            workflow_name: "Hive".to_owned(),
        });

        let error = validate_repository_checks(&pull_request, true)
            .expect_err("Main does not exercise Hive-only verification");
        assert!(error.to_string().contains("Hive Rust"));
    }

    fn run(sha: &str, conclusion: &str, created_at: &str) -> DeliveryRun {
        DeliveryRun {
            head_sha: sha.to_owned(),
            status: "completed".to_owned(),
            conclusion: conclusion.to_owned(),
            created_at: created_at.to_owned(),
        }
    }

    #[test]
    fn failed_repair_run_is_not_hidden_by_a_successful_descendant() {
        let runs = vec![
            run("repair", "failure", "2026-07-28T01:00:00Z"),
            run("descendant", "success", "2026-07-28T02:00:00Z"),
        ];
        let error = select_successful_main_run(&runs, "merge")
            .expect_err("an explicit failure must remain terminal");
        assert!(error.to_string().contains("repair"));
    }

    #[test]
    fn cancelled_run_can_coalesce_into_a_successful_descendant() {
        let runs = vec![
            run("repair", "cancelled", "2026-07-28T01:00:00Z"),
            run("descendant", "success", "2026-07-28T02:00:00Z"),
        ];
        assert_eq!(
            select_successful_main_run(&runs, "merge").expect("coalesced Main should pass"),
            "descendant"
        );
    }

    #[test]
    fn first_successful_completed_descendant_is_selected_chronologically() {
        let runs = vec![
            run("first", "success", "2026-07-28T01:00:00Z"),
            run("second", "success", "2026-07-28T02:00:00Z"),
        ];
        assert_eq!(
            select_successful_main_run(&runs, "merge").expect("Main should pass"),
            "first"
        );
    }
}
