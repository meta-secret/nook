mod outcome;
use main_run::MainRunSelection;
use outcome::{CheckAdmission, RepositoryCheckSet};
mod check_state;
use check_state::{CheckConclusion, CheckExecution, RunConclusion, RunExecution};
pub(crate) struct MainRepairDelivery<'a> {
    pub(crate) repository: &'a std::path::Path,
    pub(crate) branch: &'a str,
}
use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;

use crate::HiveContext;
use serde::Deserialize;
use tokio::process::Command;

use self::command::DeliveryCommand;

use self::readiness::DeliveryReadiness;
use self::workbench::WorkbenchCompletionCheck;

mod command;
mod generation;
mod main_run;
mod readiness;
mod wire;
use generation::DeliveryGenerationSelection;
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Deserialize)]
#[serde(untagged)]
enum DeliveryMerge {
    Merged(DeliveryCommit),
    #[default]
    Unmerged,
}
impl DeliveryMerge {
    fn require_commit(&self) -> crate::HiveResult<&DeliveryCommit> {
        match self {
            Self::Merged(commit) => Ok(commit),
            Self::Unmerged => Err(crate::HiveError::message(
                "merged Hive pull request has no merge commit",
            )),
        }
    }
}

mod workbench;
use wire::WireDeliveryPullRequest;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(from = "WireDeliveryPullRequest")]
struct DeliveryPullRequest {
    number: u64,
    title: String,
    state: String,
    head_ref_name: String,
    head_ref_oid: String,
    is_cross_repository: bool,
    labels: Vec<DeliveryLabel>,
    merge_commit: DeliveryMerge,
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
    status: CheckExecution,
    #[serde(default, alias = "state")]
    conclusion: CheckConclusion,
    #[serde(default)]
    started_at: String,
    #[serde(default)]
    workflow_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeliveryRun {
    head_sha: String,
    status: RunExecution,
    conclusion: RunConclusion,
    created_at: String,
}

impl MainRepairDelivery<'_> {
    pub(crate) async fn verify_main_repair_delivery(&self, task_id: &str) -> crate::HiveResult<()> {
        let repository = self.repository;
        let branch = self.branch;
        let (pull_request, successful_main_sha) = (MainRepairDelivery { repository, branch })
            .main_repair_merge_and_main()
            .await?;
        pull_request.validate_repository_checks(MainMergeEvidence::SuccessfulDescendant)?;
        pull_request.validate_full_e2e_checks(MainMergeEvidence::SuccessfulDescendant)?;
        (DeliveryReadiness {
            repository,
            pull_request: &pull_request,
        })
        .validate_review_and_deployment_readiness()
        .await?;
        (WorkbenchCompletionCheck {
            repository,
            task_id,
            pull_request_number: pull_request.number,
            main_sha: successful_main_sha.as_str(),
        })
        .validate_workbench_completion()
        .await?;
        Ok(())
    }
}

impl MainRepairDelivery<'_> {
    pub(crate) async fn verify_main_repair_merge_and_main(&self) -> crate::HiveResult<()> {
        let repository = self.repository;
        let branch = self.branch;
        (MainRepairDelivery { repository, branch })
            .main_repair_merge_and_main()
            .await
            .map(|_| ())
    }
}

impl MainRepairDelivery<'_> {
    async fn main_repair_merge_and_main(&self) -> crate::HiveResult<(DeliveryPullRequest, String)> {
        let repository = self.repository;
        let branch = self.branch;
        let pull_requests: Vec<DeliveryPullRequest> = serde_json::from_str(
        &(DeliveryCommand { repository, arguments: &[
                "pr",
                "list",
                "--state",
                "all",
                "--limit",
                "1000",
                "--json",
                "number,title,state,headRefName,headRefOid,isCrossRepository,labels,mergeCommit,statusCheckRollup",
            ] }).gh_output()
        .await?,
    )
    .hive_context("GitHub returned invalid Hive pull request state")?;
        let pull_request = (DeliveryGenerationSelection {
            pull_requests: &pull_requests,
            branch: branch,
        })
        .latest_delivery_generation()?
        .require_delivery("Hive repair delivery is incomplete: no pull request generation exists")?
        .clone();

        (&pull_request).validate_hive_marker()?;
        (&pull_request).validate_merged_hive_pull_request()?;
        let merge_commit = pull_request.merge_commit.require_commit()?;

        DeliveryCommand::run_git_status(
            repository,
            &["fetch", "--depth=2147483647", "origin", "main"],
            "fetch Main delivery state",
        )
        .await?;
        DeliveryCommand::run_git_status(
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
        (&pull_request).validate_squash_merge(repository).await?;

        let mut runs: Vec<DeliveryRun> = serde_json::from_str(
            &(DeliveryCommand {
                repository,
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
                    "headSha,status,conclusion,createdAt",
                ],
            })
            .gh_output()
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
        let successful_main_sha = (MainRunSelection {
            runs: &applicable_runs,
            merge_commit: &merge_commit.oid,
        })
        .select_successful_main_run()?
        .to_owned();
        Ok((pull_request, successful_main_sha))
    }
}

impl DeliveryPullRequest {
    fn validate_hive_marker(&self) -> crate::HiveResult<()> {
        let pull_request = self;
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
}

impl DeliveryPullRequest {
    async fn validate_squash_merge(&self, repository: &Path) -> crate::HiveResult<()> {
        let pull_request = self;
        let merge_commit = pull_request.merge_commit.require_commit()?;
        let parents = DeliveryCommand::git_output(
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
        let subject = DeliveryCommand::git_output(
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
}

impl DeliveryPullRequest {
    fn validate_merged_hive_pull_request(&self) -> crate::HiveResult<()> {
        let pull_request = self;
        if pull_request.state != "MERGED" {
            return Err(crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: PR #{} is {}",
                pull_request.number, pull_request.state
            )));
        }
        if matches!(pull_request.merge_commit, DeliveryMerge::Unmerged) {
            return Err(crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: PR #{} has no squash merge",
                pull_request.number
            )));
        }
        Ok(())
    }
}

impl DeliveryPullRequest {
    fn validate_full_e2e_checks(&self, main_evidence: MainMergeEvidence) -> crate::HiveResult<()> {
        if !self.labels.iter().any(|label| label.name == "ci:full-e2e") {
            return Err(crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: PR #{} at {} lacks `ci:full-e2e`",
                self.number, self.head_ref_oid
            )));
        }
        for required_check in [
            "Full browser e2e (main fix)",
            "Full extension e2e (main fix)",
        ] {
            let matching = self
                .status_check_rollup
                .iter()
                .filter(|check| check.name == required_check)
                .collect::<Vec<_>>();
            if matches!(
                (CheckAcceptance {
                    checks: &matching,
                    main_evidence,
                })
                .admit(),
                CheckAdmission::Missing
            ) {
                return Err(crate::HiveError::message(format!(
                    "Hive repair delivery is incomplete: PR #{} at {} lacks successful exact-head `{}`",
                    self.number, self.head_ref_oid, required_check
                )));
            }
        }
        Ok(())
    }
}

impl DeliveryPullRequest {
    fn validate_repository_checks(
        &self,
        main_evidence: MainMergeEvidence,
    ) -> crate::HiveResult<()> {
        let verify_checks = self
            .status_check_rollup
            .iter()
            .filter(|check| check.name == "Verify and preview")
            .collect::<Vec<_>>();
        if matches!(
            (CheckAcceptance {
                checks: &verify_checks,
                main_evidence,
            })
            .admit(),
            CheckAdmission::Missing
        ) {
            return Err(crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: PR #{} at {} lacks successful exact-head `Verify and preview`",
                self.number, self.head_ref_oid
            )));
        }
        let mut repository_checks = HashMap::<&str, Vec<&DeliveryCheck>>::new();
        for check in &self.status_check_rollup {
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
                "Verify and preview"
                    | "Full browser e2e (main fix)"
                    | "Full extension e2e (main fix)"
            ) {
                continue;
            }
            RepositoryCheckSet {
                name,
                checks: &checks,
            }
            .validate()?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{CheckConclusion, MainMergeEvidence};
    use std::fs;
    use std::path;
    use std::process;

    use super::{DeliveryCheck, DeliveryCommit, DeliveryLabel, DeliveryPullRequest};

    impl DeliveryPullRequest {
        pub(in crate::delivery) fn fixture(
            number: u64,
            branch: &str,
            state: &str,
            merge_commit: super::DeliveryMerge,
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
                merge_commit,
                status_check_rollup: vec![
                    DeliveryCheck {
                        name: "Full browser e2e (main fix)".to_owned(),
                        status: "COMPLETED".into(),
                        conclusion: "SUCCESS".into(),
                        started_at: "2026-07-28T01:00:00Z".to_owned(),
                        workflow_name: "PR".to_owned(),
                    },
                    DeliveryCheck {
                        name: "Full extension e2e (main fix)".to_owned(),
                        status: "COMPLETED".into(),
                        conclusion: "SUCCESS".into(),
                        started_at: "2026-07-28T01:00:00Z".to_owned(),
                        workflow_name: "PR".to_owned(),
                    },
                    DeliveryCheck {
                        name: "Verify and preview".to_owned(),
                        status: "COMPLETED".into(),
                        conclusion: "SUCCESS".into(),
                        started_at: "2026-07-28T01:00:00Z".to_owned(),
                        workflow_name: "PR".to_owned(),
                    },
                ],
            }
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
        let mut marked = DeliveryPullRequest::fixture(
            42,
            "repair",
            "MERGED",
            super::DeliveryMerge::Merged(DeliveryCommit {
                oid: "pending".to_owned(),
            }),
        );
        (&marked).validate_hive_marker()?;
        marked.title = "repair without marker".to_owned();
        let title_error = (&marked)
            .validate_hive_marker()
            .err()
            .ok_or_else(|| crate::HiveError::message("unmarked delivery title was accepted"))?;
        assert!(title_error.to_string().contains("title marker"));
        marked.title = "[Hive] repair".to_owned();
        marked.labels.retain(|label| label.name != "hive");
        let label_error = (&marked)
            .validate_hive_marker()
            .err()
            .ok_or_else(|| crate::HiveError::message("unlabelled Hive delivery was accepted"))?;
        assert!(label_error.to_string().contains("lacks the `hive` label"));

        let repository = tempfile::tempdir()?;
        let missing_commit =
            DeliveryPullRequest::fixture(42, "repair", "MERGED", super::DeliveryMerge::Unmerged);
        let commit_error = (&missing_commit)
            .validate_squash_merge(repository.path())
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
        let root_delivery = DeliveryPullRequest::fixture(
            42,
            "repair",
            "MERGED",
            super::DeliveryMerge::Merged(DeliveryCommit {
                oid: root_commit.clone(),
            }),
        );
        let history_error = (&root_delivery)
            .validate_squash_merge(repository.path())
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
        let valid = DeliveryPullRequest::fixture(
            42,
            "repair",
            "MERGED",
            super::DeliveryMerge::Merged(DeliveryCommit {
                oid: valid_commit.clone(),
            }),
        );
        (&valid).validate_squash_merge(repository.path()).await?;

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
        let invalid = DeliveryPullRequest::fixture(
            42,
            "repair",
            "MERGED",
            super::DeliveryMerge::Merged(DeliveryCommit {
                oid: invalid_commit.clone(),
            }),
        );
        let subject_error = (&invalid)
            .validate_squash_merge(repository.path())
            .await
            .err()
            .ok_or_else(|| {
                crate::HiveError::message("squash commit without its PR suffix was accepted")
            })?;
        assert!(subject_error.to_string().contains("lacks PR suffix (#42)"));

        let mut checks = DeliveryPullRequest::fixture(
            42,
            "repair",
            "MERGED",
            super::DeliveryMerge::Merged(DeliveryCommit {
                oid: valid_commit.clone(),
            }),
        );
        checks.status_check_rollup.push(DeliveryCheck {
            name: "Security audit".to_owned(),
            status: "IN_PROGRESS".into(),
            conclusion: CheckConclusion::default(),
            started_at: "2026-09-04T01:00:00Z".to_owned(),
            workflow_name: "Security".to_owned(),
        });
        let pending = checks
            .validate_repository_checks(MainMergeEvidence::NotEstablished)
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
        let missing = missing_verify
            .validate_repository_checks(MainMergeEvidence::NotEstablished)
            .err()
            .ok_or_else(|| {
                crate::HiveError::message("missing repository verification was accepted")
            })?;
        assert!(missing.to_string().contains("Verify and preview"));

        let mut missing_e2e = checks.clone();
        missing_e2e
            .status_check_rollup
            .retain(|check| check.name != "Full browser e2e (main fix)");
        let missing = missing_e2e
            .validate_full_e2e_checks(MainMergeEvidence::NotEstablished)
            .err()
            .ok_or_else(|| crate::HiveError::message("missing browser e2e check was accepted"))?;
        assert!(missing.to_string().contains("Full browser e2e"));

        for conclusion in ["SKIPPED", "NEUTRAL"] {
            checks.status_check_rollup.push(DeliveryCheck {
                name: "Advisory".to_owned(),
                status: "COMPLETED".into(),
                conclusion: conclusion.into(),
                started_at: "2026-09-04T01:00:00Z".to_owned(),
                workflow_name: "Advisory".to_owned(),
            });
        }
        checks.validate_repository_checks(MainMergeEvidence::NotEstablished)?;
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
        assert_eq!(
            with_context.status_check_rollup[0].conclusion,
            CheckConclusion::Success
        );
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
        let error =
            (&DeliveryPullRequest::fixture(42, "repair", "OPEN", super::DeliveryMerge::Unmerged))
                .validate_merged_hive_pull_request()
                .err()
                .ok_or_else(|| {
                    crate::HiveError::message("an open pull request cannot complete a Hive task")
                })?;

        assert!(error.to_string().contains("PR #42 is OPEN"));
        Ok(())
    }

    #[test]
    fn delivery_requires_the_squash_merge_commit() -> anyhow::Result<()> {
        let error =
            (&DeliveryPullRequest::fixture(42, "repair", "MERGED", super::DeliveryMerge::Unmerged))
                .validate_merged_hive_pull_request()
                .err()
                .ok_or_else(|| {
                    crate::HiveError::message(
                        "a merge without its commit cannot prove Main delivery",
                    )
                })?;

        assert!(error.to_string().contains("no squash merge"));
        Ok(())
    }

    #[test]
    fn delivery_accepts_a_merged_pull_request_with_its_commit() -> crate::HiveResult<()> {
        (&DeliveryPullRequest::fixture(
            42,
            "repair",
            "MERGED",
            super::DeliveryMerge::Merged(DeliveryCommit {
                oid: "abc123".to_owned(),
            }),
        ))
            .validate_merged_hive_pull_request()?;
        Ok(())
    }

    #[test]
    fn delivery_requires_the_full_e2e_label() -> crate::HiveResult<()> {
        let mut pull_request = DeliveryPullRequest::fixture(
            42,
            "repair",
            "MERGED",
            super::DeliveryMerge::Merged(DeliveryCommit {
                oid: "abc123".to_owned(),
            }),
        );
        pull_request
            .labels
            .retain(|label| label.name != "ci:full-e2e");

        let error = pull_request
            .validate_full_e2e_checks(MainMergeEvidence::NotEstablished)
            .err()
            .ok_or_else(|| {
                crate::HiveError::message("a Hive repair without the opt-in label cannot complete")
            })?;

        assert!(error.to_string().contains("lacks `ci:full-e2e`"));
        Ok(())
    }

    #[test]
    fn merge_triggered_skipped_e2e_does_not_hide_pre_merge_success() -> crate::HiveResult<()> {
        let mut pull_request = DeliveryPullRequest::fixture(
            42,
            "repair",
            "MERGED",
            super::DeliveryMerge::Merged(DeliveryCommit {
                oid: "abc123".to_owned(),
            }),
        );
        pull_request.status_check_rollup.push(DeliveryCheck {
            name: "Full extension e2e (main fix)".to_owned(),
            status: "COMPLETED".into(),
            conclusion: "SKIPPED".into(),
            started_at: "2026-07-28T02:00:00Z".to_owned(),
            workflow_name: "PR".to_owned(),
        });

        pull_request.validate_full_e2e_checks(MainMergeEvidence::NotEstablished)?;
        Ok(())
    }

    #[test]
    fn repository_workflow_failure_without_success_is_rejected() -> crate::HiveResult<()> {
        let mut pull_request = DeliveryPullRequest::fixture(
            42,
            "repair",
            "MERGED",
            super::DeliveryMerge::Merged(DeliveryCommit {
                oid: "abc123".to_owned(),
            }),
        );
        pull_request.status_check_rollup.push(DeliveryCheck {
            name: "Hive Rust and infrastructure verification".to_owned(),
            status: "COMPLETED".into(),
            conclusion: "FAILURE".into(),
            started_at: "2026-07-28T02:00:00Z".to_owned(),
            workflow_name: "Hive".to_owned(),
        });

        let error = pull_request
            .validate_repository_checks(MainMergeEvidence::NotEstablished)
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
        let mut pull_request = DeliveryPullRequest::fixture(
            42,
            "repair",
            "MERGED",
            super::DeliveryMerge::Merged(DeliveryCommit {
                oid: "abc123".to_owned(),
            }),
        );
        for check in &mut pull_request.status_check_rollup {
            check.conclusion = "CANCELLED".into();
        }

        pull_request.validate_repository_checks(MainMergeEvidence::SuccessfulDescendant)?;
        pull_request.validate_full_e2e_checks(MainMergeEvidence::SuccessfulDescendant)?;
        Ok(())
    }

    #[test]
    fn successful_main_does_not_hide_a_failed_pr_check() -> crate::HiveResult<()> {
        let mut pull_request = DeliveryPullRequest::fixture(
            42,
            "repair",
            "MERGED",
            super::DeliveryMerge::Merged(DeliveryCommit {
                oid: "abc123".to_owned(),
            }),
        );
        pull_request.status_check_rollup[0].conclusion = "FAILURE".into();
        pull_request.status_check_rollup[1].conclusion = "CANCELLED".into();

        let error = pull_request
            .validate_full_e2e_checks(MainMergeEvidence::SuccessfulDescendant)
            .err()
            .ok_or_else(|| {
                crate::HiveError::message("a failed exact-head e2e run remains a delivery failure")
            })?;
        assert!(error.to_string().contains("Full browser e2e"));
        Ok(())
    }

    #[test]
    fn successful_main_does_not_replace_cancelled_hive_verification() -> crate::HiveResult<()> {
        let mut pull_request = DeliveryPullRequest::fixture(
            42,
            "repair",
            "MERGED",
            super::DeliveryMerge::Merged(DeliveryCommit {
                oid: "abc123".to_owned(),
            }),
        );
        pull_request.status_check_rollup.push(DeliveryCheck {
            name: "Hive Rust and infrastructure verification".to_owned(),
            status: "COMPLETED".into(),
            conclusion: "CANCELLED".into(),
            started_at: "2026-07-28T02:00:00Z".to_owned(),
            workflow_name: "Hive".to_owned(),
        });

        let error = pull_request
            .validate_repository_checks(MainMergeEvidence::SuccessfulDescendant)
            .err()
            .ok_or_else(|| {
                crate::HiveError::message("Main does not exercise Hive-only verification")
            })?;
        assert!(error.to_string().contains("Hive Rust"));
        Ok(())
    }
}

#[derive(Clone, Copy)]
enum MainMergeEvidence {
    NotEstablished,
    SuccessfulDescendant,
}

struct CheckAcceptance<'a> {
    checks: &'a [&'a DeliveryCheck],
    main_evidence: MainMergeEvidence,
}
