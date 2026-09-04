use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;

use crate::HiveContext;
use serde::Deserialize;
use tokio::process::Command;

use self::command::{gh_output, git_output, run_git_status};
use self::main_run::select_successful_main_run;
use self::readiness::validate_review_and_deployment_readiness;
use self::workbench::validate_workbench_completion;

mod command;
mod main_run;
mod readiness;
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
        return Err(crate::HiveError::message(format!(
            "Hive repair delivery is ambiguous: multiple PRs use generation {latest_generation}"
        )));
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
        return Err(crate::HiveError::message(format!(
            "Hive repair delivery is incomplete: PR #{} lacks the `[Hive]` title marker",
            pull_request.number
        )));
    }
    if !pull_request.labels.iter().any(|label| label.name == "hive") {
        return Err(crate::HiveError::message(format!(
            "Hive repair delivery is incomplete: PR #{} lacks the `hive` label",
            pull_request.number
        )));
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
        return Err(crate::HiveError::message(format!(
            "Hive repair delivery violated squash-only history: merge {} has multiple parents",
            merge_commit.oid
        )));
    }
    let subject = git_output(
        repository,
        &["show", "-s", "--format=%s", merge_commit.oid.as_str()],
    )
    .await?;
    let expected_suffix = format!("(#{})", pull_request.number);
    if !subject.ends_with(&expected_suffix) {
        return Err(crate::HiveError::message(format!(
            "Hive repair delivery violated squash-only history: merge {} lacks PR suffix {}",
            merge_commit.oid, expected_suffix
        )));
    }
    Ok(())
}

fn validate_merged_hive_pull_request(pull_request: &DeliveryPullRequest) -> crate::HiveResult<()> {
    if pull_request.state != "MERGED" {
        return Err(crate::HiveError::message(format!(
            "Hive repair delivery is incomplete: PR #{} is {}",
            pull_request.number, pull_request.state
        )));
    }
    if pull_request.merge_commit.is_none() {
        return Err(crate::HiveError::message(format!(
            "Hive repair delivery is incomplete: PR #{} has no squash merge",
            pull_request.number
        )));
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
        return Err(crate::HiveError::message(format!(
            "Hive repair delivery is incomplete: PR #{} at {} lacks `ci:full-e2e`",
            pull_request.number, pull_request.head_ref_oid
        )));
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
            return Err(crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: PR #{} at {} lacks successful exact-head `{}`",
                pull_request.number, pull_request.head_ref_oid, required_check
            )));
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
        return Err(crate::HiveError::message(format!(
            "Hive repair delivery is incomplete: PR #{} at {} lacks successful exact-head `Verify and preview`",
            pull_request.number, pull_request.head_ref_oid
        )));
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
            return Err(crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: repository check `{name}` is still running"
            )));
        }
        if let Some(check) = checks
            .iter()
            .find(|check| !matches!(check.conclusion.as_str(), "SKIPPED" | "NEUTRAL"))
        {
            return Err(crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: repository check `{name}` concluded {}",
                check.conclusion
            )));
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

#[cfg(test)]
mod tests {
    use crate::HiveContext;
    use std::fs;
    use std::path;
    use std::process;

    use super::{
        DeliveryCheck, DeliveryCommit, DeliveryLabel, DeliveryPullRequest, delivery_generation,
        latest_delivery_generation, validate_full_e2e_checks, validate_hive_marker,
        validate_merged_hive_pull_request, validate_repository_checks, validate_squash_merge,
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

    fn git(repository: &path::Path, arguments: &[&str]) -> crate::HiveResult<String> {
        let output = process::Command::new("git")
            .args(arguments)
            .current_dir(repository)
            .output()?;
        if !output.status.success() {
            return Err(crate::HiveError::message(format!(
                "fixture git {arguments:?} failed with {}",
                output.status
            )));
        }
        Ok(String::from_utf8(output.stdout)?.trim().to_owned())
    }

    #[tokio::test]
    async fn delivery_metadata_history_and_repository_checks_enforce_completion_contracts()
    -> crate::HiveResult<()> {
        let mut marked = pull_request(42, "repair", "MERGED", Some("pending"));
        validate_hive_marker(&marked)?;
        marked.title = "repair without marker".to_owned();
        let title_error = validate_hive_marker(&marked)
            .err()
            .ok_or_else(|| crate::HiveError::message("unmarked delivery title was accepted"))?;
        assert!(title_error.to_string().contains("title marker"));
        marked.title = "[Hive] repair".to_owned();
        marked.labels.retain(|label| label.name != "hive");
        let label_error = validate_hive_marker(&marked)
            .err()
            .ok_or_else(|| crate::HiveError::message("unlabelled Hive delivery was accepted"))?;
        assert!(label_error.to_string().contains("lacks the `hive` label"));

        let repository = tempfile::tempdir()?;
        let missing_commit = pull_request(42, "repair", "MERGED", None);
        let commit_error = validate_squash_merge(repository.path(), &missing_commit)
            .await
            .err()
            .ok_or_else(|| crate::HiveError::message("missing squash commit was accepted"))?;
        assert!(commit_error.to_string().contains("no merge commit"));

        git(repository.path(), &["init", "--quiet"])?;
        git(repository.path(), &["config", "user.name", "Hive Test"])?;
        git(
            repository.path(),
            &["config", "user.email", "hive@example.invalid"],
        )?;
        fs::write(repository.path().join("repair.txt"), "base\n")?;
        git(repository.path(), &["add", "repair.txt"])?;
        git(repository.path(), &["commit", "--quiet", "-m", "base"])?;
        let root_commit = git(repository.path(), &["rev-parse", "HEAD"])?;
        let root_delivery = pull_request(42, "repair", "MERGED", Some(&root_commit));
        let history_error = validate_squash_merge(repository.path(), &root_delivery)
            .await
            .err()
            .ok_or_else(|| crate::HiveError::message("parentless commit was accepted as squash"))?;
        assert!(history_error.to_string().contains("multiple parents"));

        fs::write(repository.path().join("repair.txt"), "base\nrepair\n")?;
        git(repository.path(), &["add", "repair.txt"])?;
        git(
            repository.path(),
            &["commit", "--quiet", "-m", "repair invariant (#42)"],
        )?;
        let valid_commit = git(repository.path(), &["rev-parse", "HEAD"])?;
        let valid = pull_request(42, "repair", "MERGED", Some(&valid_commit));
        validate_squash_merge(repository.path(), &valid).await?;

        fs::write(
            repository.path().join("repair.txt"),
            "base\nrepair\nfollow-up\n",
        )?;
        git(repository.path(), &["add", "repair.txt"])?;
        git(
            repository.path(),
            &["commit", "--quiet", "-m", "missing pull request suffix"],
        )?;
        let invalid_commit = git(repository.path(), &["rev-parse", "HEAD"])?;
        let invalid = pull_request(42, "repair", "MERGED", Some(&invalid_commit));
        let subject_error = validate_squash_merge(repository.path(), &invalid)
            .await
            .err()
            .ok_or_else(|| {
                crate::HiveError::message("squash commit without its PR suffix was accepted")
            })?;
        assert!(subject_error.to_string().contains("lacks PR suffix (#42)"));

        let mut checks = pull_request(42, "repair", "MERGED", Some(&valid_commit));
        checks.status_check_rollup.push(DeliveryCheck {
            name: "Security audit".to_owned(),
            status: "IN_PROGRESS".to_owned(),
            conclusion: String::new(),
            started_at: "2026-09-04T01:00:00Z".to_owned(),
            workflow_name: "Security".to_owned(),
        });
        let pending = validate_repository_checks(&checks, false)
            .err()
            .ok_or_else(|| crate::HiveError::message("pending repository check was accepted"))?;
        assert!(pending.to_string().contains("still running"));

        checks
            .status_check_rollup
            .retain(|check| check.name != "Security audit");
        let mut missing_verify = checks.clone();
        missing_verify
            .status_check_rollup
            .retain(|check| check.name != "Verify and preview");
        let missing = validate_repository_checks(&missing_verify, false)
            .err()
            .ok_or_else(|| {
                crate::HiveError::message("missing repository verification was accepted")
            })?;
        assert!(missing.to_string().contains("Verify and preview"));

        let mut missing_e2e = checks.clone();
        missing_e2e
            .status_check_rollup
            .retain(|check| check.name != "Full browser e2e (main fix)");
        let missing = validate_full_e2e_checks(&missing_e2e, false)
            .err()
            .ok_or_else(|| crate::HiveError::message("missing browser e2e check was accepted"))?;
        assert!(missing.to_string().contains("Full browser e2e"));

        for conclusion in ["SKIPPED", "NEUTRAL"] {
            checks.status_check_rollup.push(DeliveryCheck {
                name: "Advisory".to_owned(),
                status: "COMPLETED".to_owned(),
                conclusion: conclusion.to_owned(),
                started_at: "2026-09-04T01:00:00Z".to_owned(),
                workflow_name: "Advisory".to_owned(),
            });
        }
        validate_repository_checks(&checks, false)?;
        Ok(())
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
                crate::HiveError::message("an open pull request cannot complete a Hive task")
            })?;

        assert!(error.to_string().contains("PR #42 is OPEN"));
        Ok(())
    }

    #[test]
    fn delivery_requires_the_squash_merge_commit() -> anyhow::Result<()> {
        let error = validate_merged_hive_pull_request(&pull_request(42, "repair", "MERGED", None))
            .err()
            .ok_or_else(|| {
                crate::HiveError::message("a merge without its commit cannot prove Main delivery")
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
                crate::HiveError::message("duplicate generations cannot identify one delivery")
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
                crate::HiveError::message("a Hive repair without the opt-in label cannot complete")
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
                crate::HiveError::message(
                    "a failed applicable repository workflow cannot complete a Hive task",
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
                crate::HiveError::message("a failed exact-head e2e run remains a delivery failure")
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
            .ok_or_else(|| {
                crate::HiveError::message("Main does not exercise Hive-only verification")
            })?;
        assert!(error.to_string().contains("Hive Rust"));
        Ok(())
    }
}
