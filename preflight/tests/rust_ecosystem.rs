use std::path::{Path, PathBuf};
use std::{env, fs, ops::Deref};

struct RepositoryFixture {
    path: PathBuf,
}
impl RepositoryFixture {
    fn repository_root() -> Self {
        Self {
            path: env::var_os("NOOK_REPO_ROOT").map_or_else(
                || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
                PathBuf::from,
            ),
        }
    }
}
impl Deref for RepositoryFixture {
    type Target = PathBuf;
    fn deref(&self) -> &PathBuf {
        &self.path
    }
}
impl AsRef<Path> for RepositoryFixture {
    fn as_ref(&self) -> &Path {
        &self.path
    }
}

impl RepositoryFixture {
    fn read(&self, relative_path: &str) -> anyhow::Result<String> {
        Ok(fs::read_to_string(self.join(relative_path))?)
    }
}

#[test]
fn dependency_policy_allows_main_cache_seed_latency() -> anyhow::Result<()> {
    let checks =
        RepositoryFixture::repository_root().read(".github/workflows/rust-ecosystem-checks.yml")?;
    let dependency_policy = checks
        .split_once("  dependency-policy:")
        .and_then(|(_, jobs)| jobs.split_once("\n  deterministic-tests:"))
        .map(|(job, _)| job)
        .ok_or_else(|| anyhow::anyhow!("dependency-policy job block is missing"))?;

    assert!(
        dependency_policy.contains("timeout-minutes: 5")
            && dependency_policy.contains("task docker:ecosystem:dependency-policy"),
        "dependency policy must retain its command within the five-minute job limit"
    );

    Ok(())
}

#[test]
fn dependency_policy_discards_fresh_downloads_before_snapshotting() -> anyhow::Result<()> {
    DependencyPolicyCacheContract::load()?.assert_bounded_fresh_results()
}

struct DependencyPolicyCacheContract {
    dockerfile: String,
}

impl DependencyPolicyCacheContract {
    fn load() -> anyhow::Result<Self> {
        Ok(Self {
            dockerfile: RepositoryFixture::repository_root()
                .read("nook-app/nook-platform/docker/rust/policy-tools.Dockerfile")?,
        })
    }

    fn assert_bounded_fresh_results(&self) -> anyhow::Result<()> {
        let (tools, policy) = self
            .dockerfile
            .split_once("FROM rust-ecosystem-policy-tools AS rust-ecosystem-dependency-policy")
            .ok_or_else(|| anyhow::anyhow!("dependency-policy stage is missing"))?;
        assert!(tools.contains("COPY nook-app/nook-platform/dylint/nook-domain-api/rust-toolchain /opt/nook/policy-nightly/rust-toolchain"));
        assert!(tools.contains("RUN cd /opt/nook/policy-nightly && rustc --version"));
        assert!(
            !tools.contains("ARG DYLINT_NIGHTLY"),
            "policy must consume the owning toolchain declaration, not duplicate its pin"
        );
        let cleanup = policy
            .find("trap 'rm -rf /tmp/nook-policy-cargo /tmp/nook-policy-repository' EXIT")
            .ok_or_else(|| {
                anyhow::anyhow!("fresh policy downloads must be cleaned on shell exit")
            })?;
        let seed = policy
            .find("cp -a /usr/local/cargo /tmp/nook-policy-cargo")
            .ok_or_else(|| anyhow::anyhow!("policy must preserve immutable Cargo inputs"))?;
        let cargo_home = policy
            .find("export CARGO_HOME=/tmp/nook-policy-cargo")
            .ok_or_else(|| {
                anyhow::anyhow!("policy downloads must use the disposable Cargo home")
            })?;
        let deny = policy
            .find("&& cargo-deny --manifest-path")
            .ok_or_else(|| anyhow::anyhow!("cargo-deny invocation is missing"))?;
        let audit = policy
            .find("&& cargo-audit audit --quiet")
            .ok_or_else(|| anyhow::anyhow!("cargo-audit invocation is missing"))?;
        assert!(cleanup < seed && seed < cargo_home && cargo_home < deny && deny < audit);
        assert!(policy.contains("test -n \"$POLICY_RUN_NONCE\""));
        assert!(!policy.contains("|| true") && !policy.contains("--offline"));
        Ok(())
    }
}

struct RustEcosystemFixture {
    root: RepositoryFixture,
    entry: String,
    checks: String,
    main: String,
    pr: String,
    quality: String,
    workspace: String,
    dylint_manifest: String,
    rust_base_dockerfile: String,
    rust_dockerfiles: String,
    rust_bake: String,
    replication: String,
    fuzz_target: String,
    fuzz_manifest: String,
    dependency_policy: String,
    docker_tasks: String,
    platform_tasks: String,
    preflight_tasks: String,
    root_tasks: String,
    nightly_dockerfile: String,
    preflight_bake: String,
}

impl RustEcosystemFixture {
    fn load() -> anyhow::Result<Self> {
        let root = RepositoryFixture::repository_root();
        let checks = root.read(".github/workflows/rust-ecosystem-checks.yml")?;
        let dependency_policy = checks
            .split_once("  dependency-policy:")
            .and_then(|(_, jobs)| jobs.split_once("  deterministic-tests:"))
            .map_or_else(String::new, |(job, _)| job.to_owned());
        let rust_dockerfiles = [
            "nook-app/nook-platform/docker/rust/product.Dockerfile",
            "nook-app/nook-platform/docker/rust/policy-tools.Dockerfile",
            "nook-app/nook-platform/docker/rust/nightly.Dockerfile",
        ]
        .into_iter()
        .map(|path| root.read(path))
        .collect::<anyhow::Result<Vec<_>>>()?
        .join("\n");

        Ok(Self {
            entry: root.read(".github/workflows/ci.yml")?,
            checks,
            main: root.read(".github/workflows/main.yml")?,
            pr: root.read(".github/workflows/pr.yml")?,
            quality: root.read(".cortex/teams/sre/workflows/quality.md")?,
            workspace: root.read("nook-app/nook-platform/Cargo.toml")?,
            dylint_manifest: root
                .read("nook-app/nook-platform/dylint/nook-domain-api/Cargo.toml")?,
            rust_base_dockerfile: root
                .read("nook-app/nook-platform/docker/rust/product.Dockerfile")?,
            rust_dockerfiles,
            rust_bake: root.read("nook-app/nook-platform/docker/rust/docker-bake.hcl")?,
            replication: root
                .read("nook-app/nook-platform/nook-replication/src/replica_store.rs")?,
            fuzz_target: root.read("nook-app/nook-platform/fuzz/fuzz_targets/wire_parsers.rs")?,
            fuzz_manifest: root.read("nook-app/nook-platform/fuzz/Cargo.toml")?,
            dependency_policy,
            docker_tasks: root.read("nook-app/nook-platform/docker/Taskfile.yml")?,
            platform_tasks: root.read("nook-app/nook-platform/Taskfile.yml")?,
            preflight_tasks: root.read("preflight/Taskfile.yml")?,
            root_tasks: root.read("Taskfile.yml")?,
            nightly_dockerfile: root
                .read("nook-app/nook-platform/docker/rust/nightly.Dockerfile")?,
            preflight_bake: root.read("preflight/docker-bake.hcl")?,
            root,
        })
    }
}

#[test]
fn rust_ecosystem_checks_remain_configured_and_executable() -> anyhow::Result<()> {
    let fixture = RustEcosystemFixture::load()?;

    assert!(
        fixture
            .pr
            .contains("uses: ./.github/workflows/rust-ecosystem-checks.yml"),
        "Labeled product PRs must call the shared Rust ecosystem checks"
    );
    assert!(
        fixture
            .entry
            .contains("uses: ./.github/workflows/rust-ecosystem-checks.yml"),
        "Central ci.yml must call the shared Rust ecosystem checks"
    );
    for marker in [
        "github.event_name == 'schedule'",
        "github.event_name == 'workflow_dispatch'",
    ] {
        assert!(
            fixture.entry.contains(marker),
            "central CI routing missing: {marker}"
        );
    }
    assert!(
        fixture
            .main
            .contains("uses: ./.github/workflows/rust-ecosystem-checks.yml")
            && fixture.main.contains("fuzz_seconds: \"20\"")
            && fixture.main.contains("isolated_cache_write: \"false\""),
        "Main must call the shared Rust ecosystem checks in its own run"
    );
    assert!(
        fixture
            .main
            .contains("runs-on: ${{ vars.NOOK_RUNS_ON || 'nook-k0s' }}")
            && fixture
                .pr
                .contains("github.event.pull_request.head.repo.full_name == github.repository")
            && fixture
                .pr
                .contains("(vars.NOOK_RUNS_ON || 'nook-k0s') || 'ubuntu-latest'")
            && fixture
                .checks
                .lines()
                .filter(|line| {
                    line.trim_start().starts_with("runs-on:")
                        && line.contains(
                            "github.event.pull_request.head.repo.full_name == github.repository",
                        )
                        && line
                            .contains("github.event.pull_request.user.login != 'dependabot[bot]'")
                        && line.contains("(vars.NOOK_RUNS_ON || 'nook-k0s') || 'ubuntu-latest'")
                })
                .count()
                == 3,
        "trusted native/ecosystem Rust jobs must use configured ARC while forks fall back hosted"
    );
    assert!(fixture.entry.contains("branches: [main]"));
    assert!(
        fixture.main.contains("workflow_call:")
            && fixture.main.contains("if: inputs.product_changed")
    );
    assert!(
        fixture
            .dependency_policy
            .contains("name: Dependency policy and RustSec")
            && fixture.dependency_policy.contains("timeout-minutes: 5"),
        "Dependency policy must enforce the five-minute job limit"
    );
    assert!(
        !fixture.entry.contains("Run dependency policy")
            && !fixture.entry.contains("Bake rust-dependency-policy"),
        "Central ci.yml must not duplicate dependency-policy steps"
    );

    Ok(())
}

#[test]
fn rust_ecosystem_jobs_keep_their_shared_execution_contract() -> anyhow::Result<()> {
    let fixture = RustEcosystemFixture::load()?;

    for marker in [
        "Run dependency policy",
        "Run deterministic tests, fuzz smoke, and Kani in parallel",
        "Bake rust-dylint",
        "task docker:ecosystem:dependency-policy",
        "task docker:ecosystem:smoke",
        "task docker:ecosystem:dylint",
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
            fixture.checks.contains(marker),
            "Shared Rust ecosystem checks are missing {marker}"
        );
    }
    for selection in [
        "ecosystem-policy-tools",
        "ecosystem-smoke",
        "ecosystem-dylint",
    ] {
        assert_eq!(
            fixture
                .checks
                .matches(&format!("cache-selection: {selection}"))
                .count(),
            1,
            "each ecosystem job must select only its owned cache probe lineage"
        );
    }
    assert!(
        !fixture.checks.contains("docker-bake-sccache.sh")
            && !fixture.checks.contains("NOOK_BAKE_FILES")
            && !fixture.checks.contains("docker buildx bake"),
        "Rust ecosystem checks must invoke Taskfile tasks instead of Bake helpers"
    );
    assert_eq!(
        fixture
            .checks
            .matches(
                "cache-write: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' && 'true' || 'false' }}"
            )
            .count(),
        3,
        "every Bake-backed ecosystem job must seed Main and isolate PR cache writes"
    );

    Ok(())
}

#[test]
fn rust_ecosystem_taskfiles_keep_workspace_ownership() -> anyhow::Result<()> {
    let fixture = RustEcosystemFixture::load()?;

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
        "task: preflight:dependency-policy",
        "task: fuzz:dependency-policy",
        "preflight-test",
        "GHA_CACHE_WRITE_ENABLED",
    ] {
        assert!(
            fixture.docker_tasks.contains(marker),
            "docker Taskfile is missing ecosystem marker {marker}"
        );
    }
    assert!(
        !fixture.docker_tasks.contains("docker run")
            && !fixture.docker_tasks.contains("type=docker"),
        "dependency policy must remain BuildKit-only without daemon image export/load"
    );
    assert!(
        fixture.docker_tasks.contains(
            "if [ -n \"${GHA_CACHE_WRITE_ENABLED:-}\" ] || [ \"${NOOK_REGISTRY_CACHE_LOCAL_PUBLISH:-}\" = \"1\" ]"
        ) && fixture
            .docker_tasks
            .contains("GHA_CACHE_WRITE_ENABLED=1 {{.DOCKER}} buildx bake"),
        "policy-tools must translate explicit local publication into a cache-only Zot write"
    );
    assert!(
        fixture.platform_tasks.contains("dylint:dependency-policy:")
            && fixture
                .platform_tasks
                .contains("WORKSPACE: nook-app/nook-platform/dylint/nook-domain-api")
            && fixture.platform_tasks.contains("rust:dependency-policy:")
            && fixture.platform_tasks.contains("fuzz:dependency-policy:")
            && fixture
                .platform_tasks
                .contains("WORKSPACE: nook-app/nook-platform/fuzz")
            && fixture
                .preflight_tasks
                .contains("preflight:dependency-policy:")
            && !fixture.root_tasks.contains("taskfile: fuzz/Taskfile.yml")
            && fixture
                .docker_tasks
                .contains("task: dylint:dependency-policy\n      - task: rust:dependency-policy"),
        "each Rust workspace must own dependency-policy in its Taskfile"
    );
    assert!(
        fixture
            .docker_tasks
            .contains("rust-ecosystem-dependency-policy")
            && !fixture
                .root
                .join("nook-app/nook-platform/docker/rust/dependency-policy.Dockerfile")
                .exists(),
        "dependency policy must use the parameterized policy-tools Dockerfile target"
    );

    Ok(())
}

#[test]
fn rust_ecosystem_taskfiles_reject_host_toolchain_shortcuts() -> anyhow::Result<()> {
    let fixture = RustEcosystemFixture::load()?;

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
            !fixture.checks.contains(forbidden),
            "Rust ecosystem checks must not use host-toolchain path: {forbidden}"
        );
    }
    assert!(
        !fixture.checks.contains("model-checking/kani-github-action")
            && fixture
                .docker_tasks
                .contains("task docker:ecosystem:kani & kani_pid=$!"),
        "Kani proof compilation must run through the BuildKit-cached Task target"
    );

    Ok(())
}

#[test]
fn rust_ecosystem_dockerfiles_keep_split_toolchain_ownership() -> anyhow::Result<()> {
    let fixture = RustEcosystemFixture::load()?;

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
        "cargo fmt --manifest-path dylint/nook-domain-api/Cargo.toml -- --check",
        "rustfmt --edition 2024 --check dylint/nook-domain-api/ui/*.rs",
        "RUSTC_WRAPPER= RUSTFLAGS= cargo llvm-cov test -p nook_domain_api",
        "cargo clippy --manifest-path dylint/nook-domain-api/Cargo.toml --locked --all-targets -- -D warnings",
        "cargo dylint --all",
        "--manifest-path dylint/nook-domain-api/Cargo.toml",
        "KANI_VERSION=0.67.0",
        "cargo kani setup",
        "cargo kani --package nook-replication",
    ] {
        assert!(
            fixture.rust_dockerfiles.contains(marker),
            "docker/rust Dockerfiles are missing ecosystem marker {marker}"
        );
    }
    assert!(
        !fixture.nightly_dockerfile.contains("rust-platform-nightly")
            && fixture
                .nightly_dockerfile
                .contains("FROM rust-ecosystem-nightly AS rust-dylint-build")
            && fixture
                .nightly_dockerfile
                .contains("FROM rust-dylint-build AS rust-dylint-self-test")
            && fixture
                .nightly_dockerfile
                .contains("FROM rust-dylint-build AS rust-dylint-native")
            && fixture
                .nightly_dockerfile
                .contains("FROM rust-dylint-build AS rust-dylint-wasm")
            && fixture
                .nightly_dockerfile
                .contains("FROM rust-dylint-native AS rust-dylint")
            && fixture
                .nightly_dockerfile
                .contains("FROM rust-ecosystem-nightly AS rust-fuzz-smoke")
            && fixture
                .nightly_dockerfile
                .contains("--manifest-path dylint/nook-domain-api/Cargo.toml --locked")
            && fixture
                .nightly_dockerfile
                .matches("COPY nook-app/nook-platform/ nook-app/nook-platform/")
                .count()
                == 3,
        "one nightly Dockerfile must own shared tools, split Dylint leaves, and fuzz"
    );
    assert!(
        fixture.rust_dockerfiles.contains("--hide-inclusion-graph")
            && fixture.rust_dockerfiles.contains("--log-level error")
            && fixture
                .rust_dockerfiles
                .contains("cargo-audit audit --quiet")
            && fixture
                .rust_dockerfiles
                .contains("test -n \"$POLICY_RUN_NONCE\""),
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
            !fixture.rust_base_dockerfile.contains(forbidden),
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
            fixture.rust_bake.contains(&format!("target \"{target}\"")),
            "docker/rust/docker-bake.hcl is missing target {target}"
        );
    }

    Ok(())
}

#[test]
fn rust_ecosystem_build_cache_policy_keeps_checks_cache_only() -> anyhow::Result<()> {
    let fixture = RustEcosystemFixture::load()?;

    assert!(
        fixture
            .rust_bake
            .contains("target \"rust-ecosystem-dependency-policy\"")
            && fixture
                .rust_bake
                .contains("cache-to   = rust_ecosystem_policy_tools_cache_to")
            && fixture
                .rust_bake
                .matches("cache-to   = rust_ecosystem_policy_tools_cache_to")
                .count()
                == 1
            && fixture
                .rust_bake
                .matches("output     = [\"type=cacheonly\"]")
                .count()
                >= 2
            && !fixture.rust_bake.contains("type=docker")
            && !fixture.rust_bake.contains("DOCKER_POLICY_TOOLS_IMAGE"),
        "policy tools and dependency checks must stay cache-only without Docker export/load"
    );
    assert!(
        !fixture
            .rust_bake
            .contains("target \"rust-ecosystem-nightly")
            && !fixture.rust_bake.contains("rust_ecosystem_nightly_cache_")
            && fixture
                .rust_bake
                .contains("cache-to   = rust_ecosystem_dylint_cache_to")
            && fixture
                .rust_bake
                .contains("cache-to   = rust_ecosystem_fuzz_cache_to")
            && fixture
                .rust_bake
                .contains("cache-from = rust_ecosystem_dylint_cache_from")
            && fixture
                .rust_bake
                .contains("cache-from = rust_ecosystem_fuzz_cache_from"),
        "dylint/fuzz full-graph leaf scopes must replace the standalone nightly cache lane"
    );

    Ok(())
}

#[test]
fn rust_ecosystem_build_cache_avoids_short_parent_scopes() -> anyhow::Result<()> {
    let fixture = RustEcosystemFixture::load()?;

    let policy_tools_from = fixture
        .rust_bake
        .split("rust_ecosystem_policy_tools_cache_from =")
        .nth(1)
        .and_then(|tail| tail.split("rust_ecosystem_policy_tools_cache_to =").next())
        .unwrap_or("");
    let deps_from = fixture
        .rust_bake
        .split("rust_deps_cache_from =")
        .nth(1)
        .and_then(|tail| tail.split("rust_deps_cache_to =").next())
        .unwrap_or("");
    let preflight_from = fixture
        .preflight_bake
        .split("preflight_cache_from =")
        .nth(1)
        .and_then(|tail| tail.split("preflight_cache_to =").next())
        .unwrap_or("");
    let dylint_from = fixture
        .rust_bake
        .split("rust_ecosystem_dylint_cache_from =")
        .nth(1)
        .and_then(|tail| tail.split("rust_ecosystem_dylint_cache_to =").next())
        .unwrap_or("");
    let fuzz_from = fixture
        .rust_bake
        .split("rust_ecosystem_fuzz_cache_from =")
        .nth(1)
        .and_then(|tail| tail.split("rust_ecosystem_fuzz_cache_to =").next())
        .unwrap_or("");
    let pr_isolated_rust_base =
        "nook-rust-base-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache,ignore-error=true";
    let trusted_rust_base = "nook/buildcache/nook-rust-base-v2:buildcache";
    let native_source_from = fixture
        .rust_bake
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

    Ok(())
}

#[test]
fn rust_ecosystem_build_cache_lineage_stays_owned_by_each_leaf() -> anyhow::Result<()> {
    let fixture = RustEcosystemFixture::load()?;

    assert!(
        !fixture
            .rust_bake
            .contains("rust-ecosystem-nightly = \"target:rust-ecosystem-nightly\"")
            && !fixture.rust_bake.contains("rust-platform-nightly")
            && fixture
                .rust_bake
                .matches("dockerfile = \"nook-app/nook-platform/docker/rust/nightly.Dockerfile\"")
                .count()
                == 2
            && !fixture
                .rust_bake
                .contains("rust-platform = \"target:rust-platform\"")
            && fixture
                .rust_bake
                .matches("rust-base = \"target:rust-base\"")
                .count()
                == 4
            && fixture.rust_bake.contains("target \"rust-base-publish\"")
            && fixture.docker_tasks.contains("rust-base-publish")
            && !fixture.docker_tasks.contains("cache-from=\"")
            && !fixture.docker_tasks.contains("cache-from='")
            && !fixture.docker_tasks.contains("cache-to=\"")
            && !fixture.docker_tasks.contains("cache-to='"),
        "external ecosystem Dockerfiles link read-only rust-base, product stages stay internal, and scoped publishers own writes"
    );
    assert!(
        fixture
            .rust_bake
            .contains("nook-rust-ecosystem-policy-tools-v5")
            && fixture.rust_bake.contains("nook-rust-ecosystem-dylint-v4")
            && fixture.rust_bake.contains("nook-rust-ecosystem-fuzz-v4"),
        "policy-tools and nightly leaves must keep dedicated hosted cache scopes"
    );
    assert!(
        fixture
            .rust_bake
            .contains("cache-from = rust_ecosystem_deterministic_cache_from")
            && fixture
                .rust_bake
                .contains("cache-to   = rust_ecosystem_deterministic_cache_to"),
        "ecosystem deterministic must seed its own hosted cache above rust-deps"
    );
    assert!(
        fixture.rust_bake.contains("nook-rust-ecosystem-kani-v2")
            && fixture
                .rust_bake
                .contains("cache-from = rust_ecosystem_kani_cache_from")
            && fixture
                .rust_bake
                .contains("cache-to   = rust_ecosystem_kani_cache_to"),
        "Kani proof compilation must own a complete hosted BuildKit cache scope"
    );

    Ok(())
}

#[test]
fn rust_ecosystem_quality_contract_covers_required_tools_and_lints() -> anyhow::Result<()> {
    let fixture = RustEcosystemFixture::load()?;

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
            fixture.quality.contains(capability),
            "Cortex quality guidance is missing {capability}"
        );
    }

    assert!(fixture.root.join("deny.toml").is_file());
    assert!(
        fixture
            .root
            .join("nook-app/nook-platform/.insta.yaml")
            .is_file()
    );
    assert!(
        fixture
            .workspace
            .contains("[workspace.metadata.kani.flags]")
    );
    assert!(
        fixture.dylint_manifest.contains("[lints.clippy]")
            && fixture
                .dylint_manifest
                .contains("all = { level = \"warn\", priority = -1 }")
            && fixture
                .dylint_manifest
                .contains("pedantic = { level = \"warn\", priority = -1 }")
            && fixture.dylint_manifest.contains("expect_used = \"deny\"")
            && fixture.dylint_manifest.contains("unwrap_used = \"deny\"")
    );
    assert!(
        fixture.workspace.contains("[workspace.metadata.dylint]")
            && fixture
                .workspace
                .contains("{ path = \"dylint/nook-domain-api\" }")
    );
    assert!(fixture.replication.contains("proptest!"));
    assert!(
        fixture
            .replication
            .contains("insta::assert_debug_snapshot!")
    );
    assert!(fixture.replication.contains("loom::model"));
    assert!(fixture.replication.contains("#[kani::proof]"));
    assert!(fixture.fuzz_target.contains("fuzz_target!"));
    assert!(fixture.fuzz_manifest.contains("[lints.clippy]"));
    assert!(fixture.fuzz_manifest.contains("expect_used = \"deny\""));
    assert!(fixture.fuzz_manifest.contains("unwrap_used = \"deny\""));
    for relative in [
        "nook-app/nook-platform/clippy.toml",
        "preflight/clippy.toml",
        "nook-app/nook-platform/fuzz/clippy.toml",
    ] {
        let clippy = fixture.root.read(relative)?;
        assert!(
            clippy.contains("allow-expect-in-tests = false"),
            "{relative} must deny expect in tests"
        );
        assert!(
            clippy.contains("allow-unwrap-in-tests = false"),
            "{relative} must deny unwrap in tests"
        );
    }

    Ok(())
}

#[test]
fn ecosystem_policy_replaces_generic_custom_scanners_only() -> anyhow::Result<()> {
    let quality =
        RepositoryFixture::repository_root().read(".cortex/teams/sre/workflows/quality.md")?;

    assert!(quality.contains("Ecosystem tools before bespoke preflight"));
    assert!(quality.contains("Keep `preflight` for Nook-specific"));
    assert!(quality.contains("Do not duplicate an ecosystem tool"));
    Ok(())
}
