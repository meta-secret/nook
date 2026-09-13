use std::path::Path;

use crate::model::BootstrapEvidence;

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
        let feature_sha = &self.evidence.feature_head_sha;
        (RemoteCompileEvidence {
            repository: self.repository,
            branch: self.branch,
            feature_sha,
        })
        .validate()
        .await?;
        let workbench = (WorkbenchCompletionCheck {
            repository: self.repository,
            task_id,
            evidence: self.evidence,
        })
        .validate_workbench_completion()
        .await?;
        (LocalDevEvidence {
            repository: self.repository,
            origin_main_sha: &self.evidence.origin_main_sha,
            pinned_local_dev_sha: &self.evidence.pinned_local_dev_sha,
            feature_sha,
            local_dev_sha: &workbench.local_dev_sha,
        })
        .validate()
        .await
    }
}

impl MainRepairDelivery<'_> {
    /// Verifies the canonical exact-SHA promotion evidence needed when an
    /// obsolete blocker checks whether its repair owners are out of the
    /// dependency path. This does not reintroduce PR or squash semantics.
    pub(crate) async fn verify_main_repair_promotion_and_main(
        &self,
        task_id: &str,
    ) -> crate::HiveResult<()> {
        let feature_sha = &self.evidence.feature_head_sha;
        (RemoteCompileEvidence {
            repository: self.repository,
            branch: self.branch,
            feature_sha,
        })
        .validate()
        .await?;
        let workbench = (WorkbenchCompletionCheck {
            repository: self.repository,
            task_id,
            evidence: self.evidence,
        })
        .validate_main_promotion()
        .await?;
        (LocalDevEvidence {
            repository: self.repository,
            origin_main_sha: &self.evidence.origin_main_sha,
            pinned_local_dev_sha: &self.evidence.pinned_local_dev_sha,
            feature_sha,
            local_dev_sha: &workbench.local_dev_sha,
        })
        .validate()
        .await?;
        DeliveryCommand::run_git_status(
            self.repository,
            &["fetch", "--no-tags", "origin", "main"],
            "fetch canonical Main for exact promotion verification",
        )
        .await?;
        DeliveryCommand::run_git_status(
            self.repository,
            &[
                "merge-base",
                "--is-ancestor",
                workbench.local_dev_sha.as_str(),
                workbench.main_sha.as_str(),
            ],
            "verify canonical Main contains the exact tested local-dev SHA",
        )
        .await?;
        DeliveryCommand::run_git_status(
            self.repository,
            &[
                "merge-base",
                "--is-ancestor",
                workbench.main_sha.as_str(),
                "FETCH_HEAD",
            ],
            "verify canonical Main contains the exact promoted SHA",
        )
        .await
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
        let _retirement_method = MainRepairDelivery::verify_main_repair_promotion_and_main;
    }
}
