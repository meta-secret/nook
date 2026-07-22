use std::{
    fs,
    path::PathBuf,
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

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
    ] {
        assert!(
            cache_action_main.contains(required),
            "cache credential action is missing: {required}"
        );
    }
    assert!(!cache_action_main.contains("console."));
    assert!(!cache_action_main.contains("shell: true"));

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

    for path in [
        ".github/workflows/agent-implement.yml",
        ".github/workflows/e2e-nightly.yml",
        ".github/workflows/e2e-pr.yml",
        ".github/workflows/main.yml",
        ".github/workflows/pr.yml",
        ".github/workflows/release.yml",
        ".github/workflows/rust-dependency-updates.yml",
    ] {
        let workflow = read(path);
        let setup_count = workflow
            .matches("uses: ./.github/actions/nook-docker-setup")
            .count();
        let password_count = workflow
            .matches("cache-redis-password: ${{ secrets.NOOK_CACHE_REDIS_PASSWORD }}")
            .count();
        let client_id_count = workflow
            .matches("cache-cloudflare-client-id: ${{ secrets.NOOK_CLOUDFLARE_ACCESS_CLIENT_ID }}")
            .count();
        let client_secret_count = workflow
            .matches("cache-cloudflare-client-secret: ${{ secrets.NOOK_CLOUDFLARE_ACCESS_CLIENT_SECRET }}")
            .count();
        assert_eq!(setup_count, password_count, "every Docker setup in {path} must receive the Redis password");
        assert_eq!(setup_count, client_id_count, "every Docker setup in {path} must receive the Access client ID");
        assert_eq!(setup_count, client_secret_count, "every Docker setup in {path} must receive the Access client secret");
    }

    let bake = read("nook-app/docker-bake.hcl");
    assert!(bake.contains("id=sccache_redis_password,src=${SCCACHE_REDIS_PASSWORD_FILE}"));

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

#[cfg(unix)]
#[test]
fn cache_connector_keeps_secrets_out_of_output_and_command_arguments() {
    use std::os::unix::fs::PermissionsExt;

    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock must be after the Unix epoch")
        .as_nanos();
    let temp_dir = std::env::temp_dir().join(format!(
        "nook-cache-connector-test-{}-{unique}",
        std::process::id()
    ));
    let bin_dir = temp_dir.join("bin");
    fs::create_dir_all(&bin_dir).expect("create cache connector test directory");

    let docker_log = temp_dir.join("docker-args.log");
    let cloudflared_log = temp_dir.join("cloudflared-args.log");
    let docker_environment_log = temp_dir.join("docker-environment.log");
    let mock_docker = bin_dir.join("docker");
    fs::write(
        &mock_docker,
        r#"#!/bin/sh
printf '%s\n' "$*" >> "$MOCK_DOCKER_ARGS"
env > "$MOCK_DOCKER_ENV"
case "$1 $2 $3" in
  "network inspect bridge") printf '%s\n' '        "Gateway": "172.17.0.1"' ;;
  "create "*) printf '%s\n' mock-cloudflared-container ;;
  "cp mock-cloudflared-container:/usr/local/bin/cloudflared"*)
    cat > "$3" <<'MOCK_CLOUDFLARED'
#!/bin/sh
printf '%s\n' "$*" >> "$MOCK_CLOUDFLARED_ARGS"
while [ "$#" -gt 0 ]; do
  if [ "$1" = --logfile ]; then
    printf 'client-id=%s client-secret=%s\n' "$TUNNEL_SERVICE_TOKEN_ID" "$TUNNEL_SERVICE_TOKEN_SECRET" > "$2"
    break
  fi
  shift
done
exit 0
MOCK_CLOUDFLARED
    chmod 0700 "$3"
    ;;
  "run --rm "*)
    attempts=0
    while [ ! -s "$MOCK_CLOUDFLARED_ARGS" ] && [ "$attempts" -lt 100 ]; do
      sleep 0.01
      attempts=$((attempts + 1))
    done
    if [ "${MOCK_CACHE_HEALTHY:-}" = 1 ]; then printf '%s\n' PONG; fi
    ;;
esac
"#,
    )
    .expect("write mock Docker executable");
    fs::set_permissions(&mock_docker, fs::Permissions::from_mode(0o700))
        .expect("make mock Docker executable");

    let redis_secret = "redis-secret-must-not-leak";
    let client_id = "cloudflare-client-id-must-not-leak";
    let client_secret = "cloudflare-client-secret-must-not-leak";
    let github_env = temp_dir.join("github-env");
    let path = format!(
        "{}:{}",
        bin_dir.display(),
        std::env::var("PATH").expect("PATH must be available")
    );
    let output = Command::new("node")
        .arg(repository_root().join(".github/actions/nook-cache-connect/main.js"))
        .current_dir(repository_root())
        .env("PATH", &path)
        .env("MOCK_DOCKER_ARGS", &docker_log)
        .env("MOCK_CLOUDFLARED_ARGS", &cloudflared_log)
        .env("MOCK_DOCKER_ENV", &docker_environment_log)
        .env("MOCK_CACHE_HEALTHY", "1")
        .env("RUNNER_TEMP", &temp_dir)
        .env("GITHUB_ENV", &github_env)
        .env("GITHUB_WORKSPACE", repository_root())
        .env("SCCACHE_REDIS_HOST_IP", "172.17.0.1")
        .env("INPUT_CACHE-REDIS-PASSWORD", redis_secret)
        .env("INPUT_CACHE-CLOUDFLARE-CLIENT-ID", client_id)
        .env("INPUT_CACHE-CLOUDFLARE-CLIENT-SECRET", client_secret)
        .output()
        .expect("run silent cache connector with mock Docker");

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(output.status.success(), "connector failed: {stderr}");
    assert!(stdout.is_empty(), "connector wrote to stdout: {stdout}");
    assert!(stderr.is_empty(), "connector wrote to stderr: {stderr}");

    let docker_arguments = fs::read_to_string(&docker_log).expect("read mock Docker arguments");
    let cloudflared_arguments =
        fs::read_to_string(&cloudflared_log).expect("read mock cloudflared arguments");
    let docker_environment =
        fs::read_to_string(&docker_environment_log).expect("read mock Docker environment");
    let exported_environment = fs::read_to_string(&github_env).expect("read GitHub environment");
    for secret in [redis_secret, client_id, client_secret] {
        assert!(!docker_arguments.contains(secret));
        assert!(!cloudflared_arguments.contains(secret));
        assert!(!docker_environment.contains(secret));
        assert!(!exported_environment.contains(secret));
    }
    assert!(!docker_arguments.contains("--env"));

    let credential_directory = temp_dir.join("nook-cache-credentials");
    let password_file = credential_directory.join("redis-password");
    assert_eq!(
        exported_environment,
        format!(
            "SCCACHE_REDIS_MODE=external\nSCCACHE_REDIS_HOST_IP=172.17.0.1\nSCCACHE_REDIS_PASSWORD_FILE={}\n",
            password_file.display()
        )
    );
    assert_eq!(fs::read_to_string(&password_file).unwrap(), redis_secret);
    assert_eq!(
        fs::metadata(&credential_directory)
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
    assert_eq!(fs::metadata(&password_file).unwrap().permissions().mode() & 0o777, 0o600);
    assert!(!credential_directory.join("cloudflare-client-id").exists());
    assert!(!credential_directory
        .join("cloudflare-client-secret")
        .exists());

    let failure_temp_dir = temp_dir.join("failure");
    fs::create_dir_all(&failure_temp_dir).expect("create failed connector test directory");
    let failure_github_env = failure_temp_dir.join("github-env");
    let failure_output = Command::new("node")
        .arg(repository_root().join(".github/actions/nook-cache-connect/main.js"))
        .current_dir(repository_root())
        .env("PATH", &path)
        .env("MOCK_DOCKER_ARGS", failure_temp_dir.join("docker-args.log"))
        .env(
            "MOCK_CLOUDFLARED_ARGS",
            failure_temp_dir.join("cloudflared-args.log"),
        )
        .env(
            "MOCK_DOCKER_ENV",
            failure_temp_dir.join("docker-environment.log"),
        )
        .env("RUNNER_TEMP", &failure_temp_dir)
        .env("GITHUB_ENV", &failure_github_env)
        .env("GITHUB_WORKSPACE", repository_root())
        .env("SCCACHE_REDIS_HOST_IP", "172.17.0.1")
        .env("CACHE_CONNECT_ATTEMPTS", "1")
        .env("CACHE_CONNECT_DELAY_SECONDS", "0")
        .env("INPUT_CACHE-REDIS-PASSWORD", redis_secret)
        .env("INPUT_CACHE-CLOUDFLARE-CLIENT-ID", client_id)
        .env("INPUT_CACHE-CLOUDFLARE-CLIENT-SECRET", client_secret)
        .output()
        .expect("run failing cache connector with mock Docker");
    let failure_stdout = String::from_utf8_lossy(&failure_output.stdout);
    let failure_stderr = String::from_utf8_lossy(&failure_output.stderr);
    assert!(!failure_output.status.success());
    assert!(failure_stdout.is_empty());
    assert!(failure_stderr.contains("client-id=[REDACTED] client-secret=[REDACTED]"));
    assert!(failure_stderr.contains("Persistent Rust cache did not become reachable"));
    for secret in [redis_secret, client_id, client_secret] {
        assert!(!failure_stdout.contains(secret));
        assert!(!failure_stderr.contains(secret));
    }
    assert!(!failure_github_env.exists());

    fs::remove_dir_all(&temp_dir).expect("remove cache connector test directory");
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
