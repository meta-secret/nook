use std::{
    fs,
    path::{Path, PathBuf},
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

fn assert_no_shell_scripts(path: &Path) {
    for entry in fs::read_dir(path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display()))
    {
        let entry = entry.unwrap_or_else(|error| {
            panic!("failed to inspect an entry under {}: {error}", path.display())
        });
        let entry_path = entry.path();
        if entry_path.is_dir() {
            assert_no_shell_scripts(&entry_path);
        } else {
            assert_ne!(
                entry_path.extension().and_then(|extension| extension.to_str()),
                Some("sh"),
                "infrastructure shell belongs inline in infra/Taskfile.yml, not {}",
                entry_path.display()
            );
        }
    }
}

#[test]
fn remote_cache_and_registry_are_private_and_persistent() {
    let compose = read("infra/compose.yaml");
    for required in [
        "127.0.0.1:6380:6379",
        "127.0.0.1:5000:5000",
        "--requirepass",
        "/run/secrets/redis-password",
        "file: ./secrets/redis-password",
        "cloudflare/cloudflared:2026.7.2@sha256:",
        "--token-file",
        "/run/secrets/cloudflare-tunnel-token",
        "file: ./secrets/cloudflare-tunnel-token",
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
    assert!(!compose.contains("- 6380:6379") && !compose.contains("- 5000:5000"));
    assert!(
        compose.matches("@sha256:").count() >= 3,
        "infrastructure service images must be digest pinned"
    );

    let root_tasks = read("Taskfile.yml");
    assert!(root_tasks.contains("taskfile: infra/Taskfile.yml"));

    assert_no_shell_scripts(&repository_root().join("infra"));

    let infra_tasks = read("infra/Taskfile.yml");
    let deploy = infra_tasks
        .split("\n  deploy:\n")
        .nth(1)
        .and_then(|tail| tail.split("\n  status:\n").next())
        .expect("infra:deploy must be defined inline in infra/Taskfile.yml");
    for required in [
        "docker compose -f \"$compose_file\" config --quiet",
        "-o BatchMode=yes",
        "docker compose -f '$remote_compose' up -d --remove-orphans --wait",
        "openssl rand -hex 32",
        "cloudflare-tunnel-token",
        "grep -qx cloudflared",
        "redis-cli ping",
        "http://127.0.0.1:5000/v2/",
    ] {
        assert!(
            deploy.contains(required),
            "infrastructure deployment is missing: {required}"
        );
    }
    assert!(!deploy.contains("sshpass"));
    assert!(!deploy.contains("scripts/"));
}
