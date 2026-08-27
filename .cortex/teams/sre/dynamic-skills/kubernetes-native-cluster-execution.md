# Kubernetes-Native Cluster Execution

## Priority

P1 hard rule. A violation blocks delivery.

## Purpose

Keep every workload inside k8s and k0s on the Kubernetes execution model.
Cluster Pods must never host or control a nested container runtime.

## Problem Pattern

- Starting Docker, Podman, or another container daemon inside a Pod.
- Mounting a host runtime socket or exposing a Docker-compatible API to a Pod.
- Using DinD, privileged Pods, host paths, or nested runtime commands to run tests or tools.
- Treating the node-local BuildKit service as a general execution runtime.
- Reusing a local Docker-based design inside the cluster without a Kubernetes-native execution contract.

## Preferred Pattern

### Cluster runtime prohibition

- Do not run `dockerd`, Docker, Podman, DinD, or another nested container runtime inside k8s or k0s.
- Do not mount Docker, Podman, containerd, CRI, or other host runtime sockets.
- Do not execute `docker run`, `docker create`, `docker start`, `docker exec`, or equivalent runtime commands from a cluster Pod.
- Do not grant privileged mode or host paths to recreate a runtime boundary.
- Select an ordinary Pod or Job image that already contains the workload's required runtime and tools.

### Playwright execution

- Run Playwright directly inside an ordinary Pod built from a Playwright-capable image.
- Prefer a purpose-built, pinned browser image with the browsers and system dependencies already installed.
- Installing Playwright and its system dependencies directly in an Actions Pod is allowed only when a suitable image is unavailable and the added cold-start cost is acceptable.
- Never launch a Playwright container from another Pod.

### BuildKit boundary

- The node-local rootless BuildKit shard is a build service only.
- ARC Pods may use the BuildKit build API to produce or export images and artifacts.
- BuildKit access does not authorize Docker runtime commands, a Docker daemon, a Docker-compatible execution API, or nested workload containers.
- A built image executes later as an ordinary Kubernetes Pod or Job.

### Local execution boundary

- The repository does not yet prescribe one local-machine container runtime policy.
- Local development choices must remain separate from cluster workflows.
- Local Docker evidence does not prove that a k8s or k0s workload is valid.
- Do not weaken the cluster prohibition while the local policy is undecided.

## Scope

Applies to all k8s and k0s workloads, ARC runners, GitHub Actions jobs placed on ARC, browser tests, executable skills, analyzers, infrastructure proofs, and repository automation that can execute in a cluster Pod.

## Application Checklist

1. [ ] The Pod contains no nested container daemon or runtime API.
2. [ ] No host runtime socket, host path, or privileged context is present.
3. [ ] Cluster scripts contain no container runtime launch or lifecycle command.
4. [ ] Playwright runs directly in the selected Pod image.
5. [ ] BuildKit is used only to build or export artifacts.
6. [ ] Local-only behavior is not presented as cluster validation.
7. [ ] `task preflight` enforces the cluster execution boundary.

## Validation

- Run `task preflight` for static workflow and script enforcement.
- Render ARC manifests and verify that Pods contain no nested runtime, runtime socket, privileged context, or host path.
- Verify browser jobs select a purpose-built image and invoke Playwright directly inside that Pod.
- Verify BuildKit consumers use build and export operations only.
