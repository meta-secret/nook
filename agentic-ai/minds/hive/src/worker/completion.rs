use crate::model::{ClaimedTask, CompletionArtifact, CompletionRelevance, TaskId, TerminalResult};

pub(super) struct TaskCompletionProposal<'a> {
    pub(super) task: &'a ClaimedTask,
    pub(super) result: &'a TerminalResult,
}
pub(super) enum CompletionPlan<'a> {
    Regular,
    ObsoleteRetirement { owning_repairs: &'a [TaskId] },
}
pub(super) struct AdmittedCompletionArtifact {
    pub(super) relevance: CompletionRelevance,
    pub(super) artifact: CompletionArtifact,
}

impl<'a> TaskCompletionProposal<'a> {
    pub(super) fn admit(self) -> crate::HiveResult<CompletionPlan<'a>> {
        match self
            .task
            .kind
            .completion_relevance(self.result.completion_relevance())
        {
            CompletionRelevance::Current => Ok(CompletionPlan::Regular),
            CompletionRelevance::Obsolete => {
                if self.task.owning_repairs.is_empty() {
                    return Err(crate::HiveError::message(
                        "obsolete blocker retirement requires active owning Main repairs",
                    ));
                }
                if !self.result.changed_files().is_empty() {
                    return Err(crate::HiveError::message(
                        "obsolete blocker retirement cannot report changed files",
                    ));
                }
                Ok(CompletionPlan::ObsoleteRetirement {
                    owning_repairs: &self.task.owning_repairs,
                })
            }
        }
    }
}

impl CompletionPlan<'_> {
    pub(super) fn admit_artifact(
        self,
        artifact: CompletionArtifact,
    ) -> crate::HiveResult<AdmittedCompletionArtifact> {
        match self {
            Self::Regular => Ok(AdmittedCompletionArtifact {
                relevance: CompletionRelevance::Current,
                artifact,
            }),
            Self::ObsoleteRetirement { .. } => match artifact {
                CompletionArtifact::NotProduced => Ok(AdmittedCompletionArtifact {
                    relevance: CompletionRelevance::Obsolete,
                    artifact: CompletionArtifact::NotProduced,
                }),
                CompletionArtifact::Produced(_) => Err(crate::HiveError::message(
                    "obsolete blocker retirement cannot persist a patch artifact",
                )),
            },
        }
    }
}

impl CompletionPlan<'_> {
    pub(super) async fn verify_owner_deliveries(
        &self,
        repository: &std::path::Path,
    ) -> crate::HiveResult<()> {
        use crate::HiveContext;
        if let Self::ObsoleteRetirement { owning_repairs } = self {
            for owner in *owning_repairs {
                crate::delivery::MainRepairDelivery { repository, branch: &owner.repair_branch_name() }
 .verify_main_repair_merge_and_main().await.hive_context(format!("obsolete blocker retirement requires a merged repair and green Main for owner {owner}"))?;
            }
        }
        Ok(())
    }
}
