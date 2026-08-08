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
    let workspace = read("nook-app/nook-platform/Cargo.toml")?;
    let rust_lineage_dockerfile = read("nook-app/nook-platform/docker/rust/lineage.Dockerfile")?;
    let rust_dockerfile = [
        "nook-app/nook-platform/docker/rust/lineage.Dockerfile",
        "nook-app/nook-platform/docker/rust/deterministic.Dockerfile",
        "nook-app/nook-platform/docker/rust/policy-tools.Dockerfile",
        "nook-app/nook-platform/docker/rust/nightly.Dockerfile",
        "nook-app/nook-platform/docker/rust/fuzz-smoke.Dockerfile",
        "nook-app/nook-platform/docker/rust/dylint.Dockerfile",
    ]
    .into_iter()
    .map(read)
    .collect::<anyhow::Result<Vec<_>>>()?
    .join("\n");
    let rust_bake = read("nook-app/nook-platform/docker/rust/docker-bake.hcl")?;
    let replication = read("nook-app/nook-platform/nook-replication/src/replica_store.rs")?;
    let fuzz_target = read("nook-app/nook-platform/fuzz/fuzz_targets/wire_parsers.rs")?;
    let fuzz_manifest = read("nook-app/nook-platform/fuzz/Cargo.toml")?;
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
        !entry.contains("Run dependency policy") && !entry.contains("Bake rust-dependency-policy"),
        "Thin rust-ecosystem.yml must not duplicate dependency-policy steps"
    );

    for marker in [
        "Run dependency policy",
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
        "cache-write: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' && 'true' || 'false' }}",
        "secrets.NOOK_REGISTRY_USERNAME",
        "secrets.NOOK_REGISTRY_REMOTE_USERNAME",
        "github.event_name == 'push' && github.ref == 'refs/heads/main' && secrets.NOOK_REGISTRY_USERNAME || secrets.NOOK_REGISTRY_REMOTE_USERNAME",
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
    assert_eq!(
        checks
            .matches(
                "cache-write: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' && 'true' || 'false' }}"
            )
            .count(),
        4,
        "every Bake-backed ecosystem job must seed Main and isolate PR cache writes"
    );
    let docker_tasks = read("nook-app/nook-platform/docker/Taskfile.yml")?;
    let platform_tasks = read("nook-app/nook-platform/Taskfile.yml")?;
    let preflight_tasks = read("preflight/Taskfile.yml")?;
    let minds_tasks = read("agentic-ai/minds/Taskfile.yml")?;
    let root_tasks = read("Taskfile.yml")?;
    for marker in [
        "docker:rust-base:",
        "docker:ecosystem:policy-tools:",
        "docker:ecosystem:nightly:",
        "docker:ecosystem:nightly:verify:",
        "docker:ecosystem:dependency-policy:",
        "docker:ecosystem:dependency-policy:run:",
        "bash -c \"set -euo pipefail;",
        "rust-ecosystem-policy-tools.output=type=cacheonly",
        "docker:ecosystem:deterministic:",
        "docker:ecosystem:fuzz:",
        "docker:ecosystem:dylint:",
        "docker:ci:cache:publish:rust-base:",
        "rust-ecosystem-policy-tools",
        "rust-ecosystem-deterministic",
        "rust-fuzz-smoke",
        "rust-dylint",
        "rust-ecosystem-nightly",
        "sccache:ensure",
        "rust-ecosystem-nightly-publish",
        "GHA_CACHE_WRITE_ENABLED=",
        "task: docker:rust-base",
        "task: docker:ecosystem:policy-tools",
        "task: docker:ecosystem:nightly:verify",
        "task: docker:ci:cache:publish:rust-base",
        "task: rust:dependency-policy",
        "task: preflight:dependency-policy",
        "task: fuzz:dependency-policy",
        "task: minds:dependency-policy",
        "preflight-test",
        "GHA_CACHE_WRITE_ENABLED",
        "DOCKER_POLICY_TOOLS_IMAGE",
        "cargo-deny --manifest-path",
        "cargo-audit audit --quiet",
    ] {
        assert!(
            docker_tasks.contains(marker),
            "docker Taskfile is missing ecosystem marker {marker}"
        );
    }
    assert!(
        !docker_tasks.contains("bash -lc \""),
        "policy-tools docker run must not use a login shell that resets PATH"
    );
    assert!(
        platform_tasks.contains("rust:dependency-policy:")
            && platform_tasks.contains("fuzz:dependency-policy:")
            && platform_tasks.contains("WORKSPACE: nook-app/nook-platform/fuzz")
            && preflight_tasks.contains("preflight:dependency-policy:")
            && minds_tasks.contains("minds:dependency-policy:")
            && !root_tasks.contains("taskfile: fuzz/Taskfile.yml")
            && root_tasks.contains("taskfile: agentic-ai/minds/Taskfile.yml"),
        "each Rust workspace must own dependency-policy in its Taskfile"
    );
    assert!(
        !docker_tasks.contains("rust-dependency-policy")
            && !repository_root()
                .join("nook-app/nook-platform/docker/rust/dependency-policy.Dockerfile")
                .exists(),
        "aggregate dependency-policy Dockerfile/Bake leaf must be removed"
    );
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
        "AS rust-ecosystem-nightly",
        "AS rust-platform-nightly",
        "AS rust-fuzz-smoke",
        "AS rust-dylint",
        "AS rust-ecosystem-deterministic",
        "CARGO_DENY_SHA256=",
        "CARGO_AUDIT_SHA256=",
        "CARGO_FUZZ_SHA256=",
        "DYLINT_NIGHTLY=nightly-2026-04-16",
        "cargo install cargo-dylint dylint-link",
        "COPY nook-app/nook-platform/ nook-app/nook-platform/",
        "cargo fuzz run",
        "cargo dylint --all",
    ] {
        assert!(
            rust_dockerfile.contains(marker),
            "docker/rust Dockerfiles are missing ecosystem marker {marker}"
        );
    }
    let nightly_dockerfile = read("nook-app/nook-platform/docker/rust/nightly.Dockerfile")?;
    let dylint_dockerfile = read("nook-app/nook-platform/docker/rust/dylint.Dockerfile")?;
    let fuzz_dockerfile = read("nook-app/nook-platform/docker/rust/fuzz-smoke.Dockerfile")?;
    assert!(
        nightly_dockerfile.contains("FROM rust-ecosystem-nightly AS rust-platform-nightly")
            && nightly_dockerfile.contains("COPY nook-app/nook-platform/ nook-app/nook-platform/"),
        "nightly.Dockerfile must own the platform source overlay for dylint/fuzz"
    );
    assert!(
        dylint_dockerfile.contains("FROM rust-platform-nightly AS rust-dylint")
            && fuzz_dockerfile.contains("FROM rust-platform-nightly AS rust-fuzz-smoke")
            && !dylint_dockerfile.contains("COPY nook-app/nook-platform/")
            && !fuzz_dockerfile.contains("COPY nook-app/nook-platform/"),
        "dylint/fuzz leaves must not re-copy platform sources"
    );
    assert!(
        docker_tasks.contains("--hide-inclusion-graph")
            && docker_tasks.contains("--log-level error"),
        "per-workspace dependency-policy runner must keep deny flags"
    );
    // Ecosystem CLIs stay in sibling Dockerfiles so rust-base product builds stay lean.
    for forbidden in [
        "CARGO_DENY_SHA256=",
        "CARGO_AUDIT_SHA256=",
        "CARGO_FUZZ_SHA256=",
        "cargo install cargo-dylint",
    ] {
        assert!(
            !rust_lineage_dockerfile.contains(forbidden),
            "lineage.Dockerfile/rust-base must not install ecosystem CLI {forbidden}"
        );
    }

    for target in [
        "rust-ecosystem-policy-tools",
        "rust-ecosystem-nightly",
        "rust-platform-nightly",
        "rust-fuzz-smoke",
        "rust-dylint",
        "rust-ecosystem-deterministic",
    ] {
        assert!(
            rust_bake.contains(&format!("target \"{target}\"")),
            "docker/rust/docker-bake.hcl is missing target {target}"
        );
    }
    assert!(
        !rust_bake.contains("target \"rust-dependency-policy\"")
            && rust_bake.contains("cache-to   = rust_ecosystem_policy_tools_cache_to")
            && rust_bake
                .matches("cache-to   = rust_ecosystem_policy_tools_cache_to")
                .count()
                == 1
            && rust_bake.contains("tags       = [DOCKER_POLICY_TOOLS_IMAGE]")
            && rust_bake.contains("output     = [\"type=docker\"]"),
        "policy-tools must be the only deny/audit Bake target and load a runnable image"
    );
    assert!(
        rust_bake.contains("target \"rust-ecosystem-nightly-publish\"")
            && rust_bake.contains("cache-to   = rust_ecosystem_nightly_cache_to")
            && rust_bake
                .matches("cache-to   = rust_ecosystem_nightly_cache_to")
                .count()
                == 1
            && !rust_bake
                .split("target \"rust-ecosystem-nightly\" {")
                .nth(1)
                .and_then(|tail| tail.split("target \"").next())
                .unwrap_or("")
                .lines()
                .any(|line| line.trim_start().starts_with("cache-to"))
            && rust_bake.contains("cache-to   = rust_ecosystem_dylint_cache_to")
            && rust_bake.contains("cache-to   = rust_ecosystem_fuzz_cache_to")
            && rust_bake.contains("cache-from = rust_ecosystem_dylint_cache_from")
            && rust_bake.contains("cache-from = rust_ecosystem_fuzz_cache_from"),
        "nightly-publish alone writes the shared nightly scope; context nightly has no cache-to; dylint/fuzz write leaf scopes"
    );
    let preflight_bake = read("preflight/docker-bake.hcl")?;
    let nightly_from = rust_bake
        .split("rust_ecosystem_nightly_cache_from =")
        .nth(1)
        .and_then(|tail| tail.split("rust_ecosystem_nightly_cache_to =").next())
        .unwrap_or("");
    let policy_tools_from = rust_bake
        .split("rust_ecosystem_policy_tools_cache_from =")
        .nth(1)
        .and_then(|tail| tail.split("rust_ecosystem_policy_tools_cache_to =").next())
        .unwrap_or("");
    let deps_from = rust_bake
        .split("rust_deps_cache_from =")
        .nth(1)
        .and_then(|tail| tail.split("rust_deps_cache_to =").next())
        .unwrap_or("");
    let preflight_from = preflight_bake
        .split("preflight_cache_from =")
        .nth(1)
        .and_then(|tail| tail.split("preflight_cache_to =").next())
        .unwrap_or("");
    let dylint_from = rust_bake
        .split("rust_ecosystem_dylint_cache_from =")
        .nth(1)
        .and_then(|tail| tail.split("rust_ecosystem_dylint_cache_to =").next())
        .unwrap_or("");
    let fuzz_from = rust_bake
        .split("rust_ecosystem_fuzz_cache_from =")
        .nth(1)
        .and_then(|tail| tail.split("rust_ecosystem_fuzz_cache_to =").next())
        .unwrap_or("");
    let pr_isolated_rust_base =
        "nook-rust-base-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true";
    let trusted_rust_base = "nook/buildcache/nook-rust-base-v1:buildcache";
    let native_source_from = rust_bake
        .split("rust_native_source_cache_from =")
        .nth(1)
        .and_then(|tail| tail.split("rust_native_source_cache_to =").next())
        .unwrap_or("");
    assert!(
        !nightly_from.contains(trusted_rust_base)
            && !nightly_from.contains(pr_isolated_rust_base)
            && !policy_tools_from.contains(trusted_rust_base)
            && !policy_tools_from.contains(pr_isolated_rust_base)
            && !preflight_from.contains(trusted_rust_base)
            && !preflight_from.contains(pr_isolated_rust_base)
            && !deps_from.contains(trusted_rust_base)
            && !deps_from.contains(pr_isolated_rust_base)
            && !deps_from.contains("nook-rust-base-v1")
            && !native_source_from.contains("nook-rust-base-v1"),
        "ecosystem/preflight/native deps+source must not import rust-base short parents"
    );
    assert!(
        deps_from.contains("nook-rust-deps-v3")
            && native_source_from.contains("nook-rust-native-source-v3")
            && native_source_from.contains("nook-rust-deps-v3"),
        "native deps/source must restore the v3 own scopes after leaving short-chain rust-base"
    );
    assert!(
        nightly_from.contains("nook/buildcache/nook-rust-ecosystem-nightly-v4")
            && policy_tools_from.contains("nook/buildcache/nook-rust-ecosystem-policy-tools-v4"),
        "nightly/policy-tools FALLBACK must restore fat Main indexes so PR verify is not cold"
    );
    assert!(
        dylint_from.contains("nook-rust-ecosystem-dylint-v2")
            && fuzz_from.contains("nook-rust-ecosystem-fuzz-v2")
            && !dylint_from.contains("nook-rust-ecosystem-nightly")
            && !fuzz_from.contains("nook-rust-ecosystem-nightly")
            && !dylint_from.contains("nook-rust-base-v1")
            && !fuzz_from.contains("nook-rust-base-v1"),
        "dylint/fuzz leaf cache-from must be own-scope only (no nightly/rust-base short parents)"
    );
    assert!(
        rust_bake.contains("rust-ecosystem-nightly = \"target:rust-ecosystem-nightly\"")
            && rust_bake.contains("rust-platform-nightly = \"target:rust-platform-nightly\"")
            && rust_bake.contains("rust-platform = \"target:rust-platform\"")
            && rust_bake.contains("rust-base = \"target:rust-base\"")
            && rust_bake.contains("target \"rust-base-publish\"")
            && docker_tasks.contains("rust-base-publish")
            && docker_tasks.contains("rust-ecosystem-nightly-publish")
            && !docker_tasks.contains("cache-from=\"")
            && !docker_tasks.contains("cache-from='")
            && !docker_tasks.contains("cache-to=\"")
            && !docker_tasks.contains("cache-to='"),
        "ecosystem leaves restore context parents without cache-to; scoped *-publish targets own writes"
    );
    assert!(
        rust_bake.contains("nook-rust-ecosystem-policy-tools-v4")
            && rust_bake.contains("nook-rust-ecosystem-nightly-v4"),
        "policy-tools and nightly must keep dedicated hosted cache scopes"
    );
    assert!(
        rust_bake.contains("cache-from = rust_ecosystem_deterministic_cache_from")
            && rust_bake.contains("cache-to   = rust_ecosystem_deterministic_cache_to"),
        "ecosystem deterministic must seed its own hosted cache above rust-deps"
    );

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
    assert!(
        repository_root()
            .join("nook-app/nook-platform/.insta.yaml")
            .is_file()
    );
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
        "nook-app/nook-platform/clippy.toml",
        "preflight/clippy.toml",
        "agentic-ai/minds/clippy.toml",
        "nook-app/nook-platform/fuzz/clippy.toml",
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
