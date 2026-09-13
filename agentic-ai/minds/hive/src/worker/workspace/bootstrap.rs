use std::path::{Path, PathBuf};
use std::process::Stdio;

use tokio::fs as async_fs;

use super::TaskWorkspace;
use crate::HiveContext;
use crate::model::{BootstrapEvidence, GitSha};

#[derive(Debug)]
pub(super) enum WorkspaceOrigin<'a> {
    Fresh,
    ResumeBranch(&'a str),
}

impl TaskWorkspace<'_> {
    pub(super) async fn prepare_repository(
        workspace: &Path,
        repository_url: &str,
        source_commit: &str,
        resume_branch: &WorkspaceOrigin<'_>,
    ) -> crate::HiveResult<(PathBuf, bool, Option<GitSha>)> {
        let repository = workspace.join("repository");
        if repository.join(".git").is_dir() {
            return Err(crate::HiveError::message(
                "refusing to reuse a repository left by an earlier worker process",
            ));
        }
        async_fs::create_dir_all(&repository).await?;
        let status = TaskWorkspace::git_command()
            .arg("init")
            .arg("--quiet")
            .arg(&repository)
            .stdin(Stdio::null())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .status()
            .await
            .hive_context("failed to initialize the task repository")?;
        if !status.success() {
            return Err(crate::HiveError::message(format!(
                "git init failed with status {status}"
            )));
        }
        TaskWorkspace::run_git_status(
            &repository,
            &["remote", "add", "origin", repository_url],
            "configure the task repository remote",
        )
        .await?;
        TaskWorkspace::run_git_status(
            &repository,
            &["fetch", "--depth=1", "origin", source_commit],
            "fetch the pinned task revision",
        )
        .await?;
        let mut did_resume = false;
        if let WorkspaceOrigin::ResumeBranch(branch) = resume_branch {
            let resumed = TaskWorkspace::git_command()
                .args([
                    "fetch",
                    "--depth=100",
                    "origin",
                    &format!("refs/heads/{branch}"),
                ])
                .current_dir(&repository)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .await?;
            if resumed.success() {
                TaskWorkspace::run_git_status(
                    &repository,
                    &["checkout", "--quiet", "-B", branch, "FETCH_HEAD"],
                    "resume the durable Hive repair branch",
                )
                .await?;
                TaskWorkspace::run_git_status(
                    &repository,
                    &["merge-base", "--is-ancestor", source_commit, "HEAD"],
                    "verify the repair branch descends from its pinned revision",
                )
                .await?;
                did_resume = true;
            }
        }
        if !did_resume {
            TaskWorkspace::run_git_status(
                &repository,
                &["checkout", "--quiet", "--detach", source_commit],
                "check out the pinned task revision",
            )
            .await?;
        }
        Ok((repository, did_resume, None))
    }

    pub(super) async fn prepare_pinned_repository(
        workspace: &Path,
        repository_url: &str,
        evidence: &BootstrapEvidence,
        resume_branch: &WorkspaceOrigin<'_>,
    ) -> crate::HiveResult<(PathBuf, bool, Option<GitSha>)> {
        let repository = workspace.join("repository");
        if repository.join(".git").is_dir() {
            return Err(crate::HiveError::message(
                "refusing to reuse a repository left by an earlier worker process",
            ));
        }
        async_fs::create_dir_all(&repository).await?;
        let status = TaskWorkspace::git_command()
            .args(["init", "--quiet"])
            .arg(&repository)
            .stdin(Stdio::null())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .status()
            .await
            .hive_context("failed to initialize the pinned task repository")?;
        if !status.success() {
            return Err(crate::HiveError::message(format!(
                "git init failed with status {status}"
            )));
        }
        TaskWorkspace::run_git_status(
            &repository,
            &["remote", "add", "origin", repository_url],
            "configure the pinned task repository remote",
        )
        .await?;
        TaskWorkspace::run_git_status(
            &repository,
            &[
                "fetch",
                "--no-tags",
                "origin",
                evidence.origin_main_sha.as_str(),
                evidence.pinned_local_dev_sha.as_str(),
                &format!(
                    "refs/heads/{}:refs/remotes/origin/{}",
                    evidence.feature_branch.as_str(),
                    evidence.feature_branch.as_str()
                ),
            ],
            "fetch the bootstrap commits and canonical feature branch",
        )
        .await?;
        TaskWorkspace::run_git_status(
            &repository,
            &[
                "merge-base",
                "--is-ancestor",
                evidence.origin_main_sha.as_str(),
                evidence.pinned_local_dev_sha.as_str(),
            ],
            "verify originMainSha ancestry",
        )
        .await?;
        let observed_feature_head = TaskWorkspace::git_output(
            &repository,
            &[
                "rev-parse",
                &format!("refs/remotes/origin/{}", evidence.feature_branch.as_str()),
            ],
        )
        .await?;
        let observed_feature_head_sha = GitSha::try_from(observed_feature_head.as_str())?;
        TaskWorkspace::run_git_status(
            &repository,
            &[
                "merge-base",
                "--is-ancestor",
                evidence.pinned_local_dev_sha.as_str(),
                observed_feature_head_sha.as_str(),
            ],
            "verify canonical feature branch descends from pinned local-dev base",
        )
        .await?;
        let mut did_resume = false;
        if let WorkspaceOrigin::ResumeBranch(branch) = resume_branch {
            if branch != evidence.feature_branch.as_str() {
                return Err(crate::HiveError::message(
                    "resume branch does not match the canonical feature branch",
                ));
            }
            TaskWorkspace::run_git_status(
                &repository,
                &[
                    "checkout",
                    "--quiet",
                    "-B",
                    branch,
                    &format!("refs/remotes/origin/{branch}"),
                ],
                "resume the canonical Hive repair branch",
            )
            .await?;
            did_resume = true;
        }
        if !did_resume {
            TaskWorkspace::run_git_status(
                &repository,
                &[
                    "checkout",
                    "--quiet",
                    "--detach",
                    observed_feature_head_sha.as_str(),
                ],
                "check out the observed canonical feature branch head",
            )
            .await?;
            let checked_out =
                TaskWorkspace::git_output(&repository, &["rev-parse", "HEAD"]).await?;
            if checked_out != observed_feature_head_sha.as_str() {
                return Err(crate::HiveError::message(
                    "detached workspace HEAD does not equal the observed canonical feature branch head",
                ));
            }
        }
        Ok((repository, did_resume, Some(observed_feature_head_sha)))
    }
}
