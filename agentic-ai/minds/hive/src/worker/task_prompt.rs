use std::path::Path;

use crate::HiveContext;
use crate::delivery::verify_main_repair_merge_and_main;
use crate::model::{ClaimedTask, TaskId};

pub(super) fn task_prompt(task: &ClaimedTask) -> String {
    let owning_repairs = if task.owning_repairs.is_empty() {
        "No active owning Main repairs.".to_owned()
    } else {
        task.owning_repairs
            .iter()
            .map(|owner| {
                format!(
                    "- {} (delivery branch `{}`)",
                    owner,
                    repair_branch_name(owner.as_str())
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    let dependencies = if task.dependency_context.is_empty() {
        "No dependency results.".to_owned()
    } else {
        task.dependency_context
            .iter()
            .map(|dependency| format!("- {}: {}", dependency.id, dependency.summary))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let delivery = if task.kind == "main-repair" {
        let branch = repair_branch_name(task.id.as_str());
        format!(
            "\n\nThis is an end-to-end Main repair. You own it until delivery is complete. \
         You are a trusted operator with direct GitHub access through `GH_TOKEN`. Use standard \
         `git`, `gh`, and repository Taskfile commands; run `gh auth setup-git` before the first \
         authenticated Git push. Reuse or create the deterministic branch \
         `{branch}` (or the next `-gN` generation after a closed or red-Main delivery), publish \
         the repair PR with a `[Hive]` title and both the `hive` and \
         `ci:full-e2e` labels, traverse all \
         checks and review feedback, fix and reply \
         to every actionable item, run `task hive:guest:pr:ready PR=<number>` for the exact-head \
         readiness audit, squash-merge, verify the \
         resulting Main workflow is green, and publish the required Workbench completion records \
         and statistics. Inspect GitHub first because a replacement Pod may be resuming a branch, \
         PR, merge, or Main verification completed by an earlier attempt. A merged generation is \
         not finished when it has unresolved actionable review: create the next `-gN` delivery \
         branch from current `origin/main`, implement the follow-up there, open and own a new \
         marked Hive PR, then reply to the original review threads with the follow-up link. Keep \
         those original threads unresolved until the follow-up is successfully merged, then resolve \
         them before reporting completion. Do not repeatedly audit an immutable merged branch. Do not report completed \
         before the squash merge and green Main verification. If blocked by another change, report \
         structured blocked status and identify the blocker precisely."
        )
    } else if task.kind == "blocker" {
        "\n\nThis is a prerequisite-ownership task, not a passive wait instruction. Resolve the \
         prerequisite yourself using the available repository and GitHub access. When the task \
         names a GitHub Actions run, inspect its current terminal state and failed logs; if it \
         belongs to an open repair PR, check out that existing PR branch, fix it there, push a \
         replacement exact-head run, and follow it to a terminal result. Before doing work or \
         reporting another blocker, inspect every active owning Main repair listed below. Only when \
         every listed repair has already been merged and has a successful Main run containing its \
         merge is this prerequisite obsolete: report completed with `obsolete` set to true, no \
         changes, and explain that it no longer blocks delivery, even when the requested capability \
         remains unavailable. For every genuine prerequisite completion and every non-blocker task, \
         set `obsolete` to false. When no owning repair is listed, or any listed repair is still \
         live, do not use this obsolescence rule. This task is a dependency leaf. Never request \
         another blocker and never create a duplicate repair PR. If the prerequisite cannot be \
         completed with the authority and tools already supplied, report failed with a precise \
         explanation, `obsolete` set to false, and `blocker.present` set to false with empty \
         blocker details. Hive records that as a bounded failed attempt without creating a child \
         task."
            .to_owned()
    } else {
        String::new()
    };
    format!(
        "You are Hive worker attempt {} for task {}.\n\
         Work only inside the supplied repository workspace.\n\
         Complete the task and return the required structured terminal result.\n\n\
         Task kind: {}\n\
         Task:\n{}\n\n\
         Active owning Main repairs:\n{}\n\n\
         Completed dependency context:\n{}{}",
        task.attempt_number,
        task.id,
        task.kind,
        task.prompt,
        owning_repairs,
        dependencies,
        delivery
    )
}

pub(super) fn repair_branch_name(task_id: &str) -> String {
    let slug = task_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>();
    format!("codex/hive-{}", slug.trim_matches('-'))
}

pub(super) fn completion_is_obsolete(
    task: &ClaimedTask,
    result: &crate::model::TerminalResult,
) -> bool {
    task.kind == "blocker" && result.is_obsolete()
}

pub(super) async fn verify_obsolete_owner_deliveries(
    repository: &Path,
    owning_repairs: &[TaskId],
) -> crate::HiveResult<()> {
    for (owner, branch) in obsolete_owner_delivery_targets(owning_repairs) {
        verify_main_repair_merge_and_main(repository, &branch)
            .await
            .hive_context(format!(
                "obsolete blocker retirement requires a merged repair and green Main for owner \
                 {owner}"
            ))?;
    }
    Ok(())
}

pub(super) fn obsolete_owner_delivery_targets(owning_repairs: &[TaskId]) -> Vec<(TaskId, String)> {
    owning_repairs
        .iter()
        .map(|owner| (owner.clone(), repair_branch_name(owner.as_str())))
        .collect()
}
