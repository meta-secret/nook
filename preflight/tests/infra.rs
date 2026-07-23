use std::{
    fs,
    path::{Path, PathBuf},
};

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

fn assert_no_shell_scripts(path: &Path) {
    for entry in fs::read_dir(path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display()))
    {
        let entry = entry.unwrap_or_else(|error| {
            panic!(
                "failed to inspect an entry under {}: {error}",
                path.display()
            )
        });
        let entry_path = entry.path();
        if entry_path.is_dir() {
            assert_no_shell_scripts(&entry_path);
        } else {
            assert_ne!(
                entry_path
                    .extension()
                    .and_then(|extension| extension.to_str()),
                Some("sh"),
                "infrastructure shell belongs inline in infra/Taskfile.yml, not {}",
                entry_path.display()
            );
        }
    }
}

#[test]
fn remote_cache_is_public_over_tls_and_registry_remains_private() {
    assert_remote_compose_contract();
    assert_infrastructure_deploy_contract();
    assert_mesh_node_contract();
}

fn assert_remote_compose_contract() {
    let compose = read("infra/compose.yaml");
    for required in [
        "6380:6380",
        "443:443",
        "127.0.0.1:5000:5000",
        "requirepass $$password",
        "/run/redis/redis.conf",
        "docker-entrypoint.sh redis-server /run/redis/redis.conf",
        "/run/secrets/redis-password",
        "file: ./secrets/redis-password",
        "appendonly yes",
        "maxmemory-policy allkeys-lru",
        "allkeys-lru",
        "redis-data:/data",
        "registry-data:/var/lib/registry",
        "traefik:v3.7.1@sha256:",
        "--certificatesResolvers.letsencrypt.acme.tlsChallenge=true",
        "./traefik-dynamic.yaml:/etc/traefik/dynamic.yaml:ro",
        "traefik-data:/data",
        "restart: unless-stopped",
        "no-new-privileges:true",
    ] {
        assert!(
            compose.contains(required),
            "remote infrastructure is missing: {required}"
        );
    }
    assert!(
        !compose.contains("--requirepass"),
        "the Redis password must be loaded from a restrictive config, not process argv"
    );
    assert!(!compose.contains("6380:6379") && !compose.contains("- 5000:5000"));
    assert!(
        compose.matches("@sha256:").count() >= 3,
        "infrastructure service images must be digest pinned"
    );

    let root_tasks = read("Taskfile.yml");
    assert!(root_tasks.contains("taskfile: infra/Taskfile.yml"));

    assert_no_shell_scripts(&repository_root().join("infra"));

    let traefik = read("infra/traefik-dynamic.yaml");
    for required in [
        "HostSNI(`redis-ovh-borg-1.bynull.link`)",
        "certResolver: letsencrypt",
        "address: redis:6379",
    ] {
        assert!(
            traefik.contains(required),
            "Traefik Redis TLS routing is missing: {required}"
        );
    }

    let nftables = read("infra/nftables.conf");
    for required in [
        "chain input",
        "chain forward",
        "policy drop",
        "ct state established,related accept",
        "iifname \"docker0\" accept",
        "iifname \"br-*\" accept",
        "oifname \"docker0\" accept",
        "oifname \"br-*\" accept",
        "chain output",
        "policy accept",
    ] {
        assert!(
            nftables.contains(required),
            "host firewall must preserve default-drop filtering and Docker forwarding: {required}"
        );
    }
}

fn assert_infrastructure_deploy_contract() {
    let infra_tasks = read("infra/Taskfile.yml");
    assert!(
        infra_tasks.contains(
            "INFRA_SSH_TARGET: '{{default \"debian@ssh-ovh-borg-1.bynull.link\" .INFRA_SSH_TARGET}}'"
        ),
        "infrastructure deployment must target the OVH borg-1 Debian account by default"
    );
    let deploy = infra_tasks
        .split("\n  deploy:\n")
        .nth(1)
        .and_then(|tail| tail.split("\n  status:\n").next())
        .expect("infra:deploy must be defined inline in infra/Taskfile.yml");
    for required in [
        "docker compose -f \"$compose_file\" config --quiet",
        "ssh -n -o BatchMode=yes",
        "docker compose -f '$remote_compose' up -d --remove-orphans --wait",
        "openssl rand -hex 32",
        "chmod 0600 '$remote_secrets/redis-password'",
        "traefik-dynamic.yaml.next",
        "cat /run/secrets/redis-password",
        "redis-cli ping",
        "grep -qx traefik",
        "http://127.0.0.1:5000/v2/",
    ] {
        assert!(
            deploy.contains(required),
            "infrastructure deployment is missing: {required}"
        );
    }
    assert!(!deploy.contains("sshpass"));
    assert!(!deploy.contains("scripts/"));
    assert!(!deploy.contains("chmod 0444"));
    assert!(!infra_tasks.contains("-e REDISCLI_AUTH"));
    assert!(!infra_tasks.contains("--env REDISCLI_AUTH"));
    assert!(!deploy.contains("cloudflare"));

    let sync = infra_tasks
        .split("\n  redis:credential:sync:\n")
        .nth(1)
        .expect("infra must provide local Redis credential synchronization");
    assert!(sync.contains(".nook/cache/redis-password"));
    assert!(sync.contains("chmod 0600"));

    assert!(read(".gitignore").contains("/infra/secrets/"));
    assert!(read(".dockerignore").contains("infra/secrets"));
}

fn assert_mesh_node_contract() {
    let infra_tasks = read("infra/Taskfile.yml");
    let mesh_add = infra_tasks
        .split("\n  mesh:node:add:\n")
        .nth(1)
        .and_then(|tail| tail.split("\n  mesh:status:\n").next())
        .expect("infra:mesh:node:add must be defined inline in infra/Taskfile.yml");
    for required in [
        "silent: true",
        "ssh -n -o BatchMode=yes",
        "sudo -n true",
        "node --input-type=module",
        "import { execFileSync, spawnSync } from \"node:child_process\"",
        "wrangler\", [\"auth\", \"token\", \"--json\"]",
        "Authorization: `Bearer ${auth.token}`",
        "body: JSON.stringify({ name: nodeName, ha: false })",
        "apt-get install -y -qq ca-certificates curl gpg",
        "warp-cli connector new",
        "warp-cli connect",
        "sudo -n tee /run/nook-warp-enroll >/dev/null",
        "sudo -n chmod 0700 /run/nook-warp-enroll",
        "sudo -n /run/nook-warp-enroll",
        "input: `${connectorToken}\\n`",
        "systemctl is-active --quiet auditd",
        "auditctl -s",
        "mount -o remount,hidepid=2 /proc",
        "sudo -n rm -f /run/nook-warp-enroll",
        "CloudflareWARP",
        "/connections",
    ] {
        assert!(
            mesh_add.contains(required),
            "Cloudflare Mesh node automation is missing: {required}"
        );
    }
    for forbidden in [
        "console.log",
        "process.stdout.write(connectorToken)",
        "INFRA_MESH_TOKEN",
        "--header \"Authorization:",
        "node --input-type=commonjs",
        "connectorToken.replaceAll",
        "sudo -n warp-cli connector new",
        "/usr/bin/warp-cli; do",
    ] {
        assert!(
            !mesh_add.contains(forbidden),
            "Cloudflare Mesh node automation may expose credentials through: {forbidden}"
        );
    }
}
