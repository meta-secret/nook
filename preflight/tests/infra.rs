use std::{fs, path::PathBuf, process::Command};

use anyhow::Context;

#[path = "infra/remote_platform_contracts.rs"]
mod remote_platform_contracts;

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

fn read_fallible(path: &str) -> anyhow::Result<String> {
    fs::read_to_string(repository_root().join(path))
        .with_context(|| format!("failed to read {path}"))
}

fn production_dockerfiles(directory: PathBuf) -> Vec<PathBuf> {
    let mut dockerfiles = Vec::new();
    let mut pending = vec![directory];

    while let Some(path) = pending.pop() {
        for entry in fs::read_dir(&path)
            .unwrap_or_else(|error| panic!("failed to inventory {}: {error}", path.display()))
        {
            let entry = entry.expect("repository entry must be readable");
            let path = entry.path();
            if path.is_dir() {
                let relative = path
                    .strip_prefix(repository_root())
                    .expect("repository entries must stay beneath the root");
                let directory_name = path.file_name().expect("directory must have a name");
                if matches!(
                    directory_name.to_str(),
                    Some(".git" | "target" | "node_modules")
                ) || relative == std::path::Path::new("infra/sim/bake-cache")
                {
                    continue;
                }
                pending.push(path);
            } else if path
                .file_name()
                .is_some_and(|name| name.to_string_lossy().contains("Dockerfile"))
            {
                dockerfiles.push(path);
            }
        }
    }

    dockerfiles
}

#[test]
fn arc_buildkit_resolves_docker_hub_only_through_zot() {
    let manifest = read("infra/k0s/manifests/arc/buildkit.yaml");

    assert!(manifest.contains(r#"[registry."docker.io"]"#));
    assert!(manifest.contains(r#"mirrors = ["registry.dev.nokey.sh"]"#));
    assert!(!manifest.contains("registry-1.docker.io"));
    assert!(manifest.contains("internalTrafficPolicy: Local"));
    assert!(manifest.contains("kind: StatefulSet"));
    assert_eq!(manifest.matches("kind: PersistentVolume\n").count(), 3);

    let proof = read("infra/tasks/bake-cache.yml");
    let zot = read("infra/sim/bake-cache/zot-config.json");
    let hive_values = read("infra/k0s/scripts/arc-hive-values.rb");
    assert!(proof.contains("registry_ref"));
    assert!(proof.contains("library/alpine"));
    assert!(zot.contains("\"onDemand\": true"));
    assert!(zot.contains("\"preserveDigest\": true"));
    assert!(hive_values.contains("registry.dev.nokey.sh/library/neo4j:"));
}

#[test]
fn production_dockerfiles_never_resolve_docker_hub_directly() {
    for path in production_dockerfiles(repository_root()) {
        let relative = path
            .strip_prefix(repository_root())
            .expect("Dockerfile must stay beneath the repository root");
        let path = relative.to_string_lossy();
        let dockerfile = read(&path);
        let mut image_arguments = std::collections::HashMap::new();
        let mut stages = std::collections::HashSet::new();

        for line in dockerfile.lines().map(str::trim) {
            if let Some(frontend) = line.strip_prefix("# syntax=") {
                assert!(
                    frontend.starts_with("registry.dev.nokey.sh/"),
                    "{path} resolves its Dockerfile frontend outside Zot: {frontend}"
                );
            }
            if let Some(argument) = line.strip_prefix("ARG ")
                && let Some((name, value)) = argument.split_once('=')
            {
                image_arguments.insert(name, value);
            }
            let Some(from) = line.strip_prefix("FROM ") else {
                continue;
            };
            let mut tokens = from.split_whitespace();
            let reference = tokens
                .find(|token| !token.starts_with("--"))
                .expect("FROM must contain an image or prior stage");
            let resolved = reference
                .strip_prefix("${")
                .and_then(|name| name.strip_suffix('}'))
                .map_or(reference, |name| {
                    image_arguments
                        .get(name)
                        .copied()
                        .unwrap_or_else(|| panic!("{path} has no default for FROM ${{{name}}}"))
                });
            assert!(
                resolved == "scratch"
                    || stages.contains(reference)
                    || matches!(reference, "rust-base" | "web-base")
                    || resolved.starts_with("registry.dev.nokey.sh/"),
                "{path} resolves a production base outside Zot: {resolved}"
            );
            let remainder: Vec<_> = tokens.collect();
            if remainder.len() >= 2 && remainder[remainder.len() - 2].eq_ignore_ascii_case("AS") {
                stages.insert(remainder[remainder.len() - 1]);
            }
        }
    }
}

#[test]
fn arc_smoke_uses_only_supported_persistent_buildkit_routes() {
    let tasks = read("infra/tasks/arc-smoke.yml");

    assert!(tasks.contains("ARC_RUNNER_LABEL: nook-k0s"));
    assert!(tasks.contains("ARC_HIVE_RUNNER_LABEL: nook-k0s-hive"));
    assert!(tasks.contains("ARC_SMOKE_TASK: arc:runtime"));
    assert!(tasks.contains("gh run watch"));
    assert!(tasks.contains("runnerName"));
    assert!(!tasks.contains("nook-k0s-cache"));
    assert!(!tasks.contains("Kata sandbox"));
    assert!(!tasks.contains("gh variable set NOOK_CACHE_RUNS_ON"));
}

#[test]
fn arc_mesh_reconciliation_fails_closed() {
    let services = read("infra/tasks/host-services.yml");
    let workers = read("infra/tasks/k0s-workers.yml");
    let worker_mesh = read("infra/k0s/scripts/k0s-worker-mesh-reconcile");
    assert!(
        workers.contains("worker_pod_cidr=\"$(sudo -n k0s kubectl get node")
            && workers.contains("AllowedIPs = $allowed_ips"),
        "peer reconciliation must preserve the registered worker Pod CIDR"
    );
    assert!(
        worker_mesh.contains("AllowedIPs = $address/32,$pod_cidr")
            && worker_mesh.contains("migrate_legacy_controller_peers")
            && worker_mesh.contains("/etc/wireguard/nook-peers/$address.conf")
            && worker_mesh.contains("sudo -n wg syncconf wg-nook")
            && worker_mesh.contains("ip route replace \"$controller_pod_cidr\" dev wg-nook")
            && worker_mesh.contains("ip route replace \"$pod_cidr\" dev wg-nook")
            && worker_mesh.contains("Deferred offline worker")
            && worker_mesh.contains("Deferred offline roaming worker")
            && worker_mesh.contains("ssh_host=\"${ssh_target#*@}\"")
            && worker_mesh.contains("comment \"nook k0s worker wireguard\"")
            && worker_mesh.contains("nook.nokey.sh/mesh=pending:NoSchedule")
            && worker_mesh.contains("nook.nokey.sh/mesh:NoSchedule-")
            && worker_mesh.contains("nft --json list chain ip filter INPUT")
            && worker_mesh.contains("Authenticated direct worker mesh is healthy"),
        "compute nodes must receive direct authenticated routes to every worker Pod CIDR"
    );
    assert!(
        !worker_mesh.contains("$0 ~ \"ip saddr \" controller_ip"),
        "mesh reconciliation must delete only comment-owned firewall rules"
    );
    assert!(
        workers.contains("WireGuard key already belongs to a legacy peer")
            && workers.contains("belongs to a legacy WireGuard peer")
            && workers.contains("persisted_matches")
            && workers.contains("refusing colliding partial legacy inventory"),
        "worker admission must reject collisions and resume partial legacy migration"
    );
    let empty_worker_check = worker_mesh
        .find("if test \"$(printf '%s' \"$compute_nodes\" | jq '.items | length')\" = 0")
        .expect("mesh reconciliation must detect an empty compute tier");
    let controller_key = worker_mesh
        .find("controller_public_key=\"$(sudo -n cat /etc/wireguard/nook-public.key)\"")
        .expect("mesh reconciliation must read the controller WireGuard key");
    let peer_verification = worker_mesh
        .find("ping -c 1 -W 3 '$target_address'")
        .expect("reachable workers must verify direct peer connectivity");
    let taint_all = worker_mesh
        .find("set_mesh_pending \"$node_name\"\ndone <<<\"$workers\"")
        .expect("all workers must become unschedulable before reconciliation");
    let connection_preflight = worker_mesh
        .find("-o ConnectTimeout=5")
        .expect("workers must be checked before configuration");
    let clear_pending = worker_mesh
        .rfind("clear_mesh_pending \"$node_name\"")
        .expect("verified workers must become schedulable");
    assert!(empty_worker_check < controller_key);
    assert!(taint_all < connection_preflight);
    assert!(peer_verification < clear_pending);
    let install = services
        .find("- task: k0s:install")
        .expect("standard deployment must install k0s");
    let standard_reconcile = services
        .find("- task: k0s:worker-mesh:reconcile")
        .expect("standard deployment must reconcile the direct worker mesh");
    let standard_arc = services
        .find("- task: arc:deploy")
        .expect("standard deployment must install ARC");
    assert!(install < standard_reconcile && standard_reconcile < standard_arc);
    let reconcile = workers
        .find("task: k0s:worker-mesh:reconcile")
        .expect("worker deployment must reconcile the direct worker mesh");
    let qualify = workers
        .find("task: kata:install")
        .expect("worker deployment must qualify Kata");
    assert!(
        reconcile < qualify,
        "the direct worker mesh must converge before Kata and ARC qualification"
    );
}

#[test]
fn arc_prioritizes_and_spreads_runners_across_qualified_nodes() {
    let values = read("infra/k0s/manifests/arc/runner-scale-set-values.yaml");
    let hive_values = read("infra/k0s/scripts/arc-hive-values.rb");
    let buildkit = read("infra/k0s/manifests/arc/buildkit.yaml");
    let tasks = read("infra/tasks/arc.yml");

    for contract in [
        "maxRunners: 25",
        "topologySpreadConstraints:",
        "maxSkew: 5",
        "topologyKey: kubernetes.io/hostname",
        "whenUnsatisfiable: DoNotSchedule",
        "nodeAffinityPolicy: Honor",
        "nodeTaintsPolicy: Honor",
        "nook.nokey.sh/arc-spread-group: general",
        "values: [primary]",
        "values: [secondary]",
        "values: [overflow]",
        "tcp://nook-buildkit.arc-runners.svc.cluster.local:1234",
    ] {
        assert!(
            values.contains(contract),
            "ARC spreading is missing: {contract}"
        );
    }
    for forbidden in ["runtimeClassName:", "podman", "docker.sock", "hostPath:"] {
        assert!(
            !values.contains(forbidden),
            "ARC runner contains {forbidden}"
        );
    }
    assert!(
        hive_values.contains("hive_values[\"maxRunners\"] = 10")
            && hive_values.contains("nook.nokey.sh/arc-spread-group\"] = \"hive\""),
        "Hive ARC must own its bounded independent spread group"
    );
    assert_eq!(buildkit.matches("kind: PersistentVolume\n").count(), 3);
    assert!(buildkit.contains("internalTrafficPolicy: Local"));
    assert!(buildkit.contains("replicas: 3"));
    assert!(buildkit.contains("requiredDuringSchedulingIgnoredDuringExecution"));
    assert!(buildkit.contains("storage: 64Gi"));

    for contract in [
        "arc:controller-build:prepare:",
        "nook.nokey.sh/arc-build=preparing:NoSchedule",
        "nook.nokey.sh/arc-tier=overflow",
        "arc:buildkit:storage:prepare:",
        "rollout status statefulset/nook-buildkit",
        "autoscalingrunnerset/nook-k0s",
        "autoscalingrunnerset/nook-k0s-hive",
        "arc:build-hosts:activate:",
    ] {
        assert!(
            tasks.contains(contract),
            "ARC orchestration is missing: {contract}"
        );
    }
    let prepare = tasks
        .find("- task: arc:controller-build:prepare")
        .expect("ARC deployment must prepare the controller build node");
    let storage = tasks
        .find("- task: arc:buildkit:storage:prepare")
        .expect("ARC deployment must prepare retained storage");
    let rollout = tasks
        .find("rollout status statefulset/nook-buildkit")
        .expect("ARC deployment must wait for BuildKit");
    let activate = tasks
        .rfind("- task: arc:build-hosts:activate")
        .expect("ARC deployment must activate converged nodes");
    assert!(prepare < storage && storage < rollout && rollout < activate);
}

#[test]
fn hive_dispatcher_avoids_dragonball_network_churn_and_bounds_terminal_pods() {
    let workers = read("infra/k0s/manifests/hive/deployment.yaml");
    let dispatcher = read("infra/k0s/manifests/hive/dispatcher.yaml");
    let observer = read("infra/k0s/manifests/hive/observer.yaml");
    let reaper = read("infra/k0s/manifests/hive/reaper-controller.yaml");
    let k0s = read("infra/k0s/config/k0s.yaml");

    for manifest in [&workers, &dispatcher, &observer, &reaper] {
        assert!(
            manifest.contains("replicas: 0"),
            "Hive must remain paused until duplicate repair orchestration is corrected"
        );
    }
    assert!(
        workers.contains("runtimeClassName: kata-dragonball")
            && workers.contains("nook.nokey.sh/node-role: compute"),
        "Hive workers must keep their private sidecar channel inside Dragonball compute VMs"
    );
    assert!(
        dispatcher.contains("runtimeClassName: kata-qemu-runtime-rs")
            && dispatcher.contains("nook.nokey.sh/node-role: compute")
            && dispatcher.contains("sizeLimit: 1Gi"),
        "the persistent Hive dispatcher must use QEMU Kata on the compute tier with enough bounded checkout space"
    );
    assert!(
        k0s.contains("terminated-pod-gc-threshold: \"200\""),
        "k0s must bound retained terminal Pods for operational diagnosis"
    );
}

#[test]
fn neo4j_credentials_reconcile_exact_bytes_before_tls_mutation() -> anyhow::Result<()> {
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
        .context("Neo4j task must reconcile credentials")?;
    let tls_secret_apply = task
        .find("kubectl create secret generic hive-neo4j-tls")
        .context("Neo4j task must publish its TLS secret")?;
    assert!(
        credential_validation < tls_secret_apply,
        "credentials must be validated before replacement TLS Secrets are published"
    );
    Ok(())
}

#[test]
fn hive_dispatcher_keeps_github_run_reads_token_free() -> anyhow::Result<()> {
    let manifest = read_fallible("infra/k0s/manifests/hive/dispatcher.yaml")?;
    assert!(!manifest.contains("GH_TOKEN"));
    assert!(!manifest.contains("hive-github-publication"));

    let client = read_fallible("agentic-ai/minds/hive/src/dispatcher/github.rs")?;
    assert!(
        client.contains("https://github.com/meta-secret/nook/actions/runs"),
        "Hive dispatcher must use the public run page outside the REST API rate budget"
    );
    assert!(
        !client.contains("api.github.com") && !client.contains("Authorization"),
        "Hive dispatcher must not own a GitHub credential"
    );
    assert!(
        client.contains("kill_on_drop(true)") && client.contains("timeout("),
        "Hive dispatcher GitHub requests must remain bounded"
    );
    Ok(())
}

#[test]
fn hive_deploy_preserves_cluster_rotated_codex_auth() -> anyhow::Result<()> {
    let root = repository_root();
    for (harness, description) in [
        (
            "preflight/tests/hive_auth_sync.sh",
            "Hive auth synchronization",
        ),
        (
            "preflight/tests/hive_auth_rotation.sh",
            "Hive auth rotation",
        ),
        ("preflight/tests/hive_auth_staging.sh", "Hive auth staging"),
        (
            "preflight/tests/hive_mutation_serialization.sh",
            "Hive mutation serialization",
        ),
        (
            "preflight/tests/hive_deploy_convergence.sh",
            "Hive deployment convergence",
        ),
    ] {
        let output = Command::new("bash")
            .arg(root.join(harness))
            .arg(&root)
            .output()?;
        assert!(
            output.status.success(),
            "{description} harness failed:\nstdout:\n{}\nstderr:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let tasks = read_fallible("infra/tasks/hive.yml")?;
    let rotate = tasks
        .split("\n  hive:auth:rotate:\n")
        .nth(1)
        .and_then(|tail| tail.split("\n  hive:auth:bootstrap:\n").next())
        .context("Hive tasks must define explicit Codex auth rotation")?;
    let publish_task = tasks
        .split("\n  hive:auth:publish:\n")
        .nth(1)
        .and_then(|tail| tail.split("\n  hive:auth:sync:\n").next())
        .context("Hive tasks must define internal Codex auth publication")?;
    let deploy = tasks
        .split("\n  hive:deploy:\n")
        .nth(1)
        .context("Hive tasks must define deployment")?;
    assert!(
        rotate.contains("HIVE_AUTH_PUBLICATION_MODE: replace")
            && publish_task.contains("HIVE_CODEX_AUTH_FILE is required")
            && publish_task.contains("IFS= read -r -d '' remote_program <<'REMOTE' || true")
            && !publish_task.contains("remote_program=\"$(cat <<'REMOTE'")
            && publish_task.contains("encoded_program=")
            && publish_task.contains("base64 -d")
            && publish_task.contains("HIVE_AUTH_REMOTE_BEGIN"),
        "explicit auth rotation must validate and stream the local credential"
    );
    assert!(
        !publish_task.contains("cat >\"$auth_file\"")
            && !publish_task.contains("NOOK_HIVE_AUTH_STAGING_ROOT")
            && publish_task.contains("data: {\"auth.json\": (tojson | @base64)}")
            && publish_task.contains("kubectl scale deployment/hive")
            && publish_task.contains("--replicas=0")
            && publish_task.contains("--for=delete")
            && publish_task.contains("exec 9>/run/lock/nook/hive-mutation.lock")
            && publish_task.contains("flock --exclusive --timeout 900 9")
            && publish_task.contains("nook.nokey.sh/hive-auth-desired-replicas")
            && !publish_task.contains("$remote_dir/hive-auth-desired-replicas")
            && publish_task.contains("kubectl rollout status deployment/hive"),
        "explicit auth rotation must stream the Secret without staging, quiesce brokers, and restore the pool"
    );
    assert!(
        deploy.contains("exec 9>/run/lock/nook/hive-mutation.lock")
            && deploy.contains("flock --exclusive --timeout 900 9"),
        "Hive deployment and auth rotation must share the host-global mutation lock"
    );
    let neo4j = read("infra/tasks/neo4j.yml");
    assert!(
        neo4j.contains(
            "if test \"$tls_changed\" = true; then\n          # NEO4J_HIVE_MUTATION_LOCK_BEGIN"
        ) && neo4j.contains("exec 9>/run/lock/nook/hive-mutation.lock")
            && neo4j.contains("flock --exclusive --timeout 900 9"),
        "Neo4j TLS rotation must share Hive's host-global mutation lock"
    );
    let quiesce = publish_task
        .find("--replicas=0")
        .context("auth rotation must quiesce the warm pool")?;
    let publish = publish_task
        .find("data: {\"auth.json\": (tojson | @base64)}")
        .context("auth rotation must publish the replacement Secret")?;
    let restore = publish_task
        .rfind("restore_hive_workers")
        .context("auth rotation must restore the warm pool")?;
    assert!(
        quiesce < publish && publish < restore,
        "auth rotation must stop brokers before publication and restore them afterward"
    );
    Ok(())
}

#[test]
fn neo4j_client_secret_normalization_is_upgrade_safe() -> anyhow::Result<()> {
    let tasks = read("infra/tasks/neo4j.yml");
    let start = tasks
        .find("NEO4J_CREDENTIAL_RECONCILIATION_BEGIN")
        .context("Neo4j task must delimit credential reconciliation")?;
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
        .context("Neo4j task must probe retained storage")?;
    let storage_apply = tasks
        .find("manifests/neo4j/storage.yaml")
        .context("Neo4j task must apply its storage manifest")?;
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
        .context("Neo4j task must wait for the StatefulSet")?;
    let client_restart = reconciliation
        .find("hive.nook.sh/neo4j-client-sha256")
        .context("Neo4j task must restart clients for credential changes")?;
    assert!(
        client_restart > neo4j_ready,
        "clients restart only after Neo4j is available"
    );
    Ok(())
}

#[test]
fn hive_graph_clients_never_mix_schema_revisions() -> anyhow::Result<()> {
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
        .ok_or_else(|| anyhow::anyhow!("Hive coordinator container"))?;
    let coordinator = &worker_manifest[coordinator_start..];
    let coordinator_end = coordinator
        .find("        - name: auth-broker\n")
        .ok_or_else(|| anyhow::anyhow!("container after Hive coordinator"))?;
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
        "HIVE_DEPLOY_CONVERGENCE_HELPERS_BEGIN",
        "hive_wait_for_graph_client_drain \"$deployment\" 60 2",
        "hive_wait_for_ready_pool 60 2 3",
    ] {
        assert!(
            deployment_tasks.contains(required),
            "Hive graph-client rollout is missing: {required}"
        );
    }
    for required in [
        "--selector \"app.kubernetes.io/name=$1\"",
        ".status.phase != \"Succeeded\" and .status.phase != \"Failed\"",
        ".metadata.deletionTimestamp == null",
        ".name == \"hive\" and .ready == true",
        "Timed out draining active graph client deployment/$deployment",
        "consecutive_ready=0",
        "Hive pool did not stabilize at four ready workers",
    ] {
        assert!(
            deployment_tasks.contains(required),
            "Hive deployment convergence helper is missing: {required}"
        );
    }
    let drain = deployment_tasks
        .find("kubectl scale \"deployment/$deployment\"")
        .context("graph-client drain must exist")?;
    let apply = deployment_tasks
        .find("kubectl apply -f \"$rendered\"")
        .context("Hive manifest apply must exist")?;
    assert!(
        drain < apply,
        "every old graph client must stop before the new revision is applied"
    );
    Ok(())
}
