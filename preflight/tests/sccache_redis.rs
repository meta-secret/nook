#![allow(clippy::unnecessary_wraps)]

use std::{fs, path::PathBuf};

use anyhow::Context;

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

#[test]
fn hive_materializes_test_and_clippy_dependency_graphs_in_parallel() -> anyhow::Result<()> {
    let dockerfile = read("agentic-ai/minds/hive/Dockerfile");
    for required in [
        "FROM fetched-dependencies AS test-dependencies",
        "FROM fetched-dependencies AS clippy-dependencies",
        "FROM clippy-dependencies AS check-source",
        "FROM test-dependencies AS test-source",
        "COPY --from=test-dependencies /opt/nook/hive-test-dependencies",
        "COPY --from=clippy-dependencies /opt/nook/hive-clippy-dependencies",
    ] {
        assert!(
            dockerfile.contains(required),
            "Hive parallel verification cache topology is missing: {required}"
        );
    }
    assert!(
        !dockerfile.contains("AS verification-dependencies"),
        "Hive test and Clippy dependency graphs must not share a serial stage"
    );
    Ok(())
}

#[test]
fn sccache_uses_the_direct_public_tls_endpoint_without_docker_host_routing() -> anyhow::Result<()> {
    let app_tasks = read("nook-app/Taskfile.yml");
    for required in [
        "rediss://redis-ovh-borg-1.bynull.link:6380",
        ".nook/cache/redis-password",
        "no Redis credential; compiling without sccache",
        "direct TLS Redis is unavailable; compiling without remote sccache",
        "direct TLS Redis is healthy",
        "SCCACHE_REDIS_TLS_SERVER_NAME",
        "redis-cli --sni",
        "--set '*.args.SCCACHE_REDIS_ENDPOINT={{.SCCACHE_REDIS_ENDPOINT}}'",
    ] {
        assert!(
            app_tasks.contains(required),
            "direct sccache Redis configuration is missing: {required}"
        );
    }
    assert!(
        !app_tasks.contains("print $4; exit") && !app_tasks.contains("print $2; exit"),
        "pipefail-safe Docker inspection must consume complete output instead of SIGPIPEing the producer"
    );
    assert!(
        app_tasks
            .matches("password_file=\"{{.SCCACHE_REDIS_PASSWORD_FILE}}\"")
            .count()
            >= 2,
        "local runtime checks and mounts must use the resolved Task credential path"
    );
    assert!(
        read(".dockerignore").lines().any(|line| line == ".nook"),
        "ignored local credentials must never enter a Docker build context"
    );

    let bake = read("nook-app/docker-bake.hcl");
    assert!(bake.contains("variable \"SCCACHE_REDIS_ENDPOINT\""));
    assert!(bake.contains("target \"_sccache\""));
    assert!(!bake.contains("extra-hosts"));

    let rust_base = read("nook-app/docker/base.Dockerfile");
    assert!(
        rust_base.contains("ARG SCCACHE_REDIS_ENDPOINT=rediss://redis-ovh-borg-1.bynull.link:6380")
    );
    assert!(rust_base.contains("ENV SCCACHE_REDIS_ENDPOINT=${SCCACHE_REDIS_ENDPOINT}"));
    assert!(rust_base.contains("SCCACHE_SERVER_UDS=/tmp/nook-sccache.sock"));

    for path in [
        "nook-app/Taskfile.yml",
        "nook-app/docker/Taskfile.yml",
        "nook-app/docker-bake.hcl",
        "nook-app/docker/base.Dockerfile",
    ] {
        assert!(
            !read(path).contains("host.docker.internal")
                && !read(path).contains("SCCACHE_REDIS_HOST_IP"),
            "{path} must not route Redis through the Docker host"
        );
    }

    assert!(
        !repository_root()
            .join("nook-app/docker/resolve-docker-host-ip.sh")
            .exists()
    );
    Ok(())
}

#[test]
fn github_actions_keep_remote_credentials_out_of_delivery_builds() -> anyhow::Result<()> {
    assert_hosted_docker_builds_use_buildkit_only();
    assert_workflows_scope_cache_credentials();
    assert_rust_build_cache_boundary();
    Ok(())
}

fn assert_hosted_docker_builds_use_buildkit_only() {
    let action = read(".github/actions/nook-docker-setup/action.yml");
    for required in [
        "NOOK_SCCACHE_BACKEND=direct_compile",
        "NOOK_SCCACHE_BACKEND_REASON=hosted_buildkit_only",
    ] {
        assert!(
            action.contains(required),
            "hosted Docker cache configuration is missing: {required}"
        );
    }
    assert!(
        !action.contains("cache-redis-password")
            && !action.contains("uses: ./.github/actions/nook-cache-connect"),
        "hosted Docker builds must rely on BuildKit without attaching Redis credentials"
    );
    assert!(!action.contains("cloudflare-client"));
    assert!(!action.contains("ssh -fNT") && !action.contains("CACHE_SSH_PRIVATE_KEY"));

    let cache_action = read(".github/actions/nook-cache-connect/action.yml");
    assert!(cache_action.contains("using: node24"));
    assert!(!cache_action.contains("cloudflare"));
    let cache_action_main = read(".github/actions/nook-cache-connect/main.js");
    for required in [
        "mode: 0o700",
        "mode: 0o600",
        "delete process.env[inputName]",
        "SCCACHE_REDIS_PASSWORD_FILE",
        "NOOK_SCCACHE_BACKEND=direct_compile",
        "NOOK_SCCACHE_BACKEND=remote",
        "NOOK_SCCACHE_BACKEND_REASON=persistent_tls_service",
        "hosted_secret_free_by_design",
        "credentials_unavailable",
    ] {
        assert!(
            cache_action_main.contains(required),
            "cache credential action is missing: {required}"
        );
    }
    assert!(!cache_action_main.contains("console."));
    assert!(!cache_action_main.contains("shell: true"));
    assert!(!cache_action_main.contains("process.stdout.write"));
    assert!(!cache_action_main.contains("spawnSync"));
    assert!(!cache_action_main.contains("cloudflare"));
}

fn assert_workflows_scope_cache_credentials() {
    for path in [
        ".github/workflows/agent-implement.yml",
        ".github/workflows/e2e-pr.yml",
        ".github/workflows/pr.yml",
        ".github/workflows/release.yml",
        ".github/workflows/rust-dependency-updates.yml",
    ] {
        let workflow = read(path);
        for secret in ["NOOK_CACHE_REDIS_PASSWORD", "NOOK_CLOUDFLARE_ACCESS"] {
            assert!(
                !workflow.contains(secret),
                "untrusted or arbitrary-ref workflow {path} must not receive {secret}"
            );
        }
    }

    let main = read(".github/workflows/main.yml");
    assert!(
        !main.contains("NOOK_CACHE_REDIS_PASSWORD"),
        "hosted cache publishers must stay secret-free so their BuildKit compiler layers are reusable by PRs"
    );
    assert!(!main.contains("NOOK_CLOUDFLARE_ACCESS"));
}

fn assert_rust_build_cache_boundary() {
    let bake = read("nook-app/docker-bake.hcl");
    let app_tasks = read("nook-app/Taskfile.yml");
    assert!(
        !bake.contains("SCCACHE_REDIS_PASSWORD_FILE")
            && !bake.contains("id=sccache_redis_password")
            && !bake.contains("secret ="),
        "Bake must not attach Redis credentials to hosted Docker builds"
    );
    assert!(
        !app_tasks.contains("SCCACHE_REDIS_BAKE_ALLOW"),
        "Task must not grant BuildKit access to the local Redis credential"
    );

    let wrapper = read("nook-app/docker/sccache-wrapper.sh");
    assert!(wrapper.contains("/run/secrets/sccache_redis_password"));
    assert!(wrapper.contains("NOOK_SCCACHE_REDIS_MODE"));
    assert!(wrapper.contains("exec \"$@\""));
    assert!(wrapper.contains("exec /usr/local/bin/sccache \"$@\""));

    let rust_base = read("nook-app/docker/base.Dockerfile");
    assert!(rust_base.contains("RUSTC_WRAPPER=/usr/local/bin/nook-sccache"));
    assert!(rust_base.contains("NOOK_SCCACHE_REDIS_MODE=${SCCACHE_REDIS_MODE}"));
    assert!(rust_base.contains("SCCACHE_IGNORE_SERVER_IO_ERROR=1"));

    assert!(bake.contains("SCCACHE_REDIS_MODE") && bake.contains("= SCCACHE_REDIS_MODE"));
    assert!(app_tasks.contains("--set '*.args.SCCACHE_REDIS_MODE={{.SCCACHE_REDIS_MODE}}'"));

    let core_dockerfile = read("nook-app/nook-core/Dockerfile");
    let wasm_dockerfile = read("nook-app/nook-wasm/Dockerfile");
    for (path, dockerfile) in [
        ("nook-app/nook-core/Dockerfile", core_dockerfile.as_str()),
        ("nook-app/nook-wasm/Dockerfile", wasm_dockerfile.as_str()),
    ] {
        assert!(
            !dockerfile.contains("--mount=type=secret")
                && !dockerfile.contains("/run/secrets/sccache_redis_password"),
            "{path} must not attach secrets to compiler layers"
        );
    }
}

fn assert_delivery_cache_scope_contract() -> anyhow::Result<()> {
    let setup = read(".github/actions/nook-docker-setup/action.yml");
    assert!(setup.contains("cache-telemetry.cjs start"));
    assert!(setup.contains("NOOK_CACHE_TELEMETRY_BASELINE"));
    assert!(setup.contains("if [[ \"$pr_number\" =~ ^[0-9]+$ ]]"));
    assert!(setup.contains("Pull-request jobs are forced to restore Main's cache read-only"));
    assert!(setup.contains("GHA_CACHE_SCOPE_SUFFIX="));
    assert!(setup.contains("GHA_CACHE_FALLBACK_ENABLED="));
    assert!(setup.contains("GHA_CACHE_SEED_SCOPE_SUFFIX="));
    for fingerprint_input in [
        "nook-app/Cargo.toml",
        "nook-app/Cargo.lock",
        "nook-app/**/Cargo.toml",
        "nook-app/.cargo/**",
        "nook-app/.config/**",
        "nook-app/Taskfile.yml",
        "nook-app/docker-bake.hcl",
        "nook-app/**/docker-bake.hcl",
        "nook-app/docker/*.docker-bake.hcl",
        "nook-app/docker/base.Dockerfile",
        "nook-app/docker/Taskfile.yml",
        "nook-app/docker/sccache-wrapper.sh",
        "nook-app/docker/sccache-report.sh",
        "nook-app/nook-core/Dockerfile",
    ] {
        assert!(
            setup.contains(fingerprint_input),
            "WASM dependency scope fingerprint is missing {fingerprint_input}"
        );
    }
    assert!(
        setup.contains("GHA_RUST_WASM_DEPS_SCOPE=nook-rust-wasm-deps-v4-$wasm_deps_fingerprint")
    );
    assert!(setup.contains("GHA_CACHE_WRITE_ENABLED=$cache_write_enabled"));
    assert!(setup.contains("[ -z \"$read_only\" ]"));
    assert!(setup.contains("main-cache-only"));
    assert!(setup.contains("main-cache-only requires cache-write=false"));
    assert!(!setup.contains("cache_total_count()"));
    assert!(!setup.contains("GHA_CACHE_SCOPE_SUFFIX=$scope_suffix"));

    assert_release_cache_fingerprint_contract()?;

    let bake = read("nook-app/docker-bake.hcl");
    assert!(bake.contains("variable \"GHA_CACHE_SCOPE_SUFFIX\""));
    assert!(bake.contains("variable \"GHA_CACHE_FALLBACK_ENABLED\""));
    assert!(bake.contains("variable \"GHA_CACHE_SEED_SCOPE_SUFFIX\""));
    assert!(bake.contains("variable \"GHA_RUST_WASM_DEPS_SCOPE\""));
    assert!(bake.contains("variable \"NOOK_REGISTRY_CACHE_HOST\""));
    assert!(bake.contains("nook/buildcache/${GHA_RUST_WASM_DEPS_SCOPE}:buildcache"));
    assert!(
        bake.contains(
            "nook/buildcache/${GHA_RUST_WASM_DEPS_SCOPE}:buildcache,mode=max,timeout=10m"
        )
    );
    let wasm_source_cache = bake
        .split_once("rust_wasm_source_cache_from =")
        .context("bake file must define the WASM source cache inputs")?
        .1
        .split_once("rust_wasm_source_cache_to =")
        .context("bake file must delimit the WASM source cache inputs")?
        .0;
    assert!(
        wasm_source_cache
            .matches("nook/buildcache/${GHA_RUST_WASM_DEPS_SCOPE}:buildcache")
            .count()
            >= 1,
        "every WASM source cache path must directly import the fingerprinted dependency lineage"
    );
    let docker_tasks = read("nook-app/docker/Taskfile.yml");
    assert!(docker_tasks.contains(
        "nook/buildcache/${GHA_RUST_WASM_DEPS_SCOPE:?missing GHA_RUST_WASM_DEPS_SCOPE}:buildcache"
    ));
    assert!(!bake.contains("type=gha"));
    for scope in [
        "nook-rust-base-v1${GHA_CACHE_SCOPE_SUFFIX}",
        "nook-rust-deps-v2${GHA_CACHE_SCOPE_SUFFIX}",
        "nook-rust-native-source-v2${GHA_CACHE_SCOPE_SUFFIX}",
        "nook-rust-wasm-source-v2${GHA_CACHE_SCOPE_SUFFIX}",
        "nook-web-v1${GHA_CACHE_SCOPE_SUFFIX}",
    ] {
        assert!(
            bake.contains(scope),
            "delivery cache must isolate immutable PR job generations: {scope}"
        );
    }
    for main_scope in [
        "nook/buildcache/nook-rust-base-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
        "nook/buildcache/nook-rust-deps-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
        "nook/buildcache/nook-rust-native-source-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
        "nook/buildcache/nook-rust-wasm-source-v2${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
        "nook/buildcache/nook-web-deps-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
        "nook/buildcache/nook-web-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
        "nook/buildcache/nook-web-e2e-v1${GHA_CACHE_SCOPE_SUFFIX}:buildcache",
    ] {
        assert!(
            bake.contains(main_scope),
            "registry BuildKit cache ref is missing: {main_scope}"
        );
    }
    assert!(
        bake.contains(
            "type=registry,ref=${NOOK_REGISTRY_CACHE_HOST}/nook/buildcache/nook-rust-base-v1"
        ) && bake.contains("rust_wasm_deps_cache_from")
            && bake.contains("registry.nokey.sh"),
        "WASM/native dependency restores must import registry.nokey.sh cache refs including rust-base"
    );

    let core_bake = read("nook-app/nook-core/docker-bake.hcl");
    let wasm_dependencies = core_bake
        .split_once("target \"builder-wasm-deps\"")
        .context("core bake file must define the WASM dependency target")?
        .1
        .split_once("target \"builder-debug\"")
        .context("core bake file must delimit the WASM dependency target")?
        .0;
    assert!(
        wasm_dependencies.contains("cache-from = rust_wasm_deps_cache_from"),
        "WASM dependencies must restore Main's dedicated complete WASM dependency lineage"
    );
    assert!(
        wasm_dependencies.contains("dockerfile = \"nook-app/docker/base.Dockerfile\"")
            && !wasm_dependencies.contains("rust-base = \"target:rust-base\""),
        "WASM dependency cache keys must extend rust-base inside one Dockerfile instead of through a volatile named-target image"
    );
    Ok(())
}

fn assert_release_cache_fingerprint_contract() -> anyhow::Result<()> {
    let release = read(".github/workflows/release.yml");
    let release_source = release
        .find("- name: Checkout release source")
        .context("release workflow must check out release source")?;
    let release_tooling = release
        .find("- name: Checkout release workflow tooling")
        .context("release workflow must check out workflow tooling")?;
    let release_docker_setup = release
        .find("- name: Docker setup")
        .context("release workflow must configure Docker")?;
    assert!(
        release_source < release_tooling && release_tooling < release_docker_setup,
        "release Docker setup must fingerprint the requested source after checkout"
    );
    assert!(release.contains("path: .nook/release-workflow"));
    assert!(release.contains("uses: ./.nook/release-workflow/.github/actions/nook-docker-setup"));
    Ok(())
}

#[test]
fn cache_hit_telemetry_distinguishes_compiler_and_buildkit_reuse() -> anyhow::Result<()> {
    let reporter = read("nook-app/docker/sccache-report.sh");
    for required in [
        "--show-stats --stats-format=json",
        "NOOK_SCCACHE_STATS",
        "compile_requests",
        "requests_executed",
        "cache_hits",
        "cache_misses",
        "cache_errors",
        "cache_writes",
    ] {
        assert!(
            reporter.contains(required),
            "sccache reporter is missing safe counter: {required}"
        );
    }
    for forbidden in [
        "cache_location",
        "SCCACHE_REDIS_PASSWORD",
        "SCCACHE_REDIS_ENDPOINT",
    ] {
        assert!(
            !reporter.contains(forbidden),
            "sccache telemetry must not emit backend details: {forbidden}"
        );
    }

    let rust_base = read("nook-app/docker/base.Dockerfile");
    assert!(rust_base.contains("sccache-report.sh /usr/local/bin/nook-sccache-report"));
    for path in [
        "nook-app/docker/base.Dockerfile",
        "nook-app/nook-core/Dockerfile",
        "nook-app/nook-wasm/Dockerfile",
    ] {
        assert!(
            read(path).contains("nook-sccache-report"),
            "{path} must report compiler cache outcomes"
        );
    }
    assert!(
        read("nook-app/docker/base.Dockerfile")
            .matches("nook-sccache-report")
            .count()
            >= 12
    );
    assert!(
        read("nook-app/nook-wasm/Dockerfile")
            .matches("nook-sccache-report")
            .count()
            >= 3
    );

    assert_delivery_cache_scope_contract()?;

    let telemetry_action = read(".github/actions/nook-cache-telemetry/action.yml");
    for required in [
        "cache-telemetry.cjs collect",
        "cache-telemetry-${{ github.run_id }}-${{ github.run_attempt }}-${{ github.job }}",
        "actions/upload-artifact@v7",
    ] {
        assert!(
            telemetry_action.contains(required),
            "cache telemetry action is missing: {required}"
        );
    }

    let pr = read(".github/workflows/pr.yml");
    assert!(
        pr.matches("uses: ./.github/actions/nook-cache-telemetry")
            .count()
            >= 5,
        "every Buildx-backed PR job must preserve cache telemetry"
    );
    let main = read(".github/workflows/main.yml");
    assert!(main.contains("uses: ./.github/actions/nook-cache-telemetry"));

    let main_stats = read(".github/workflows/main-build-stats.yml");
    for required in [
        "Download completed Main cache telemetry",
        "cache-telemetry-${{ github.event.workflow_run.id }}-${{ github.event.workflow_run.run_attempt }}-*",
        "cacheTelemetry",
    ] {
        assert!(
            main_stats.contains(required),
            "Main statistics must retain cache telemetry: {required}"
        );
    }
    Ok(())
}

#[test]
fn rust_build_targets_inherit_the_sccache_configuration() -> anyhow::Result<()> {
    for (path, targets) in [
        (
            "nook-app/nook-core/docker-bake.hcl",
            ["builder-deps", "builder-debug", "coverage-export"].as_slice(),
        ),
        (
            "nook-app/nook-wasm/docker-bake.hcl",
            [
                "builder-wasm",
                "web-artifacts",
                "_nook-rust-common",
                "_nook-rust-browser-common",
            ]
            .as_slice(),
        ),
    ] {
        let bake = read(path);
        for target in targets {
            let start = format!("target \"{target}\" {{");
            let body = bake
                .split_once(&start)
                .unwrap_or_else(|| panic!("missing target {target} in {path}"))
                .1
                .split_once("\n}")
                .unwrap_or_else(|| panic!("unterminated target {target} in {path}"))
                .0;
            assert!(
                body.contains("inherits") && body.contains("_sccache"),
                "{target} must inherit the sccache configuration"
            );
        }
    }
    Ok(())
}
