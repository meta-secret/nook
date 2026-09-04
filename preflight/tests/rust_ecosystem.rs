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
fn dependency_policy_allows_main_cache_seed_latency() -> anyhow::Result<()> {
    let checks = read(".github/workflows/rust-ecosystem-checks.yml")?;
    let dependency_policy = checks
        .split_once("  dependency-policy:")
        .and_then(|(_, jobs)| jobs.split_once("\n  deterministic-tests:"))
        .map(|(job, _)| job)
        .ok_or_else(|| anyhow::anyhow!("dependency-policy job block is missing"))?;

    assert!(
        dependency_policy.contains("timeout-minutes: 30")
            && dependency_policy.contains("task docker:ecosystem:dependency-policy"),
        "dependency policy must retain its command and allow Main cache-seed latency"
    );

    Ok(())
}

#[test]
fn rust_ecosystem_checks_remain_configured_and_executable() -> anyhow::Result<()> {
    let entry = read(".github/workflows/rust-ecosystem.yml")?;
    let checks = read(".github/workflows/rust-ecosystem-checks.yml")?;
    let main = read(".github/workflows/main.yml")?;
    let pr = read(".github/workflows/pr.yml")?;
    let quality = read(".cortex/teams/sre/workflows/quality.md")?;
    let workspace = read("nook-app/nook-platform/Cargo.toml")?;
    let rust_lineage_dockerfile = read("nook-app/nook-platform/docker/rust/product.Dockerfile")?;
    let rust_dockerfile = [
        "nook-app/nook-platform/docker/rust/product.Dockerfile",
        "nook-app/nook-platform/docker/rust/policy-tools.Dockerfile",
        "nook-app/nook-platform/docker/rust/nightly.Dockerfile",
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
    let dependency_policy = checks
        .split_once("  dependency-policy:")
        .and_then(|(_, jobs)| jobs.split_once("  deterministic-tests:"))
        .map(|(job, _)| job)
        .unwrap_or_default();

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
    for marker in [
        "github.rest.pulls.listFiles",
        "const isIgnoredByProductWorkflow",
        "path.startsWith('.cortex/')",
        "path.startsWith('.cursor/')",
        "path === '.github/workflows/web-research.yml'",
        "path.startsWith('agentic-ai/')",
        "path.startsWith('nook-app/nook-web/nook-web-research/')",
        "files.every((file) => isIgnoredByProductWorkflow(file.filename))",
        "needs.validation-request.outputs.should-run == 'true'",
    ] {
        assert!(
            entry.contains(marker),
            "Thin rust-ecosystem.yml must defer only paths handled by pr.yml: missing {marker}"
        );
    }
    assert!(
        main.contains("uses: ./.github/workflows/rust-ecosystem-checks.yml")
            && main.contains("fuzz_seconds: \"20\"")
            && main.contains("isolated_cache_write: \"false\""),
        "Main must call the shared Rust ecosystem checks in its own run"
    );
    assert!(
        main.contains("runs-on: ${{ vars.NOOK_RUNS_ON || 'nook-k0s' }}")
            && pr.contains("github.event.pull_request.head.repo.full_name == github.repository")
            && pr.contains("(vars.NOOK_RUNS_ON || 'nook-k0s') || 'ubuntu-latest'")
            && checks
                .matches("github.event.pull_request.head.repo.full_name == github.repository")
                .count()
                == 5,
        "trusted native/ecosystem Rust jobs must use configured ARC while forks fall back hosted"
    );
    assert!(
        !entry.contains("\n  push:"),
        "Thin rust-ecosystem.yml must not start a second Main-push run"
    );
    for marker in [
        "- \"!agentic-ai/**\"",
        "- \"agentic-ai/minds/**\"",
        "product-paths:",
        "git diff --name-only \"$BEFORE_SHA\" \"$AFTER_SHA\"",
        "if: needs.product-paths.outputs.changed == 'true'",
    ] {
        assert!(
            main.contains(marker),
            "Main must route minds pushes while gating product jobs: missing {marker}"
        );
    }
    assert!(
        dependency_policy.contains("name: Dependency policy and RustSec")
            && dependency_policy.contains("timeout-minutes: 30"),
        "Dependency policy must retain enough time for a contended ARC cache miss"
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
        "Bake Kani bounded proofs",
        "task docker:ecosystem:dependency-policy",
        "task docker:ecosystem:deterministic",
        "task docker:ecosystem:fuzz",
        "task docker:ecosystem:dylint",
        "task docker:ecosystem:kani",
        "nook-docker-setup",
        "NOOK_SCCACHE_ACCESS_KEY",
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
        5,
        "every Bake-backed ecosystem job must seed Main and isolate PR cache writes"
    );
    let docker_tasks = read("nook-app/nook-platform/docker/Taskfile.yml")?;
    let platform_tasks = read("nook-app/nook-platform/Taskfile.yml")?;
    let preflight_tasks = read("preflight/Taskfile.yml")?;
    let minds_tasks = read("agentic-ai/minds/Taskfile.yml")?;
    let root_tasks = read("Taskfile.yml")?;
    for marker in [
        "docker:rust-base:",
        "rust-base-restore",
        "docker:ecosystem:policy-tools:",
        "docker:ecosystem:dependency-policy:",
        "docker:ecosystem:dependency-policy:run:",
        "rust-ecosystem-dependency-policy.args.WORKSPACE=",
        "rust-ecosystem-dependency-policy.args.POLICY_RUN_NONCE=",
        "docker:ecosystem:deterministic:",
        "docker:ecosystem:kani:",
        "docker:ecosystem:fuzz:",
        "docker:ecosystem:dylint:",
        "docker:ci:cache:publish:rust-base:",
        "rust-ecosystem-policy-tools",
        "rust-ecosystem-deterministic",
        "rust-kani",
        "rust-fuzz-smoke",
        "rust-dylint",
        "sccache:ensure",
        "GHA_CACHE_WRITE_ENABLED=",
        "NOOK_REGISTRY_CACHE_LOCAL_PUBLISH",
        "task: docker:rust-base",
        "task: docker:ecosystem:policy-tools",
        "task: docker:ci:cache:publish:rust-base",
        "task: rust:dependency-policy",
        "task: preflight:dependency-policy",
        "task: fuzz:dependency-policy",
        "task: minds:dependency-policy",
        "preflight-test",
        "GHA_CACHE_WRITE_ENABLED",
    ] {
        assert!(
            docker_tasks.contains(marker),
            "docker Taskfile is missing ecosystem marker {marker}"
        );
    }
    assert!(
        !docker_tasks.contains("docker run") && !docker_tasks.contains("type=docker"),
        "dependency policy must remain BuildKit-only without daemon image export/load"
    );
    assert!(
        docker_tasks.contains(
            "if [ -n \"${GHA_CACHE_WRITE_ENABLED:-}\" ] || [ \"${NOOK_REGISTRY_CACHE_LOCAL_PUBLISH:-}\" = \"1\" ]"
        ) && docker_tasks.contains("GHA_CACHE_WRITE_ENABLED=1 {{.DOCKER}} buildx bake"),
        "policy-tools must translate explicit local publication into a cache-only Zot write"
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
        docker_tasks.contains("rust-ecosystem-dependency-policy")
            && !repository_root()
                .join("nook-app/nook-platform/docker/rust/dependency-policy.Dockerfile")
                .exists(),
        "dependency policy must use the parameterized policy-tools Dockerfile target"
    );
    for forbidden in [
        "rustsec/audit-check",
        "cargo-deny-action",
        "cargo install cargo-audit",
        "cargo install cargo-dylint",
        "cargo kani",
        "kani-verifier",
        "Swatinem/rust-cache",
        "taiki-e/install-action",
        "actions/cache",
        "dtolnay/rust-toolchain",
    ] {
        assert!(
            !checks.contains(forbidden),
            "Rust ecosystem checks must not use host-toolchain path: {forbidden}"
        );
    }
    assert!(
        !checks.contains("model-checking/kani-github-action")
            && checks.contains("task docker:ecosystem:kani"),
        "Kani proof compilation must run through the BuildKit-cached Task target"
    );

    for marker in [
        "AS rust-ecosystem-policy-tools",
        "AS rust-ecosystem-dependency-policy",
        "ARG POLICY_RUN_NONCE",
        "AS rust-ecosystem-nightly",
        "AS rust-fuzz-smoke",
        "AS rust-dylint",
        "AS rust-ecosystem-deterministic",
        "AS rust-kani-toolchain",
        "AS rust-kani",
        "CARGO_DENY_SHA256=",
        "CARGO_AUDIT_SHA256=",
        "CARGO_FUZZ_SHA256=",
        "DYLINT_NIGHTLY=nightly-2026-04-16",
        "cargo install cargo-dylint dylint-link",
        "COPY nook-app/nook-platform/ nook-app/nook-platform/",
        "cargo fuzz run",
        "RUSTC_WRAPPER= RUSTFLAGS= cargo test",
        "cargo dylint --all",
        "--manifest-path dylint/nook-domain-api/Cargo.toml",
        "KANI_VERSION=0.67.0",
        "cargo kani setup",
        "cargo kani --package nook-replication",
    ] {
        assert!(
            rust_dockerfile.contains(marker),
            "docker/rust Dockerfiles are missing ecosystem marker {marker}"
        );
    }
    let nightly_dockerfile = read("nook-app/nook-platform/docker/rust/nightly.Dockerfile")?;
    assert!(
        !nightly_dockerfile.contains("rust-platform-nightly")
            && nightly_dockerfile.contains("FROM rust-ecosystem-nightly AS rust-dylint")
            && nightly_dockerfile.contains("FROM rust-ecosystem-nightly AS rust-fuzz-smoke")
            && nightly_dockerfile
                .contains("--manifest-path dylint/nook-domain-api/Cargo.toml --locked")
            && nightly_dockerfile
                .matches("COPY nook-app/nook-platform/ nook-app/nook-platform/")
                .count()
                == 2,
        "one nightly Dockerfile must own the shared tools and both source leaves"
    );
    assert!(
        rust_dockerfile.contains("--hide-inclusion-graph")
            && rust_dockerfile.contains("--log-level error")
            && rust_dockerfile.contains("cargo-audit audit --quiet")
            && rust_dockerfile.contains("test -n \"$POLICY_RUN_NONCE\""),
        "BuildKit dependency-policy target must refresh deny and audit checks"
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
            "product.Dockerfile/rust-base must not install ecosystem CLI {forbidden}"
        );
    }

    for target in [
        "rust-ecosystem-policy-tools",
        "rust-ecosystem-dependency-policy",
        "rust-fuzz-smoke",
        "rust-dylint",
        "rust-ecosystem-deterministic",
        "rust-kani",
    ] {
        assert!(
            rust_bake.contains(&format!("target \"{target}\"")),
            "docker/rust/docker-bake.hcl is missing target {target}"
        );
    }
    assert!(
        rust_bake.contains("target \"rust-ecosystem-dependency-policy\"")
            && rust_bake.contains("cache-to   = rust_ecosystem_policy_tools_cache_to")
            && rust_bake
                .matches("cache-to   = rust_ecosystem_policy_tools_cache_to")
                .count()
                == 1
            && rust_bake
                .matches("output     = [\"type=cacheonly\"]")
                .count()
                >= 2
            && !rust_bake.contains("type=docker")
            && !rust_bake.contains("DOCKER_POLICY_TOOLS_IMAGE"),
        "policy tools and dependency checks must stay cache-only without Docker export/load"
    );
    assert!(
        !rust_bake.contains("target \"rust-ecosystem-nightly")
            && !rust_bake.contains("rust_ecosystem_nightly_cache_")
            && rust_bake.contains("cache-to   = rust_ecosystem_dylint_cache_to")
            && rust_bake.contains("cache-to   = rust_ecosystem_fuzz_cache_to")
            && rust_bake.contains("cache-from = rust_ecosystem_dylint_cache_from")
            && rust_bake.contains("cache-from = rust_ecosystem_fuzz_cache_from"),
        "dylint/fuzz full-graph leaf scopes must replace the standalone nightly cache lane"
    );
    let preflight_bake = read("preflight/docker-bake.hcl")?;
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
        "nook-rust-base-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true";
    let trusted_rust_base = "nook/buildcache/nook-rust-base-v2:buildcache";
    let native_source_from = rust_bake
        .split("rust_native_source_cache_from =")
        .nth(1)
        .and_then(|tail| tail.split("rust_native_source_cache_to =").next())
        .unwrap_or("");
    assert!(
        !policy_tools_from.contains(trusted_rust_base)
            && !policy_tools_from.contains(pr_isolated_rust_base)
            && !preflight_from.contains(trusted_rust_base)
            && !preflight_from.contains(pr_isolated_rust_base)
            && !deps_from.contains(trusted_rust_base)
            && !deps_from.contains(pr_isolated_rust_base)
            && !deps_from.contains("nook-rust-base-v2")
            && !native_source_from.contains("nook-rust-base-v2"),
        "ecosystem/preflight/native deps+source must not import rust-base short parents"
    );
    assert!(
        deps_from.contains("nook-rust-deps-v4")
            && native_source_from.contains("nook-rust-native-source-v4")
            && native_source_from.contains("nook-rust-deps-v4"),
        "native deps/source must restore the v3 own scopes; source cold fallback may import deps after leaving rust-base"
    );
    assert!(
        policy_tools_from.contains("nook/buildcache/nook-rust-ecosystem-policy-tools-v5"),
        "policy-tools FALLBACK must restore the fat Main index so PR verify is not cold"
    );
    assert!(
        dylint_from.contains("nook-rust-ecosystem-dylint-v4")
            && fuzz_from.contains("nook-rust-ecosystem-fuzz-v4")
            && !dylint_from.contains("nook-rust-ecosystem-nightly")
            && !fuzz_from.contains("nook-rust-ecosystem-nightly")
            && !dylint_from.contains("nook-rust-base-v2")
            && !fuzz_from.contains("nook-rust-base-v2"),
        "dylint/fuzz leaf cache-from must be own-scope only (no nightly/rust-base short parents)"
    );
    assert!(
        !rust_bake.contains("rust-ecosystem-nightly = \"target:rust-ecosystem-nightly\"")
            && !rust_bake.contains("rust-platform-nightly")
            && rust_bake
                .matches("dockerfile = \"nook-app/nook-platform/docker/rust/nightly.Dockerfile\"")
                .count()
                == 2
            && !rust_bake.contains("rust-platform = \"target:rust-platform\"")
            && rust_bake
                .matches("rust-base = \"target:rust-base\"")
                .count()
                == 4
            && rust_bake.contains("target \"rust-base-publish\"")
            && docker_tasks.contains("rust-base-publish")
            && !docker_tasks.contains("cache-from=\"")
            && !docker_tasks.contains("cache-from='")
            && !docker_tasks.contains("cache-to=\"")
            && !docker_tasks.contains("cache-to='"),
        "external ecosystem Dockerfiles link read-only rust-base, product stages stay internal, and scoped publishers own writes"
    );
    assert!(
        rust_bake.contains("nook-rust-ecosystem-policy-tools-v5")
            && rust_bake.contains("nook-rust-ecosystem-dylint-v4")
            && rust_bake.contains("nook-rust-ecosystem-fuzz-v4"),
        "policy-tools and nightly leaves must keep dedicated hosted cache scopes"
    );
    assert!(
        rust_bake.contains("cache-from = rust_ecosystem_deterministic_cache_from")
            && rust_bake.contains("cache-to   = rust_ecosystem_deterministic_cache_to"),
        "ecosystem deterministic must seed its own hosted cache above rust-deps"
    );
    assert!(
        rust_bake.contains("nook-rust-ecosystem-kani-v2")
            && rust_bake.contains("cache-from = rust_ecosystem_kani_cache_from")
            && rust_bake.contains("cache-to   = rust_ecosystem_kani_cache_to"),
        "Kani proof compilation must own a complete hosted BuildKit cache scope"
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
    assert!(
        workspace.contains("[workspace.metadata.dylint]")
            && workspace.contains("{ path = \"dylint/nook-domain-api\" }")
    );
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
    let quality = read(".cortex/teams/sre/workflows/quality.md")?;

    assert!(quality.contains("Ecosystem tools before bespoke preflight"));
    assert!(quality.contains("Keep `preflight` for Nook-specific"));
    assert!(quality.contains("Do not duplicate an ecosystem tool"));
    Ok(())
}
