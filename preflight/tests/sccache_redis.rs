use std::{fs, path::PathBuf};

fn repository_root() -> PathBuf {
    std::env::var_os("NOOK_REPO_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."))
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
fn github_actions_use_the_authenticated_persistent_cache() {
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
    ] {
        assert!(
            cache_action_main.contains(required),
            "cache credential action is missing: {required}"
        );
    }
    assert!(!cache_action_main.contains("console."));
    assert!(!cache_action_main.contains("shell: true"));
    assert!(!cache_action_main.contains("process.stdout.write"));
    assert!(!cache_action_main.contains("spawnSync(\"task\", [\"infra:cache:connect\", redisPassword"));

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
        "--hostname rust-cache.nokey.sh",
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
    assert!(connector.contains("diagnostic=\"${diagnostic//\"$cloudflare_client_id\"/[REDACTED]}\""));
    assert!(connector.contains("diagnostic=\"${diagnostic//\"$cloudflare_client_secret\"/[REDACTED]}\""));
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
    for secret_value in ["cloudflare_client_id", "cloudflare_client_secret", "redis_password\""] {
        assert!(
            !github_environment.contains(secret_value),
            "GITHUB_ENV must contain only credential file paths, never {secret_value}"
        );
    }

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

    for (path, expected_secret_uses) in [
        (".github/workflows/e2e-nightly.yml", 1),
        (".github/workflows/main.yml", 1),
    ] {
        let workflow = read(path);
        let password_count = workflow
            .matches("cache-redis-password: ${{ secrets.NOOK_CACHE_REDIS_PASSWORD }}")
            .count();
        let client_id_count = workflow
            .matches("cache-cloudflare-client-id: ${{ secrets.NOOK_CLOUDFLARE_ACCESS_CLIENT_ID }}")
            .count();
        let client_secret_count = workflow
            .matches("cache-cloudflare-client-secret: ${{ secrets.NOOK_CLOUDFLARE_ACCESS_CLIENT_SECRET }}")
            .count();
        assert_eq!(password_count, expected_secret_uses, "only trusted Docker setup calls in {path} may receive the Redis password");
        assert_eq!(client_id_count, expected_secret_uses, "only trusted Docker setup calls in {path} may receive the Access client ID");
        assert_eq!(client_secret_count, expected_secret_uses, "only trusted Docker setup calls in {path} may receive the Access client secret");
    }

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
    assert!(
        read("nook-app/nook-core/Dockerfile")
            .matches(secret_mount)
            .count()
            >= 12
    );
    assert!(
        read("nook-app/nook-wasm/Dockerfile")
            .matches(secret_mount)
            .count()
            >= 3
    );
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
