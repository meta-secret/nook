#!/usr/bin/env python3

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
NAMESPACES = (ROOT / "infra/k0s/manifests/namespaces.yaml").read_text()
RUNNERS = (
    ROOT / "infra/k0s/manifests/arc/runner-scale-set-values.yaml"
).read_text()
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
    'limits:\n            cpu: "4"\n            memory: 10Gi',
    "BuildKit limits must keep the Kata guest within node capacity",
)
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
require(RUNNERS, "restartPolicy: Always", "BuildKit must be a native sidecar")
require(RUNNERS, "name: buildkit", "runner Pod must carry BuildKit")
require(RUNNERS, '- "80000"', "BuildKit argument values must remain strings")
require(RUNNERS, "privileged: true", "BuildKit needs build privileges in the guest")
require(
    RUNNERS,
    "NOOK_BUILDKIT_ADDR",
    "runner must receive the loopback BuildKit endpoint",
)
require(
    RUNNERS,
    "tcp://127.0.0.1:1234",
    "BuildKit must listen only inside the runner Pod network namespace",
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
require(
    RUNNERS,
    "moby/buildkit:v0.32.2@sha256:",
    "BuildKit image must be versioned and digest-pinned",
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
    "ARC Buildx must use the loopback remote BuildKit driver",
)
require(
    DOCKER_SETUP,
    "startsWith(runner.name, 'nook-k0s-')",
    "ARC Buildx selection must use an Actions expression-visible runner identity",
)
for source in (RUNNERS, TASKS, DOCKER_SETUP):
    forbid(source.lower(), "docker-in-docker", "DinD wording must not become config")

print("ARC manifest contract passed")
