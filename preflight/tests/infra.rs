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
    let dockerfile = read("infra/k0s/images/arc-buildkit/Dockerfile");
    let config = read("infra/k0s/images/arc-buildkit/buildkitd.toml");

    assert!(dockerfile.contains("COPY buildkitd.toml /etc/buildkit/buildkitd.toml"));
    assert_eq!(
        config,
        "[registry.\"docker.io\"]\n  mirrors = [\"registry.dev.nokey.sh\"]\n"
    );
    assert!(!config.contains("registry-1.docker.io"));

    let proof = read("infra/tasks/bake-cache.yml");
    let zot = read("infra/sim/bake-cache/zot-config.json");
    let hive_values = read("infra/k0s/scripts/arc-hive-values.rb");
    assert!(proof.contains("mirrors = [\\\"${registry_ref}\\\"]"));
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
fn arc_smoke_retains_the_observed_sandbox_before_persisting_teardown_state() -> anyhow::Result<()> {
    let tasks = read("infra/tasks/arc-smoke.yml");
    let completion = tasks
        .split("if test \"$status\" = completed; then")
        .nth(1)
        .and_then(|tail| tail.split("discovered_runner=\"$(").next())
        .context("ARC smoke must define its completed-run branch")?;
    let retention_check = completion
        .find("test -z \"$runner_state_retained\"")
        .context("ARC smoke completion must require retained BuildKit state")?;
    let persist = completion
        .find("\"$run_id\" \"$runner_uid\" \"$runner_sandbox_id\" \"$build_target\" > \"$state_file\"")
        .context("ARC smoke completion must persist teardown state")?;
    let completion_recheck = completion
        .find("completed_sandbox=\"$(find_sandbox \"$runner_uid\")\"")
        .context("ARC smoke completion must recheck the current Kata sandbox")?;

    assert!(
        tasks.contains("$pool_dir/runtime/$pod_uid.retain")
            && tasks.contains("runner_state_retained=1"),
        "ARC smoke must retain the observed BuildKit state while the runner is active"
    );
    assert!(
        retention_check < completion_recheck && completion_recheck < persist,
        "ARC smoke must require retained state and recheck its current sandbox before persisting teardown authority"
    );
    Ok(())
}

#[test]
fn arc_smoke_discards_the_job_and_bounded_request_lane() -> anyhow::Result<()> {
    let tasks = read("infra/tasks/arc-smoke.yml");
    let validate_request = tasks
        .find("btrfs subvolume show \"$request_lane\"")
        .context("ARC smoke teardown must validate its bounded request lane")?;
    let delete_job = tasks
        .find("btrfs subvolume delete \"$job_dir\"")
        .context("ARC smoke teardown must delete retained job state")?;
    let delete_request = tasks
        .find("btrfs subvolume delete \"$request_lane\"")
        .context("ARC smoke teardown must delete the request lane and its qgroup")?;
    let delete_intent = tasks
        .find("\"$intent_dir/$pod_uid.intent\"")
        .context("ARC smoke teardown must delete promotion intent state")?;

    assert!(
        validate_request < delete_request
            && delete_request < delete_job
            && delete_job < delete_intent,
        "ARC smoke must preserve the job recovery index until the request lane is deleted"
    );
    Ok(())
}

#[test]
fn arc_cloner_reaps_only_inactive_aged_orphan_request_lanes() {
    let cloner = read("infra/k0s/scripts/arc-buildkit-cloner");
    let reaper = cloner
        .split("prune_orphan_request_lanes() {")
        .nth(1)
        .and_then(|tail| tail.split("\n}\n").next())
        .expect("ARC cloner must define orphan request-lane cleanup");

    for guard in [
        "request_lane_valid",
        "test ! -e \"$request_lane/request\"",
        "test ! -e \"$jobs_dir/$pod_uid\"",
        "find \"$request_lane\" -mmin +5",
        "test ! -e \"$pod_root/$pod_uid\"",
        "io.kubernetes.pod.uid",
        "sandbox_marker=\"$runtime_dir/$pod_uid.sandbox\"",
        "k0s ctr --namespace k8s.io tasks list -q",
        "containerd-shim-kata-v2*\" -id $sandbox_id \"",
    ] {
        assert!(
            reaper.contains(guard),
            "orphan-lane reaper is missing: {guard}"
        );
    }
    assert!(cloner.contains("record_sandbox_id \"$pod_uid\""));
    assert!(reaper.contains("delete_request_lane \"$request_lane\""));
    assert!(!reaper.contains("*containerd-shim-kata-v2*) continue 2"));
}

#[test]
fn arc_promotion_and_mesh_reconciliation_fail_closed() {
    let cloner = read("infra/k0s/scripts/arc-buildkit-cloner");
    let services = read("infra/tasks/host-services.yml");
    let workers = read("infra/tasks/k0s-workers.yml");
    let worker_mesh = read("infra/k0s/scripts/k0s-worker-mesh-reconcile");
    let claim = cloner
        .find("claim_untrusted_marker \"$candidate\" \"$candidate_claim\" 256")
        .expect("promotion candidates must be copied into host-private storage safely");
    let read_claim = cloner
        .find("candidate_value=\"$(tr -d '\\r\\n' < \"$candidate_claim\")\"")
        .expect("promotion verification must read the host-private claim");

    assert!(
        claim < read_claim,
        "candidate content must be claimed before reading"
    );
    for marker in ["$create", "$candidate", "$request"] {
        assert!(
            cloner.contains(&format!("remove_untrusted_path \"{marker}\"")),
            "guest-controlled marker cleanup must accept arbitrary path types: {marker}"
        );
        assert!(
            !cloner.contains(&format!("rm -f -- \"{marker}\"")),
            "guest-controlled markers must not use file-only cleanup: {marker}"
        );
    }
    assert!(
        cloner.contains("pod_is_cache_primary_runner") && cloner.contains("arc-cache-runner"),
        "only cache-primary runner Pods may request seed promotion"
    );
    assert!(
        cloner.contains("publish_ready_marker \"$pod_uid\" \"$ready_file\"")
            && !cloner.contains("touch \"$ready_file\""),
        "host ready publication must replace rather than follow guest-controlled paths"
    );
    for contract in [
        "iflag=nofollow,nonblock,count_bytes",
        "timeout 1 dd",
        "create-claim",
        "request_dir\"/*.request",
        "request-claim",
    ] {
        assert!(
            cloner.contains(contract),
            "untrusted and legacy marker handling is missing: {contract}"
        );
    }
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
    let controller_values = read("infra/k0s/manifests/arc/controller-values.yaml");
    let tasks = read("infra/tasks/arc.yml");

    for contract in [
        "topologySpreadConstraints:",
        "maxSkew: 3",
        "topologyKey: kubernetes.io/hostname",
        "whenUnsatisfiable: ScheduleAnyway",
        "nodeAffinityPolicy: Honor",
        "nodeTaintsPolicy: Honor",
        "nook.nokey.sh/arc-spread-group: general",
        "preferredDuringSchedulingIgnoredDuringExecution:",
        "values: [primary]",
        "values: [secondary]",
        "values: [overflow]",
    ] {
        assert!(
            values.contains(contract),
            "ARC spreading is missing: {contract}"
        );
    }
    assert!(
        hive_values.contains("nook.nokey.sh/arc-spread-group\"] = \"hive\"")
            && hive_values.contains("topologySpreadConstraints"),
        "Hive ARC must own an independent hostname-spread group"
    );
    for contract in [
        "arc:controller-build:prepare:",
        "nook.nokey.sh/arc-build=preparing:NoSchedule",
        "nook.nokey.sh/arc-tier=overflow",
        "nook.nokey.sh/ssh-target=$controller_ssh_user@$internal_ip",
        "nook.nokey.sh/infra-remote-dir={{.INFRA_REMOTE_DIR}}",
        "arc:cache-primary:preserve:",
        "Preserved legacy ARC cache primary $legacy_primary",
        "arc:build-hosts:activate:",
        "nook.nokey.sh/arc-build=preparing:NoSchedule- >/dev/null 2>&1 || true",
        "ARC cache-primary node $node is unreachable",
        "Deferred offline non-primary ARC node",
        "select(.type == \"InternalIP\")",
        "test \"$host\" != \"$internal_ip\"",
        "SSH host does not match its Kubernetes InternalIP",
    ] {
        assert!(
            tasks.contains(contract),
            "KS-6 ARC qualification is missing: {contract}"
        );
    }
    let preserve = tasks
        .find("- task: arc:cache-primary:preserve")
        .expect("ARC deployment must preserve a sole legacy primary");
    let prepare = tasks
        .find("- task: arc:controller-build:prepare")
        .expect("ARC deployment must prepare the controller build node");
    let cache_primary = tasks
        .find("- task: arc:cache-primary:ensure")
        .expect("ARC deployment must select its cache primary");
    let pool = tasks
        .find("- task: arc:cache:pool:sync")
        .expect("ARC deployment must converge every build-node pool");
    let scale_sets_ready = tasks
        .find("ARC scale sets are dispatch-ready")
        .expect("ARC deployment must wait for every scale set");
    let activate = tasks
        .rfind("- task: arc:build-hosts:activate")
        .expect("ARC deployment must activate every converged build node");
    assert!(
        preserve < prepare
            && prepare < cache_primary
            && cache_primary < pool
            && pool < scale_sets_ready
            && scale_sets_ready < activate,
        "legacy selection and recovered-node activation must bracket ARC convergence"
    );
    for contract in [
        "tolerations:",
        "key: nook.nokey.sh/arc-build",
        "value: preparing",
        "effect: NoSchedule",
    ] {
        assert!(
            controller_values.contains(contract) && values.contains(contract),
            "ARC control pods must tolerate build preparation: {contract}"
        );
    }
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
