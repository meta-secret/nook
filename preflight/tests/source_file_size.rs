use std::fs;
use std::path::PathBuf;

use nook_preflight::source_size::{
    AUTHORED_SOURCE_LINE_LIMIT, SOURCE_SIZE_REMEDIATION, UNIT_TEST_COLOCATION_REMEDIATION,
    external_rust_unit_test_modules, source_size_violations,
};

fn repository_root() -> PathBuf {
    std::env::var_os("NOOK_REPO_ROOT").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
        PathBuf::from,
    )
}

#[test]
fn authored_source_files_stay_within_hard_limits() -> anyhow::Result<()> {
    let violations = source_size_violations(&repository_root())?;
    assert!(
        violations.is_empty(),
        "{SOURCE_SIZE_REMEDIATION}\n{violations:#?}"
    );
    Ok(())
}

#[test]
fn rust_unit_tests_stay_with_their_focused_implementation() -> anyhow::Result<()> {
    let violations = external_rust_unit_test_modules(&repository_root())?;
    assert!(
        violations.is_empty(),
        "{UNIT_TEST_COLOCATION_REMEDIATION}\n{violations:#?}"
    );
    Ok(())
}

#[test]
fn critical_architecture_rule_stays_wired_to_agent_guidance() -> anyhow::Result<()> {
    assert_eq!(AUTHORED_SOURCE_LINE_LIMIT, 1_000);
    let root = repository_root();
    let agents = fs::read_to_string(root.join(".cortex/AGENTS.md"))?;
    let canonical = fs::read_to_string(root.join(".cortex/dynamic-skills/source-file-size.md"))?;
    let executable = fs::read_to_string(root.join(".agents/skills/source-file-size/SKILL.md"))?;

    for (name, source) in [
        (".cortex/AGENTS.md", agents.as_str()),
        ("canonical source-size skill", canonical.as_str()),
        ("executable source-size skill", executable.as_str()),
    ] {
        assert!(
            source.contains("1,000"),
            "{name} must preserve the hard limit"
        );
        assert!(
            !source.contains("1,500"),
            "{name} must not preserve a larger Rust allowance"
        );
        assert!(
            source.contains("overcomplicated")
                || source.contains("too many")
                || source.contains("excessive"),
            "{name} must explain that oversized Rust indicates excessive domain responsibility"
        );
        assert!(
            source.contains("unit tests") && source.contains("integration tests"),
            "{name} must require unit-test colocation and preserve integration tests"
        );
        assert!(
            source.contains("domain") && source.contains("architectural"),
            "{name} must require domain or architectural decomposition"
        );
    }

    assert!(SOURCE_SIZE_REMEDIATION.contains("P1 source architecture violation"));
    assert!(SOURCE_SIZE_REMEDIATION.contains("overcomplicated domain model"));
    assert!(SOURCE_SIZE_REMEDIATION.contains("Extracting tests alone is prohibited"));
    assert!(SOURCE_SIZE_REMEDIATION.contains("Arbitrary half-splits"));
    assert!(UNIT_TEST_COLOCATION_REMEDIATION.contains("unit tests must be inline"));
    assert!(UNIT_TEST_COLOCATION_REMEDIATION.contains("integration tests"));
    Ok(())
}

#[test]
fn source_architecture_gate_runs_for_every_pull_request_tree() -> anyhow::Result<()> {
    let root = repository_root();
    let workflow = fs::read_to_string(root.join(".github/workflows/repository-policy.yml"))?;
    let taskfile = fs::read_to_string(repository_root().join("preflight/Taskfile.yml"))?;

    assert!(
        !root
            .join(".github/workflows/source-architecture.yml")
            .exists()
            && !root.join(".github/workflows/loom.yml").exists(),
        "repository policy must remain the single automatic policy workflow"
    );
    assert!(workflow.contains("pull_request:"));
    let pull_request_trigger = workflow
        .split_once("  pull_request:\n")
        .and_then(|(_, tail)| tail.split_once("  push:\n"))
        .map(|(trigger, _)| trigger)
        .ok_or_else(|| anyhow::anyhow!("repository policy must define PR before push triggers"))?;
    assert!(
        !pull_request_trigger.contains("paths:") && !pull_request_trigger.contains("paths-ignore:"),
        "repository policy must not skip source architecture for authored PR trees"
    );
    assert!(
        workflow.contains("if: github.event_name == 'pull_request'\n        run: task preflight:source-architecture"),
        "repository policy must run source architecture for every PR event"
    );
    assert_hosted_preflight_rust_cache(&workflow, "repository-policy")?;
    assert!(
        taskfile.contains("--test source_file_size"),
        "preflight:source-architecture must run the source_file_size test"
    );
    Ok(())
}

fn assert_hosted_preflight_rust_cache(workflow: &str, name: &str) -> anyhow::Result<()> {
    let toolchain = workflow
        .find("uses: dtolnay/rust-toolchain@stable")
        .ok_or_else(|| anyhow::anyhow!("{name} must install the pinned stable Rust channel"))?;
    let cache = workflow
        .find("uses: Swatinem/rust-cache@v2")
        .ok_or_else(|| anyhow::anyhow!("{name} must restore its hosted Rust dependency cache"))?;
    let first_preflight_task = workflow
        .find("task preflight:")
        .ok_or_else(|| anyhow::anyhow!("{name} must run a preflight Rust task"))?;

    assert!(
        toolchain < cache && cache < first_preflight_task,
        "{name} must restore Rust dependencies after toolchain setup and before Cargo work"
    );
    for marker in [
        "shared-key: pr-preflight",
        "workspaces: preflight -> target",
    ] {
        assert!(
            workflow.contains(marker),
            "{name} Rust cache is missing `{marker}`"
        );
    }
    Ok(())
}
