use crate::model;

use crate::model::{ClaimedTask, TaskId};

impl ClaimedTask {
    pub(super) fn task_prompt(&self) -> String {
        let task = self;
        let feature_branch = task
            .bootstrap_evidence
            .as_ref()
            .map_or("(not applicable)", |evidence| {
                evidence.feature_branch.as_str()
            });
        let owning_repairs = if task.owning_repairs.is_empty() {
            "No active owning Main repairs.".to_owned()
        } else {
            task.owning_repairs
                .iter()
                .map(|owner| format!("- {owner} (canonical delivery branch `{feature_branch}`)"))
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
        let delivery = task.kind.delivery_instructions();
        let terminal_contract = task.kind.terminal_contract();
        format!(
            "You are Hive worker attempt {} for task {}.\n\
         Work only inside the supplied repository workspace.\n\
         Complete the task and return the required structured terminal result.\n\n\
         Task kind: {}\n\
         Task:\n{}\n\n\
         Active owning Main repairs:\n{}\n\n\
         Completed dependency context:\n{}{}{}",
            task.attempt_number,
            task.id,
            task.kind,
            task.prompt,
            owning_repairs,
            dependencies,
            delivery,
            terminal_contract
        )
    }
}

impl TaskId {
    #[cfg(test)]
    pub(crate) fn repair_branch_name(&self) -> String {
        let task_id = self.as_str();
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
}

impl model::TaskKind {
    fn delivery_instructions(&self) -> String {
        if self.is_main_repair() {
            "\n\nThis is an end-to-end Main repair. Track the durable incident until the \
         authorized delivery owners return completion evidence. You are a trusted operator with \
         direct GitHub access through `GH_TOKEN`; use standard `git`, `gh`, and repository Taskfile \
         commands only within the role authorization below. Route implementation through Gizmo Prime and the owning Team \
         Gizmos. Consume the caller-recorded `originMainSha`, `pinnedLocalDevSha`, and \
         the canonical `featureBranch`; require `originMainSha` to be an ancestor of \
         `pinnedLocalDevSha`. Resolve the current head of that canonical branch at the start of \
         every attempt and use that observed run head for checkout and exact-head evidence. Gizmo \
         Prime creates every new canonical feature branch and worktree strictly from the exact \
         `pinnedLocalDevSha`. Never use a remote-tracking ref as the creation base; freshly fetched \
         `origin/main` is ancestry evidence only. Obtain exact-head remote build-only evidence and \
         required review, then have Gizmo Prime authorize `dev:land` through Delivery Pipeline's \
         Team Gizmo and PR Lifecycle Agent. The manually run Dev Manager alone selects and \
         publishes a dev snapshot, invokes `dev:pr-manager`, owns the full slow checks and \
         readiness verdict, and authorizes guarded fast-forward promotion through Delivery \
         Pipeline. Inspect GitHub first because a replacement Pod may be resuming durable feature, \
         dev-validation, promotion, or Main-verification state completed by an earlier attempt. \
         Route every actionable follow-up through the same feature and local-dev delivery path. \
         Do not create or update a pull request, squash, rebase, force-push, or use a PR merge method. \
         Verify the resulting Main workflow is green and publish the required Workbench completion \
         records and statistics before reporting completion. If blocked by another change, report \
         structured blocked status and identify the blocker precisely."
                .to_owned()
        } else if self.is_blocker() {
            "\n\nThis is a prerequisite-ownership task, not a passive wait instruction. Resolve the \
         prerequisite yourself using the available repository and GitHub access. When the task \
         names a GitHub Actions run, inspect its current terminal state and failed logs; if it \
         belongs to an active repair, route the correction through the owning feature Gizmo and \
         canonical local-dev delivery path, then follow the replacement exact-head evidence to a \
         terminal result. Never create or update a pull request. Before concluding the \
         prerequisite cannot be completed, inspect every active owning Main repair listed below. Only when \
         every listed repair has already been promoted and has a successful Main run containing its \
         promoted commit is this prerequisite obsolete: report completed with `obsolete` set to true, no \
         changes, and explain that it no longer blocks delivery, even when the requested capability \
         remains unavailable. For every genuine prerequisite completion and every non-blocker task, \
         set `obsolete` to false. When no owning repair is listed, or any listed repair is still \
         live, do not use this obsolescence rule. This task is a dependency leaf. Never request \
         another blocker and never start a parallel delivery. If the prerequisite cannot be \
         completed with the authority and tools already supplied, report failed with a precise \
         explanation, `obsolete` set to false, and `blocker.present` set to false with empty \
         blocker details. Hive records that as a bounded failed attempt without creating a child \
         task."
            .to_owned()
        } else {
            String::new()
        }
    }
    fn terminal_contract(&self) -> &'static str {
        if self.is_blocker() {
            ""
        } else {
            "\n\nThis task is not a dependency leaf. Never return the failed status. If it \
         cannot complete, return blocked with exactly one prerequisite request."
        }
    }
}
