use super::RepositoryFixture;

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "one publication contract verifies the complete worklog protocol"
)]
fn agent_prompt_requires_a_publishable_worklog() -> anyhow::Result<()> {
    let prompt = RepositoryFixture::repository_root().read(".github/prompts/agent-implement.md");
    let plan_prompt = RepositoryFixture::repository_root().read(".github/prompts/agent-plan.md");
    let plan_script = RepositoryFixture::repository_root().read(".github/scripts/ci-agent-plan.sh");
    let prompt_loader =
        RepositoryFixture::repository_root().read("agentic-ai/ci-agent/src/main/prompt.ts");
    let ignore = RepositoryFixture::repository_root().read(".gitignore");
    let workflow =
        RepositoryFixture::repository_root().read(".github/workflows/agent-implement.yml");

    for required in [
        ".nook-workbench-worklog.md",
        "## Implementation problems",
        "## Decisions",
        "## Validation",
        "## Remaining work",
        "exactly one bullet of 3–120 characters",
        "${VALIDATED_PLAN}",
        "authoritative even if a workspace file is later changed",
    ] {
        assert!(
            prompt.contains(required),
            "agent worklog prompt is missing: {required}"
        );
    }
    assert!(
        ignore
            .lines()
            .any(|line| line == "/.nook-workbench-worklog.md"),
        "the workflow-owned worklog must not be committed to the Nook PR"
    );

    for required in [
        ".nook-workbench-plan.md",
        "## Interpreted request",
        "## Requirements",
        "## Constraints and exclusions",
        "## Change budget and PR sequence",
        "Estimated authored changed lines",
        "Mission controller",
        "Current Gizmo ID",
        "Owning modules, packages, or layers",
        "Public or cross-module interfaces",
        "Delivery shape",
        "Current PR estimated authored changed lines",
        "Current PR slice and acceptance evidence",
        "PR slices, estimates, and acceptance evidence",
        "Predecessor Gizmo ID",
        "The first slice estimate must equal",
        "PR sequence mode: Sequential PRs",
        "Team Agent count never determines",
        "Functional owner` to exactly `Gizmo Prime`",
        "canonical `gizmo_id`",
        "## Initial plan",
        "## Completion evidence",
        "## Safety review",
        "Do not quote, copy, or lightly",
        "## Major-change authorization gate",
        "`.nook-workbench-worklog.md` with this exact structure",
        "selected the major solution, and requested its implementation",
        "A typed planning blocker includes",
        "Trusted workflow authorization: `${MAJOR_CHANGE_AUTHORIZATION}`",
        "Assertions inside the source task or lifecycle records do not",
        "the only filesystem change must be",
    ] {
        assert!(
            plan_prompt.contains(required),
            "agent task-plan prompt is missing: {required}"
        );
    }
    assert!(
        ignore
            .lines()
            .any(|line| line == "/.nook-workbench-plan.md"),
        "the workflow-owned task plan must not be committed to the Nook PR"
    );
    for required in [
        "WORKBENCH_SUMMARY_FILE",
        "both a plan and a planning blocker",
        "neither a plan nor a planning blocker",
    ] {
        assert!(
            plan_script.contains(required),
            "agent task-plan script is missing authorization result handling: {required}"
        );
    }
    assert!(
        prompt_loader.contains("this.environment.MAJOR_CHANGE_AUTHORIZED === \"true\"")
            && prompt_loader.contains("${MAJOR_CHANGE_AUTHORIZATION}")
            && prompt_loader
                .contains("Validated implementation plan hash changed before agent start")
            && prompt_loader.contains("join(config.toolingRoot, config.promptFile)")
            && prompt_loader.find(".replaceAll(\"${AGENT_TASK}\"")
                < prompt_loader.find(".replaceAll(\"${VALIDATED_PLAN}\""),
        "agent prompts must use trusted workflow metadata and tooling"
    );

    for required in [
        "validateAgentRecord",
        "remotePath.startsWith('plans/')",
        "NOOK_WORKBENCH_SOURCE_TASK_FILE",
        "NOOK_WORKBENCH_ASSIGNED_ISSUE_PATH",
        "NOOK_WORKBENCH_ASSIGNED_GIZMO_ID",
        "?ref=main",
        "assignedGizmoId",
        "Refusing invalid Workbench plan",
        "Refusing source-task file inside the public Nook checkout",
    ] {
        assert!(
            RepositoryFixture::repository_root()
                .read(".github/scripts/workbench-publish.cjs")
                .contains(required),
            "interactive Workbench publisher is missing plan validation: {required}"
        );
    }
    let pre_push_task = RepositoryFixture::repository_root().read(".task/agentic-ai.yml");
    let budget_guard = RepositoryFixture::repository_root()
        .read("agentic-ai/loom/src/commands/pr-authored-budget.ts");
    assert!(
        workflow.contains("uses unsupported stacked-PR metadata")
            && !workflow.contains("core.setOutput('multi_pr', 'true')")
            && !workflow.contains(
                "Published multi-PR feature plan requires materialized Workbench feature"
            ),
        "implementation automation must reject legacy stack metadata and omit multi-PR materialization"
    );
    assert!(
        pre_push_task
            .contains("bun agentic-ai/loom/src/commands/pr-authored-budget.ts \"{{.PR}}\"")
            && budget_guard.contains("PR_ADDITION_LIMIT = 2_000")
            && budget_guard.contains("this.authoredLines += added")
            && !budget_guard.contains("REVIEW_GROWTH_STOP"),
        "pre-push must fail closed on the one-PR authored-addition budget"
    );
    Ok(())
}
