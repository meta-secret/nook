use std::fs;
use std::path::PathBuf;

fn repository_root() -> PathBuf {
    std::env::var_os("NOOK_REPO_ROOT").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
        PathBuf::from,
    )
}

fn read(relative_path: &str) -> anyhow::Result<String> {
    Ok(fs::read_to_string(repository_root().join(relative_path))?)
}

#[test]
fn rust_ecosystem_checks_remain_configured_and_executable() -> anyhow::Result<()> {
    let workflow = read(".github/workflows/rust-ecosystem.yml")?;
    let quality = read(".cortex/workflows/quality.md")?;
    let workspace = read("nook-app/Cargo.toml")?;
    let replication = read("nook-app/nook-replication/src/replica_store.rs")?;
    let fuzz_target = read("fuzz/fuzz_targets/wire_parsers.rs")?;
    let fuzz_manifest = read("fuzz/Cargo.toml")?;
    let readiness = read("agentic-ai/ci-agent/src/main/github.ts")?;

    for marker in [
        "cargo-deny-action",
        "rustsec/audit-check",
        "Property and snapshot tests",
        "Concurrency permutation model",
        "cargo fuzz run",
        "Preserve fuzz corpus and crash inputs",
        "FUZZ_SECONDS",
        "kani-github-action",
        "cargo dylint --all",
        "nightly-2026-04-16",
        "checks: write",
    ] {
        assert!(
            workflow.contains(marker),
            "Rust ecosystem workflow is missing {marker}"
        );
    }

    for capability in [
        "cargo-deny",
        "RustSec",
        "Proptest",
        "Insta",
        "Loom",
        "cargo-fuzz",
        "Kani",
        "Dylint",
    ] {
        assert!(
            quality.contains(capability),
            "Cortex quality guidance is missing {capability}"
        );
    }

    assert!(repository_root().join("deny.toml").is_file());
    assert!(repository_root().join("nook-app/.insta.yaml").is_file());
    assert!(workspace.contains("[workspace.metadata.kani.flags]"));
    assert!(workspace.contains("[workspace.metadata.dylint]"));
    assert!(replication.contains("proptest!"));
    assert!(replication.contains("insta::assert_debug_snapshot!"));
    assert!(replication.contains("loom::model"));
    assert!(replication.contains("#[kani::proof]"));
    assert!(fuzz_target.contains("fuzz_target!"));
    assert!(fuzz_manifest.contains("[lints.clippy]"));
    assert!(readiness.contains("workflowFile: \"rust-ecosystem.yml\""));
    Ok(())
}

#[test]
fn ecosystem_policy_replaces_generic_custom_scanners_only() -> anyhow::Result<()> {
    let quality = read(".cortex/workflows/quality.md")?;

    assert!(quality.contains("Ecosystem tools before bespoke preflight"));
    assert!(quality.contains("Keep `preflight` for Nook-specific"));
    assert!(quality.contains("Do not duplicate an ecosystem tool"));
    Ok(())
}
