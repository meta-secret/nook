use std::{fs, path::PathBuf};

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
fn sccache_uses_the_direct_public_tls_endpoint_without_docker_host_routing() {
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
        app_tasks.contains("SCCACHE_REDIS_PASSWORD_FILE: '{{.SCCACHE_REDIS_PASSWORD_FILE}}'"),
        "Task must export the resolved credential path for Bake's HCL secret source"
    );
    assert!(
        !app_tasks.contains("print $4; exit") && !app_tasks.contains("print $2; exit"),
        "pipefail-safe Docker inspection must consume complete output instead of SIGPIPEing the producer"
    );
    assert!(
        app_tasks
            .matches("password_file=\"{{.SCCACHE_REDIS_PASSWORD_FILE}}\"")
            .count()
            >= 2,
        "Bake permission and mount arguments must use the resolved Task credential path"
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
}

#[test]
fn github_actions_keep_remote_credentials_out_of_delivery_builds() {
    assert_cache_actions_use_credential_files();
    assert_workflows_scope_cache_credentials();
    assert_rust_build_cache_boundary();
}

fn assert_cache_actions_use_credential_files() {
    let action = read(".github/actions/nook-docker-setup/action.yml");
    for required in [
        "cache-redis-password",
        "uses: ./.github/actions/nook-cache-connect",
    ] {
        assert!(
            action.contains(required),
            "GitHub Actions cache configuration is missing: {required}"
        );
    }
    assert!(!action.contains("cloudflare-client"));
    assert!(!action.contains("ssh -fNT") && !action.contains("CACHE_SSH_PRIVATE_KEY"));
    let cache_step = action
        .split("    - name: Configure persistent Rust compiler cache\n")
        .nth(1)
        .expect("Docker setup must contain the persistent cache step")
        .split("\n    # Inline `task`/Bake calls")
        .next()
        .expect("persistent cache step must precede the GHA runtime step");
    assert!(
        !cache_step.contains("env:"),
        "secret-valued step environments are forbidden"
    );

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

    for path in [
        ".github/workflows/main.yml",
        ".github/workflows/e2e-nightly.yml",
    ] {
        let workflow = read(path);
        assert!(workflow.contains("NOOK_CACHE_REDIS_PASSWORD"));
        assert!(!workflow.contains("NOOK_CLOUDFLARE_ACCESS"));
    }

    let nightly = read(".github/workflows/e2e-nightly.yml");
    let nightly_fix = nightly
        .split_once("\n  ci-fix:\n")
        .expect("nightly workflow must define its AI fix job")
        .1;
    assert!(
        !nightly_fix.contains("NOOK_CACHE_REDIS_PASSWORD"),
        "agent-authored nightly repair builds must not receive shared cache credentials"
    );
}

fn assert_rust_build_cache_boundary() {
    let bake = read("nook-app/docker-bake.hcl");
    assert!(bake.contains("id=sccache_redis_password,src=${SCCACHE_REDIS_PASSWORD_FILE}"));
    let app_tasks = read("nook-app/Taskfile.yml");
    assert!(app_tasks.contains("SCCACHE_REDIS_BAKE_ALLOW"));
    assert!(app_tasks.contains("--allow=fs.read="));

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

    let secret_mount = "--mount=type=secret,id=sccache_redis_password";
    let core_dockerfile = read("nook-app/nook-core/Dockerfile");
    assert!(
        core_dockerfile.matches(secret_mount).count() >= 12,
        "every native Rust compiler layer must receive the optional cache credential"
    );
    assert!(
        read("nook-app/nook-wasm/Dockerfile")
            .matches(secret_mount)
            .count()
            >= 3,
        "every WASM compiler layer must receive the optional cache credential"
    );
}

fn assert_delivery_cache_scope_contract() {
    let setup = read(".github/actions/nook-docker-setup/action.yml");
    assert!(setup.contains("cache-telemetry.cjs start"));
    assert!(setup.contains("NOOK_CACHE_TELEMETRY_BASELINE"));
    assert!(setup.contains("if [[ \"$pr_number\" =~ ^[0-9]+$ ]]"));
    assert!(setup.contains("Pull-request jobs are forced to restore Main's cache read-only"));
    assert!(setup.contains("GHA_CACHE_SCOPE_SUFFIX="));
    assert!(setup.contains("GHA_CACHE_FALLBACK_ENABLED="));
    assert!(setup.contains("GHA_CACHE_SEED_SCOPE_SUFFIX="));
    assert!(setup.contains("GHA_CACHE_WRITE_ENABLED=$cache_write_enabled"));
    assert!(setup.contains("[ -z \"$read_only\" ]"));
    assert!(setup.contains("main-cache-only"));
    assert!(setup.contains("main-cache-only requires cache-write=false"));
    assert!(!setup.contains("cache_total_count()"));
    assert!(!setup.contains("GHA_CACHE_SCOPE_SUFFIX=$scope_suffix"));

    let bake = read("nook-app/docker-bake.hcl");
    assert!(bake.contains("variable \"GHA_CACHE_SCOPE_SUFFIX\""));
    assert!(bake.contains("variable \"GHA_CACHE_FALLBACK_ENABLED\""));
    assert!(bake.contains("variable \"GHA_CACHE_SEED_SCOPE_SUFFIX\""));
    assert!(bake.contains("GHA_CACHE_FALLBACK_ENABLED != \"\""));
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
        "\"type=gha,scope=nook-rust-base-v1,version=2\"",
        "\"type=gha,scope=nook-rust-deps-v2,version=2\"",
        "\"type=gha,scope=nook-rust-wasm-deps-v1,version=2\"",
        "\"type=gha,scope=nook-rust-native-source-v2,version=2\"",
        "\"type=gha,scope=nook-rust-wasm-source-v2,version=2\"",
        "\"type=gha,scope=nook-web-deps-v1,version=2\"",
        "\"type=gha,scope=nook-web-v1,version=2\"",
        "\"type=gha,scope=nook-web-e2e-v1,version=2\"",
    ] {
        assert!(
            bake.matches(main_scope).count() >= 3,
            "a missing generation with an older PR seed must also import Main: {main_scope}"
        );
    }

    let core_bake = read("nook-app/nook-core/docker-bake.hcl");
    let wasm_dependencies = core_bake
        .split_once("target \"builder-wasm-deps\"")
        .expect("WASM dependency target must exist")
        .1
        .split_once("target \"builder-debug\"")
        .expect("native source target must follow WASM dependencies")
        .0;
    assert!(
        wasm_dependencies.contains("cache-from = rust_wasm_deps_cache_from"),
        "WASM dependencies must restore Main's dedicated complete WASM dependency lineage"
    );
}

#[test]
fn cache_hit_telemetry_distinguishes_compiler_and_buildkit_reuse() {
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
        "nook-app/nook-core/Dockerfile",
        "nook-app/nook-wasm/Dockerfile",
    ] {
        assert!(
            read(path).contains("nook-sccache-report"),
            "{path} must report compiler cache outcomes"
        );
    }
    assert!(
        read("nook-app/nook-core/Dockerfile")
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

    assert_delivery_cache_scope_contract();

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
}

#[test]
fn rust_build_targets_inherit_the_sccache_configuration() {
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
}
