# Docker Container and Harness Hygiene

## Purpose

Enforce container harness stability, cache predictability, and dependency reproducibility across local and CI environments.

This card does not authorize Docker inside k8s or k0s. Cluster execution follows [Kubernetes-Native Cluster Execution](kubernetes-native-cluster-execution.md).

## Problem Pattern

- Adding Dockerfile `RUN --mount=type=cache` directives that introduce hidden state and serialize concurrent builds.
- Attempting to kill, restart, or terminate Docker Desktop, `dockerd`, or the Docker VM.
- Using unpinned or floating semver dependency ranges in `Cargo.toml`.
- Committing `package-lock.json` or `yarn.lock` in Bun-managed web packages.

## Preferred Pattern

### Prohibit Dockerfile cache mounts

- **Strictly prohibited:** Never add `RUN --mount=type=cache` anywhere in Dockerfiles.
- Cache mounts introduce hidden BuildKit state and cause runner lockups.
- Install dependencies directly in ordinary Dockerfile `RUN` layers.
- Let immutable Docker layers and lockfiles define the cache boundary.
- Enforced by the standalone `preflight/` invariant suite (`task preflight`).

### Never kill the Docker daemon

- **Strictly prohibited:** Agents and developers must never stop, restart, or kill `dockerd`, Docker Desktop, or the Docker VM (`killall Docker`, `pkill docker`, etc.).
- Stop **individual containers** only: `docker stop <container_id>` or `docker compose down`.
- Free dev ports by stopping the owning container (`docker ps --filter publish=5173` -> `docker stop <id>`), never by killing host PIDs blindly.

### Exact dependency pinning and Bun lockfiles

- **Cargo dependencies:** Commit `Cargo.lock` for reproducibility. A bare Cargo
  requirement such as `age = "0.11.3"` is a compatible range, not an exact pin.
  Use `=0.11.3` only when the owning dependency policy requires an exact
  manifest pin.
- **Web packages:** Svelte and Loom packages are managed with Bun; commit `bun.lock` alongside `package.json`. (`agentic-ai/ci-agent` is the only maintained Node/npm package).

## Scope

Applies to:

- All Dockerfiles, compose files, and container tasks under `infra/`.
- Dependency manifests (`Cargo.toml`, `package.json`, `bun.lock`).
- Local development workflows and CI runners.

Cluster Pods are excluded from local Docker lifecycle guidance. They may use a remote BuildKit build API, but they never host or control a container runtime.

## Application Checklist

1. [ ] No `RUN --mount=type=cache` directives exist in Dockerfiles.
2. [ ] Only individual containers are stopped (`docker stop <id>`); daemon remains untouched.
3. [ ] Dependency requirements and lockfiles match the owning update policy.
4. [ ] Bun lockfiles are committed for web packages.
5. [ ] Invariant preflight passes: `task preflight`.

## Validation

- Invariant test suite: `task preflight`
- Harness setup solve: `task setup`
