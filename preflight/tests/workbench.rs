#![allow(clippy::unnecessary_wraps)]

use anyhow::Context as _;
use std::{
    fs,
    path::{Path, PathBuf},
};

fn repository_root() -> PathBuf {
    std::env::var_os("NOOK_REPO_ROOT").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
        PathBuf::from,
    )
}

fn read(path: &str) -> String {
    fs::read_to_string(repository_root().join(path))
        .unwrap_or_else(|error| panic!("failed to read {path}: {error}"))
}

fn directory_has_files(path: &Path) -> bool {
    fs::read_dir(path).is_ok_and(|entries| {
        entries.filter_map(Result::ok).any(|entry| {
            let path = entry.path();
            path.is_file() || (path.is_dir() && directory_has_files(&path))
        })
    })
}

#[test]
fn agent_implementation_claims_only_explicit_workbench_records() -> anyhow::Result<()> {
    let workflow = read(".github/workflows/agent-implement.yml");
    let plan_script = read(".github/scripts/ci-agent-plan.sh");
    let record_validator = read(".github/scripts/workbench-records.cjs");

    for required in [
        "WORKBENCH_REPOSITORY: meta-secret/nook-workbench",
        "WORKBENCH_PLAN_FILE: .nook-workbench-plan.md",
        "CI_AGENT_TIMEOUT_MS: \"18000000\"",
        "status: ready",
        "automation: agent",
        "status: in_progress",
        "continuing_owner:",
        "A prompt-backed run requires continuing_owner.",
        "continuing_owner must be a lowercase GitHub login.",
        "must name a continuing GitHub owner before automation can claim it",
        "## Ownership",
        "CONTINUING_AGENT_OWNER",
        "Validate continuing GitHub owner",
        "getCollaboratorPermissionLevel",
        "addAssignees",
        "issues.createComment",
        "Supply exactly one of issue_path or prompt.",
        "[ -z \"$PROMPT\" ] && [ -z \"$ISSUE_PATH\" ]",
        "[ -n \"$PROMPT\" ] && [ -n \"$ISSUE_PATH\" ]",
        "const path = requestedPath",
        "github.rest.repos.getContent({ owner, repo, path, ref: 'main' })",
        "Claim ready Workbench issue",
        "Run task-planning agent",
        "task ci-agent:plan",
        "uses: ./.github/actions/nook-node-setup",
        "uses: go-task/setup-task@v2",
        "Validate and publish Workbench task plan",
        "Publish Workbench result",
        "MULTI_PR_PLAN: ${{ steps.plan.outputs.multi_pr }}",
        "Materialize the feature and ordered focused issues",
        "steps.workbench.outputs.found == 'true'",
        "validateAgentRecord",
        "if: steps.plan.outcome == 'success'",
        "`plan: ${process.env.PLAN_PATH || 'null'}`",
        "publishing trusted fallback metadata",
        "## Decisions",
        "worklogs/${feature}/",
    ] {
        assert!(
            workflow.contains(required),
            "Workbench agent workflow is missing: {required}"
        );
    }
    for required in [
        "git worktree add --detach",
        "REPO_ROOT=\"$planning_root\" task ci-agent:run",
    ] {
        assert!(
            plan_script.contains(required),
            "Workbench planning script is missing: {required}"
        );
    }
    for required in [
        "content contains a workflow credential",
        "content resembles a transcript, credential, environment dump, or raw log",
        "content contains a verbatim source-task excerpt",
        "containsSourceTaskExcerpt",
    ] {
        assert!(
            record_validator.contains(required),
            "Workbench record validator is missing: {required}"
        );
    }

    assert!(
        !workflow.contains("\n  issues:"),
        "GitHub issue events must not trigger Nook implementation agents"
    );
    assert!(
        !workflow.contains("\n  schedule:")
            && !workflow.contains("\nconcurrency:")
            && !workflow.contains("github.rest.git.getTree")
            && !workflow.contains("recursive: 'true'")
            && !workflow.contains("for (const path of paths)"),
        "Workbench implementation must preserve each explicit dispatch without scheduled tree scanning or a collapsing concurrency group"
    );
    let dispatch_validation_position = workflow
        .find("Validate dispatch inputs")
        .context("the workflow must validate dispatch inputs")?;
    let checkout_position = workflow
        .find("Checkout")
        .context("the workflow must check out Nook")?;
    assert!(
        dispatch_validation_position < checkout_position,
        "invalid or ambiguous dispatches must fail before checkout"
    );
    let claim_position = workflow
        .find("Claim ready Workbench issue")
        .context("the workflow must claim the requested Workbench issue")?;
    let docker_position = workflow
        .find("Docker setup")
        .context("the workflow must set up Docker")?;
    assert!(
        claim_position < docker_position,
        "the workflow must atomically claim a Workbench record before expensive setup"
    );
    let plan_position = workflow
        .find("Validate and publish Workbench task plan")
        .context("the workflow must validate and publish its Workbench plan")?;
    let implementation_position = workflow
        .find("Run ci-agent implement")
        .context("the workflow must run bounded implementation")?;
    assert!(
        plan_position < implementation_position,
        "the workflow must publish the interpreted task plan before implementation"
    );
    Ok(())
}

#[test]
fn agents_mutate_only_their_owned_feature_and_issue_set() -> anyhow::Result<()> {
    let agent_map = read(".cortex/AGENTS.md");
    let coding_workflow = read(".cortex/workflows/coding-bro.md");
    let issue_workflow = read(".cortex/workflows/issues.md");
    let pull_request_workflow = read(".cortex/workflows/pull-requests.md");
    let ownership_skill = read(".cortex/dynamic-skills/agent-feature-ownership.md");

    for required in [
        "agents mutate only their owned feature",
        "Another active agent's work is read-only",
        "wait for an explicit user, owner, or orchestrator handoff",
    ] {
        assert!(
            agent_map.contains(required),
            "agent map is missing ownership guard: {required}"
        );
    }

    for required in [
        "Treat every other active task as read-only",
        "current task's owned feature and focused issue set",
        "Require an explicit handoff first",
    ] {
        assert!(
            coding_workflow.contains(required),
            "coding workflow is missing ownership guard: {required}"
        );
    }

    assert!(
        issue_workflow.contains("Related scope does not transfer ownership")
            && issue_workflow.contains("mutate another active task's branch")
            && issue_workflow.contains("trigger another active task's checks")
            && issue_workflow.contains("change another active task's merge state"),
        "Workbench issue guidance must protect active task ownership"
    );
    assert!(
        pull_request_workflow
            .contains("Another active task's branch and pull request are read-only")
            && pull_request_workflow.contains("explicit handoff."),
        "pull-request workflow must reject foreign task mutation"
    );
    assert!(
        ownership_skill.contains("replying to or resolving its review threads")
            && ownership_skill.contains("closing, reopening, or merging its pull request")
            && ownership_skill.contains("Recheck ownership before every remote mutation")
            && ownership_skill.contains("prompt-backed run requires the `continuing_owner`"),
        "agent feature ownership skill must cover PR and review mutations"
    );
    Ok(())
}

#[test]
fn substantial_agent_tasks_use_curated_session_memory() -> anyhow::Result<()> {
    let gitignore = read(".gitignore");
    let agent_map = read(".cortex/AGENTS.md");
    let coding_workflow = read(".cortex/workflows/coding-bro.md");
    let pull_request_workflow = read(".cortex/workflows/pull-requests.md");
    let self_improvement = read(".cortex/dynamic-skills/self-improvement.md");
    let skill_wrapper = read(".agents/skills/self-improvement/SKILL.md");
    let agent_tasks = read(".task/agentic-ai.yml");
    let readiness_guard = read("agentic-ai/loom/src/commands/cortex-session-clean.ts");

    assert!(
        gitignore.lines().any(|line| line == ".cortex/.session/"),
        "temporary Cortex session memory must remain ignored"
    );
    assert!(
        agent_map.contains("dynamic-skills/self-improvement.md")
            && coding_workflow.contains("dynamic-skills/self-improvement.md")
            && pull_request_workflow.contains("dynamic-skills/self-improvement.md"),
        "agent entry points must invoke the canonical self-improvement skill"
    );
    assert!(
        pull_request_workflow.contains("completion contract"),
        "pull-request readiness must invoke the canonical completion contract"
    );
    for required in [
        "## Knowledge classification",
        "## Self-improvement review",
        "## Promotion criteria",
        "## Evidence and consistency",
        "No Cortex update is a valid outcome",
        "## Protocol evolution safety",
        "## Workflow improvement review",
        "### Instruction classification",
        "### Loom extraction procedure",
        "task loom:agent-workflow:cortex-audit",
        "task loom:cortex-session-clean",
        "## Pull-request completion contract",
    ] {
        assert!(
            self_improvement.contains(required),
            "self-improvement skill is missing: {required}"
        );
    }
    assert!(
        skill_wrapper.contains(".cortex/dynamic-skills/self-improvement.md")
            && skill_wrapper.contains("invocation mirror")
            && !skill_wrapper.contains("Create `.cortex/.session"),
        "the executable skill must route agents through the canonical lifecycle"
    );
    assert!(
        agent_tasks
            .matches("- task loom:cortex-session-clean")
            .count()
            == 2
            && readiness_guard
                .contains("PR readiness requires removing temporary Cortex session memory")
            && !repository_root()
                .join(".github/scripts/assert-cortex-session-clean.sh")
                .exists(),
        "host and Hive readiness must reject leftover temporary session memory"
    );
    Ok(())
}

#[test]
fn statistics_leave_the_product_repository() -> anyhow::Result<()> {
    let collector = read(".github/workflows/main-build-stats.yml");
    let publisher = read(".github/scripts/workbench-publish.cjs");

    for required in [
        "repository: meta-secret/nook-workbench",
        "workbench/stats/main-build/",
        "git -C workbench push origin HEAD:main",
    ] {
        assert!(
            collector.contains(required),
            "Main statistics collector is missing: {required}"
        );
    }
    assert!(
        !collector.contains("gh pr create")
            && !collector.contains("gh pr merge")
            && !collector.contains(".stats/"),
        "Main statistics must not create Nook bookkeeping PRs or files"
    );
    assert!(
        !directory_has_files(&repository_root().join(".stats")),
        "statistics must live only in Nook Workbench"
    );
    assert!(
        publisher.contains("remotePath.startsWith('stats/')")
            && publisher.contains("Refusing to overwrite immutable Workbench record")
            && publisher.contains("NOOK_WORKBENCH_EXPECTED_SHA")
            && publisher.contains("Refusing stale Workbench update"),
        "the Workbench publisher must refuse to replace immutable statistics"
    );

    for path in [".github/workflows/main.yml", ".github/workflows/pr.yml"] {
        assert!(
            !read(path).contains(".stats/**"),
            "{path} must not retain obsolete statistics path exceptions"
        );
    }
    Ok(())
}

#[test]
fn agent_prompt_requires_a_publishable_worklog() -> anyhow::Result<()> {
    let prompt = read(".github/prompts/agent-implement.md");
    let plan_prompt = read(".github/prompts/agent-plan.md");
    let ignore = read(".gitignore");
    let workflow = read(".github/workflows/agent-implement.yml");

    for required in [
        ".nook-workbench-worklog.md",
        "## Implementation problems",
        "## Decisions",
        "## Validation",
        "## Remaining work",
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
        "Owning modules, packages, or layers",
        "Public or cross-module interfaces",
        "Delivery shape",
        "Current PR estimated authored changed lines",
        "Current PR slice and acceptance evidence",
        "PR slices and acceptance evidence",
        "## Initial plan",
        "## Completion evidence",
        "## Safety review",
        "Do not quote, copy, or lightly",
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
        "validateAgentRecord",
        "remotePath.startsWith('plans/')",
        "NOOK_WORKBENCH_SOURCE_TASK_FILE",
        "Refusing invalid Workbench plan",
        "Refusing source-task file inside the public Nook checkout",
    ] {
        assert!(
            read(".github/scripts/workbench-publish.cjs").contains(required),
            "interactive Workbench publisher is missing plan validation: {required}"
        );
    }
    let publish_position = workflow
        .find("path: planPath")
        .context("bounded automation must publish the validated plan")?;
    let block_position = workflow
        .find("Published multi-PR feature plan requires materialized Workbench feature")
        .context("bounded automation must block an unmaterialized multi-PR plan")?;
    let materialization_position = workflow
        .find("core.setOutput('multi_pr', 'true')")
        .context("bounded automation must identify a multi-PR materialization action")?;
    assert!(
        publish_position < block_position,
        "bounded automation must publish a multi-PR plan before blocking implementation"
    );
    assert!(
        materialization_position < block_position,
        "bounded automation must identify the materialization action before blocking"
    );
    let implement = read("agentic-ai/ci-agent/src/main/implement.ts");
    let budget_position = implement
        .find("assertAuthoredChangeBudget(budgetArgs)")
        .context("bounded implementation must enforce the authored diff budget")?;
    let push_position = implement
        .find("pushFixBranch(repoRoot, agentBranch, runId)")
        .context("bounded implementation must push its bounded branch")?;
    assert!(
        budget_position < push_position,
        "bounded implementation must enforce the authored diff budget before push"
    );
    Ok(())
}
