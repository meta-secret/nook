use std::path::Path;

use serde::Deserialize;

use super::command::DeliveryCommand;
use crate::model::GitSha;

pub(super) struct PromotionEvidence<'a> {
    pub(super) repository: &'a Path,
    pub(super) promoted_sha: &'a GitSha,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PromotionPullRequest {
    state: String,
    merged_at: Option<String>,
    head_ref_name: String,
    head_ref_oid: String,
    base_ref_name: String,
    merge_commit: Option<PromotionCommit>,
}

#[derive(Deserialize)]
struct PromotionCommit {
    oid: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MainRun {
    head_sha: String,
    status: String,
    conclusion: String,
}

impl PromotionEvidence<'_> {
    pub(super) async fn validate(self) -> crate::HiveResult<()> {
        let sha = self.promoted_sha.as_str();
        DeliveryCommand::run_git_status(
            self.repository,
            &[
                "fetch",
                "--no-tags",
                "origin",
                "+main:refs/remotes/origin/main",
                "+dev:refs/remotes/origin/dev",
            ],
            "fetch canonical dev and Main promotion refs",
        )
        .await?;
        let main = DeliveryCommand::git_output(
            self.repository,
            &["rev-parse", "refs/remotes/origin/main"],
        )
        .await?;
        if !DeliveryCommand::is_ancestor(
            self.repository,
            sha,
            &main,
            "verify remote Main contains the promoted repair",
        )
        .await?
        {
            return Err(crate::HiveError::message(format!(
                "obsolete blocker retirement requires remote Main to contain tested SHA {sha}, observed {main}"
            )));
        }
        let dev =
            DeliveryCommand::git_output(self.repository, &["rev-parse", "refs/remotes/origin/dev"])
                .await?;
        if !DeliveryCommand::is_ancestor(
            self.repository,
            sha,
            &dev,
            "verify remote dev contains the promoted repair",
        )
        .await?
        {
            return Err(crate::HiveError::message(format!(
                "obsolete blocker retirement requires remote dev to contain tested SHA {sha}, observed {dev}"
            )));
        }
        self.validate_pull_request(sha).await?;
        self.validate_main_run(sha).await
    }

    async fn validate_pull_request(&self, sha: &str) -> crate::HiveResult<()> {
        let output = (DeliveryCommand {
            repository: self.repository,
            arguments: &[
                "pr",
                "list",
                "--state",
                "merged",
                "--base",
                "main",
                "--head",
                "dev",
                "--limit",
                "20",
                "--json",
                "state,mergedAt,headRefName,headRefOid,baseRefName,mergeCommit",
            ],
        })
        .gh_output()
        .await?;
        let pulls: Vec<PromotionPullRequest> = serde_json::from_str(&output)?;
        let valid = pulls.iter().any(|pull| {
            pull.state == "MERGED"
                && pull.merged_at.is_some()
                && pull.head_ref_name == "dev"
                && pull.base_ref_name == "main"
                && pull.head_ref_oid == sha
                && pull
                    .merge_commit
                    .as_ref()
                    .is_some_and(|commit| commit.oid == sha)
        });
        if !valid {
            return Err(crate::HiveError::message(format!(
                "obsolete blocker retirement requires a merged dev-to-main lifecycle PR preserving exact SHA {sha}"
            )));
        }
        Ok(())
    }

    async fn validate_main_run(&self, sha: &str) -> crate::HiveResult<()> {
        let output = (DeliveryCommand {
            repository: self.repository,
            arguments: &[
                "run",
                "list",
                "--workflow",
                "Main",
                "--branch",
                "main",
                "--limit",
                "100",
                "--json",
                "headSha,status,conclusion",
            ],
        })
        .gh_output()
        .await?;
        let runs: Vec<MainRun> = serde_json::from_str(&output)?;
        for run in runs
            .iter()
            .filter(|run| run.status == "completed" && run.conclusion == "success")
        {
            if DeliveryCommand::is_ancestor(
                self.repository,
                sha,
                &run.head_sha,
                "verify successful Main run contains the promoted repair",
            )
            .await?
            {
                return Ok(());
            }
        }
        Err(crate::HiveError::message(format!(
            "obsolete blocker retirement requires a successful Main run containing tested SHA {sha}"
        )))
    }
}
