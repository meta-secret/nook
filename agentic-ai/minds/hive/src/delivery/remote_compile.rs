use std::path::Path;

use serde::Deserialize;

use super::command::DeliveryCommand;
use crate::model::GitSha;

pub(super) struct RemoteCompileEvidence<'a> {
    pub(super) repository: &'a Path,
    pub(super) branch: &'a str,
    pub(super) feature_sha: &'a GitSha,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RemoteCompileRun {
    database_id: u64,
    head_sha: String,
    head_branch: String,
    event: String,
    status: String,
    conclusion: String,
    created_at: String,
    display_title: String,
}

#[cfg(test)]
impl RemoteCompileRun {
    fn new(
        database_id: u64,
        branch: &str,
        sha: &str,
        status: &str,
        conclusion: &str,
        title: &str,
        created_at: &str,
    ) -> Self {
        Self {
            database_id,
            head_sha: sha.to_owned(),
            head_branch: branch.to_owned(),
            event: "workflow_dispatch".to_owned(),
            status: status.to_owned(),
            conclusion: conclusion.to_owned(),
            created_at: created_at.to_owned(),
            display_title: title.to_owned(),
        }
    }
}

impl RemoteCompileEvidence<'_> {
    pub(super) async fn validate(self) -> crate::HiveResult<()> {
        let Self {
            repository,
            branch,
            feature_sha,
        } = self;
        let output = (DeliveryCommand {
            repository,
            arguments: &[
                "run",
                "list",
                "--workflow",
                "remote.yml",
                "--branch",
                branch,
                "--limit",
                "100",
                "--json",
                "databaseId,headSha,headBranch,event,status,conclusion,createdAt,displayTitle",
            ],
        })
        .gh_output()
        .await?;
        let mut runs: Vec<RemoteCompileRun> = serde_json::from_str(&output)
            .map_err(crate::HiveError::from)
            .map_err(|error| {
                crate::HiveError::message(format!(
                    "GitHub returned invalid remote build-only workflow state: {error}"
                ))
            })?;
        runs.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        let run = Self::latest_exact_compile_run(&runs, branch, feature_sha.as_str())?;
        if run.status != "completed" {
            return Err(crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: exact-head remote build:compile run {} is still {}",
                run.database_id, run.status
            )));
        }
        if run.conclusion != "success" {
            return Err(crate::HiveError::message(format!(
                "Hive repair delivery exact-head remote build:compile run {} concluded {}",
                run.database_id, run.conclusion
            )));
        }
        Ok(())
    }
}

impl RemoteCompileEvidence<'_> {
    fn latest_exact_compile_run<'a>(
        runs: &'a [RemoteCompileRun],
        branch: &str,
        feature_sha: &str,
    ) -> crate::HiveResult<&'a RemoteCompileRun> {
        let expected_title = format!("Remote / build:compile @ {feature_sha}");
        let run = runs.iter().find(|run| {
            run.head_sha == feature_sha
                && run.head_branch == branch
                && run.event == "workflow_dispatch"
                && run.display_title.starts_with(&expected_title)
        });
        run.ok_or_else(|| {
            crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: no exact-head remote build:compile evidence for {feature_sha}"
            ))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::RemoteCompileRun;
    use crate::HiveResult;

    #[test]
    fn exact_compile_run_requires_sha_branch_and_task_identity() -> HiveResult<()> {
        let sha = "0123456789012345678901234567890123456789";
        let branch = "codex/hive-main-failure-42";
        let title = format!("Remote / build:compile @ {sha} / nonce");
        let runs = vec![RemoteCompileRun::new(
            7,
            branch,
            sha,
            "completed",
            "success",
            &title,
            "2026-09-13T01:00:00Z",
        )];

        let selected = super::RemoteCompileEvidence::latest_exact_compile_run(
            &runs, branch, sha,
        )?;
        assert_eq!(selected.database_id, 7);
        assert!(super::RemoteCompileEvidence::latest_exact_compile_run(
            &runs,
            branch,
            "abcdefabcdefabcdefabcdefabcdefabcdefabcd",
        )
        .is_err());
        assert!(super::RemoteCompileEvidence::latest_exact_compile_run(
            &runs,
            "codex/other",
            sha,
        )
        .is_err());
        Ok(())
    }

    #[test]
    fn a_latest_pending_or_failed_exact_run_cannot_hide_as_success() -> HiveResult<()> {
        let sha = "0123456789012345678901234567890123456789";
        let branch = "codex/hive-main-failure-42";
        let title = format!("Remote / build:compile @ {sha} / nonce");
        let runs = vec![
            RemoteCompileRun::new(
                8,
                branch,
                sha,
                "completed",
                "success",
                &title,
                "2026-09-13T01:00:00Z",
            ),
            RemoteCompileRun::new(
                9,
                branch,
                sha,
                "in_progress",
                "",
                &title,
                "2026-09-13T02:00:00Z",
            ),
        ];
        let selected = super::RemoteCompileEvidence::latest_exact_compile_run(
            &runs, branch, sha,
        )?;
        assert_eq!(selected.database_id, 9);
        assert_ne!(selected.status, "completed");
        Ok(())
    }

    #[test]
    fn non_compile_remote_tasks_are_not_compile_evidence() -> HiveResult<()> {
        let sha = "0123456789012345678901234567890123456789";
        let branch = "codex/hive-main-failure-42";
        let runs = vec![RemoteCompileRun::new(
            10,
            branch,
            sha,
            "completed",
            "success",
            &format!("Remote / hive:verify @ {sha} / nonce"),
            "2026-09-13T01:00:00Z",
        )];
        assert!(super::RemoteCompileEvidence::latest_exact_compile_run(
            &runs, branch, sha,
        )
        .is_err());
        Ok(())
    }
}
