use std::{
    fs,
    path::{Path, PathBuf},
};

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

fn infra_taskfile_graph() -> String {
    let root = read("infra/Taskfile.yml");
    let mut graph = root.clone();
    for line in root.lines() {
        let Some(relative_path) = line.trim().strip_prefix("taskfile: ") else {
            continue;
        };
        if relative_path.starts_with("tasks/") {
            graph.push_str(&read(&format!("infra/{relative_path}")));
        }
    }
    graph
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
                "infrastructure shell belongs inline in its owning infra Taskfile domain, not {}",
                entry_path.display()
            );
        }
    }
}

#[test]
fn remote_cache_and_registry_are_public_over_tls() -> anyhow::Result<()> {
    assert_remote_compose_contract()?;
    assert_infrastructure_deploy_contract()?;
    assert_zot_registry_contract()?;
    assert_mesh_node_contract()?;
    Ok(())
}

fn assert_remote_compose_contract() -> anyhow::Result<()> {
    let compose = read("infra/compose.yaml");
    for required in [
        "network_mode: host",
        "chrislusf/seaweedfs:",
        "-s3.port=8333",
        "-s3.ip.bind=127.0.0.1",
        "-s3.config=/etc/seaweedfs/s3.json",
        "/var/lib/nook/seaweedfs:/data",
        "./secrets/seaweedfs-s3.json:/etc/seaweedfs/s3.json:ro",
        "--entryPoints.websecure.address=:443",
        "traefik:v3.7.1@sha256:",
        "--certificatesResolvers.letsencrypt.acme.tlsChallenge=true",
        "./traefik-dynamic.yaml:/etc/traefik/dynamic.yaml:ro",
        "traefik-data:/data",
        "mem_limit: 2g",
        "restart: unless-stopped",
        "no-new-privileges:true",
    ] {
        assert!(
            compose.contains(required),
            "remote infrastructure is missing: {required}"
        );
    }
    assert!(
        !compose.contains("\n  redis:")
            && !compose.contains("redis-data")
            && !compose.contains("redis-password")
            && !compose.contains("--entryPoints.redis"),
        "Redis must be fully retired from Compose after the SeaweedFS cutover"
    );
    assert!(
        !compose.contains("6380:6379")
            && !compose.contains("5000:5000")
            && !compose.contains("ports:"),
        "host-network Traefik/SeaweedFS must not publish bridge port maps"
    );
    assert!(
        !compose.contains("\n  registry:") && !compose.contains("registry-data"),
        "the legacy Compose registry must be retired after the Zot migration"
    );
    assert!(
        compose.matches("@sha256:").count() >= 2,
        "infrastructure service images must be digest pinned"
    );

    let root_tasks = read("Taskfile.yml");
    assert!(root_tasks.contains("taskfile: infra/Taskfile.yml"));
    let infra_root = read("infra/Taskfile.yml");
    let expected_domains = [
        "manifests",
        "providers",
        "mesh",
        "operator-ssh",
        "host-services",
        "kubernetes-tools",
        "k0s",
        "k0s-workers",
        "k0s-worker-mesh",
        "kata",
        "neo4j",
        "registry",
        "arc",
        "arc-operations",
        "arc-smoke",
        "sccache",
        "hive",
        "hive-queue",
        "operations",
        "bake-cache",
        "kubernetes-cache",
    ];
    for domain in expected_domains {
        let include = format!(
            "  {domain}:\n    taskfile: tasks/{domain}.yml\n    dir: ..\n    flatten: true"
        );
        assert!(
            infra_root.contains(&include),
            "infra Taskfile must flatten the {domain} operational domain"
        );
    }
    let mut actual_domain_taskfiles = fs::read_dir(repository_root().join("infra/tasks"))?
        .map(|entry| {
            entry?.file_name().into_string().map_err(|name| {
                anyhow::anyhow!("non-UTF-8 infra task filename: {}", name.display())
            })
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    actual_domain_taskfiles.sort();
    let mut expected_domain_taskfiles = expected_domains
        .map(|domain| format!("{domain}.yml"))
        .to_vec();
    expected_domain_taskfiles.sort();
    assert_eq!(
        actual_domain_taskfiles, expected_domain_taskfiles,
        "every infra/tasks/*.yml domain must be reachable from the composition root"
    );

    assert_no_shell_scripts(&repository_root().join("infra"));

    let traefik = read("infra/traefik-dynamic.yaml");
    for required in [
        "certResolver: letsencrypt",
        "Host(`registry.dev.nokey.sh`)",
        "url: http://10.96.90.10:5000",
        "Host(`sccache.dev.nokey.sh`)",
        "url: http://127.0.0.1:8333",
        "passHostHeader: true",
    ] {
        assert!(
            traefik.contains(required),
            "Traefik TLS routing is missing: {required}"
        );
    }
    assert!(
        !traefik.contains("HostSNI(")
            && !traefik.contains("127.0.0.1:6379")
            && !traefik.contains("redis"),
        "Traefik must not retain Redis TCP routing after the SeaweedFS cutover"
    );

    let nftables = read("infra/nftables.conf");
    for required in [
        "chain input",
        "chain forward",
        "policy drop",
        "ct state established,related accept",
        "tcp dport { 22, 443 } accept",
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
    assert!(
        !nftables.contains("6380"),
        "host firewall must not expose retired Redis TCP 6380"
    );
    Ok(())
}

fn assert_infrastructure_deploy_contract() -> anyhow::Result<()> {
    let infra_root = read("infra/Taskfile.yml");
    let infra_tasks = infra_taskfile_graph();
    let host_services = read("infra/tasks/host-services.yml");
    let operations = read("infra/tasks/operations.yml");
    assert!(
        infra_root.contains(
            "INFRA_SSH_TARGET: '{{default \"debian@ssh-ovh-borg-1.bynull.link\" .INFRA_SSH_TARGET}}'"
        ),
        "infrastructure deployment must target the OVH borg-1 Debian account by default"
    );
    let deploy = host_services
        .split("\n  deploy:\n")
        .nth(1)
        .and_then(|tail| tail.split("\n  k0s:sync:\n").next())
        .context("host-services taskfile must define the deploy section")?;
    for required in [
        "docker compose -f \"$compose_file\" config --quiet",
        "ssh -n -o BatchMode=yes",
        "docker compose -f '$remote_compose' up -d --wait --force-recreate seaweedfs",
        "docker compose -f '$remote_compose' up -d --wait --remove-orphans traefik",
        "sudo -n install -d -m 0750 -o 1000 -g 1000 /var/lib/nook/seaweedfs",
        "traefik-dynamic.yaml.next",
        "grep -qx seaweedfs",
        "grep -qx traefik",
        "task: sccache:credential:ensure",
        "task: sccache:bucket:ensure",
        "task: registry:deploy",
        "docker volume rm nook-infra_redis-data",
        "rm -f '$remote_dir/secrets/redis-password'",
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
    assert!(!deploy.contains("up -d --wait redis"));
    assert!(!deploy.contains("cloudflare"));

    assert_sccache_credential_contract();
    let registry = read("infra/tasks/registry.yml");
    for required in [
        "home_cache=\"${HOME}/.nook/cache\"",
        "docker login \"$host\"",
        "gh secret set NOOK_REGISTRY_REMOTE_PASSWORD",
        "synchronized to ~/.nook/cache",
    ] {
        assert!(
            registry.contains(required),
            "registry credential sync is missing: {required}"
        );
    }
    assert!(
        !registry.contains("repo_root/.nook/cache") && !registry.contains("credential_dir="),
        "registry credentials must sync only to ~/.nook/cache"
    );
    assert!(!operations.contains("redis:credential"));
    assert!(!operations.contains("redis:stats"));

    assert!(read(".gitignore").contains("/infra/secrets/"));
    assert!(read(".dockerignore").contains("infra/secrets"));
    Ok(())
}

fn assert_sccache_credential_contract() {
    let sccache = read("infra/tasks/sccache.yml");
    for required in [
        "sccache:credential:ensure:",
        "sccache:credential:sync:",
        "sccache:bucket:ensure:",
        "sccache:check:",
        "home_cache=\"${HOME}/.nook/cache\"",
        "sccache-access-key",
        "sccache-secret-key",
        "sccache-remote-access-key",
        "sccache-remote-secret-key",
        "sccache-admin-access-key",
        "sccache-admin-secret-key",
        "install -d -m 0750 -o 1000 -g 1000 \"$data_dir\"",
        r#"\"name\": \"nook-sccache-build\""#,
        r#"\"Read:$bucket\""#,
        r#"\"Write:$bucket\""#,
        r#"\"List:$bucket\""#,
        r#"\"Tagging:$bucket\""#,
        r#"\"name\": \"nook-sccache-remote-reader\""#,
        r#"\"name\": \"nook-sccache-admin\""#,
        "gh secret set NOOK_SCCACHE_ACCESS_KEY",
        "gh secret set NOOK_SCCACHE_SECRET_KEY",
        "gh secret set NOOK_SCCACHE_REMOTE_ACCESS_KEY",
        "gh secret set NOOK_SCCACHE_REMOTE_SECRET_KEY",
        "gh secret set NOOK_SCCACHE_REMOTE_BUCKET",
        "NOOK_SCCACHE_ENDPOINT",
        "sccache.dev.nokey.sh",
        "nook-sccache",
        "chmod 0600",
        "~/.nook/cache",
        "s3api put-object",
        "s3api head-object",
        "s3api delete-object",
        "Main read/write and Remote read-only S3 checks passed",
        "Remote compiler identity must not write Main's bucket",
    ] {
        assert!(
            sccache.contains(required),
            "SeaweedFS sccache credential lifecycle is missing: {required}"
        );
    }
    assert!(
        !sccache.contains("repo_cache=")
            && !sccache.contains("$repo_root/.nook/cache")
            && !sccache.contains("and .nook/cache"),
        "SeaweedFS sccache credentials must sync only to ~/.nook/cache"
    );
    assert!(
        !sccache.contains("gh secret set NOOK_SCCACHE_ADMIN")
            && !sccache.contains("$home_cache/sccache-admin"),
        "SeaweedFS administrative credentials must remain server-side"
    );
    assert!(
        sccache.contains(
            "\\\"name\\\": \\\"nook-sccache-remote-reader\\\",\n              \\\"credentials\\\""
        ) && sccache.contains(
            "\\\"actions\\\": [\n                \\\"Read:$bucket\\\",\n                \\\"List:$bucket\\\"\n              ]"
        ),
        "Remote compiler identity must be read/list-only on Main's bucket"
    );
    let bucket_ensure = sccache
        .split("\n  sccache:bucket:ensure:\n")
        .nth(1)
        .and_then(|tail| tail.split("\n  sccache:check:\n").next())
        .unwrap_or_else(|| panic!("infra must define SeaweedFS bucket ensure"));
    let reload = bucket_ensure
        .find("up -d --wait --force-recreate seaweedfs")
        .unwrap_or_else(|| panic!("bucket ensure must reload SeaweedFS credentials"));
    let admin_login = bucket_ensure
        .find("sccache-admin-access-key")
        .unwrap_or_else(|| panic!("bucket ensure must load the server-side admin identity"));
    assert!(
        reload < admin_login,
        "bucket ensure must reload SeaweedFS before using newly generated admin credentials"
    );
}

fn assert_zot_registry_contract() -> anyhow::Result<()> {
    let manifest = read("infra/k0s/manifests/registry/zot.yaml");
    assert!(
        manifest.contains("\"compat\": [\"docker2s2\"]"),
        "Zot must accept legacy Docker Schema 2 manifests without changing their digests"
    );
    assert!(
        manifest.contains(
            "resources:\n            requests:\n              cpu: \"2\"\n              memory: 4Gi\n            limits:\n              cpu: \"8\"\n              memory: 12Gi"
        ),
        "Zot must reserve capacity and allow enough burst headroom for concurrent BuildKit cache traffic"
    );
    for required in [
        "\"nook/buildcache/**\"",
        "\"nook/remote-buildcache/**\"",
        "\"users\": [\"__NOOK_REGISTRY_REMOTE_USERNAME__\"]",
        "\"actions\": [\"read\"]",
        "\"actions\": [\"read\", \"create\", \"update\"]",
        "\"repositories\": [\"nook/remote-buildcache/**\"]",
        "\"pushedWithin\": \"168h\"",
        "\"adminPolicy\"",
    ] {
        assert!(
            manifest.contains(required),
            "Zot repository authorization is missing: {required}"
        );
    }
    let tasks = read("infra/tasks/registry.yml");
    let deploy = tasks
        .split("\n  registry:deploy:\n")
        .nth(1)
        .and_then(|tail| tail.split("\n  registry:check:\n").next())
        .context("infra must define the Zot deployment task")?;
    for required in [
        "sudo -n install -d -m 0750 -o 10001 -g 10001 /var/lib/hive/zot",
        "kubectl rollout status deployment/nook-zot",
        "deployment/nook-zot",
        "nook-zot-registry-loopback.service",
        "systemctl disable --now \"$unit\"",
        "Host must not listen on :5000",
        "kubectl.*port-forward.*nook-zot",
        "NOOK_REGISTRY_CLUSTER_IP",
        "docker-registry nook-registry",
        "kubectl delete secret nook-registry",
        "--namespace arc-runners",
        "certs.d/{{.NOOK_REGISTRY_HOST}}",
        "s/__NOOK_REGISTRY_USERNAME__/$username/g",
        "s/__NOOK_REGISTRY_REMOTE_USERNAME__/$remote_username/g",
        "kubectl apply -f \"$rendered_manifest\"",
    ] {
        assert!(
            deploy.contains(required),
            "Zot deployment is missing: {required}"
        );
    }
    assert!(
        !deploy.contains("5001:5000")
            && !deploy.contains("systemctl enable --now \"$unit\"")
            && !deploy.contains("NodePort")
            && !deploy.contains("kind: Ingress"),
        "Zot deployment must not recreate loopback port-forward or NodePort/Ingress paths"
    );
    assert!(
        !deploy.contains("hive-data hive-system arc-runners"),
        "ARC must not receive the Main-writer Zot credential"
    );

    let check = tasks
        .split("\n  registry:check:\n")
        .nth(1)
        .and_then(|tail| tail.split("\n  registry:diagnose:\n").next())
        .context("infra must define the Zot operational check")?;
    for required in [
        "jsonpath='{.status.phase}'",
        "Host must not listen on :5000",
        "https://$host/v2/",
        "test \"$public_code\" = 200",
        "test \"$anonymous_private_read\" = 401",
        "test \"$anonymous_mirror_write\" = 401",
        "test \"$public_auth\" = 200",
        "test \"$remote_main_write\" = 403",
        "test \"$remote_branch_write\" = 202",
        "nook/remote-buildcache/nook-authz-probe",
        "\"https://$host/\"*) upload_url=\"$location\"",
        "Legacy loopback registry unit must be removed",
    ] {
        assert!(
            check.contains(required),
            "Zot operational check is missing: {required}"
        );
    }

    let credential = tasks
        .split("\n  registry:credential:ensure:\n")
        .nth(1)
        .and_then(|tail| tail.split("\n  registry:credential:sync:\n").next())
        .context("infra must define registry credential ensure")?;
    assert!(
        credential.contains("htpasswd")
            && credential.contains("-nbB")
            && credential.contains("nook-zot-htpasswd")
            && credential.contains("registry-password")
            && credential.contains("registry-remote-password"),
        "registry credential lifecycle must materialize separate Main and Remote Zot identities"
    );
    assert!(
        tasks.contains("gh secret set NOOK_REGISTRY_REMOTE_USERNAME")
            && tasks.contains("gh secret set NOOK_REGISTRY_REMOTE_PASSWORD"),
        "registry credential sync must publish only the scoped Remote Zot identity to Remote jobs"
    );
    assert_eq!(
        tasks
            .matches("Main and Remote Zot usernames must be distinct")
            .count(),
        2,
        "credential generation and manifest rendering must both reject a shared Zot principal"
    );

    let uninstall = read("infra/tasks/k0s.yml");
    assert!(
        uninstall.contains("disable --now nook-zot-registry-loopback.service")
            && uninstall.contains("test -d /var/lib/hive/zot")
            && uninstall.contains("certs.d/registry.dev.nokey.sh"),
        "k0s uninstall must remove any legacy forwarding unit, retain Zot data, and use the public registry host config"
    );
    Ok(())
}

fn assert_mesh_node_contract() -> anyhow::Result<()> {
    let mesh_tasks = read("infra/tasks/mesh.yml");
    let mesh_add = mesh_tasks
        .split("\n  mesh:node:add:\n")
        .nth(1)
        .and_then(|tail| tail.split("\n  mesh:status:\n").next())
        .context("mesh taskfile must define mesh node enrollment")?;
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
    Ok(())
}
