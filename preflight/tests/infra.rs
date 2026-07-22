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
fn remote_cache_and_registry_are_private_and_persistent() {
    let compose = read("infra/compose.yaml");
    for required in [
        "127.0.0.1:6380:6379",
        "127.0.0.1:5000:5000",
        "--appendonly",
        "--maxmemory-policy",
        "allkeys-lru",
        "redis-data:/data",
        "registry-data:/var/lib/registry",
        "restart: unless-stopped",
        "no-new-privileges:true",
    ] {
        assert!(
            compose.contains(required),
            "remote infrastructure is missing: {required}"
        );
    }
    assert!(
        !compose.contains("- 0.0.0.0:6380:") && !compose.contains("- 0.0.0.0:5000:"),
        "stateful infrastructure ports must never publish on every server interface"
    );
    assert!(
        compose.matches("@sha256:").count() >= 2,
        "stateful service images must be digest pinned"
    );

    let root_tasks = read("Taskfile.yml");
    assert!(root_tasks.contains("taskfile: infra/Taskfile.yml"));

    let deploy = read("infra/scripts/deploy.sh");
    for required in [
        "docker compose -f \"$compose_file\" config --quiet",
        "-o BatchMode=yes",
        "docker compose -f '$remote_compose' up -d --remove-orphans --wait",
        "redis-cli ping",
        "http://127.0.0.1:5000/v2/",
    ] {
        assert!(
            deploy.contains(required),
            "infrastructure deployment is missing: {required}"
        );
    }
    assert!(!deploy.contains("sshpass"));
}
