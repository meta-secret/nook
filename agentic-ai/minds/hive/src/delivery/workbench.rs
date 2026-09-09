pub struct WorkbenchCompletionCheck<'scan> {
    pub repository: &'scan Path,
    pub task_id: &'scan str,
    pub pull_request_number: u64,
    pub main_sha: &'scan str,
}
use std::path::Path;

use super::command::DeliveryCommand;

impl WorkbenchCompletionCheck<'_> {
    pub async fn validate_workbench_completion(self) -> crate::HiveResult<()> {
        let Self {
            repository,
            task_id,
            pull_request_number,
            main_sha,
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
            repository: repository,
            arguments: &[
                "api",
                "-H",
                "Accept: application/vnd.github.raw+json",
                endpoint.as_str(),
            ],
        })
        .gh_output()
        .await?;
        let completed_status = incident.lines().any(|line| {
            matches!(
                line.trim(),
                "status: completed" | "status: complete" | "status: done"
            )
        });
        if !completed_status {
            return Err(crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: Workbench incident {task_base}.md is not completed"
            )));
        }
        if !incident.contains(&format!("#{pull_request_number}"))
            && !incident.contains(&format!("/pull/{pull_request_number}"))
        {
            return Err(crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: Workbench incident does not link PR #{pull_request_number}"
            )));
        }
        if !incident.contains(main_sha) {
            return Err(crate::HiveError::message(format!(
                "Hive repair delivery is incomplete: Workbench incident does not record green Main SHA {main_sha}"
            )));
        }
        if !incident.to_ascii_lowercase().contains("worklog") {
            return Err(crate::HiveError::message(
                "Hive repair delivery is incomplete: Workbench incident has no linked worklog",
            ));
        }
        Ok(())
    }
}
