use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;

use crate::HiveContext;
use serde::Deserialize;
use tokio::process::Command;

use self::command::{gh_output, git_output, run_git_status};
use self::workbench::validate_workbench_completion;

mod command;
mod workbench;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
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
    #[serde(default, deserialize_with = "null_to_default")]
    status_check_rollup: Vec<DeliveryCheck>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
struct DeliveryLabel {
    name: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
struct DeliveryCommit {
    oid: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DeliveryCheck {
    #[serde(default, alias = "context")]
    name: String,
    #[serde(default)]
    status: String,
    #[serde(default, alias = "state")]
    conclusion: String,
    #[serde(default)]
    started_at: String,
    #[serde(default)]
    workflow_name: String,
}

fn null_to_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de> + Default,
{
    Option::<T>::deserialize(deserializer).map(Option::unwrap_or_default)
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
) -> crate::HiveResult<()> {
    let (pull_request, successful_main_sha) =
        main_repair_merge_and_main(repository, branch).await?;
    validate_repository_checks(&pull_request, true)?;
    validate_full_e2e_checks(&pull_request, true)?;
    validate_review_and_deployment_readiness(repository, &pull_request).await?;
    validate_workbench_completion(
        repository,
        task_id,
        pull_request.number,
        successful_main_sha.as_str(),
    )
    .await?;
    Ok(())
}

pub(crate) async fn verify_main_repair_merge_and_main(
    repository: &Path,
    branch: &str,
) -> crate::HiveResult<()> {
    main_repair_merge_and_main(repository, branch)
        .await
        .map(|_| ())
}

async fn main_repair_merge_and_main(
    repository: &Path,
    branch: &str,
) -> crate::HiveResult<(DeliveryPullRequest, String)> {
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
    .hive_context("GitHub returned invalid Hive pull request state")?;
    let pull_request = latest_delivery_generation(&pull_requests, branch)?
        .hive_context("Hive repair delivery is incomplete: no pull request generation exists")?
        .clone();

    validate_hive_marker(&pull_request)?;
    validate_merged_hive_pull_request(&pull_request)?;
    let merge_commit = pull_request
        .merge_commit
        .as_ref()
        .hive_context("merged Hive pull request has no merge commit")?;

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
    validate_squash_merge(repository, &pull_request).await?;

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
    .hive_context("GitHub returned invalid Main workflow state")?;
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
            .hive_context("failed to inspect Main workflow ancestry")?;
        if !contains_merge.success() {
            continue;
        }
        applicable_runs.push(run);
    }
    let successful_main_sha =
        select_successful_main_run(&applicable_runs, &merge_commit.oid)?.to_owned();
    Ok((pull_request, successful_main_sha))
}

fn select_successful_main_run<'a>(
    runs: &'a [DeliveryRun],
    merge_commit: &str,
) -> crate::HiveResult<&'a str> {
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
        crate::hive_bail!(
            "Hive repair delivery failed on Main: run at {} concluded {}",
            run.head_sha,
            run.conclusion
        );
    }
    crate::hive_bail!(
        "Hive repair delivery is incomplete: no successful Main workflow contains merge {}",
        merge_commit
    )
}

fn latest_delivery_generation<'a>(
    pull_requests: &'a [DeliveryPullRequest],
    branch: &str,
) -> crate::HiveResult<Option<&'a DeliveryPullRequest>> {
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
        crate::hive_bail!(
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

fn validate_hive_marker(pull_request: &DeliveryPullRequest) -> crate::HiveResult<()> {
    if !pull_request.title.starts_with("[Hive] ") {
        crate::hive_bail!(
            "Hive repair delivery is incomplete: PR #{} lacks the `[Hive]` title marker",
            pull_request.number
        );
    }
    if !pull_request.labels.iter().any(|label| label.name == "hive") {
        crate::hive_bail!(
            "Hive repair delivery is incomplete: PR #{} lacks the `hive` label",
            pull_request.number
        );
    }
    Ok(())
}

async fn validate_squash_merge(
    repository: &Path,
    pull_request: &DeliveryPullRequest,
) -> crate::HiveResult<()> {
    let merge_commit = pull_request
        .merge_commit
        .as_ref()
        .hive_context("merged Hive pull request has no merge commit")?;
    let parents = git_output(
        repository,
        &["show", "-s", "--format=%P", merge_commit.oid.as_str()],
    )
    .await?;
    if parents.split_whitespace().count() != 1 {
        crate::hive_bail!(
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
        crate::hive_bail!(
            "Hive repair delivery violated squash-only history: merge {} lacks PR suffix {}",
            merge_commit.oid,
            expected_suffix
        );
    }
    Ok(())
}

fn validate_merged_hive_pull_request(pull_request: &DeliveryPullRequest) -> crate::HiveResult<()> {
    if pull_request.state != "MERGED" {
        crate::hive_bail!(
            "Hive repair delivery is incomplete: PR #{} is {}",
            pull_request.number,
            pull_request.state
        );
    }
    if pull_request.merge_commit.is_none() {
        crate::hive_bail!(
            "Hive repair delivery is incomplete: PR #{} has no squash merge",
            pull_request.number
        );
    }
    Ok(())
}

fn validate_full_e2e_checks(
    pull_request: &DeliveryPullRequest,
    successful_main_contains_merge: bool,
) -> crate::HiveResult<()> {
    if !pull_request
        .labels
        .iter()
        .any(|label| label.name == "ci:full-e2e")
    {
        crate::hive_bail!(
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
            crate::hive_bail!(
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
) -> crate::HiveResult<()> {
    let verify_checks = pull_request
        .status_check_rollup
        .iter()
        .filter(|check| check.name == "Verify and preview")
        .collect::<Vec<_>>();
    if !successful_or_merge_cancelled(&verify_checks, successful_main_contains_merge) {
        crate::hive_bail!(
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
            crate::hive_bail!(
                "Hive repair delivery is incomplete: repository check `{name}` is still running"
            );
        }
        if let Some(check) = checks
            .iter()
            .find(|check| !matches!(check.conclusion.as_str(), "SKIPPED" | "NEUTRAL"))
        {
            crate::hive_bail!(
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
) -> crate::HiveResult<()> {
    let number = pull_request.number.to_string();
    let repository_state: serde_json::Value = serde_json::from_str(
        &gh_output(repository, &["repo", "view", "--json", "nameWithOwner"]).await?,
    )
    .hive_context("GitHub returned invalid repository identity")?;
    let name_with_owner = repository_state
        .get("nameWithOwner")
        .and_then(serde_json::Value::as_str)
        .hive_context("GitHub repository identity omitted nameWithOwner")?;
    let (owner, name) = name_with_owner
        .split_once('/')
        .hive_context("GitHub repository identity is malformed")?;
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
                .hive_context("GitHub returned invalid Hive review state")?;
        let threads = review
            .pointer("/data/repository/pullRequest/reviewThreads")
            .hive_context("GitHub review response omitted review threads")?;
        unresolved += threads
            .get("nodes")
            .and_then(serde_json::Value::as_array)
            .hive_context("GitHub review response omitted review thread nodes")?
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
        crate::hive_ensure!(
            cursor.is_some(),
            "GitHub review pagination omitted its cursor"
        );
    }
    if unresolved > 0 {
        crate::hive_bail!(
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
    .hive_context("GitHub returned invalid deployment state")?;
    let mut state = None;
    for deployment_id in deployments
        .as_array()
        .hive_context("GitHub deployment response is not an array")?
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
        .hive_context("GitHub returned invalid deployment status")?;
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
        crate::hive_bail!(
            "Hive repair delivery is incomplete: PR #{} exact-head github-pages deployment is {:?}",
            pull_request.number,
            state.as_deref()
        );
    }
    Ok(())
}

async fn validate_non_thread_feedback(repository: &Path, number: u64) -> crate::HiveResult<()> {
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
        .hive_context("GitHub returned invalid paginated feedback")?;
        let actionable = pages
            .as_array()
            .into_iter()
            .flatten()
            .flat_map(|page| page.as_array().into_iter().flatten())
            .filter_map(|item| item.get("body").and_then(serde_json::Value::as_str))
            .any(is_actionable_feedback);
        if actionable {
            crate::hive_bail!(
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

#[cfg(test)]
mod tests {
    use crate::HiveContext;

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
    fn delivery_state_accepts_legacy_status_contexts_and_null_rollups() -> anyhow::Result<()> {
        let with_context: DeliveryPullRequest = serde_json::from_str(
            r#"{
                "number": 42,
                "title": "[Hive] repair",
                "state": "MERGED",
                "headRefName": "codex/hive-task",
                "headRefOid": "head-42",
                "isCrossRepository": false,
                "labels": [{"name": "hive"}],
                "mergeCommit": {"oid": "abc123"},
                "statusCheckRollup": [{
                    "__typename": "StatusContext",
                    "context": "CodeRabbit",
                    "state": "SUCCESS",
                    "startedAt": "2026-07-28T01:00:00Z"
                }]
            }"#,
        )?;
        assert_eq!(with_context.status_check_rollup[0].name, "CodeRabbit");
        assert_eq!(with_context.status_check_rollup[0].conclusion, "SUCCESS");
        assert!(with_context.status_check_rollup[0].workflow_name.is_empty());

        let without_checks: DeliveryPullRequest = serde_json::from_str(
            r#"{
                "number": 43,
                "title": "[Hive] repair",
                "state": "OPEN",
                "headRefName": "codex/hive-task-g2",
                "headRefOid": "head-43",
                "isCrossRepository": false,
                "labels": [],
                "mergeCommit": null,
                "statusCheckRollup": null
            }"#,
        )?;
        assert!(without_checks.status_check_rollup.is_empty());
        Ok(())
    }

    #[test]
    fn delivery_requires_a_merged_pull_request() -> anyhow::Result<()> {
        let error = validate_merged_hive_pull_request(&pull_request(42, "repair", "OPEN", None))
            .err()
            .ok_or_else(|| {
                crate::hive_error!("an open pull request cannot complete a Hive task")
            })?;

        assert!(error.to_string().contains("PR #42 is OPEN"));
        Ok(())
    }

    #[test]
    fn delivery_requires_the_squash_merge_commit() -> anyhow::Result<()> {
        let error = validate_merged_hive_pull_request(&pull_request(42, "repair", "MERGED", None))
            .err()
            .ok_or_else(|| {
                crate::hive_error!("a merge without its commit cannot prove Main delivery")
            })?;

        assert!(error.to_string().contains("no squash merge"));
        Ok(())
    }

    #[test]
    fn delivery_accepts_a_merged_pull_request_with_its_commit() -> crate::HiveResult<()> {
        validate_merged_hive_pull_request(&pull_request(42, "repair", "MERGED", Some("abc123")))?;
        Ok(())
    }

    #[test]
    fn latest_follow_up_generation_is_selected() -> crate::HiveResult<()> {
        let pull_requests = vec![
            pull_request(40, "codex/hive-task", "CLOSED", None),
            pull_request(42, "codex/hive-task-g3", "MERGED", Some("abc123")),
            pull_request(41, "codex/hive-task-g2", "CLOSED", None),
            pull_request(99, "codex/hive-other", "MERGED", Some("unrelated")),
        ];

        let latest = latest_delivery_generation(&pull_requests, "codex/hive-task")?
            .hive_context("latest delivery generation must be present")?;

        assert_eq!(latest.number, 42);
        assert_eq!(
            delivery_generation("codex/hive-task", "codex/hive-task-g1"),
            None
        );
        Ok(())
    }

    #[test]
    fn duplicate_delivery_generations_are_rejected() -> anyhow::Result<()> {
        let pull_requests = vec![
            pull_request(41, "codex/hive-task-g2", "CLOSED", None),
            pull_request(42, "codex/hive-task-g2", "MERGED", Some("abc123")),
        ];

        let error = latest_delivery_generation(&pull_requests, "codex/hive-task")
            .err()
            .ok_or_else(|| {
                crate::hive_error!("duplicate generations cannot identify one delivery")
            })?;

        assert!(error.to_string().contains("multiple PRs use generation 2"));
        Ok(())
    }

    #[test]
    fn cross_repository_generation_is_ignored() -> crate::HiveResult<()> {
        let mut fork = pull_request(99, "codex/hive-task-g99", "OPEN", None);
        fork.is_cross_repository = true;
        let pull_requests = vec![
            pull_request(42, "codex/hive-task-g2", "MERGED", Some("abc123")),
            fork,
        ];

        let latest = latest_delivery_generation(&pull_requests, "codex/hive-task")?
            .hive_context("same-repository delivery generation must be present")?;

        assert_eq!(latest.number, 42);
        Ok(())
    }

    #[test]
    fn delivery_requires_the_full_e2e_label() -> crate::HiveResult<()> {
        let mut pull_request = pull_request(42, "repair", "MERGED", Some("abc123"));
        pull_request
            .labels
            .retain(|label| label.name != "ci:full-e2e");

        let error = validate_full_e2e_checks(&pull_request, false)
            .err()
            .ok_or_else(|| {
                crate::hive_error!("a Hive repair without the opt-in label cannot complete")
            })?;

        assert!(error.to_string().contains("lacks `ci:full-e2e`"));
        Ok(())
    }

    #[test]
    fn merge_triggered_skipped_e2e_does_not_hide_pre_merge_success() -> crate::HiveResult<()> {
        let mut pull_request = pull_request(42, "repair", "MERGED", Some("abc123"));
        pull_request.status_check_rollup.push(DeliveryCheck {
            name: "Full extension e2e (main fix)".to_owned(),
            status: "COMPLETED".to_owned(),
            conclusion: "SKIPPED".to_owned(),
            started_at: "2026-07-28T02:00:00Z".to_owned(),
            workflow_name: "PR".to_owned(),
        });

        validate_full_e2e_checks(&pull_request, false)?;
        Ok(())
    }

    #[test]
    fn repository_workflow_failure_without_success_is_rejected() -> crate::HiveResult<()> {
        let mut pull_request = pull_request(42, "repair", "MERGED", Some("abc123"));
        pull_request.status_check_rollup.push(DeliveryCheck {
            name: "Hive Rust and infrastructure verification".to_owned(),
            status: "COMPLETED".to_owned(),
            conclusion: "FAILURE".to_owned(),
            started_at: "2026-07-28T02:00:00Z".to_owned(),
            workflow_name: "Hive".to_owned(),
        });

        let error = validate_repository_checks(&pull_request, false)
            .err()
            .ok_or_else(|| {
                crate::hive_error!(
                    "a failed applicable repository workflow cannot complete a Hive task"
                )
            })?;
        assert!(error.to_string().contains("Hive Rust"));
        Ok(())
    }

    #[test]
    fn successful_main_accepts_checks_cancelled_by_the_squash_merge() -> crate::HiveResult<()> {
        let mut pull_request = pull_request(42, "repair", "MERGED", Some("abc123"));
        for check in &mut pull_request.status_check_rollup {
            check.conclusion = "CANCELLED".to_owned();
        }

        validate_repository_checks(&pull_request, true)?;
        validate_full_e2e_checks(&pull_request, true)?;
        Ok(())
    }

    #[test]
    fn successful_main_does_not_hide_a_failed_pr_check() -> crate::HiveResult<()> {
        let mut pull_request = pull_request(42, "repair", "MERGED", Some("abc123"));
        pull_request.status_check_rollup[0].conclusion = "FAILURE".to_owned();
        pull_request.status_check_rollup[1].conclusion = "CANCELLED".to_owned();

        let error = validate_full_e2e_checks(&pull_request, true)
            .err()
            .ok_or_else(|| {
                crate::hive_error!("a failed exact-head e2e run remains a delivery failure")
            })?;
        assert!(error.to_string().contains("Full browser e2e"));
        Ok(())
    }

    #[test]
    fn successful_main_does_not_replace_cancelled_hive_verification() -> crate::HiveResult<()> {
        let mut pull_request = pull_request(42, "repair", "MERGED", Some("abc123"));
        pull_request.status_check_rollup.push(DeliveryCheck {
            name: "Hive Rust and infrastructure verification".to_owned(),
            status: "COMPLETED".to_owned(),
            conclusion: "CANCELLED".to_owned(),
            started_at: "2026-07-28T02:00:00Z".to_owned(),
            workflow_name: "Hive".to_owned(),
        });

        let error = validate_repository_checks(&pull_request, true)
            .err()
            .ok_or_else(|| crate::hive_error!("Main does not exercise Hive-only verification"))?;
        assert!(error.to_string().contains("Hive Rust"));
        Ok(())
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
    fn failed_repair_run_is_not_hidden_by_a_successful_descendant() -> anyhow::Result<()> {
        let runs = vec![
            run("repair", "failure", "2026-07-28T01:00:00Z"),
            run("descendant", "success", "2026-07-28T02:00:00Z"),
        ];
        let error = select_successful_main_run(&runs, "merge")
            .err()
            .ok_or_else(|| crate::hive_error!("an explicit failure must remain terminal"))?;
        assert!(error.to_string().contains("repair"));
        Ok(())
    }

    #[test]
    fn cancelled_run_can_coalesce_into_a_successful_descendant() -> crate::HiveResult<()> {
        let runs = vec![
            run("repair", "cancelled", "2026-07-28T01:00:00Z"),
            run("descendant", "success", "2026-07-28T02:00:00Z"),
        ];
        assert_eq!(select_successful_main_run(&runs, "merge")?, "descendant");
        Ok(())
    }

    #[test]
    fn first_successful_completed_descendant_is_selected_chronologically() -> crate::HiveResult<()>
    {
        let runs = vec![
            run("first", "success", "2026-07-28T01:00:00Z"),
            run("second", "success", "2026-07-28T02:00:00Z"),
        ];
        assert_eq!(select_successful_main_run(&runs, "merge")?, "first");
        Ok(())
    }
}
