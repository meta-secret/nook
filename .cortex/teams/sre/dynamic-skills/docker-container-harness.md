# Docker Container and Harness Hygiene

## Purpose

Enforce container harness stability, cache predictability, and dependency reproducibility across local and CI environments.

This card does not authorize Docker inside k8s or k0s. Cluster execution follows [Kubernetes-Native Cluster Execution](kubernetes-native-cluster-execution.md).

## Problem Pattern

- Adding Dockerfile `RUN --mount=type=cache` directives that introduce hidden state and serialize concurrent builds.
- Computing custom dependency fingerprints or cache selectors to predict
  whether a Docker layer should be reusable.
- Simulating unrelated and related source mutations solely to duplicate
  BuildKit's cache-invalidation decision.
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

### Keep Docker layer invalidation inside BuildKit

- BuildKit alone determines Docker layer validity and reuse from the actual
  Dockerfile, build context, build arguments, and base image.
- Custom dependency fingerprints, cache selectors, allowlists, and mutation
  simulations that reimplement that decision are prohibited. Treat their
  introduction or preservation as a P1 finding and stop under the Cortex
  circuit-breaker rule.
- Preserve genuine `cache-from` and `cache-to` wiring, structured cache
  artifacts, registry import/export integrity, and actual Dockerfile syntax and
  build checks.
- Preserve the complete sccache contract: structured telemetry, bounded
  fallback, health reporting, publication evidence, and terminal repeated
  changed-head zero-hit detection. Compiler-cache evidence must not become a
  substitute Docker layer-validity algorithm.

### Never kill the Docker daemon

- **Strictly prohibited:** Agents and developers must never stop, restart, or kill `dockerd`, Docker Desktop, or the Docker VM (`killall Docker`, `pkill docker`, etc.).
- Stop **individual containers** only: `docker stop <container_id>` or `docker compose down`.
- Free dev ports by stopping the owning container (`docker ps --filter publish=5173` -> `docker stop <id>`), never by killing host PIDs blindly.

### Exact dependency pinning and Bun lockfiles

- **Cargo dependencies:** Commit `Cargo.lock` for reproducibility. A bare Cargo
  requirement such as `age = "0.11.3"` is a compatible range, not an exact pin.
  Use `=0.11.3` only when the owning dependency policy requires an exact
  manifest pin.
- **Web packages:** Svelte and Loom packages are managed with Bun; commit `bun.lock` alongside `package.json`..

## Scope

Applies to:

- All Dockerfiles, compose files, and container tasks under `infra/`.
- Dependency manifests (`Cargo.toml`, `package.json`, `bun.lock`).
- Local development workflows and CI runners.

Cluster Pods are excluded from local Docker lifecycle guidance. They may use a remote BuildKit build API, but they never host or control a container runtime.

## Application Checklist

1. [ ] No `RUN --mount=type=cache` directives exist in Dockerfiles.
2. [ ] No custom fingerprint, selector, allowlist, or mutation simulation
       duplicates BuildKit layer invalidation.
3. [ ] Cache import/export and the complete sccache telemetry and health
       contract remain intact.
4. [ ] Only individual containers are stopped (`docker stop <id>`); daemon remains untouched.
5. [ ] Dependency requirements and lockfiles match the owning update policy.
6. [ ] Bun lockfiles are committed for web packages.
7. [ ] Invariant preflight passes: `task preflight`.

## Validation

- Invariant test suite: `task preflight`
- Harness setup solve: `task setup`
