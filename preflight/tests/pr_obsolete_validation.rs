use std::{fs, path::PathBuf};

use anyhow::{Context, Result};

fn repository_root() -> PathBuf {
    std::env::var_os("NOOK_REPO_ROOT").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
        PathBuf::from,
    )
}

fn read(path: &str) -> Result<String> {
    fs::read_to_string(repository_root().join(path))
        .with_context(|| format!("failed to read {path}"))
}

#[test]
fn head_transition_marker_and_stabilization_routes_are_absent() -> Result<()> {
    let workflow_name = ["pr-head", "stabilization.yml"].join("-");
    assert!(
        !repository_root()
            .join(".github/workflows")
            .join(&workflow_name)
            .exists(),
        "the head-stabilization workflow must remain removed"
    );

    let forbidden = [
        ["pr-head", "stabilization"].join("-"),
        ["nook-head", "transition"].join("-"),
    ];
    for relative_root in [".github/workflows", ".github/scripts", ".task"] {
        let mut pending = vec![repository_root().join(relative_root)];
        while let Some(directory) = pending.pop() {
            for entry in fs::read_dir(&directory)? {
                let entry = entry?;
                if entry.file_type()?.is_dir() {
                    pending.push(entry.path());
                    continue;
                }
                let Ok(source) = fs::read_to_string(entry.path()) else {
                    continue;
                };
                for marker in &forbidden {
                    assert!(
                        !source.contains(marker),
                        "{} must not support removed head-transition state: {marker}",
                        entry.path().display()
                    );
                }
            }
        }
    }
    Ok(())
}

#[test]
fn obsolete_validation_cancellation_is_marker_free_and_head_bound() -> Result<()> {
    let cancellation = read(".github/workflows/pr-obsolete-validation.yml")?;
    for required in [
        "pull_request_target:",
        "types: [edited, synchronize]",
        "actions: write",
        "pull-requests: read",
        "name: Cancel obsolete validation heads",
        "context.payload.action === \"edited\"",
        "context.payload.changes?.base?.ref?.from",
        "Ignoring PR edit without a base-ref change.",
        "{ file: \"pr.yml\", name: \"PR\" }",
        "{ file: \"rust-ecosystem.yml\", name: \"Rust ecosystem checks\" }",
        "{ file: \"web-research.yml\", name: \"Web research\" }",
        "associatedPullRequest?.base?.sha !== currentPr.base.sha",
        "run.head_sha !== currentPr.head.sha || predatesBaseRetarget",
        "latestPr.head.sha === eventHeadSha",
        "latestPr.base.ref === eventBaseRef",
        "github.rest.actions.listWorkflowRuns",
        "github.rest.actions.cancelWorkflowRun",
        "github.rest.actions.getWorkflowRun",
        "inspectionDeadline = Date.now() + 45_000",
        "setTimeout(resolve, 5_000)",
    ] {
        assert!(
            cancellation.contains(required),
            "obsolete validation cancellation contract missing: {required}"
        );
    }
    for forbidden in [
        "workflow_dispatch:",
        "pull-requests: write",
        "github.rest.issues",
        "github.rest.issues.createComment",
        "github.rest.issues.updateComment",
        "pr_number:",
        "head_sha:",
        "base_sha:",
        "nook-head-transition",
        "backfill",
        "actions/checkout",
    ] {
        assert!(
            !cancellation.contains(forbidden),
            "cancellation-only workflow must not restore transition state: {forbidden}"
        );
    }
    Ok(())
}
