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
    let entry = read(".github/workflows/rust-ecosystem.yml")?;
    let checks = read(".github/workflows/rust-ecosystem-checks.yml")?;
    let pr = read(".github/workflows/pr.yml")?;
    let quality = read(".cortex/workflows/quality.md")?;
    let workspace = read("nook-app/Cargo.toml")?;
    let rust_dockerfile = read("nook-app/docker/rust.Dockerfile")?;
    let rust_bake = read("nook-app/docker/rust.docker-bake.hcl")?;
    let replication = read("nook-app/nook-platform/nook-replication/src/replica_store.rs")?;
    let fuzz_target = read("fuzz/fuzz_targets/wire_parsers.rs")?;
    let fuzz_manifest = read("fuzz/Cargo.toml")?;
    let readiness = read("agentic-ai/ci-agent/src/main/github.ts")?;

    assert!(
        pr.contains("uses: ./.github/workflows/rust-ecosystem-checks.yml"),
        "Labeled product PRs must call the shared Rust ecosystem checks"
    );
    assert!(
        entry.contains("uses: ./.github/workflows/rust-ecosystem-checks.yml"),
        "Thin rust-ecosystem.yml must call the shared Rust ecosystem checks"
    );
    assert!(
        entry.contains("agentic-ai/minds/**"),
        "Thin rust-ecosystem.yml must keep labeled minds-only PR coverage"
    );
    assert!(
        !entry.contains("Bake rust-dependency-policy"),
        "Thin rust-ecosystem.yml must not duplicate Bake steps"
    );

    for marker in [
        "Bake rust-dependency-policy",
        "Bake rust-ecosystem-deterministic",
        "Bake rust-fuzz-smoke",
        "Bake rust-dylint",
        "task docker:ecosystem:dependency-policy",
        "task docker:ecosystem:deterministic",
        "task docker:ecosystem:fuzz",
        "task docker:ecosystem:dylint",
        "nook-docker-setup",
        "NOOK_SCCACHE_ACCESS_KEY",
        "kani-github-action",
        "FUZZ_SECONDS",
        "isolated-cache-write: ${{ inputs.isolated_cache_write }}",
    ] {
        assert!(
            checks.contains(marker),
            "Shared Rust ecosystem checks are missing {marker}"
        );
    }
    assert!(
        !checks.contains("docker-bake-sccache.sh")
            && !checks.contains("NOOK_BAKE_FILES")
            && !checks.contains("docker buildx bake"),
        "Rust ecosystem checks must invoke Taskfile tasks instead of Bake helpers"
    );
    let docker_tasks = read("nook-app/docker/Taskfile.yml")?;
    for marker in [
        "docker:ecosystem:dependency-policy:",
        "docker:ecosystem:deterministic:",
        "docker:ecosystem:fuzz:",
        "docker:ecosystem:dylint:",
        "rust-dependency-policy",
        "rust-ecosystem-deterministic",
        "rust-fuzz-smoke",
        "rust-dylint",
        "sccache:ensure",
    ] {
        assert!(
            docker_tasks.contains(marker),
            "docker Taskfile is missing ecosystem marker {marker}"
        );
    }
    for forbidden in [
        "rustsec/audit-check",
        "cargo-deny-action",
        "cargo install cargo-audit",
        "cargo install cargo-dylint",
        "dtolnay/rust-toolchain",
        "Swatinem/rust-cache",
        "taiki-e/install-action",
    ] {
        assert!(
            !checks.contains(forbidden),
            "Rust ecosystem checks must not use host-toolchain path: {forbidden}"
        );
    }

    for marker in [
        "AS rust-ecosystem-policy-tools",
        "AS rust-dependency-policy",
        "AS rust-ecosystem-nightly",
        "AS rust-fuzz-smoke",
        "AS rust-dylint",
        "AS rust-ecosystem-deterministic",
        "CARGO_DENY_SHA256=",
        "CARGO_AUDIT_SHA256=",
        "CARGO_FUZZ_SHA256=",
        "DYLINT_NIGHTLY=nightly-2026-04-16",
        "cargo install cargo-dylint dylint-link",
        "cargo-deny --manifest-path",
        "--hide-inclusion-graph",
        "--log-level error",
        "cargo-audit audit",
        "cargo fuzz run",
        "cargo dylint --all",
    ] {
        assert!(
            rust_dockerfile.contains(marker),
            "rust.Dockerfile is missing ecosystem marker {marker}"
        );
    }
    // Ecosystem CLIs stay on separate stages so rust-base product builds stay lean.
    let rust_base = rust_dockerfile
        .split("FROM rust-base AS rust-ecosystem-policy-tools")
        .next()
        .expect("rust-base section");
    for forbidden in [
        "CARGO_DENY_SHA256=",
        "CARGO_AUDIT_SHA256=",
        "CARGO_FUZZ_SHA256=",
        "cargo install cargo-dylint",
    ] {
        assert!(
            !rust_base.contains(forbidden),
            "rust-base must not install ecosystem CLI {forbidden}"
        );
    }

    for target in [
        "rust-ecosystem-policy-tools",
        "rust-dependency-policy",
        "rust-ecosystem-nightly",
        "rust-fuzz-smoke",
        "rust-dylint",
        "rust-ecosystem-deterministic",
    ] {
        assert!(
            rust_bake.contains(&format!("target \"{target}\"")),
            "rust.docker-bake.hcl is missing target {target}"
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
    assert!(fuzz_manifest.contains("expect_used = \"deny\""));
    assert!(fuzz_manifest.contains("unwrap_used = \"deny\""));
    for relative in [
        "nook-app/clippy.toml",
        "preflight/clippy.toml",
        "agentic-ai/minds/clippy.toml",
        "fuzz/clippy.toml",
    ] {
        let clippy = read(relative)?;
        assert!(
            clippy.contains("allow-expect-in-tests = false"),
            "{relative} must deny expect in tests"
        );
        assert!(
            clippy.contains("allow-unwrap-in-tests = false"),
            "{relative} must deny unwrap in tests"
        );
    }
    assert!(readiness.contains("workflowFile: \"rust-ecosystem.yml\""));
    assert!(readiness.contains("paths.every(isMainPrIgnoredPath)"));
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
