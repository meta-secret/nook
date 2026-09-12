# Configured GitHub Actions Remote Execution

## Overview

Trusted focused tasks run on Nook's ARC scale sets in the k0s cluster.

General `nook-k0s` runners are disposable ordinary Pods. Their Docker CLI
connects to the persistent rootless BuildKit shard on the selected node for
build and export operations only. It is not a container runtime.

ARC runners receive no:

- Docker daemon;
- Podman API;
- DinD process;
- host runtime socket;
- host path;
- privileged context; or
- Kata runtime.

Untrusted fork and Dependabot lanes remain on GitHub-hosted runners. Agent
machines use only the lightweight feedback allowed by the dev contract.


## Feature compilation

Gizmo publishes its feature branch and authorizes PR Steward to dispatch
the required remote build-only capability for that exact SHA.

- Compile and type-check without tests, coverage, e2e, or preflight.
- Preserve that boundary through every transitive Task and Docker stage.
- Do not substitute `rust:ci`, `web:verify`, or `loom:verify`.
- Return positive compilation evidence for local integration.

## Slow dev PR validation

The manually started dev manager authorizes Steward to publish the selected
snapshot and run the full existing PR checks. Follow
[dev delivery](../../../gizmo/architecture/dev-delivery.md).

- Freeze origin/dev during validation and promotion.
- Check out the captured dev SHA in every job.
- Preserve e2e opt-ins and security-required focused checks.
- Use native concurrency with cancellation disabled and one pending slot.
- Do not use per-push path reductions or an automatic dev-push slow pipeline.
- Delegate failures back through the feature path.
- Promote only through guarded fast-forward promotion after the complete slow verdict.

## Runner and task reference

The testing selectors below belong to slow validation or separately authorized
operations. Their existence never permits feature-stage test execution.

Routing rules:

- Invoke Rust validation remotely with `task remote TASK_NAME=rust:ci`.
- Single `preflight`, `rust:ci`, and `arc:runtime` selections may use
  `NOOK_RUNS_ON=nook-k0s`.
- `loom:verify` uses the general `nook-k0s` scale set.
- Trusted `hive:verify` uses `NOOK_HIVE_RUNS_ON=nook-k0s-hive`.
- Batches containing `hive:verify` use `nook-k0s-hive`.
- Other mixed batches use the general `nook-k0s` scale set.
- Fork and Dependabot jobs stay hosted and secret-free.
- Browser jobs use ordinary Pods on `nook-k0s-container`.
- Do not expose selectors whose Taskfile path reaches `docker run`, `docker create`, `docker start`, `docker exec`, or another runtime lifecycle command.
- Keep a selector unavailable until it has a direct ordinary-Pod or build-only
  implementation.

Batch rules:

- Provision one runner.
- Perform checkout and cache setup once.
- Run selected tasks sequentially.
- Accept at most eight tasks.
- Continue after a failure.
- Report every result.
- Fail the final job when any selection failed.
- Keep the configured per-task timeout.
- Restore the checkout after timeout before continuing.

ARC cache rules:

- Register the node-local BuildKit Service as a remote Buildx builder.
- Keep one retained 128 GiB BuildKit shard on every qualified node.
- Route each runner only to its local shard.
- Let concurrent jobs share BuildKit's content-addressed store.
- Import an exact Zot ref alone when it exists.
- Otherwise restore source-free dependencies and trusted Main.
- Publish commit-scoped refs only under `nook/remote-buildcache/**`.
- Publish shared Main refs only from trusted Main.
- Keep Hive's exact-head lineage separate.
- Never use GitHub Actions cache for BuildKit layers.

Zot carries cache state between nodes and hosted runners. SeaweedFS carries
compiler objects. These systems solve different cold-start costs.

Security rules:

- Pass Task names as literal arguments to the `task` executable.
- Never evaluate user input as shell.
- Disable runner Kubernetes service-account tokens.
- Prohibit DinD, Docker daemons, Podman, Sysbox, host runtime sockets, runner
  host paths, privileged runners, and Kata runtime classes.
- Prohibit `docker run`, `docker create`, `docker start`, `docker exec`, and equivalent container runtime lifecycle commands inside cluster Pods.
- Run Playwright directly in a purpose-built browser Pod image. Installing Playwright directly in an Actions Pod is the slower fallback; never launch a browser container from another Pod.
- Treat BuildKit as a build-only service. A produced image executes later as an ordinary Kubernetes Pod or Job.
- Give Remote read-only access to Main cache refs.
- Give Remote write access only to commit-scoped refs.
- Mount SeaweedFS credentials only as fixed BuildKit secrets.
- Never place credential bytes in build arguments, layers, or cache checksums.

The named ARC tasks avoid a general container-runtime requirement:

- `rust:ci` executes formatting, Clippy, tests, and coverage in BuildKit stages.
- `loom:verify` executes the full Loom format, lint, typecheck, unit-test,
  skill, and expert-catalog verification directly on the ARC runner.
  - A Loom-only dispatch installs the repository-pinned Task version.
  - Every Loom dispatch installs the pinned Bun version and stable Rust
    toolchain used by repository policy.
  - It proves Task, Bun, and Cargo before starting the named task.
  - It does not initialize Docker or cache credentials.
- `arc:runtime` exports and verifies a BuildKit result without `docker run`.
- `hive:verify` executes exported tests through its pinned native runtime
  sidecar.
- `web:build`, `web:e2e`, `extension:e2e`, `check`, `ci:pr`, and `ci:pr:e2e`
  execute directly inside an ordinary exact-image Pod.

Every dispatch requires:

- a non-`main` branch;
- a clean worktree;
- a branch present on `origin`; and
- a remote branch SHA equal to local `HEAD`.
