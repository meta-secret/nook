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
fn sccache_redis_routing_is_portable_and_not_lan_exposed() {
    let app_tasks = read("nook-app/Taskfile.yml");
    for required in [
        "SCCACHE_REDIS_MODE",
        "if [ \"$mode\" = external ]",
        "external Redis is healthy through host.docker.internal:$port",
        "if [ \"$(uname -s)\" = Darwin ]",
        "bind_ip=127.0.0.1",
        "network inspect bridge",
        "--publish \"$bind_ip:$port:6379\"",
        "--add-host host.docker.internal:{{.SCCACHE_REDIS_HOST_IP}}",
        "resolve-docker-host-ip.sh",
        "--set '*.args.SCCACHE_REDIS_PORT={{.SCCACHE_REDIS_PORT}}'",
    ] {
        assert!(
            app_tasks.contains(required),
            "sccache Redis lifecycle is missing portable routing: {required}"
        );
    }
    assert!(
        !app_tasks.contains("--publish \"0.0.0.0:"),
        "the compiler cache must never publish Redis on every host interface"
    );
    assert!(
        !app_tasks.contains("| jq"),
        "sccache bootstrap must not add jq to the host prerequisites"
    );

    let bake = read("nook-app/docker-bake.hcl");
    assert!(bake.contains("variable \"SCCACHE_REDIS_HOST_IP\""));
    assert!(bake.contains("variable \"SCCACHE_REDIS_HOST_IP\" {\n  default = \"\""));
    assert!(bake.contains("\"host.docker.internal\" = SCCACHE_REDIS_HOST_IP"));

    let rust_base = read("nook-app/docker/base.Dockerfile");
    assert!(
        rust_base
            .contains("SCCACHE_REDIS_ENDPOINT=redis://host.docker.internal:${SCCACHE_REDIS_PORT}")
    );
    assert!(rust_base.contains("SCCACHE_SERVER_UDS=/tmp/nook-sccache.sock"));

    let docker_tasks = read("nook-app/docker/Taskfile.yml");
    assert!(
        docker_tasks
            .matches("--add-host host.docker.internal:{{.SCCACHE_REDIS_HOST_IP}}")
            .count()
            >= 5,
        "every Rust-capable runtime path must resolve the shared Redis endpoint"
    );
    assert!(
        docker_tasks
            .matches("-e SCCACHE_REDIS_HOST_IP=\"{{.SCCACHE_REDIS_HOST_IP}}\"")
            .count()
            >= 7,
        "runtime containers must inherit the resolved address without needing Docker"
    );

    for path in [
        "nook-app/Taskfile.yml",
        "nook-app/docker/Taskfile.yml",
        "nook-app/docker-bake.hcl",
    ] {
        let forbidden_gateway_token = ["host", "gateway"].join("-");
        assert!(
            !read(path).contains(&forbidden_gateway_token),
            "{path} must use the resolved numeric Docker host address"
        );
    }

    let resolver = read("nook-app/docker/resolve-docker-host-ip.sh");
    for required in [
        "ping -4 -c 1 host.docker.internal",
        "network inspect bridge",
        "*[!0-9.]*",
    ] {
        assert!(
            resolver.contains(required),
            "Docker host resolver is missing: {required}"
        );
    }
}

#[test]
fn github_actions_keep_remote_credentials_out_of_delivery_builds() {
    assert_cache_actions_use_credential_files();
    assert_cache_connector_redacts_credentials();
    assert_workflows_scope_cache_credentials();
    assert_rust_build_cache_boundary();
}

fn assert_cache_actions_use_credential_files() {
    let action = read(".github/actions/nook-docker-setup/action.yml");
    for required in [
        "cache-redis-password",
        "cache-cloudflare-client-id",
        "cache-cloudflare-client-secret",
        "uses: ./.github/actions/nook-cache-connect",
    ] {
        assert!(
            action.contains(required),
            "GitHub Actions cache configuration is missing: {required}"
        );
    }
    assert!(
        !action.contains("ssh -fNT") && !action.contains("CACHE_SSH_PRIVATE_KEY"),
        "routine Rust jobs must use Cloudflare Access instead of installing an SSH tunnel"
    );
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
    let cache_action_main = read(".github/actions/nook-cache-connect/main.js");
    for required in [
        "mode: 0o700",
        "mode: 0o600",
        "delete taskEnvironment[inputName]",
        "CACHE_REDIS_PASSWORD_FILE",
        "CACHE_CLOUDFLARE_CLIENT_ID_FILE",
        "CACHE_CLOUDFLARE_CLIENT_SECRET_FILE",
        "spawnSync(\"task\", [\"infra:cache:connect\"]",
        "externalCacheEnabled",
        "fs.rmSync(credentialDirectory, { recursive: true, force: true })",
        "NOOK_SCCACHE_BACKEND=local_fallback",
        "NOOK_SCCACHE_BACKEND=remote",
        "NOOK_SCCACHE_BACKEND_REASON=persistent_service",
    ] {
        assert!(
            cache_action_main.contains(required),
            "cache credential action is missing: {required}"
        );
    }
    assert!(!cache_action_main.contains("console."));
    assert!(!cache_action_main.contains("shell: true"));
    assert!(!cache_action_main.contains("process.stdout.write"));
    assert!(
        !cache_action_main.contains("spawnSync(\"task\", [\"infra:cache:connect\", redisPassword")
    );
}

fn assert_cache_connector_redacts_credentials() {
    let infra_tasks = read("infra/Taskfile.yml");
    let connector = infra_tasks
        .split("\n  cache:connect:\n")
        .nth(1)
        .expect("infra Taskfile must contain the cache connector")
        .split("\n  deploy:\n")
        .next()
        .expect("infra Taskfile must contain the cache connector before deploy");
    for required in [
        "cloudflare/cloudflared:2026.7.2@sha256:",
        "access tcp",
        "--hostname redis-ovh-borg-1.bynull.link",
        "CACHE_REDIS_PASSWORD_FILE",
        "CACHE_CLOUDFLARE_CLIENT_ID_FILE",
        "CACHE_CLOUDFLARE_CLIENT_SECRET_FILE",
        "TUNNEL_SERVICE_TOKEN_ID",
        "TUNNEL_SERVICE_TOKEN_SECRET",
        "SCCACHE_REDIS_MODE=external",
        "SCCACHE_REDIS_HOST_IP=$bridge_ip",
        "SCCACHE_REDIS_PASSWORD_FILE=$redis_password_file",
        "using the job-local Redis fallback",
        "kill \"$cloudflared_pid\"",
        "cleanup_cloudflared_extract",
        "fallback_from_cloudflared_extract",
        "if ! extract_container=\"$(docker create",
        "if ! docker cp",
        "if ! chmod 0700 \"$cloudflared_binary\"",
        "Persistent Rust cache proxy setup failed; using the job-local Redis fallback",
    ] {
        assert!(
            connector.contains(required),
            "GitHub Actions cache connector is missing: {required}"
        );
    }
    assert!(!connector.contains("188.165.236.156"));
    assert!(connector.contains("silent: true"));
    assert!(!connector.contains("set -x"));
    assert!(!connector.contains("docker logs \"$proxy_container\""));
    assert!(!connector.contains("cat \"$cloudflared_log\""));
    assert!(
        connector.contains("diagnostic=\"${diagnostic//\"$cloudflare_client_id\"/[REDACTED]}\"")
    );
    assert!(
        connector
            .contains("diagnostic=\"${diagnostic//\"$cloudflare_client_secret\"/[REDACTED]}\"")
    );
    assert!(!connector.contains("SCCACHE_REDIS_PASSWORD=$CACHE_REDIS_PASSWORD"));
    assert!(!connector.contains("CACHE_REDIS_PASSWORD: ${{"));
    assert!(!connector.contains("--env REDISCLI_AUTH"));
    assert!(!connector.contains("--env TUNNEL_SERVICE_TOKEN"));
    assert!(!connector.contains("--service-token-id"));
    assert!(!connector.contains("--service-token-secret"));
    for forbidden_output in [
        "echo \"$cloudflare_client_id\"",
        "echo \"$cloudflare_client_secret\"",
        "echo \"$redis_password\"",
        "printf '%s\\n' \"$cloudflare_client_id\"",
        "printf '%s\\n' \"$cloudflare_client_secret\"",
    ] {
        assert!(
            !connector.contains(forbidden_output),
            "cache Task output may expose a credential through: {forbidden_output}"
        );
    }

    let github_environment = connector
        .split("        {\n          echo \"SCCACHE_REDIS_MODE=external\"")
        .nth(1)
        .and_then(|tail| tail.split("        } >> \"$GITHUB_ENV\"").next())
        .expect("cache connector must export only the external-cache routing block");
    assert!(github_environment.contains("SCCACHE_REDIS_PASSWORD_FILE=$redis_password_file"));
    for secret_value in [
        "cloudflare_client_id",
        "cloudflare_client_secret",
        "redis_password\"",
    ] {
        assert!(
            !github_environment.contains(secret_value),
            "GITHUB_ENV must contain only credential file paths, never {secret_value}"
        );
    }
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
        for secret in [
            "NOOK_CACHE_REDIS_PASSWORD",
            "NOOK_CLOUDFLARE_ACCESS_CLIENT_ID",
            "NOOK_CLOUDFLARE_ACCESS_CLIENT_SECRET",
        ] {
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
        for secret in [
            "NOOK_CACHE_REDIS_PASSWORD",
            "NOOK_CLOUDFLARE_ACCESS_CLIENT_ID",
            "NOOK_CLOUDFLARE_ACCESS_CLIENT_SECRET",
        ] {
            assert!(
                !workflow.contains(secret),
                "delivery workflow {path} must use the job-local cache and stable BuildKit keys"
            );
        }
    }
}

fn assert_rust_build_cache_boundary() {
    let bake = read("nook-app/docker-bake.hcl");
    assert!(bake.contains("id=sccache_redis_password,src=${SCCACHE_REDIS_PASSWORD_FILE}"));
    let app_tasks = read("nook-app/Taskfile.yml");
    assert!(app_tasks.contains("SCCACHE_REDIS_BAKE_ALLOW"));
    assert!(app_tasks.contains("--allow=fs.read="));

    let wrapper = read("nook-app/docker/sccache-wrapper.sh");
    assert!(wrapper.contains("/run/secrets/sccache_redis_password"));
    assert!(wrapper.contains("exec /usr/local/bin/sccache \"$@\""));

    let rust_base = read("nook-app/docker/base.Dockerfile");
    assert!(rust_base.contains("RUSTC_WRAPPER=/usr/local/bin/nook-sccache"));

    let secret_mount = "--mount=type=secret,id=sccache_redis_password";
    let core_dockerfile = read("nook-app/nook-core/Dockerfile");
    assert!(
        !core_dockerfile.contains(secret_mount),
        "Rust dependency and source layers must remain reusable across Main and PR jobs"
    );
    assert!(
        !read("nook-app/nook-wasm/Dockerfile").contains(secret_mount),
        "WASM source layers must remain reusable across Main and PR jobs"
    );
}

fn assert_delivery_cache_scope_contract() {
    let setup = read(".github/actions/nook-docker-setup/action.yml");
    assert!(setup.contains("cache-telemetry.cjs start"));
    assert!(setup.contains("NOOK_CACHE_TELEMETRY_BASELINE"));
    assert!(setup.contains("job_scope=\"$(printf '%s' \"$GITHUB_JOB\""));
    assert!(setup.contains("app_tree=\"$(git rev-parse HEAD:nook-app)\""));
    assert!(setup.contains("dockerignore_blob=\"$(git hash-object .dockerignore)\""));
    assert!(setup.contains("scope_suffix=\"-pr-$pr_number-$job_scope-$cache_generation\""));
    assert!(setup.contains("GHA_CACHE_SCOPE_SUFFIX=$scope_suffix"));
    assert!(setup.contains("repos/$GITHUB_REPOSITORY/actions/caches"));
    assert!(setup.contains("GHA_CACHE_FALLBACK_ENABLED=$fallback_enabled"));
    assert!(setup.contains("legacy_scope_suffix=\"-pr-$pr_number-$job_scope\""));
    assert!(setup.contains("GHA_CACHE_LEGACY_SCOPE_SUFFIX=$legacy_scope_suffix"));
    assert!(setup.contains("GHA_CACHE_WRITE_ENABLED=$cache_write_enabled"));
    assert!(setup.contains("[ -n \"$fallback_enabled\" ]"));

    let bake = read("nook-app/docker-bake.hcl");
    assert!(bake.contains("variable \"GHA_CACHE_SCOPE_SUFFIX\""));
    assert!(bake.contains("variable \"GHA_CACHE_FALLBACK_ENABLED\""));
    assert!(bake.contains("variable \"GHA_CACHE_LEGACY_SCOPE_SUFFIX\""));
    assert!(bake.contains("GHA_CACHE_FALLBACK_ENABLED != \"\""));
    for scope in [
        "nook-rust-base-v1${GHA_CACHE_SCOPE_SUFFIX}",
        "nook-rust-deps-v2${GHA_CACHE_SCOPE_SUFFIX}",
        "nook-rust-native-source-v1${GHA_CACHE_SCOPE_SUFFIX}",
        "nook-rust-wasm-source-v1${GHA_CACHE_SCOPE_SUFFIX}",
        "nook-web-v1${GHA_CACHE_SCOPE_SUFFIX}",
    ] {
        assert!(
            bake.contains(scope),
            "delivery cache must isolate immutable PR job generations: {scope}"
        );
    }
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
fn rust_build_targets_inherit_the_sccache_host_mapping() {
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
                body.contains("inherits") && body.contains("_sccache-network"),
                "{target} must inherit the sccache host mapping"
            );
        }
    }
}
