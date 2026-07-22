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
fn github_actions_tunnels_to_the_persistent_cache_safely() {
    let action = read(".github/actions/nook-docker-setup/action.yml");
    for required in [
        "cache-ssh-private-key",
        "StrictHostKeyChecking=yes",
        "UserKnownHostsFile=\"$known_hosts\"",
        "ExitOnForwardFailure=yes",
        "-L \"$bridge_ip:6380:127.0.0.1:6380\"",
        "SCCACHE_REDIS_MODE=external",
        "SCCACHE_REDIS_HOST_IP=$bridge_ip",
    ] {
        assert!(
            action.contains(required),
            "GitHub Actions cache tunnel is missing: {required}"
        );
    }
    assert!(
        !action.contains("ssh-keyscan"),
        "the workflow must use the committed verified host key"
    );

    let known_hosts = read(".github/actions/nook-docker-setup/known_hosts");
    assert!(known_hosts.contains("188.165.236.156 ssh-ed25519 "));
    assert_eq!(known_hosts.lines().count(), 1);

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
        let key_count = workflow
            .matches("cache-ssh-private-key: ${{ secrets.NOOK_CACHE_SSH_PRIVATE_KEY }}")
            .count();
        assert_eq!(
            setup_count, key_count,
            "every Docker setup in {path} must receive the cache key"
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
