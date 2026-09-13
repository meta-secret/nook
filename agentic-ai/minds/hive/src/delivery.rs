use std::path::Path;

use crate::model::{BootstrapEvidence, GitSha};

use self::command::DeliveryCommand;
use self::local_dev::LocalDevEvidence;
use self::remote_compile::RemoteCompileEvidence;
use self::workbench::WorkbenchCompletionCheck;

mod command;
mod local_dev;
mod remote_compile;
mod workbench;

/// Evidence required before a Main-repair task can retire its worker lease.
///
/// A repair is a feature delivery. It is not an external-lifecycle producer: the
/// feature head must have a reviewed, exact-head build-only run and must be
/// present in the serialized local `dev` checkout. The Dev Manager owns the
/// later dev snapshot validation and promotion cycle.
pub(crate) struct MainRepairDelivery<'a> {
    pub(crate) repository: &'a Path,
    pub(crate) branch: &'a str,
    pub(crate) evidence: &'a BootstrapEvidence,
}

impl MainRepairDelivery<'_> {
    pub(crate) async fn verify_main_repair_delivery(
        &self,
        task_id: &str,
    ) -> crate::HiveResult<()> {
        let feature_sha = self.feature_head_sha().await?;
        (RemoteCompileEvidence {
            repository: self.repository,
            origin_main_sha: &self.evidence.origin_main_sha,
            pinned_local_dev_sha: &self.evidence.pinned_local_dev_sha,
            feature_sha,
        })
        .validate()
        .await?;
        (LocalDevEvidence {
            repository: self.repository,
            origin_main_sha: &self.evidence.origin_main_sha,
            pinned_local_dev_sha: &self.evidence.pinned_local_dev_sha,
            feature_sha,
        })
        .validate()
        .await?;
        (WorkbenchCompletionCheck {
            repository: self.repository,
            task_id,
            feature_sha,
        })
        .validate_workbench_completion()
        .await
    }
}

impl MainRepairDelivery<'_> {
    /// Verifies the subset needed when a blocker checks whether its repair
    /// owners are already out of the dependency path.
    pub(crate) async fn verify_main_repair_merge_and_main(&self) -> crate::HiveResult<()> {
        let feature_sha = self.feature_head_sha().await?;
        (RemoteCompileEvidence {
            repository: self.repository,
            origin_main_sha: &self.evidence.origin_main_sha,
            pinned_local_dev_sha: &self.evidence.pinned_local_dev_sha,
            feature_sha,
        })
        .validate()
        .await?;
        (LocalDevEvidence {
            repository: self.repository,
            origin_main_sha: &self.evidence.origin_main_sha,
            pinned_local_dev_sha: &self.evidence.pinned_local_dev_sha,
            feature_sha,
        })
        .validate()
        .await
    }
}

impl MainRepairDelivery<'_> {
    async fn feature_head_sha(&self) -> crate::HiveResult<&GitSha> {
        let current_head = DeliveryCommand::git_output(self.repository, &["rev-parse", "HEAD"])
            .await?;
        let feature_head = self.evidence.feature_head_sha.as_str();
        if current_head != feature_head {
            return Err(crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: detached workspace HEAD {} does not equal exact feature head {}",
                current_head, feature_head
            )));
        }
        Ok(&self.evidence.feature_head_sha)
    }
}

#[cfg(test)]
mod tests {
    use super::MainRepairDelivery;

    #[test]
    fn feature_delivery_wires_the_canonical_evidence_layers() {
        let source = include_str!("delivery.rs");
        assert!(source.contains("RemoteCompileEvidence"));
        assert!(source.contains("LocalDevEvidence"));
        assert!(source.contains("WorkbenchCompletionCheck"));
    }

    #[test]
    fn repair_delivery_keeps_the_worker_call_surface() {
        let _delivery_method = MainRepairDelivery::verify_main_repair_delivery;
        let _retirement_method = MainRepairDelivery::verify_main_repair_merge_and_main;
    }
}
