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
        "if [ \"$(uname -s)\" = Darwin ]",
        "bind_ip=127.0.0.1",
        "network inspect bridge",
        "--publish \"$bind_ip:$port:6379\"",
        "--add-host host.docker.internal:host-gateway",
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
    assert!(bake.contains("\"host.docker.internal\" = \"host-gateway\""));

    let rust_base = read("nook-app/docker/base.Dockerfile");
    assert!(
        rust_base
            .contains("SCCACHE_REDIS_ENDPOINT=redis://host.docker.internal:${SCCACHE_REDIS_PORT}")
    );
    assert!(rust_base.contains("SCCACHE_SERVER_UDS=/tmp/nook-sccache.sock"));

    let docker_tasks = read("nook-app/docker/Taskfile.yml");
    assert!(
        docker_tasks
            .matches("--add-host host.docker.internal:host-gateway")
            .count()
            >= 5,
        "every Rust-capable runtime path must resolve the shared Redis endpoint"
    );
}

#[test]
fn rust_build_targets_inherit_the_sccache_host_gateway() {
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
                "{target} must inherit the sccache host-gateway mapping"
            );
        }
    }
}
