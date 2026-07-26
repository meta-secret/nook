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

    for required in [
        "WORKBENCH_REPOSITORY: meta-secret/nook-workbench",
        "CI_AGENT_TIMEOUT_MS: \"18000000\"",
        "status: ready",
        "automation: agent",
        "status: in_progress",
        "Supply either issue_path or prompt, not both",
        "Claim ready Workbench issue",
        "Publish Workbench result",
        "validateSummary",
        "contains a workflow credential",
        "publishing trusted fallback metadata",
        "## Decisions",
        "worklogs/${feature}/",
    ] {
        assert!(
            workflow.contains(required),
            "Workbench agent workflow is missing: {required}"
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
        publisher.contains("sha && remotePath.startsWith('stats/')")
            && publisher.contains("Refusing to overwrite immutable Workbench statistics"),
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
}
