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
fn agent_implementation_claims_only_explicit_workbench_records() {
    let workflow = read(".github/workflows/agent-implement.yml");
    let record_validator = read(".github/scripts/workbench-records.cjs");

    for required in [
        "WORKBENCH_REPOSITORY: meta-secret/nook-workbench",
        "WORKBENCH_PLAN_FILE: .nook-workbench-plan.md",
        "CI_AGENT_TIMEOUT_MS: \"18000000\"",
        "status: ready",
        "automation: agent",
        "status: in_progress",
        "Supply either issue_path or prompt, not both",
        "Claim ready Workbench issue",
        "Run task-planning agent",
        "git worktree add --detach",
        "REPO_ROOT=\"$planning_root\" task ci-agent:run",
        "Validate and publish Workbench task plan",
        "Publish Workbench result",
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
        workflow.find("Claim ready Workbench issue") < workflow.find("Docker setup"),
        "the workflow must atomically claim a Workbench record before expensive setup"
    );
    assert!(
        workflow.find("Validate and publish Workbench task plan")
            < workflow.find("Run ci-agent implement"),
        "the workflow must publish the interpreted task plan before implementation"
    );
}

#[test]
fn statistics_leave_the_product_repository() {
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
}

#[test]
fn agent_prompt_requires_a_publishable_worklog() {
    let prompt = read(".github/prompts/agent-implement.md");
    let plan_prompt = read(".github/prompts/agent-plan.md");
    let ignore = read(".gitignore");

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
}
