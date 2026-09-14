use std::path::Path;

use super::command::DeliveryCommand;
use crate::model::{BootstrapEvidence, FeatureBranch, GitSha};

/// The exact structured lines written to a Workbench incident are the only
/// accepted completion evidence. Human prose and substring markers are not
/// evidence. The packet supplied by the coordinator remains authoritative for
/// the creation-base SHAs and canonical feature branch; Workbench may only
/// repeat those identities exactly.
pub(super) struct WorkbenchCompletionCheck<'a> {
    pub(super) repository: &'a Path,
    pub(super) task_id: &'a str,
    pub(super) evidence: &'a BootstrapEvidence,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct WorkbenchLocalDevEvidence {
    pub(super) local_dev_sha: GitSha,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct WorkbenchMainPromotionEvidence {
    pub(super) local_dev_sha: GitSha,
    pub(super) main_sha: GitSha,
}

impl WorkbenchCompletionCheck<'_> {
    pub(super) async fn validate_workbench_completion(
        &self,
    ) -> crate::HiveResult<WorkbenchLocalDevEvidence> {
        let incident = self.load_incident().await?;
        self.parse_completion_incident(&incident)
    }

    /// Obsolete blocker retirement has no owner review or Workbench terminal
    /// handoff requirement. It does require canonical exact-SHA evidence that
    /// the tested local-dev commit was promoted fast-forward to Main and had a
    /// successful Main run.
    pub(super) async fn validate_main_promotion(
        &self,
    ) -> crate::HiveResult<WorkbenchMainPromotionEvidence> {
        let incident = self.load_incident().await?;
        self.parse_main_promotion_incident(&incident)
    }

    async fn load_incident(&self) -> crate::HiveResult<String> {
        let task_base = self.task_id.split("-run-").next().unwrap_or(self.task_id);
        if !task_base.starts_with("main-failure-") {
            return Err(crate::HiveError::message(
                "Hive repair task id does not identify its Workbench incident",
            ));
        }
        let endpoint = format!(
            "repos/meta-secret/nook-workbench/contents/issues/hive-isolated-agent-platform/{task_base}.md?ref=main"
        );
        (DeliveryCommand {
            repository: self.repository,
            arguments: &[
                "api",
                "-H",
                "Accept: application/vnd.github.raw+json",
                endpoint.as_str(),
            ],
        })
        .gh_output()
        .await
    }
}

impl WorkbenchCompletionCheck<'_> {
    fn parse_completion_incident(
        &self,
        incident: &str,
    ) -> crate::HiveResult<WorkbenchLocalDevEvidence> {
        self.parse_packet(incident)?;
        let status = Self::exact_field(incident, "status")?;
        if status != "done" {
            return Err(crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: Workbench status must be exactly `done`, got `{status}`"
            )));
        }
        let review_branch = Self::parse_review_line(incident)?;
        self.require_feature_branch("review", &review_branch)?;
        let worklog_branch = Self::parse_worklog_line(incident)?;
        self.require_feature_branch("worklog", &worklog_branch)?;
        let (landed_feature_branch, local_dev_sha) = Self::parse_dev_land_line(incident)?;
        self.require_feature_branch("dev:land", &landed_feature_branch)?;
        Ok(WorkbenchLocalDevEvidence { local_dev_sha })
    }

    fn parse_main_promotion_incident(
        &self,
        incident: &str,
    ) -> crate::HiveResult<WorkbenchMainPromotionEvidence> {
        self.parse_packet(incident)?;
        let (landed_feature_branch, local_dev_sha) = Self::parse_dev_land_line(incident)?;
        self.require_feature_branch("dev:land", &landed_feature_branch)?;
        let (tested_dev_sha, main_sha) = Self::parse_promotion_line(incident)?;
        if tested_dev_sha != local_dev_sha {
            return Err(crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: dev:promote testedDevSha {tested_dev_sha} does not equal dev:land localDevSha {local_dev_sha}"
            )));
        }
        let successful_main_sha = Self::parse_main_success_line(incident)?;
        if successful_main_sha != main_sha {
            return Err(crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: successful Main headSha {successful_main_sha} does not equal promoted mainSha {main_sha}"
            )));
        }
        Ok(WorkbenchMainPromotionEvidence {
            local_dev_sha,
            main_sha,
        })
    }

    fn parse_packet(&self, incident: &str) -> crate::HiveResult<()> {
        let origin_main_sha = Self::parse_sha_field(incident, "originMainSha")?;
        Self::require_packet_sha(
            "originMainSha",
            &origin_main_sha,
            &self.evidence.origin_main_sha,
        )?;
        let pinned_local_dev_sha = Self::parse_sha_field(incident, "pinnedLocalDevSha")?;
        Self::require_packet_sha(
            "pinnedLocalDevSha",
            &pinned_local_dev_sha,
            &self.evidence.pinned_local_dev_sha,
        )?;
        let feature_branch = Self::parse_branch_field(incident, "featureBranch")?;
        self.require_feature_branch("packet", &feature_branch)
    }

    fn require_packet_sha(
        field: &str,
        actual: &GitSha,
        expected: &GitSha,
    ) -> crate::HiveResult<()> {
        if actual != expected {
            return Err(crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: Workbench {field} does not match the typed bootstrap packet"
            )));
        }
        Ok(())
    }

    fn require_feature_branch(
        &self,
        evidence: &str,
        actual: &FeatureBranch,
    ) -> crate::HiveResult<()> {
        if actual != &self.evidence.feature_branch {
            return Err(crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: Workbench {evidence} evidence is bound to a different feature branch"
            )));
        }
        Ok(())
    }

    fn exact_field<'a>(incident: &'a str, field: &str) -> crate::HiveResult<&'a str> {
        let prefix = format!("{field}: ");
        let mut matches = incident.lines().filter(|line| line.starts_with(&prefix));
        let value = matches.next().ok_or_else(|| {
            crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: Workbench is missing exact `{field}: ...` evidence"
            ))
        })?;
        if matches.next().is_some() {
            return Err(crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: Workbench has duplicate `{field}: ...` evidence"
            )));
        }
        value.strip_prefix(&prefix).ok_or_else(|| {
            crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: Workbench exact `{field}: ...` evidence is malformed"
            ))
        })
    }

    fn exact_operation_line<'a>(incident: &'a str, field: &str) -> crate::HiveResult<&'a str> {
        let mut matches = incident.lines().filter(|line| line.starts_with(field));
        let line = matches.next().ok_or_else(|| {
            crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: Workbench is missing exact `{field} ...` evidence"
            ))
        })?;
        if matches.next().is_some() {
            return Err(crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: Workbench has duplicate or conflicting `{field} ...` evidence"
            )));
        }
        Ok(line)
    }

    fn parse_sha(value: &str, field: &str) -> crate::HiveResult<GitSha> {
        let sha = GitSha::try_from(value).map_err(|error| {
            crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: Workbench {field} is not a full Git SHA: {error}"
            ))
        })?;
        if sha.as_str() != value {
            return Err(crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: Workbench {field} must use lowercase canonical Git SHA text"
            )));
        }
        Ok(sha)
    }

    fn parse_sha_field(incident: &str, field: &str) -> crate::HiveResult<GitSha> {
        let value = Self::exact_field(incident, field)?;
        Self::parse_sha(value, field)
    }

    fn parse_branch_field(incident: &str, field: &str) -> crate::HiveResult<FeatureBranch> {
        let value = Self::exact_field(incident, field)?;
        FeatureBranch::try_from(value).map_err(|error| {
            crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: Workbench {field} is not a canonical feature branch: {error}"
            ))
        })
    }

    fn parse_review_line(incident: &str) -> crate::HiveResult<FeatureBranch> {
        let line = Self::exact_operation_line(incident, "review:")?;
        let value = line.strip_prefix("review: approved featureBranch=").ok_or_else(|| {
            crate::HiveError::message(
                "Hive repair delivery is incomplete: Workbench review evidence must be exactly `review: approved featureBranch=<branch>`",
            )
        })?;
        FeatureBranch::try_from(value).map_err(|error| {
            crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: Workbench review featureBranch is invalid: {error}"
            ))
        })
    }

    fn parse_worklog_line(incident: &str) -> crate::HiveResult<FeatureBranch> {
        let line = Self::exact_operation_line(incident, "worklog:")?;
        let value = line.strip_prefix("worklog: linked featureBranch=").ok_or_else(|| {
            crate::HiveError::message(
                "Hive repair delivery is incomplete: Workbench worklog evidence must be exactly `worklog: linked featureBranch=<branch>`",
            )
        })?;
        FeatureBranch::try_from(value).map_err(|error| {
            crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: Workbench worklog featureBranch is invalid: {error}"
            ))
        })
    }

    fn parse_dev_land_line(incident: &str) -> crate::HiveResult<(FeatureBranch, GitSha)> {
        let line = Self::exact_operation_line(incident, "dev:land:")?;
        let value = line.strip_prefix("dev:land: ").ok_or_else(|| {
            crate::HiveError::message(
                "Hive repair delivery is incomplete: Workbench dev:land evidence has an invalid shape",
            )
        })?;
        let (outcome, value) = value.split_once(" featureBranch=").ok_or_else(|| {
            crate::HiveError::message(
                "Hive repair delivery is incomplete: Workbench dev:land evidence must bind featureBranch and localDevSha",
            )
        })?;
        if !matches!(outcome, "landed" | "already-present") {
            return Err(crate::HiveError::message(
                "Hive repair delivery is incomplete: Workbench dev:land outcome is not an accepted exact landing result",
            ));
        }
        let (feature_branch, local_dev_sha) = value.split_once(" localDevSha=").ok_or_else(|| {
            crate::HiveError::message(
                "Hive repair delivery is incomplete: Workbench dev:land evidence must bind featureBranch and localDevSha",
            )
        })?;
        Ok((
            FeatureBranch::try_from(feature_branch).map_err(|error| {
                crate::HiveError::message(format!(
                    "Hive repair delivery is incomplete: Workbench dev:land featureBranch is invalid: {error}"
                ))
            })?,
            Self::parse_sha(local_dev_sha, "dev:land localDevSha")?,
        ))
    }

    fn parse_promotion_line(incident: &str) -> crate::HiveResult<(GitSha, GitSha)> {
        let line = Self::exact_operation_line(incident, "dev:promote:")?;
        let value = line.strip_prefix("dev:promote: fast-forward testedDevSha=").ok_or_else(|| {
            crate::HiveError::message(
                "Hive repair delivery is incomplete: Workbench promotion evidence must be exactly `dev:promote: fast-forward testedDevSha=<sha> mainSha=<sha>`",
            )
        })?;
        let (tested_dev_sha, main_sha) = value.split_once(" mainSha=").ok_or_else(|| {
            crate::HiveError::message(
                "Hive repair delivery is incomplete: Workbench promotion evidence must bind mainSha",
            )
        })?;
        Ok((
            Self::parse_sha(tested_dev_sha, "dev:promote testedDevSha")?,
            Self::parse_sha(main_sha, "dev:promote mainSha")?,
        ))
    }

    fn parse_main_success_line(incident: &str) -> crate::HiveResult<GitSha> {
        let line = Self::exact_operation_line(incident, "main:")?;
        let value = line.strip_prefix("main: success headSha=").ok_or_else(|| {
            crate::HiveError::message(
                "Hive repair delivery is incomplete: Workbench Main evidence must be exactly `main: success headSha=<sha>`",
            )
        })?;
        Self::parse_sha(value, "main headSha")
    }
}

#[cfg(test)]
mod tests {
    use super::{WorkbenchCompletionCheck, WorkbenchMainPromotionEvidence};
    use crate::model::{BootstrapEvidence, FeatureBranch, GitSha};
    use std::path::Path;

    const ORIGIN: &str = "0000000000000000000000000000000000000001";
    const PINNED: &str = "0000000000000000000000000000000000000002";
    const FEATURE_BRANCH: &str = "codex/repair-cache";
    const LOCAL_DEV: &str = "0000000000000000000000000000000000000004";
    const MAIN: &str = "0000000000000000000000000000000000000005";

    fn check() -> crate::HiveResult<WorkbenchCompletionCheck<'static>> {
        let evidence = Box::leak(Box::new(BootstrapEvidence {
            origin_main_sha: GitSha::try_from(ORIGIN)?,
            pinned_local_dev_sha: GitSha::try_from(PINNED)?,
            feature_branch: FeatureBranch::try_from(FEATURE_BRANCH)?,
        }));
        Ok(WorkbenchCompletionCheck {
            repository: Path::new("."),
            task_id: "main-failure-42-run-1",
            evidence,
        })
    }

    fn complete_incident() -> String {
        format!(
            "status: done\noriginMainSha: {ORIGIN}\npinnedLocalDevSha: {PINNED}\nfeatureBranch: {FEATURE_BRANCH}\nreview: approved featureBranch={FEATURE_BRANCH}\nworklog: linked featureBranch={FEATURE_BRANCH}\ndev:land: landed featureBranch={FEATURE_BRANCH} localDevSha={LOCAL_DEV}\n"
        )
    }

    #[test]
    fn completed_workbench_requires_exact_bound_evidence() -> crate::HiveResult<()> {
        let check = check()?;
        let evidence = check.parse_completion_incident(&complete_incident())?;
        assert_eq!(evidence.local_dev_sha.as_str(), LOCAL_DEV);
        Ok(())
    }

    #[test]
    fn negated_stale_and_substring_markers_fail_closed() -> crate::HiveResult<()> {
        for incident in [
            complete_incident().replace("status: done", "status: not done"),
            complete_incident().replace(
                &format!("review: approved featureBranch={FEATURE_BRANCH}"),
                &format!("review: not approved featureBranch={FEATURE_BRANCH}"),
            ),
            complete_incident().replace(
                &format!("dev:land: landed featureBranch={FEATURE_BRANCH}"),
                &format!("dev:land: failed featureBranch={FEATURE_BRANCH}"),
            ),
            complete_incident().replace(
                &format!("worklog: linked featureBranch={FEATURE_BRANCH}"),
                "worklog: linked featureBranch=codex/other-branch",
            ),
            complete_incident().replace("status: done", "status: done-ish"),
        ] {
            assert!(check()?.parse_completion_incident(&incident).is_err());
        }
        Ok(())
    }

    #[test]
    fn obsolete_retirement_uses_exact_promotion_and_main_sha_evidence() -> crate::HiveResult<()> {
        let check = check()?;
        let incident = format!(
            "originMainSha: {ORIGIN}\npinnedLocalDevSha: {PINNED}\nfeatureBranch: {FEATURE_BRANCH}\ndev:land: already-present featureBranch={FEATURE_BRANCH} localDevSha={LOCAL_DEV}\ndev:promote: fast-forward testedDevSha={LOCAL_DEV} mainSha={LOCAL_DEV}\nmain: success headSha={LOCAL_DEV}\n"
        );
        let evidence = check.parse_main_promotion_incident(&incident)?;
        assert_eq!(
            evidence,
            WorkbenchMainPromotionEvidence {
                local_dev_sha: GitSha::try_from(LOCAL_DEV)?,
                main_sha: GitSha::try_from(LOCAL_DEV)?,
            }
        );
        Ok(())
    }

    #[test]
    fn promotion_rejects_a_different_tested_sha() -> crate::HiveResult<()> {
        let check = check()?;
        let incident = format!(
            "originMainSha: {ORIGIN}\npinnedLocalDevSha: {PINNED}\nfeatureBranch: {FEATURE_BRANCH}\ndev:land: landed featureBranch={FEATURE_BRANCH} localDevSha={LOCAL_DEV}\ndev:promote: fast-forward testedDevSha={MAIN} mainSha={MAIN}\nmain: success headSha={MAIN}\n"
        );
        assert!(check.parse_main_promotion_incident(&incident).is_err());
        Ok(())
    }

    #[test]
    fn promotion_accepts_a_later_successful_main_descendant() -> crate::HiveResult<()> {
        let check = check()?;
        let incident = format!(
            "originMainSha: {ORIGIN}\npinnedLocalDevSha: {PINNED}\nfeatureBranch: {FEATURE_BRANCH}\ndev:land: already-present featureBranch={FEATURE_BRANCH} localDevSha={LOCAL_DEV}\ndev:promote: fast-forward testedDevSha={LOCAL_DEV} mainSha={MAIN}\nmain: success headSha={MAIN}\n"
        );
        let evidence = check.parse_main_promotion_incident(&incident)?;
        assert_eq!(evidence.local_dev_sha.as_str(), LOCAL_DEV);
        assert_eq!(evidence.main_sha.as_str(), MAIN);
        Ok(())
    }
}
