#!/usr/bin/env python3

import json
from pathlib import Path
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[2]
NAMESPACES = (ROOT / "infra/k0s/manifests/namespaces.yaml").read_text()
RUNNERS = (
    ROOT / "infra/k0s/manifests/arc/runner-scale-set-values.yaml"
).read_text()
CONTROLLER = (
    ROOT / "infra/k0s/manifests/arc/controller-values.yaml"
).read_text()
NETWORK = (ROOT / "infra/k0s/manifests/arc/network-policy.yaml").read_text()
KATA_VALUES = (ROOT / "infra/k0s/manifests/kata/values.yaml").read_text()
TASKS = (ROOT / "infra/tasks/arc.yml").read_text()
REMOTE_WORKFLOW = (ROOT / ".github/workflows/remote.yml").read_text()
HIVE_NEO4J_WAIT = (ROOT / ".github/scripts/wait-hive-neo4j.sh").read_text()
DOCKER_SETUP = (ROOT / ".github/actions/nook-docker-setup/action.yml").read_text()
REMOTE_BATCH = (ROOT / ".github/scripts/remote-task-batch.sh").read_text()
REGISTRY_TASKS = (ROOT / "infra/tasks/registry.yml").read_text()
PLATFORM_TASKS = (ROOT / "nook-app/nook-platform/Taskfile.yml").read_text()
BUILDKIT_ENTRYPOINT = (
    ROOT / "infra/k0s/images/arc-buildkit/entrypoint"
).read_text()
BUILDKIT_PREPARE = (
    ROOT / "infra/k0s/images/arc-buildkit/prepare-state"
).read_text()
BUILDKIT_CLONER = (
    ROOT / "infra/k0s/scripts/arc-buildkit-cloner"
).read_text()
HIVE_VALUES_RENDERER = ROOT / "infra/k0s/scripts/arc-hive-values.rb"
HIVE_WORKFLOW = (ROOT / ".github/workflows/hive.yml").read_text()
HIVE_TASKS = (ROOT / "agentic-ai/minds/hive/Taskfile.yml").read_text()
REMOTE_WORKFLOW = (ROOT / ".github/workflows/remote.yml").read_text()


def require(source: str, fragment: str, message: str) -> None:
    if fragment not in source:
        raise AssertionError(message)


def forbid(source: str, fragment: str, message: str) -> None:
    if fragment in source:
        raise AssertionError(message)


require(NAMESPACES, "name: arc-systems", "ARC controller namespace is missing")
require(NAMESPACES, "name: arc-runners", "ARC runner namespace is missing")
require(
    NAMESPACES,
    "nook.nokey.sh/role: arc-runners",
    "ARC runner namespace ownership label is missing",
)
require(RUNNERS, "runnerScaleSetName: nook-k0s", "runner label must stay stable")
require(TASKS, "ARC_HIVE_RUNNER_LABEL: nook-k0s-hive", "Hive smoke label must be defined")
require(RUNNERS, "minRunners: 0", "runner scale set must retain scale-to-zero")
require(RUNNERS, "maxRunners: 10", "runner concurrency must support ten jobs")
with tempfile.NamedTemporaryFile() as rendered_hive_values:
    subprocess.run(
        [
            HIVE_VALUES_RENDERER,
            ROOT / "infra/k0s/manifests/arc/runner-scale-set-values.yaml",
            rendered_hive_values.name,
        ],
        check=True,
    )
    parsed_hive_values = subprocess.run(
        [
            "ruby",
            "-ryaml",
            "-rjson",
            "-e",
            "print JSON.generate(YAML.safe_load(File.read(ARGV.fetch(0)), aliases: true))",
            rendered_hive_values.name,
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    hive_values = json.loads(parsed_hive_values.stdout)
if hive_values["runnerScaleSetName"] != "nook-k0s-hive":
    raise AssertionError("Hive verification must use its dedicated ARC scale set")
if hive_values["minRunners"] != 0 or hive_values["maxRunners"] != 10:
    raise AssertionError("Hive ARC must scale from zero through ten fresh runners")
hive_pod = hive_values["template"]["spec"]
if hive_pod["runtimeClassName"] != "kata-qemu-runtime-rs":
    raise AssertionError("Hive ARC must use the qualified Kata QEMU runtime-rs fallback")
hive_init_containers = {
    item["name"]: item for item in hive_pod["initContainers"]
}
if "neo4j" not in hive_init_containers:
    raise AssertionError("Hive ARC requires its Kubernetes-native Neo4j sidecar")
if "hive-test-runtime" not in hive_init_containers:
    raise AssertionError("Hive ARC requires its pinned Trixie test-runtime sidecar")
for native_sidecar in ("neo4j", "hive-test-runtime"):
    if hive_init_containers[native_sidecar].get("restartPolicy") != "Always":
        raise AssertionError(f"Hive ARC {native_sidecar} must be a native sidecar")
require(
    hive_init_containers["neo4j"]["image"],
    "neo4j:2026.06.0-community@sha256:",
    "Hive ARC Neo4j must be versioned and digest-pinned",
)
if sum(1 for volume in hive_pod["volumes"] if "hostPath" in volume) != 2:
    raise AssertionError("Hive ARC must inherit only the two approved hostPaths")
require(
    RUNNERS,
    'requests:\n            cpu: 750m\n            memory: 4Gi',
    "BuildKit requests must allow ten runner Pods to fit the current node",
)
require(
    RUNNERS,
    'requests:\n            cpu: 250m\n            memory: 1Gi',
    "runner requests must allow ten runner Pods to fit the current node",
)
require(
    RUNNERS,
    'limits:\n            cpu: "2"\n            memory: 6Gi',
    "runner limits must retain its share of the 16 GiB Kata guest",
)
require(RUNNERS, "runAsNonRoot: true", "ARC listener must run as non-root")
require(
    RUNNERS,
    "runtimeClassName: kata-qemu-runtime-rs",
    "runner Pods must use the QEMU runtime-rs microVM fallback",
)
require(
    KATA_VALUES,
    "qemu-runtime-rs:\n    enabled: true",
    "Kata must install the ARC QEMU runtime-rs fallback",
)
require(
    RUNNERS,
    "--oci-worker-snapshotter",
    "private BuildKit must select its guest-local snapshotter explicitly",
)
require(RUNNERS, "- overlayfs", "private BuildKit must avoid native layer copies")
require(
    RUNNERS,
    "localhost/nook-arc-buildkit:0.32.2-ext4-reflink-v1",
    "private BuildKit must use the node-imported reflink wrapper image",
)
require(RUNNERS, "imagePullPolicy: Never", "the node-imported image must stay local")
require(
    RUNNERS,
    'limits:\n            cpu: "6"\n            memory: 10Gi',
    "BuildKit limits must retain its share of the 16 GiB Kata guest",
)
require(RUNNERS, '- "24000"', "BuildKit must retain a 24 GB GC target")
require(
    RUNNERS,
    'value: "34359738368"',
    "BuildKit state must stay bounded to 32 GiB",
)
require(
    RUNNERS,
    "path: /var/lib/nook-arc-buildkit/pool/requests",
    "the trusted init container must see only the clone-request path",
)
require(
    RUNNERS,
    "path: /var/lib/nook-arc-buildkit/pool/jobs",
    "BuildKit must use the host-managed copy-on-write job path",
)
require(
    RUNNERS,
    "subPathExpr: $(POD_UID)",
    "each BuildKit sidecar must mount only its Pod UID state",
)
require(
    RUNNERS,
    "name: prepare-buildkit-state",
    "each runner must request its private reflink clone before BuildKit starts",
)
if RUNNERS.count("hostPath:") != 2:
    raise AssertionError("ARC permits only the request and Pod-UID job hostPaths")
require(RUNNERS, "name: buildkit", "each runner Pod must carry private BuildKit")
require(RUNNERS, "restartPolicy: Always", "BuildKit must be a native sidecar")
require(RUNNERS, "privileged: true", "BuildKit needs build privileges in the guest")
require(
    RUNNERS,
    "NOOK_BUILDKIT_ADDR",
    "runner must receive the private BuildKit endpoint",
)
require(
    RUNNERS,
    "tcp://127.0.0.1:1234",
    "runner must use Pod loopback for private BuildKit",
)
require(
    RUNNERS,
    "automountServiceAccountToken: false",
    "runner must not receive a Kubernetes API credential",
)
require(
    RUNNERS,
    "ghcr.io/actions/actions-runner:2.336.0@sha256:",
    "runner image must be versioned and digest-pinned",
)
require(
    RUNNERS,
    "docker:29.1.3-cli@sha256:",
    "Docker client image must be versioned and digest-pinned",
)
for prohibited in (
    "docker:dind",
    "dockerd",
    "docker.sock",
    "containerd.sock",
    "sysbox",
    "containermode:",
):
    forbid(RUNNERS.lower(), prohibited, f"prohibited runner pattern: {prohibited}")

require(CONTROLLER, "updateStrategy: eventual", "ARC upgrades must drain jobs")
require(NETWORK, "policyTypes:\n    - Ingress", "ARC ingress must default deny")
require(TASKS, "ARC_CHART_VERSION: 0.14.2", "ARC charts must be pinned")
require(RUNNERS, "githubConfigSecret", "ARC must reference a Kubernetes secret")
require(
    RUNNERS,
    "actions-runner:2.336.0@sha256:0cfdcc701ce933c6d243c6b0b2da767366dc9f2e99961d4c3754b0b78084cdda",
    "ARC runner image must pin the accepted GitHub runner release",
)
require(TASKS, "helm upgrade --install", "ARC deployment must be declarative")
require(
    TASKS,
    "ARC scale sets are dispatch-ready",
    "ARC deployment must wait for both listener and runner-set pairs",
)
require(TASKS, "helm upgrade --install nook-k0s-hive", "Hive ARC must deploy declaratively")
require(
    TASKS,
    "unexpected ARC hostPath volumes",
    "the rendered runner must reject every unapproved hostPath",
)
require(
    TASKS,
    'ruby - "$runner_render" "$hive_render"',
    "remote ARC rendering must use the provisioned standard-library YAML parser",
)
forbid(
    TASKS,
    "import yaml",
    "direct ARC rendering must not depend on separately provisioned PyYAML",
)
require(
    TASKS,
    '"buildkit-requests" => ["prepare-buildkit-state"]',
    "only the trusted init container may mount clone requests",
)
require(
    TASKS,
    '"buildkit-jobs" => ["buildkit"]',
    "only private BuildKit may mount its Pod UID state",
)
require(
    TASKS,
    'install -d -m 0700 "$pool_root"',
    "the raw BuildKit pool root must not be readable by host users",
)
require(TASKS, "pool_size=768G", "ARC pool must cover both ten-runner scale sets")
forbid(TASKS, "e2fsck", "guest-controlled filesystems must not be parsed as host root")
require(
    TASKS,
    'btrfs quota enable "$pool_mount"',
    "the pool must enable per-job Btrfs quota enforcement",
)
require(
    BUILDKIT_CLONER,
    'btrfs qgroup limit -e "$job_exclusive_limit" "$job_dir"',
    "each guest must have a bounded exclusive storage allocation",
)
require(
    BUILDKIT_CLONER,
    'if ! container_list="$(',
    "cleanup must retain state when containerd cannot prove it stale",
)
require(
    TASKS,
    'btrfs filesystem resize max "$pool_mount"',
    "ARC deployment must grow an existing sparse pool in place",
)
require(
    TASKS,
    'chmod 0600 "$pool_image"',
    "the raw BuildKit pool image must not be readable by host users",
)
require(
    TASKS,
    'if ! sudo -n test -f "$pool_image"; then',
    "pool deployment must probe the root-only backing image as root",
)
require(
    TASKS,
    'if ! sudo -n test -f "$seed_file"; then',
    "pool deployment must probe the root-only seed as root",
)
require(
    TASKS,
    'sudo -n mountpoint -q "$pool_mount"',
    "pool deployment must probe the root-only mount as root",
)
require(
    TASKS,
    '*" -id $sandbox_id "*',
    "ARC promotion must detect a Kata shim independently of argument order",
)
require(
    TASKS,
    'stat -c \'%F:%u:%g:%h:%s\' -- "$job_file"',
    "ARC promotion must reject linked, non-root-owned, or wrong-sized state",
)
require(
    TASKS,
    'test "$generation_size" -gt 128',
    "ARC promotion must bound its generation marker before reading it",
)
require(
    TASKS,
    "'^[0-9]+:[0-9]+:[0-9]+:[0-9]+$'",
    "ARC promotion must validate the generation marker format",
)
require(
    TASKS,
    "actions/runs/$run_id/force-cancel",
    "ARC smoke must force-cancel a run whose assigned ephemeral runner fails",
)
require(TASKS, "runner_uid", "ARC smoke must detect replacement of an assigned Pod")
require(
    TASKS,
    "A session for this runner already exists.",
    "ARC smoke must detect the stale JIT-session failure mode",
)
require(
    TASKS,
    'kubectl delete ephemeralrunner --namespace arc-runners',
    "ARC smoke must remove a failed ephemeral-runner registration",
)
require(
    TASKS,
    "sudo -n k0s kubeconfig admin",
    "ARC Helm deployment must target the managed k0s cluster explicitly",
)
require(
    TASKS,
    'tr -d "\\r\\n"',
    "streamed GitHub credentials must not retain transport newlines",
)
require(
    TASKS,
    "Existing ARC repository credential retained; set ARC_GITHUB_TOKEN_FILE to rotate it",
    "routine ARC deployment must retain the installed repository credential",
)
require(
    TASKS,
    "ARC repository credential is not installed; set ARC_GITHUB_TOKEN_FILE to bootstrap it",
    "first ARC deployment must explain how to bootstrap its credential",
)
require(
    TASKS,
    'test -s "$token_file"',
    "explicit ARC credential rotation must reject an empty credential file",
)
forbid(
    TASKS,
    "gh auth token",
    "ARC deployment must not persist an implicit operator CLI credential",
)
require(
    TASKS,
    "gh workflow run remote.yml",
    "ARC smoke must dispatch independently from the branch-only remote helper",
)
require(
    TASKS,
    "bash <<'BASH'\n        set -euo pipefail\n        smoke_task=",
    "ARC smoke monitoring must use Bash rather than Task's embedded shell interpreter",
)
require(
    TASKS,
    '--raw-field "tasks=$smoke_task"',
    "ARC smoke must dispatch only its selected trusted task",
)
forbid(
    TASKS,
    "task remote TASK_NAME=preflight",
    "ARC smoke must remain usable from a pushed Main checkout",
)
require(
    TASKS,
    "for _ in $(seq 1 500)",
    "ARC smoke must outlive cold setup plus the preflight command timeout",
)
require(
    TASKS,
    "did not complete within 25 minutes",
    "ARC smoke timeout diagnostics must match the polling budget",
)
require(
    REMOTE_WORKFLOW,
    "(inputs.tasks || inputs.task) == 'preflight'",
    "only the daemon-free remote task subset may select ARC",
)
require(
    REMOTE_WORKFLOW,
    "runs-on: ubuntu-latest",
    "runtime-dependent remote jobs must retain hosted capacity",
)
require(TASKS, "Successful smoke run did not report", "ARC smoke must verify its runner label")
for dispatch_marker in [
    'dispatch_nonce="$(openssl rand -hex 16)"',
    '--raw-field "dispatch_nonce=$dispatch_nonce"',
    '--json databaseId,displayTitle,headSha',
    ".displayTitle == $title and .headSha == $sha",
]:
    require(
        TASKS,
        dispatch_marker,
        "ARC smoke must correlate exactly with its nonce-qualified dispatch",
    )
require(
    REMOTE_WORKFLOW,
    "run-name: Remote / ${{ inputs.tasks || inputs.task }} / ${{ inputs.dispatch_nonce || 'manual' }}",
    "remote dispatches must expose their caller correlation nonce",
)
require(
    REMOTE_BATCH,
    'rust:ci) run_with_timeout "$timeout_minutes" env CI_ARTIFACT_DIR="$artifact_root/rust-ci" task ci:pr:rust',
    "the daemon-free Rust selector must use a writable artifact root and execute its Task target",
)
forbid(
    REGISTRY_TASKS,
    'kubectl create namespace "$namespace" --dry-run=client',
    "registry rotation must not overwrite canonical ARC namespace labels",
)
require(
    DOCKER_SETUP,
    "driver remote",
    "ARC Buildx must use the private remote BuildKit driver",
)
require(
    TASKS,
    "btrfs-progs e2fsprogs ruby util-linux",
    "ARC pool deployment must install its filesystem and renderer tooling",
)
require(
    TASKS,
    "mkfs.btrfs -q -f -L nook-arc-buildkit",
    "ARC deployment must create the non-destructive reflink pool",
)
require(
    TASKS,
    'sudo -n mv "$pool_image_next" "$pool_image"',
    "ARC pool creation must publish a formatted image atomically",
)
require(
    TASKS,
    "Promoted successful ARC smoke state to the reusable seed",
    "only a successful stopped smoke guest may refresh the reusable seed",
)
require(
    TASKS,
    'mktemp "${TMPDIR:-/tmp}/nook-arc-smoke-{{.ARC_SMOKE_RUNNER_LABEL}}.XXXXXX"',
    "concurrent ARC smoke invocations must own distinct state files",
)
if TASKS.count('state_file="{{.ARC_SMOKE_STATE_FILE}}"') != 2:
    fail("ARC smoke must carry one invocation-specific state file into promotion")
require(
    TASKS,
    'test "$state_lines" -ne 3',
    "ARC smoke promotion must reject incomplete teardown evidence",
)
require(
    TASKS,
    "*containerd-shim-kata-v2*",
    "seed promotion must identify the Kata shim executable",
)
require(
    TASKS,
    '/var/lib/k0s/kubelet/pods/$pod_uid',
    "seed promotion must wait for kubelet volume teardown",
)
require(
    BUILDKIT_PREPARE,
    'printf \'%s\\n\' "$pod_uid"',
    "the trusted init container must request a clone by Pod UID",
)
require(
    BUILDKIT_CLONER,
    "cp --reflink=always --sparse=auto",
    "the host cloner must fail rather than copy a full state image",
)
require(
    BUILDKIT_CLONER,
    'test ! -e "$pod_root/$pod_uid" || continue',
    "stale-state cleanup must preserve active Pod state",
)
require(
    BUILDKIT_CLONER,
    'SECONDS - last_prune >= 30',
    "inactive job clones must be reclaimed promptly under sustained load",
)
require(
    BUILDKIT_CLONER,
    'retain_marker="$runtime_dir/$pod_uid.retain"',
    "the smoke retention lease must stay outside guest-writable job state",
)
require(
    BUILDKIT_CLONER,
    "retain_expiry > now && retain_expiry <= now + 1800",
    "a failed smoke run must not retain its clone indefinitely",
)
require(
    BUILDKIT_CLONER,
    'k0s ctr --namespace k8s.io tasks list -q',
    "stale cleanup must preserve a sandbox with a live containerd task",
)
require(
    BUILDKIT_CLONER,
    "record_active_sandboxes",
    "cloner restarts must recover sandbox identities for active jobs",
)
require(
    BUILDKIT_CLONER,
    'test "$existing_sandbox_id" = "$sandbox_id" && return 0',
    "active job markers must follow a replacement sandbox for the same Pod UID",
)
require(
    BUILDKIT_CLONER,
    "SECONDS - last_sandbox_refresh >= 1",
    "replacement sandbox identities must be refreshed before stale-job pruning",
)
require(
    BUILDKIT_CLONER,
    'if ! record_sandbox_id "$pod_uid"; then',
    "sandbox identity must be durable before any job subvolume is created",
)
if BUILDKIT_CLONER.index('if ! record_sandbox_id "$pod_uid"; then') > BUILDKIT_CLONER.index(
    'btrfs subvolume create "$job_dir"'
):
    fail("sandbox identity must be recorded before any job subvolume is created")
require(
    BUILDKIT_CLONER,
    'if request_expired "$pod_uid" "$request"; then',
    "clone requests abandoned before sandbox discovery must expire",
)
require(
    BUILDKIT_CLONER,
    'find "$request" -mmin +5',
    "clone request reclamation must use a bounded age",
)
require(
    BUILDKIT_CLONER,
    'test ! -e "$pod_root/$pod_uid" || return 1',
    "clone request reclamation must preserve live kubelet Pod state",
)
require(
    BUILDKIT_CLONER,
    'if ! container_list="$(\n    k0s ctr --namespace k8s.io containers list -q',
    "clone request reclamation must fail closed when containerd cannot confirm absence",
)
require(
    BUILDKIT_CLONER,
    'test ! -e "$request_dir/$pod_uid.request" || continue',
    "markerless storage must remain while a clone request is active",
)
require(
    BUILDKIT_CLONER,
    '*containerd-shim-kata-v2*) continue 2',
    "markerless legacy storage must remain until every Kata shim has exited",
)
require(
    BUILDKIT_CLONER,
    '*containerd-shim-kata-v2*" -id $sandbox_id "*',
    "stale cleanup must preserve a sandbox with a live Kata shim",
)
forbid(
    BUILDKIT_CLONER,
    'retain_marker="$job_dir/.retain"',
    "guest-writable job state must not control host retention",
)
require(
    TASKS,
    'runner_state_retained=1',
    "ARC smoke must retain its stopped clone until guarded seed promotion",
)
require(
    BUILDKIT_CLONER,
    'labels.\\"io.kubernetes.pod.uid\\"==$pod_uid',
    "stale-state cleanup must preserve containerd-owned Pod state",
)
require(
    BUILDKIT_ENTRYPOINT,
    "NOOK_BUILDKIT_STATE_IMAGE_BYTES:-34359738368",
    "the guest must reject a BuildKit filesystem with the wrong capacity",
)
require(
    PLATFORM_TASKS,
    "--no-cache",
    "the signed ARC cache-health probe must execute on every check",
)
require(
    DOCKER_SETUP,
    "startsWith(runner.name, 'nook-k0s-')",
    "ARC Buildx selection must use an Actions expression-visible runner identity",
)
require(HIVE_WORKFLOW, "runs-on: nook-k0s-hive", "trusted Hive Rust must run on ARC")
require(
    HIVE_WORKFLOW,
    "vars.NOOK_HIVE_RUNS_ON == 'nook-k0s-hive'",
    "trusted Hive ARC routing must honor the emergency fallback",
)
require(
    REMOTE_WORKFLOW,
    "vars.NOOK_HIVE_RUNS_ON || 'ubuntu-latest'",
    "remote Hive routing must honor the emergency fallback",
)
require(
    TASKS,
    "gh variable set NOOK_HIVE_RUNS_ON",
    "ARC activation and fallback must update the Hive route",
)
require(
    TASKS,
    "route_variable=NOOK_HIVE_RUNS_ON",
    "Hive ARC smoke must validate its route before dispatch",
)
require(
    HIVE_WORKFLOW,
    "verify-hosted:",
    "trusted Hive must retain a credentialed hosted fallback",
)
require(
    HIVE_WORKFLOW,
    "Connect hosted BuildKit cache",
    "trusted hosted Hive fallback must restore the shared cache",
)
if HIVE_WORKFLOW.count("Publish verified Hive cache") != 2:
    raise AssertionError("ARC and trusted hosted Main must both publish the Hive cache")
require(
    HIVE_WORKFLOW,
    "github.event.pull_request.head.repo.full_name != github.repository",
    "untrusted fork Hive jobs must stay on hosted capacity",
)
require(
    HIVE_WORKFLOW,
    "github.actor == 'dependabot[bot]'",
    "Dependabot Hive jobs must stay on hosted capacity",
)
require(
    HIVE_NEO4J_WAIT,
    "http://127.0.0.1:7474/db/neo4j/tx/commit",
    "Hive ARC must wait for authenticated Neo4j query readiness",
)
require(
    HIVE_TASKS,
    '"$HIVE_TASK_DIR/run-arc-tests.sh"',
    "Hive ARC must execute exported tests through its pinned runtime sidecar",
)
require(
    TASKS,
    "nook-arc-hive-test-runtime",
    "ARC deploy must publish the pinned Hive runtime entrypoint",
)
require(
    REMOTE_WORKFLOW,
    "HIVE_NEO4J_TEST_URI:",
    "remote Hive smoke must exercise the Neo4j integration contract",
)
require(
    REMOTE_WORKFLOW,
    "--publish 127.0.0.1:7474:7474",
    "hosted Hive fallback must expose its loopback-only Neo4j readiness endpoint",
)
require(
    REMOTE_WORKFLOW,
    "nook-hive-linux-amd64-v1:buildcache",
    "remote Hive smoke must retain the trusted Main registry fallback",
)
require(
    BUILDKIT_CLONER,
    ".seed-generation",
    "BuildKit clones must record the seed generation they received",
)
require(
    TASKS,
    "refusing stale promotion",
    "ARC seed promotion must reject clones from an older seed generation",
)
for source in (RUNNERS, TASKS, DOCKER_SETUP):
    forbid(source.lower(), "docker-in-docker", "DinD wording must not become config")

print("ARC manifest contract passed")
