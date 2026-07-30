use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
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

#[test]
fn neo4j_credentials_reconcile_exact_bytes_before_tls_mutation() -> std::io::Result<()> {
    let root = repository_root();
    let output = Command::new("bash")
        .arg(root.join("preflight/tests/neo4j_credentials.sh"))
        .arg(&root)
        .output()?;
    assert!(
        output.status.success(),
        "Neo4j credential reconciliation harness failed:\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    let task = read("infra/tasks/neo4j.yml");
    let credential_validation = task
        .find("reconcile_neo4j_credentials \"$secret_dir\" \"$retained_storage\"")
        .expect("credential validation");
    let tls_secret_apply = task
        .find("kubectl create secret generic hive-neo4j-tls")
        .expect("TLS Secret apply");
    assert!(
        credential_validation < tls_secret_apply,
        "credentials must be validated before replacement TLS Secrets are published"
    );
    Ok(())
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
fn remote_cache_is_public_over_tls_and_zot_remains_private() {
    assert_remote_compose_contract();
    assert_infrastructure_deploy_contract();
    assert_zot_registry_contract();
    assert_mesh_node_contract();
}

#[test]
fn neo4j_client_secret_normalization_is_upgrade_safe() {
    let tasks = read("infra/tasks/neo4j.yml");
    let start = tasks
        .find("NEO4J_CREDENTIAL_RECONCILIATION_BEGIN")
        .expect("Neo4j credential reconciliation starts");
    let reconciliation = &tasks[start..];

    for required in [
        "tr -d '\\r\\n' > \"$secret_dir/password\"",
        "Refusing to generate Neo4j credentials while retained data exists",
        "if ! test -s \"$secret_dir/password\"",
        "test \"$client_exists\" = true",
        "test -s \"$secret_dir/password\"",
        "kubectl apply -f -",
        "Refusing divergent non-empty Neo4j credentials",
        "auth_secret_needs_reconcile=true",
    ] {
        assert!(
            reconciliation.contains(required),
            "Neo4j credential reconciliation is missing: {required}"
        );
    }
    for required in [
        "hive.nook.sh/neo4j-client-sha256",
        "hive-workbench-dispatcher",
        "hive-observer",
        "kubectl patch",
        "kubectl rollout status",
    ] {
        assert!(
            tasks.contains(required),
            "Neo4j client rollout is missing: {required}"
        );
    }
    let retained_probe = tasks
        .find("retained_storage=false")
        .expect("retained storage probe");
    let storage_apply = tasks
        .find("manifests/neo4j/storage.yaml")
        .expect("Neo4j storage apply");
    assert!(
        retained_probe < storage_apply,
        "retained storage must be detected before storage resources are applied"
    );
    assert!(
        tasks.contains("sudo -n find /var/lib/hive/neo4j"),
        "retained host files must fail closed"
    );
    assert!(
        tasks.contains("if ! retained_path=\"$(")
            && tasks.contains("Failed to inspect retained Neo4j storage"),
        "a failed retained-storage probe must abort credential reconciliation"
    );
    assert!(
        !tasks[retained_probe..storage_apply].contains("kubectl get pvc"),
        "an empty PVC from interrupted bootstrap is not retained Neo4j data"
    );
    assert!(
        reconciliation.contains("if grep -Fq '(NotFound)'"),
        "only a verified Secret NotFound response may be treated as absence"
    );
    assert!(
        reconciliation.contains("Failed to inspect Secret"),
        "other Secret lookup failures must be propagated"
    );

    let neo4j_ready = reconciliation
        .find("kubectl rollout status statefulset/hive-neo4j")
        .expect("Neo4j availability wait");
    let client_restart = reconciliation
        .find("hive.nook.sh/neo4j-client-sha256")
        .expect("client checksum rollout gate");
    assert!(
        client_restart > neo4j_ready,
        "clients restart only after Neo4j is available"
    );
}

#[test]
fn hive_graph_clients_never_mix_schema_revisions() {
    for manifest in [
        "infra/k0s/manifests/hive/deployment.yaml",
        "infra/k0s/manifests/hive/dispatcher.yaml",
        "infra/k0s/manifests/hive/observer.yaml",
    ] {
        let deployment = read(manifest);
        assert!(
            deployment.contains("strategy:\n    type: Recreate"),
            "{manifest} must drain its prior graph-schema revision before starting a new one"
        );
    }
    let worker_manifest = read("infra/k0s/manifests/hive/deployment.yaml");
    for required in [
        "terminationGracePeriodSeconds: 75",
        "while [ ! -e /workspace/.hive-task-finished ]",
        "/workspace/.hive-task-finished",
        "&& [ -e /workspace/.hive-worker-ready ]",
    ] {
        assert!(
            worker_manifest.contains(required),
            "Hive rollout must preserve worker lease release through coordinator shutdown: \
             missing {required}"
        );
    }
    let coordinator_start = worker_manifest
        .find("        - name: coordinator\n")
        .expect("Hive coordinator container");
    let coordinator = &worker_manifest[coordinator_start..];
    let coordinator_end = coordinator
        .find("        - name: auth-broker\n")
        .expect("container after Hive coordinator");
    let coordinator = &coordinator[..coordinator_end];
    assert!(
        coordinator.contains(
            "            - name: workspace\n              mountPath: /workspace\n              \
             readOnly: true"
        ),
        "Hive coordinator must mount the worker workspace read-only to observe lifecycle markers"
    );
    let deployment_tasks = read("infra/tasks/hive.yml");
    for required in [
        "for deployment in hive hive-workbench-dispatcher hive-observer",
        "kubectl scale \"deployment/$deployment\"",
        "--replicas=0",
        "--selector \"app.kubernetes.io/name=$deployment\"",
        "Timed out draining graph client deployment/$deployment",
    ] {
        assert!(
            deployment_tasks.contains(required),
            "Hive graph-client rollout is missing: {required}"
        );
    }
    let drain = deployment_tasks
        .find("kubectl scale \"deployment/$deployment\"")
        .expect("graph-client drain");
    let apply = deployment_tasks
        .find("kubectl apply -f \"$rendered\"")
        .expect("Hive manifest apply");
    assert!(
        drain < apply,
        "every old graph client must stop before the new revision is applied"
    );
}

fn assert_remote_compose_contract() {
    let compose = read("infra/compose.yaml");
    for required in [
        "6380:6380",
        "443:443",
        "requirepass $$password",
        "/run/redis/redis.conf",
        "docker-entrypoint.sh redis-server /run/redis/redis.conf",
        "/run/secrets/redis-password",
        "file: ./secrets/redis-password",
        "appendonly yes",
        "maxmemory-policy allkeys-lru",
        "allkeys-lru",
        "redis-data:/data",
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
    assert!(!compose.contains("6380:6379") && !compose.contains("5000:5000"));
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
        "mesh",
        "host-services",
        "kubernetes-tools",
        "k0s",
        "kata",
        "neo4j",
        "registry",
        "hive",
        "operations",
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
    let mut actual_domain_taskfiles = fs::read_dir(repository_root().join("infra/tasks"))
        .expect("infra/tasks must be readable")
        .map(|entry| {
            entry
                .expect("infra/tasks entries must be readable")
                .file_name()
                .into_string()
                .expect("infra taskfile names must be UTF-8")
        })
        .collect::<Vec<_>>();
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
        "tcp dport { 22, 443, 6380 } accept",
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
        .expect("infra:deploy must be defined in the host-services Taskfile domain");
    for required in [
        "docker compose -f \"$compose_file\" config --quiet",
        "ssh -n -o BatchMode=yes",
        "docker compose -f '$remote_compose' up -d --wait redis traefik",
        "openssl rand -hex 32",
        "chmod 0600 '$remote_secrets/redis-password'",
        "traefik-dynamic.yaml.next",
        "cat /run/secrets/redis-password",
        "redis-cli ping",
        "grep -qx traefik",
        "task: registry:deploy",
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

    let sync = operations
        .split("\n  redis:credential:sync:\n")
        .nth(1)
        .expect("infra must provide local Redis credential synchronization");
    assert!(sync.contains(".nook/cache/redis-password"));
    assert!(sync.contains("chmod 0600"));

    assert!(read(".gitignore").contains("/infra/secrets/"));
    assert!(read(".dockerignore").contains("infra/secrets"));
}

fn assert_zot_registry_contract() {
    let tasks = read("infra/tasks/registry.yml");
    let deploy = tasks
        .split("\n  registry:deploy:\n")
        .nth(1)
        .and_then(|tail| tail.split("\n  registry:check:\n").next())
        .expect("infra must define the Zot deployment and migration task");
    for required in [
        "sudo -n install -d -m 0750 -o 10001 -g 10001 /var/lib/hive/zot",
        "kubectl rollout status deployment/nook-zot",
        "deployment/nook-zot",
        "5001:5000",
        "/v2/_catalog?n=10000",
        "/tags/list?n=10000",
        "docker pull \"$source\"",
        "docker push \"$destination\"",
        "destination_digest",
        "Refusing lossy registry migration",
        "docker stop \"$legacy_registry\"",
        "nook-zot-registry-loopback.service",
        "--address 127.0.0.1",
        "5000:5000",
        "Restart=always",
        "NoNewPrivileges=true",
        "ProtectSystem=strict",
        "docker start \"$legacy_registry\"",
        "cutover_complete=true",
    ] {
        assert!(
            deploy.contains(required),
            "Zot deployment is missing: {required}"
        );
    }
    let copy = deploy
        .find("copy_legacy_registry")
        .expect("legacy registry copy");
    let stop = deploy
        .find("docker stop \"$legacy_registry\"")
        .expect("legacy registry stop");
    let enable = deploy
        .find("systemctl enable --now \"$unit\"")
        .expect("Zot loopback enable");
    assert!(
        copy < stop && stop < enable,
        "Zot must copy before stopping legacy storage and bind loopback afterward"
    );
    assert!(
        !deploy.contains("--address 0.0.0.0")
            && !deploy.contains("NodePort")
            && !deploy.contains("Ingress"),
        "Zot deployment must not create a public registry path"
    );

    let check = tasks
        .split("\n  registry:check:\n")
        .nth(1)
        .and_then(|tail| tail.split("\n  registry:diagnose:\n").next())
        .expect("infra must define the Zot operational check");
    for required in [
        "systemctl is-enabled --quiet",
        "systemctl is-active --quiet",
        "jsonpath='{.status.phase}'",
        "127.0.0.1:5000/v2/",
        "127.0.0.1:5000",
        "Zot registry is not loopback-only",
    ] {
        assert!(
            check.contains(required),
            "Zot operational check is missing: {required}"
        );
    }

    let uninstall = read("infra/tasks/k0s.yml");
    assert!(
        uninstall.contains("disable --now nook-zot-registry-loopback.service")
            && uninstall.contains("test -d /var/lib/hive/zot"),
        "k0s uninstall must remove the forwarding unit and retain Zot data"
    );
}

fn assert_mesh_node_contract() {
    let mesh_tasks = read("infra/tasks/mesh.yml");
    let mesh_add = mesh_tasks
        .split("\n  mesh:node:add:\n")
        .nth(1)
        .and_then(|tail| tail.split("\n  mesh:status:\n").next())
        .expect("infra:mesh:node:add must be defined in the mesh Taskfile domain");
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
