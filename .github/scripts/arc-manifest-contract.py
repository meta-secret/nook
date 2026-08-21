#!/usr/bin/env python3

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
NAMESPACES = (ROOT / "infra/k0s/manifests/namespaces.yaml").read_text()
RUNNERS = (
    ROOT / "infra/k0s/manifests/arc/runner-scale-set-values.yaml"
).read_text()
BUILDKIT = (ROOT / "infra/k0s/manifests/arc/buildkit.yaml").read_text()
CONTROLLER = (
    ROOT / "infra/k0s/manifests/arc/controller-values.yaml"
).read_text()
NETWORK = (ROOT / "infra/k0s/manifests/arc/network-policy.yaml").read_text()
TASKS = (ROOT / "infra/tasks/arc.yml").read_text()
REMOTE_WORKFLOW = (ROOT / ".github/workflows/remote.yml").read_text()
DOCKER_SETUP = (ROOT / ".github/actions/nook-docker-setup/action.yml").read_text()
REMOTE_BATCH = (ROOT / ".github/scripts/remote-task-batch.sh").read_text()
REGISTRY_TASKS = (ROOT / "infra/tasks/registry.yml").read_text()


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
require(RUNNERS, "maxRunners: 4", "runner concurrency must remain bounded")
require(
    RUNNERS,
    'limits:\n            cpu: "2"\n            memory: 4Gi',
    "runner limits must keep the Kata guest within node capacity",
)
require(RUNNERS, "runAsNonRoot: true", "ARC listener must run as non-root")
require(
    RUNNERS,
    "runtimeClassName: kata-dragonball",
    "runner Pods must use the Dragonball microVM runtime",
)
require(
    BUILDKIT,
    "--oci-worker-snapshotter",
    "rootless BuildKit must use the portable native snapshotter",
)
require(BUILDKIT, "- native", "rootless BuildKit snapshotter value is missing")
require(
    BUILDKIT,
    "--oci-worker-no-process-sandbox",
    "rootless BuildKit must use its container-compatible process mode",
)
require(BUILDKIT, '- "80000"', "BuildKit argument values must remain strings")
require(BUILDKIT, "runAsNonRoot: true", "BuildKit must remain rootless")
require(BUILDKIT, "runAsUser: 1000", "BuildKit must use the rootless image user")
require(
    BUILDKIT,
    "automountServiceAccountToken: false",
    "BuildKit must not receive a Kubernetes API credential",
)
require(
    BUILDKIT,
    "appArmorProfile:\n              type: Unconfined",
    "rootless BuildKit must retain the profile required by newuidmap",
)
require(
    BUILDKIT,
    "moby/buildkit:v0.32.2-rootless@sha256:504731e577c20559c00f968f33219f30115e70be29ab96728d1d06e963fc494b",
    "rootless BuildKit image must be versioned and digest-pinned",
)
require(
    BUILDKIT,
    "nook.nokey.sh/role: arc-runner",
    "only ARC runner Pods may reach BuildKit",
)
require(
    RUNNERS,
    "NOOK_BUILDKIT_ADDR",
    "runner must receive the cluster-local BuildKit endpoint",
)
require(
    RUNNERS,
    "tcp://nook-arc-buildkit.arc-runners.svc.cluster.local:1234",
    "runner must use the rootless BuildKit Service",
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
    "hostPath:",
    "sysbox",
    "containermode:",
):
    for source in (RUNNERS, BUILDKIT):
        forbid(source.lower(), prohibited, f"prohibited runner pattern: {prohibited}")
forbid(RUNNERS, "name: buildkit", "BuildKit must not nest inside the Kata runner")
forbid(BUILDKIT, "privileged: true", "rootless BuildKit must not be privileged")
forbid(
    BUILDKIT,
    "runtimeClassName: kata-dragonball",
    "Dragonball cannot execute BuildKit nested OCI workloads",
)

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
require(TASKS, "manifests/arc/buildkit.yaml", "ARC deployment must apply BuildKit")
require(TASKS, "nook-arc-buildkit", "ARC deployment must wait for BuildKit")
require(
    TASKS,
    "ARC scale set is dispatch-ready",
    "ARC deployment must wait for listener and runner-set readiness",
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
require(TASKS, "known_run_ids", "ARC smoke must ignore pre-existing exact-head runs")
require(
    REMOTE_BATCH,
    'rust:ci) run_with_timeout "$timeout_minutes" task ci:pr:rust',
    "the daemon-free Rust selector must execute its Task target",
)
forbid(
    REGISTRY_TASKS,
    'kubectl create namespace "$namespace" --dry-run=client',
    "registry rotation must not overwrite canonical ARC namespace labels",
)
require(
    DOCKER_SETUP,
    "driver remote",
    "ARC Buildx must use the cluster-local remote BuildKit driver",
)
require(
    DOCKER_SETUP,
    "startsWith(runner.name, 'nook-k0s-')",
    "ARC Buildx selection must use an Actions expression-visible runner identity",
)
for source in (RUNNERS, BUILDKIT, TASKS, DOCKER_SETUP):
    forbid(source.lower(), "docker-in-docker", "DinD wording must not become config")

print("ARC manifest contract passed")
