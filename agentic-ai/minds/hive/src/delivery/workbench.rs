use std::path::Path;

use super::command::DeliveryCommand;
use crate::model::GitSha;

/// Reviews and records the terminal Workbench handoff for a feature delivery.
///
/// Workbench is the durable review surface for Hive. It carries the exact
/// feature head and local-dev landing evidence; it does not identify an
/// external lifecycle object.
pub(super) struct WorkbenchCompletionCheck<'a> {
    pub(super) repository: &'a Path,
    pub(super) task_id: &'a str,
    pub(super) feature_sha: &'a GitSha,
}

impl WorkbenchCompletionCheck<'_> {
    pub(super) async fn validate_workbench_completion(self) -> crate::HiveResult<()> {
        let Self {
            repository,
            task_id,
            feature_sha,
        } = self;
        let task_base = task_id.split("-run-").next().unwrap_or(task_id);
        if !task_base.starts_with("main-failure-") {
            return Err(crate::HiveError::message(
                "Hive repair task id does not identify its Workbench incident",
            ));
        }
        let endpoint = format!(
            "repos/meta-secret/nook-workbench/contents/issues/hive-isolated-agent-platform/{task_base}.md"
        );
        let incident = (DeliveryCommand {
            repository,
            arguments: &[
                "api",
                "-H",
                "Accept: application/vnd.github.raw+json",
                endpoint.as_str(),
            ],
        })
        .gh_output()
        .await?;
        if !Self::has_completed_status(&incident) {
            return Err(crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: Workbench incident {task_base}.md is not completed"
            )));
        }
        if !incident.contains(feature_sha.as_str()) {
            return Err(crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: Workbench incident does not record feature head {feature_sha}"
            )));
        }
        if !incident.to_ascii_lowercase().contains("worklog") {
            return Err(crate::HiveError::message(
                "Hive repair delivery is incomplete: Workbench incident has no linked worklog",
            ));
        }
        if !Self::has_review_approval(&incident) {
            return Err(crate::HiveError::message(
                "Hive repair delivery is incomplete: Workbench incident has no approved feature review",
            ));
        }
        if !Self::has_local_dev_landing(&incident) {
            return Err(crate::HiveError::message(
                "Hive repair delivery is incomplete: Workbench incident has no serialized dev:land evidence",
            ));
        }
        Ok(())
    }
}

impl WorkbenchCompletionCheck<'_> {
    fn has_completed_status(incident: &str) -> bool {
        incident.lines().any(|line| {
            matches!(
                line.trim(),
                "status: completed" | "status: complete" | "status: done"
            )
        })
    }

    fn has_review_approval(incident: &str) -> bool {
        incident.lines().any(|line| {
            let line = line.to_ascii_lowercase();
            line.contains("review")
                && (line.contains("approved")
                    || line.contains("accepted")
                    || line.contains("resolved"))
        })
    }

    fn has_local_dev_landing(incident: &str) -> bool {
        incident.lines().any(|line| {
            let line = line.to_ascii_lowercase();
            line.contains("dev:land")
                && (line.contains("success")
                    || line.contains("complete")
                    || line.contains("landed"))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::WorkbenchCompletionCheck;

    #[test]
    fn completed_workbench_requires_review_and_local_landing_markers() {
        let sha = "0123456789012345678901234567890123456789";
        let incident = format!(
            "status: completed\nfeatureHeadSha: {sha}\nreview: approved\ndev:land: success\nworklog: linked\n"
        );
        assert!(WorkbenchCompletionCheck::has_completed_status(&incident));
        assert!(WorkbenchCompletionCheck::has_review_approval(&incident));
        assert!(WorkbenchCompletionCheck::has_local_dev_landing(&incident));
        assert!(incident.contains(sha));
    }

    #[test]
    fn review_or_landing_without_approval_does_not_complete_delivery() {
        let incident = "status: completed\nreview: changes requested\ndev:land: success\nworklog: linked\n";
        assert!(!WorkbenchCompletionCheck::has_review_approval(incident));
        assert!(WorkbenchCompletionCheck::has_local_dev_landing(incident));
    }

    #[test]
    fn terminal_handoff_uses_feature_sha_not_external_lifecycle() {
        let sha = "0123456789012345678901234567890123456789";
        let incident = format!(
            "status: complete\nfeatureHeadSha: {sha}\nreview: accepted\ndev:land: landed\nworklog: linked\n"
        );
        assert!(WorkbenchCompletionCheck::has_review_approval(&incident));
        assert!(WorkbenchCompletionCheck::has_local_dev_landing(&incident));
    }
}
