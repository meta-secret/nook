use std::{collections::BTreeSet, fs, path::PathBuf};

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

fn catalog_from_taskfile(taskfile: &str) -> BTreeSet<&str> {
    taskfile
        .split("case \"$requested_task\" in")
        .nth(1)
        .and_then(|content| content.split(") ;;").next())
        .unwrap_or_else(|| panic!("remote Taskfile must contain an allowlist case"))
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or_else(|| panic!("remote Taskfile allowlist must not be empty"))
        .split('|')
        .collect()
}

#[test]
fn remote_task_catalog_is_allowlisted_and_exact_head_only() {
    let root_tasks = read("Taskfile.yml");
    let remote_tasks = read(".task/remote-execution.yml");

    assert!(root_tasks.contains("taskfile: .task/remote-execution.yml"));
    for required in [
        "requires:\n      vars: [TASK_NAME]",
        "requested_task=\"$REQUESTED_REMOTE_TASK\"",
        "git status --porcelain",
        "git ls-remote --refs origin",
        "if [ \"$remote_sha\" != \"$local_sha\" ]",
        "gh workflow run remote.yml",
        "--raw-field \"task=$requested_task\"",
        "task remote:list",
    ] {
        assert!(
            remote_tasks.contains(required),
            "remote Taskfile contract missing: {required}"
        );
    }
    assert!(
        !remote_tasks.contains("--raw-field \"command="),
        "remote execution must dispatch an allowlisted name, not arbitrary shell"
    );
}

#[test]
fn hosted_workflow_matches_the_taskfile_catalog() {
    let remote_tasks = read(".task/remote-execution.yml");
    let workflow = read(".github/workflows/remote.yml");
    let task_catalog = catalog_from_taskfile(&remote_tasks);

    for task in &task_catalog {
        assert!(
            workflow.contains(&format!("          - {task}\n")),
            "remote workflow input is missing catalog task: {task}"
        );
        assert!(
            workflow.contains(&format!("if: inputs.task == '{task}'")),
            "remote workflow has no selected job for task: {task}"
        );
    }

    assert_eq!(
        workflow.matches("if: inputs.task == '").count(),
        task_catalog.len(),
        "every selected remote job must correspond to exactly one Taskfile allowlist entry"
    );
    assert_eq!(
        workflow.matches("runs-on: ubuntu-latest").count(),
        task_catalog.len(),
        "every catalog task must run on its own GitHub-hosted job"
    );
    assert!(!workflow.contains("runs-on: nook"));
    assert!(!workflow.contains("secrets."));
    assert!(!workflow.contains("${{ inputs.command }}"));
    assert!(workflow.contains("cache-write: \"false\""));
    assert!(workflow.contains("main-cache-only: \"true\""));
}

#[test]
fn complete_pr_validation_is_explicit_and_exact_head_bound() {
    let remote_tasks = read(".task/remote-execution.yml");
    let pr = read(".github/workflows/pr.yml");
    let remote_doc = read(".cortex/workflows/remote-execution.md");

    assert!(pr.contains("types: [labeled, closed]"));
    for label in ["ci:validate", "ci:full-e2e"] {
        assert!(
            pr.contains(&format!("github.event.label.name == '{label}'")),
            "PR workflow must gate workers on {label}"
        );
        assert!(
            remote_tasks.contains(label),
            "PR validation Task command must own {label}"
        );
    }
    for required in [
        "pr_sha=\"$(gh pr view \"$REQUESTED_PR\"",
        "if [ \"$local_sha\" != \"$pr_sha\" ]",
        "--remove-label \"$validation_label\"",
        "--add-label \"$validation_label\"",
        "task remote TASK_NAME=rust:test",
        "task pr:validate PR=<number>",
        "Any later push changes the PR head",
    ] {
        assert!(
            remote_tasks.contains(required) || remote_doc.contains(required),
            "remote execution contract missing: {required}"
        );
    }
}
