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
    labels: Vec<DeliveryLabel>,
    merge_commit: Option<DeliveryCommit>,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
struct DeliveryLabel {
    name: String,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
struct DeliveryCommit {
    oid: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeliveryRun {
    head_sha: String,
    status: String,
    conclusion: String,
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
                "--head",
                branch,
                "--state",
                "all",
                "--limit",
                "2",
                "--json",
                "number,title,state,labels,mergeCommit",
            ],
        )
        .await?,
    )
    .context("GitHub returned invalid Hive pull request state")?;
    let pull_request = match pull_requests.as_slice() {
        [pull_request] => pull_request,
        [] => anyhow::bail!("Hive repair delivery is incomplete: no pull request exists"),
        _ => anyhow::bail!("Hive repair delivery is ambiguous: multiple pull requests exist"),
    };

    ensure_hive_marker(repository, pull_request).await?;
    validate_merged_hive_pull_request(pull_request)?;
    let merge_commit = pull_request
        .merge_commit
        .as_ref()
        .context("merged Hive pull request has no merge commit")?;

    run_git_status(
        repository,
        &["fetch", "--depth=100", "origin", "main"],
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

    let runs: Vec<DeliveryRun> = serde_json::from_str(
        &gh_output(
            repository,
            &[
                "run",
                "list",
                "--workflow",
                "Main",
                "--branch",
                "main",
                "--status",
                "success",
                "--limit",
                "20",
                "--json",
                "headSha,status,conclusion",
            ],
        )
        .await?,
    )
    .context("GitHub returned invalid Main workflow state")?;
    for run in runs {
        if run.status != "completed" || run.conclusion != "success" {
            continue;
        }
        let fetched = Command::new("git")
            .args(["fetch", "--depth=100", "origin", run.head_sha.as_str()])
            .current_dir(repository)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .context("failed to fetch successful Main workflow revision")?;
        if !fetched.success() {
            continue;
        }
        let contains_merge = Command::new("git")
            .args([
                "merge-base",
                "--is-ancestor",
                merge_commit.oid.as_str(),
                "FETCH_HEAD",
            ])
            .current_dir(repository)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .context("failed to inspect successful Main workflow ancestry")?;
        if contains_merge.success() {
            return Ok(());
        }
    }
    anyhow::bail!(
        "Hive repair delivery is incomplete: no successful Main workflow contains merge {}",
        merge_commit.oid
    )
}

async fn ensure_hive_marker(
    repository: &Path,
    pull_request: &DeliveryPullRequest,
) -> anyhow::Result<()> {
    run_gh_status(
        repository,
        &[
            "label",
            "create",
            "hive",
            "--color",
            "7057ff",
            "--description",
            "Created and owned by the Hive agent platform",
            "--force",
        ],
        "create the Hive pull request label",
    )
    .await?;
    let number = pull_request.number.to_string();
    if !pull_request.title.starts_with("[Hive] ") {
        let title = format!("[Hive] {}", pull_request.title);
        run_gh_status(
            repository,
            &["pr", "edit", &number, "--title", &title],
            "mark the Hive pull request title",
        )
        .await?;
    }
    if !pull_request.labels.iter().any(|label| label.name == "hive") {
        run_gh_status(
            repository,
            &["pr", "edit", &number, "--add-label", "hive"],
            "mark the Hive pull request label",
        )
        .await?;
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

async fn run_gh_status(
    repository: &Path,
    arguments: &[&str],
    operation: &str,
) -> anyhow::Result<()> {
    let status = Command::new("gh")
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
    use super::{DeliveryCommit, DeliveryPullRequest, validate_merged_hive_pull_request};

    fn pull_request(state: &str, merge_commit: Option<&str>) -> DeliveryPullRequest {
        DeliveryPullRequest {
            number: 42,
            title: "[Hive] repair".to_owned(),
            state: state.to_owned(),
            labels: Vec::new(),
            merge_commit: merge_commit.map(|oid| DeliveryCommit {
                oid: oid.to_owned(),
            }),
        }
    }

    #[test]
    fn delivery_requires_a_merged_pull_request() {
        let error = validate_merged_hive_pull_request(&pull_request("OPEN", None))
            .expect_err("an open pull request cannot complete a Hive task");

        assert!(error.to_string().contains("PR #42 is OPEN"));
    }

    #[test]
    fn delivery_requires_the_squash_merge_commit() {
        let error = validate_merged_hive_pull_request(&pull_request("MERGED", None))
            .expect_err("a merge without its commit cannot prove Main delivery");

        assert!(error.to_string().contains("no squash merge"));
    }

    #[test]
    fn delivery_accepts_a_merged_pull_request_with_its_commit() {
        validate_merged_hive_pull_request(&pull_request("MERGED", Some("abc123")))
            .expect("the merged pull request should pass the local delivery invariant");
    }
}
