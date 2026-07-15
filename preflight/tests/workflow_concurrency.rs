use std::{fs, path::PathBuf};

fn repository_root() -> PathBuf {
    std::env::var_os("NOOK_REPO_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."))
}

fn workflow(path: &str) -> String {
    fs::read_to_string(repository_root().join(path))
        .unwrap_or_else(|error| panic!("failed to read {path}: {error}"))
}

fn assert_policy(path: &str, policy: &str) {
    assert!(
        workflow(path).contains(policy),
        "{path} must preserve this concurrency policy:\n{policy}"
    );
}

#[test]
fn superseded_builds_are_cancelled_within_their_own_delivery_scope() {
    for (path, policy) in [
        (
            ".github/workflows/pr.yml",
            "concurrency:\n  group: pr-${{ github.event.pull_request.number }}\n  cancel-in-progress: true",
        ),
        (
            ".github/workflows/main.yml",
            "concurrency:\n  group: main\n  cancel-in-progress: true",
        ),
        (
            ".github/workflows/e2e-pr.yml",
            "concurrency:\n  group: e2e-pr-${{ inputs.pr_number }}-${{ inputs.suite }}\n  cancel-in-progress: true",
        ),
        (
            ".github/workflows/web-research.yml",
            "concurrency:\n  group: web-research-${{ github.event.pull_request.number || github.ref }}\n  cancel-in-progress: true",
        ),
        (
            ".github/workflows/ci-agent-smoke.yml",
            "concurrency:\n  group: ci-agent-smoke\n  cancel-in-progress: true",
        ),
    ] {
        assert_policy(path, policy);
    }

    assert_policy(
        ".github/workflows/e2e-nightly.yml",
        "concurrency:\n      group: e2e-nightly-${{ matrix.provider }}\n      # A newer provider run supersedes the live-sync build, but this job-level\n      # group deliberately leaves an already-running ci-fix agent alone.\n      cancel-in-progress: true",
    );
}

#[test]
fn stateful_workflows_are_serialized_without_interrupting_active_work() {
    for (path, policy) in [
        (
            ".github/workflows/agent-implement.yml",
            "concurrency:\n  group: agent-implement-${{ github.event.issue.number || github.run_id }}\n  # Do not interrupt an agent after it may have pushed a branch or opened a PR.\n  cancel-in-progress: false",
        ),
        (
            ".github/workflows/release.yml",
            "concurrency:\n  group: production-release\n  # Production publication is stateful; serialize releases without interrupting one mid-deploy.\n  cancel-in-progress: false",
        ),
        (
            ".github/workflows/runner-cleanup.yml",
            "concurrency:\n  group: runner-cleanup\n  # Let an active Docker prune finish instead of interrupting runner maintenance mid-operation.\n  cancel-in-progress: false",
        ),
    ] {
        assert_policy(path, policy);
    }
}
