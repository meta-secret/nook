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
    validate_required_pr_checks(pull_request)?;
    validate_full_e2e_checks(pull_request)?;
    validate_review_and_deployment_readiness(repository, pull_request).await?;
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
    for run in runs {
        if run.status != "completed" {
            continue;
        }
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
        if run.conclusion == "success" {
            return Ok(());
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
        merge_commit.oid
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

fn validate_full_e2e_checks(pull_request: &DeliveryPullRequest) -> anyhow::Result<()> {
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
        let latest = pull_request
            .status_check_rollup
            .iter()
            .filter(|check| check.name == required_check)
            .max_by(|left, right| left.started_at.cmp(&right.started_at));
        if !latest.is_some_and(|check| check.status == "COMPLETED" && check.conclusion == "SUCCESS")
        {
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

fn validate_required_pr_checks(pull_request: &DeliveryPullRequest) -> anyhow::Result<()> {
    let latest = pull_request
        .status_check_rollup
        .iter()
        .filter(|check| check.name == "Verify and preview")
        .max_by(|left, right| left.started_at.cmp(&right.started_at));
    if !latest.is_some_and(|check| check.status == "COMPLETED" && check.conclusion == "SUCCESS") {
        anyhow::bail!(
            "Hive repair delivery is incomplete: PR #{} at {} lacks successful exact-head `Verify and preview`",
            pull_request.number,
            pull_request.head_ref_oid
        );
    }
    Ok(())
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
    let review_query = format!(
        "query($number:Int!){{repository(owner:\"{owner}\",name:\"{name}\"){{pullRequest(number:$number){{reviewThreads(first:100){{nodes{{isResolved}}}}}}}}}}"
    );
    let review: serde_json::Value = serde_json::from_str(
        &gh_output(
            repository,
            &[
                "api",
                "graphql",
                "-F",
                &format!("number={number}"),
                "-f",
                &format!("query={review_query}"),
            ],
        )
        .await?,
    )
    .context("GitHub returned invalid Hive review state")?;
    let unresolved = review
        .pointer("/data/repository/pullRequest/reviewThreads/nodes")
        .and_then(serde_json::Value::as_array)
        .context("GitHub review response omitted review threads")?
        .iter()
        .filter(|thread| {
            thread
                .get("isResolved")
                .and_then(serde_json::Value::as_bool)
                == Some(false)
        })
        .count();
    if unresolved > 0 {
        anyhow::bail!(
            "Hive repair delivery is incomplete: PR #{} has {} unresolved review thread(s)",
            pull_request.number,
            unresolved
        );
    }

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
    let deployment_id = deployments
        .as_array()
        .and_then(|items| items.first())
        .and_then(|deployment| deployment.get("id"))
        .and_then(serde_json::Value::as_u64)
        .context("Hive repair delivery lacks an exact-head github-pages deployment")?;
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
    let state = statuses
        .as_array()
        .and_then(|items| items.first())
        .and_then(|status| status.get("state"))
        .and_then(serde_json::Value::as_str);
    if state != Some("success") {
        anyhow::bail!(
            "Hive repair delivery is incomplete: PR #{} exact-head github-pages deployment is {:?}",
            pull_request.number,
            state
        );
    }
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
        DeliveryCheck, DeliveryCommit, DeliveryLabel, DeliveryPullRequest, delivery_generation,
        latest_delivery_generation, validate_full_e2e_checks, validate_merged_hive_pull_request,
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
                },
                DeliveryCheck {
                    name: "Full extension e2e (main fix)".to_owned(),
                    status: "COMPLETED".to_owned(),
                    conclusion: "SUCCESS".to_owned(),
                    started_at: "2026-07-28T01:00:00Z".to_owned(),
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

        let error = validate_full_e2e_checks(&pull_request)
            .expect_err("a Hive repair without the opt-in label cannot complete");

        assert!(error.to_string().contains("lacks `ci:full-e2e`"));
    }

    #[test]
    fn delivery_requires_successful_full_e2e_on_the_current_head() {
        let mut pull_request = pull_request(42, "repair", "MERGED", Some("abc123"));
        pull_request.status_check_rollup.push(DeliveryCheck {
            name: "Full extension e2e (main fix)".to_owned(),
            status: "COMPLETED".to_owned(),
            conclusion: "FAILURE".to_owned(),
            started_at: "2026-07-28T02:00:00Z".to_owned(),
        });

        let error = validate_full_e2e_checks(&pull_request)
            .expect_err("a failed extension suite cannot complete a Hive task");

        assert!(error.to_string().contains("Full extension e2e"));
    }
}
