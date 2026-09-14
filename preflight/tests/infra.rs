use std::{
    collections::{HashMap, HashSet},
    env, fs,
    ops::Deref,
    path::{Path, PathBuf},
    process::Command,
};

use anyhow::Context;

#[path = "infra/kubernetes_cache_sim.rs"]
mod kubernetes_cache_sim;
#[path = "infra/remote_platform_contracts.rs"]
mod remote_platform_contracts;

struct RepositoryFixture {
    path: PathBuf,
}
impl RepositoryFixture {
    fn repository_root() -> Self {
        Self {
            path: env::var_os("NOOK_REPO_ROOT").map_or_else(
                || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
                PathBuf::from,
            ),
        }
    }
}
impl Deref for RepositoryFixture {
    type Target = PathBuf;
    fn deref(&self) -> &PathBuf {
        &self.path
    }
}
impl AsRef<Path> for RepositoryFixture {
    fn as_ref(&self) -> &Path {
        &self.path
    }
}
impl RepositoryFixture {
    fn read(&self, path: &str) -> String {
        fs::read_to_string(self.join(path))
            .unwrap_or_else(|error| panic!("failed to read {path}: {error}"))
    }
}

fn read_fallible(path: &str) -> anyhow::Result<String> {
    fs::read_to_string(RepositoryFixture::repository_root().join(path))
        .with_context(|| format!("failed to read {path}"))
}

fn production_dockerfiles(directory: PathBuf) -> Vec<PathBuf> {
    let mut dockerfiles = Vec::new();
    let mut pending = vec![directory];

    while let Some(path) = pending.pop() {
        for entry in fs::read_dir(&path)
            .unwrap_or_else(|error| panic!("failed to inventory {}: {error}", path.display()))
        {
            let entry =
                entry.unwrap_or_else(|error| panic!("repository entry must be readable: {error}"));
            let path = entry.path();
            if path.is_dir() {
                let relative = path
                    .strip_prefix(RepositoryFixture::repository_root())
                    .unwrap_or_else(|error| {
                        panic!("repository entries must stay beneath the root: {error}")
                    });
                let directory_name = path
                    .file_name()
                    .unwrap_or_else(|| panic!("directory must have a name"));
                if matches!(
                    directory_name.to_str(),
                    Some(".git" | "target" | "node_modules")
                ) || relative == Path::new("infra/sim/bake-cache")
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
    let manifest =
        RepositoryFixture::repository_root().read("infra/k0s/manifests/arc/buildkit.yaml");

    assert!(manifest.contains(r#"[registry."docker.io"]"#));
    assert!(manifest.contains(r#"mirrors = ["registry.dev.nokey.sh"]"#));
    assert!(!manifest.contains("registry-1.docker.io"));
    assert!(manifest.contains("internalTrafficPolicy: Local"));
    assert!(manifest.contains("kind: StatefulSet"));
    assert_eq!(manifest.matches("kind: PersistentVolume\n").count(), 4);

    let proof = RepositoryFixture::repository_root().read("infra/tasks/bake-cache.yml");
    let zot = RepositoryFixture::repository_root().read("infra/sim/bake-cache/zot-config.json");
    assert!(proof.contains("registry_ref"));
    assert!(proof.contains("library/alpine"));
    assert!(zot.contains("\"onDemand\": true"));
    assert!(zot.contains("\"preserveDigest\": true"));
}

#[test]
fn production_dockerfiles_never_resolve_docker_hub_directly() {
    for path in production_dockerfiles(RepositoryFixture::repository_root().to_path_buf()) {
        let relative = path
            .strip_prefix(RepositoryFixture::repository_root())
            .unwrap_or_else(|error| {
                panic!("Dockerfile must stay beneath the repository root: {error}")
            });
        let path = relative.to_string_lossy();
        let dockerfile = RepositoryFixture::repository_root().read(&path);
        let mut image_arguments = HashMap::new();
        let mut stages = HashSet::new();

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
                .unwrap_or_else(|| panic!("FROM must contain an image or prior stage"));
            let resolved = reference
                .strip_prefix("${")
                .and_then(|name| name.strip_suffix('}'))
                .map_or(reference, |name| {
                    image_arguments
                        .get(name)
                        .copied()
                        .unwrap_or_else(|| panic!("{path} has no default for FROM ${{{name}}}"))
                });
            let trusted_formatter_context =
                path == ".github/formatting/ci.Dockerfile" && reference == "formatter-tools";
            if trusted_formatter_context {
                let bake = RepositoryFixture::repository_root().read(".github/formatting/ci.hcl");
                assert!(bake.contains("formatter-tools = \"target:formatter-tools\""));
                assert!(bake.contains(
                    "target \"formatter-tools\" {\n  context = \".\"\n  dockerfile = \"Dockerfile\""
                ));
            }
            assert!(
                resolved == "scratch"
                    || stages.contains(reference)
                    || trusted_formatter_context
                    || matches!(
                        reference,
                        "rust-base" | "web-base" | "web-runtime" | "wasm-deps"
                    )
                    || resolved.starts_with("registry.dev.nokey.sh/"),
                "{path} resolves a production base outside Zot: {resolved}"
            );
            let remainder: Vec<_> = tokens.collect();
            if let [.., marker, stage] = remainder.as_slice()
                && marker.eq_ignore_ascii_case("AS")
            {
                stages.insert(*stage);
            }
        }
    }
}

#[test]
fn arc_smoke_uses_only_supported_persistent_buildkit_routes() {
    let tasks = RepositoryFixture::repository_root().read("infra/tasks/arc-smoke.yml");

    assert!(tasks.contains("ARC_RUNNER_LABEL: nook-k0s"));
    assert!(tasks.contains("ARC_SMOKE_TASK: arc:runtime"));
    assert!(tasks.contains("gh run watch"));
    assert!(tasks.contains("runnerName"));
    assert!(!tasks.contains("nook-k0s-cache"));
    assert!(!tasks.contains("Kata sandbox"));
    assert!(!tasks.contains("gh variable set NOOK_CACHE_RUNS_ON"));
}

#[test]
fn arc_mesh_reconciliation_fails_closed() {
    let services = RepositoryFixture::repository_root().read("infra/tasks/host-services.yml");
    let workers = RepositoryFixture::repository_root().read("infra/tasks/k0s-workers.yml");
    let worker_mesh =
        RepositoryFixture::repository_root().read("infra/k0s/scripts/k0s-worker-mesh-reconcile");
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
        .unwrap_or_else(|| panic!("mesh reconciliation must detect an empty compute tier"));
    let controller_key = worker_mesh
        .find("controller_public_key=\"$(sudo -n cat /etc/wireguard/nook-public.key)\"")
        .unwrap_or_else(|| panic!("mesh reconciliation must read the controller WireGuard key"));
    let peer_verification = worker_mesh
        .find("ping -c 1 -W 3 '$target_address'")
        .unwrap_or_else(|| panic!("reachable workers must verify direct peer connectivity"));
    let taint_all = worker_mesh
        .find("set_mesh_pending \"$node_name\"\ndone <<<\"$workers\"")
        .unwrap_or_else(|| panic!("all workers must become unschedulable before reconciliation"));
    let connection_preflight = worker_mesh
        .find("-o ConnectTimeout=5")
        .unwrap_or_else(|| panic!("workers must be checked before configuration"));
    let clear_pending = worker_mesh
        .rfind("clear_mesh_pending \"$node_name\"")
        .unwrap_or_else(|| panic!("verified workers must become schedulable"));
    assert!(empty_worker_check < controller_key);
    assert!(taint_all < connection_preflight);
    assert!(peer_verification < clear_pending);
    let install = services
        .find("- task: k0s:install")
        .unwrap_or_else(|| panic!("standard deployment must install k0s"));
    let standard_reconcile = services
        .find("- task: k0s:worker-mesh:reconcile")
        .unwrap_or_else(|| panic!("standard deployment must reconcile the direct worker mesh"));
    let standard_arc = services
        .find("- task: arc:deploy")
        .unwrap_or_else(|| panic!("standard deployment must install ARC"));
    assert!(install < standard_reconcile && standard_reconcile < standard_arc);
    let reconcile = workers
        .find("task: k0s:worker-mesh:reconcile")
        .unwrap_or_else(|| panic!("worker deployment must reconcile the direct worker mesh"));
    let qualify = workers
        .find("task: kata:install")
        .unwrap_or_else(|| panic!("worker deployment must qualify Kata"));
    assert!(
        reconcile < qualify,
        "the direct worker mesh must converge before Kata and ARC qualification"
    );
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "one infrastructure contract verifies runner placement as a unit"
)]
fn arc_prioritizes_and_spreads_runners_across_qualified_nodes() {
    let values = RepositoryFixture::repository_root()
        .read("infra/k0s/manifests/arc/runner-scale-set-values.yaml");
    let buildkit =
        RepositoryFixture::repository_root().read("infra/k0s/manifests/arc/buildkit.yaml");
    let container_hook =
        RepositoryFixture::repository_root().read("infra/k0s/manifests/arc/container-hook.yaml");
    let container_job_nodes =
        RepositoryFixture::repository_root().read("infra/k0s/config/arc-container-job-nodes");
    let tasks = RepositoryFixture::repository_root().read("infra/tasks/arc.yml");
    let pull_request_workflow =
        RepositoryFixture::repository_root().read(".github/workflows/pr.yml");

    for contract in [
        "maxRunners: 35",
        "topologySpreadConstraints:",
        "maxSkew: 2",
        "topologyKey: kubernetes.io/hostname",
        "whenUnsatisfiable: ScheduleAnyway",
        "nodeAffinityPolicy: Honor",
        "nodeTaintsPolicy: Honor",
        "weight: 100",
        "weight: 50",
        "weight: 1",
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
    assert!(
        !values.contains("whenUnsatisfiable: DoNotSchedule"),
        "ARC hostname spreading must not force equal cross-tier placement"
    );
    for forbidden in ["runtimeClassName:", "podman", "docker.sock", "hostPath:"] {
        assert!(
            !values.contains(forbidden),
            "ARC runner contains {forbidden}"
        );
    }
    assert_eq!(buildkit.matches("kind: PersistentVolume\n").count(), 4);
    assert!(buildkit.contains("internalTrafficPolicy: Local"));
    assert!(buildkit.contains("replicas: 4"));
    assert!(buildkit.contains("requiredDuringSchedulingIgnoredDuringExecution"));
    assert_eq!(
        buildkit
            .matches("  labels:\n    app.kubernetes.io/name: nook-buildkit")
            .count(),
        4,
        "all four BuildKit PVs must carry the operational status label"
    );
    assert!(buildkit.contains("--oci-worker-no-process-sandbox"));
    for contract in [
        "[worker.oci]",
        "gc = true",
        "reservedSpace = \"8GB\"",
        "maxUsedSpace = \"112GB\"",
        "minFreeSpace = \"16GB\"",
    ] {
        assert!(
            buildkit.contains(contract),
            "ARC BuildKit GC configuration is missing: {contract}"
        );
    }
    assert!(!buildkit.contains("--oci-worker-gc-keepstorage"));
    assert!(container_hook.contains("nook.nokey.sh/arc-build: \"true\""));
    assert!(container_hook.contains("nook.nokey.sh/arc-container-job: \"true\""));
    assert_eq!(
        container_job_nodes, "nook-rise-s-1\nnook-rise-s-2\novh-us\n",
        "container jobs must remain limited to the explicit eligible-node inventory"
    );
    assert!(
        pull_request_workflow
            .contains("github.event.pull_request.head.repo.full_name == github.repository")
    );
    assert!(
        pull_request_workflow.contains("github.event.pull_request.user.login != 'dependabot[bot]'")
    );
    assert!(tasks.contains("usable_bytes=$((available_bytes + state_bytes + legacy_bytes))"));
    assert!(tasks.contains("test \"$((available_bytes + state_bytes))\" -ge 137438953472"));
    assert!(tasks.contains("--cascade=orphan --wait=true"));
    assert!(tasks.contains("- task: arc:auth:sync"));
    assert!(tasks.contains("nook.nokey.sh/buildkit-config-sha256"));
    assert!(tasks.contains("ARC requires exactly $expected_count build hosts"));
    assert!(tasks.contains("expected_build_nodes"));
    assert!(tasks.contains("disable --now nook-arc-buildkit-cloner.service"));
    assert!(tasks.contains("$legacy_image_next"));
    assert_eq!(buildkit.matches("storage: 128Gi").count(), 5);
    for contract in [
        "inotify_max_user_instances=8000",
        "inotify_max_user_watches=10485760",
        "fs.inotify.max_user_instances=$inotify_max_user_instances",
        "fs.inotify.max_user_watches=$inotify_max_user_watches",
        "cat /proc/sys/fs/inotify/max_user_instances",
        "cat /proc/sys/fs/inotify/max_user_watches",
    ] {
        assert!(
            tasks.contains(contract),
            "ARC build hosts must converge inotify limits: {contract}"
        );
    }

    for contract in [
        "arc:controller-build:prepare:",
        "nook.nokey.sh/arc-build=preparing:NoSchedule",
        "nook.nokey.sh/arc-tier=overflow",
        "arc:buildkit:storage:prepare:",
        "rollout status statefulset/nook-buildkit",
        "autoscalingrunnerset/nook-k0s",
        "arc:build-hosts:activate:",
        "arc:container-hosts:reconcile:",
        "arc-container-job-nodes",
        "nook.nokey.sh/arc-container-job=true",
        "ARC container-job labels do not match the declared eligibility inventory",
        "for tier in primary secondary overflow",
        "primary) expected_tier_count=2",
        "secondary|overflow) expected_tier_count=1",
        "kubectl taint node \"${tier_nodes[@]}\"",
        "ARC build tier $tier is active",
    ] {
        assert!(
            tasks.contains(contract),
            "ARC orchestration is missing: {contract}"
        );
    }
    let prepare = tasks
        .find("- task: arc:controller-build:prepare")
        .unwrap_or_else(|| panic!("ARC deployment must prepare the controller build node"));
    let storage = tasks
        .find("- task: arc:buildkit:storage:prepare")
        .unwrap_or_else(|| panic!("ARC deployment must prepare retained storage"));
    let container_eligibility = tasks
        .find("- task: arc:container-hosts:reconcile")
        .unwrap_or_else(|| panic!("ARC deployment must reconcile container-job eligibility"));
    let rollout = tasks
        .find("rollout status statefulset/nook-buildkit")
        .unwrap_or_else(|| panic!("ARC deployment must wait for BuildKit"));
    let activate = tasks
        .rfind("- task: arc:build-hosts:activate")
        .unwrap_or_else(|| panic!("ARC deployment must activate converged nodes"));
    assert!(
        prepare < container_eligibility
            && container_eligibility < storage
            && storage < rollout
            && rollout < activate
    );
    let primary = tasks
        .find("for tier in primary secondary overflow")
        .unwrap_or_else(|| panic!("ARC activation must expose primary capacity first"));
    let grouped = tasks
        .find("kubectl taint node \"${tier_nodes[@]}\"")
        .unwrap_or_else(|| panic!("ARC activation must expose each tier as one group"));
    assert!(primary < grouped);
}
