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
    assert!(SOURCE_SIZE_REMEDIATION.contains("extracting tests alone is prohibited"));
    assert!(SOURCE_SIZE_REMEDIATION.contains("Arbitrary half-splits"));
    assert!(UNIT_TEST_COLOCATION_REMEDIATION.contains("unit tests must be inline"));
    assert!(UNIT_TEST_COLOCATION_REMEDIATION.contains("integration tests"));
    Ok(())
}

#[test]
fn source_architecture_gate_runs_for_every_pull_request_tree() -> anyhow::Result<()> {
    let workflow =
        fs::read_to_string(repository_root().join(".github/workflows/source-architecture.yml"))?;

    assert!(workflow.contains("pull_request:"));
    assert!(
        !workflow.contains("paths:") && !workflow.contains("paths-ignore:"),
        "the source-architecture workflow must not skip authored product trees"
    );
    assert!(workflow.contains("--test source_file_size"));
    Ok(())
}
