use std::path::Path;

use super::command::gh_output;

pub(super) async fn validate_workbench_completion(
    repository: &Path,
    task_id: &str,
    pull_request_number: u64,
    main_sha: &str,
) -> crate::HiveResult<()> {
    let task_base = task_id.split("-run-").next().unwrap_or(task_id);
    crate::hive_ensure!(
        task_base.starts_with("main-failure-"),
        "Hive repair task id does not identify its Workbench incident"
    );
    let endpoint = format!(
        "repos/meta-secret/nook-workbench/contents/issues/hive-isolated-agent-platform/{task_base}.md"
    );
    let incident = gh_output(
        repository,
        &[
            "api",
            "-H",
            "Accept: application/vnd.github.raw+json",
            endpoint.as_str(),
        ],
    )
    .await?;
    let completed_status = incident.lines().any(|line| {
        matches!(
            line.trim(),
            "status: completed" | "status: complete" | "status: done"
        )
    });
    crate::hive_ensure!(
        completed_status,
        "Hive repair delivery is incomplete: Workbench incident {task_base}.md is not completed"
    );
    crate::hive_ensure!(
        incident.contains(&format!("#{pull_request_number}"))
            || incident.contains(&format!("/pull/{pull_request_number}")),
        "Hive repair delivery is incomplete: Workbench incident does not link PR #{pull_request_number}"
    );
    crate::hive_ensure!(
        incident.contains(main_sha),
        "Hive repair delivery is incomplete: Workbench incident does not record green Main SHA {main_sha}"
    );
    crate::hive_ensure!(
        incident.to_ascii_lowercase().contains("worklog"),
        "Hive repair delivery is incomplete: Workbench incident has no linked worklog"
    );
    Ok(())
}
