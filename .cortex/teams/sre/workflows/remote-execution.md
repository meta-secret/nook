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

The owning Feature Gizmo authorizes publication of its canonical feature branch
through PR Lifecycle. Team Gizmo assigns hosted execution to the upstream CI/CD
agent with Nook SRE context. Each stage re-fetches and resolves the latest
committed branch head; the returned exact SHA is observational evidence only.

- Compile and type-check without tests, coverage, e2e, or preflight.
- Preserve that boundary through every transitive Task and Docker stage.
- Do not substitute `rust:ci`, `web:verify`, or `loom:verify`.
- Return positive compilation evidence for local integration.
- The compile task checks authenticated registry transport and access to each
  present current/parent manifest and its referenced blobs before work starts.
  Phase A imports both unversioned exact `nook-build-compile` refs through
  BuildKit and builds a rooted dependency foundation containing Cargo fetch,
  native/WASM dependency compilation, and stable Node/web dependency roots.
  When publication is authorized, Phase A is the sole current-head `mode=max`
  exporter. Phase B imports that current-head ref, performs source-sensitive
  Rust/WASM and web/repository-tooling/Loom compile/type-check work, and has no
  `cache-to`. The phases run sequentially inside one `build:compile` task; a
  Phase B failure leaves the completed Phase A cache portable for a fresh-node
  retry. No-export verification imports both refs in Phase A and the current
  ref in Phase B, with no registry exporter and sccache still available. A
  missing exact manifest is a normal miss; API, authentication,
  referenced-content, and export failures are terminal. The access check does
  not select cache reuse; BuildKit remains authoritative. The five-minute
  timeout includes both phases and export.

## Feature PR validation

The Feature Gizmo authorizes publication of the canonical feature branch and
the full existing PR checks. Team Gizmo (Delivery Pipeline context) routes that
packet through the active harness to PR Lifecycle Agent for branch publication
and check observation. Upstream CI/CD handles required dispatches, reruns, and
pipeline diagnostics with SRE context. The Feature Gizmo retains policy authority, and
the feature PR lifecycle remains the sole path for pull-request
creation/update. Follow
[dev delivery](../../../gizmo-prime/architecture/dev-delivery.md).

- Resolve the latest committed feature-branch head before every stage.
- Preserve e2e opt-ins and security-required focused checks.
- Let a newer feature-head event cancel stale head validation.
- Delegate failures back through the feature path.
- Squash-merge only after the unchanged head has a complete green verdict.

## Runner and task reference

### Execution boundary

The testing selectors below belong to slow validation or separately authorized
operations. Their existence never permits feature-stage test execution.

### Routing rules

Team Gizmo routes remote task execution through upstream CI/CD with Nook SRE
context and the authorized canonical feature branch. The execution owner
re-fetches and resolves that branch's latest committed head before each stage
and returns the exact SHA as observational evidence only. A stale caller-provided
feature SHA does not reject branch-authorized execution. Forward user-requested
selectors directly under the root circuit breaker.

For feature-branch publication, PR check observation, and squash merge, Team
Gizmo assigns PR Lifecycle under Feature Gizmo authorization. CI/CD returns run
evidence through Team Gizmo for PR observation. Neither role decides product
policy or readiness. Single-agent sessions perform these responsibilities locally.

- **Prohibited:** dispatch a second run solely because PR observation changed
  owners, or validate a requested selector against a local catalog.
- **Preferred:** reuse matching run evidence and dispatch an authorized selector
  directly when execution is needed. Report the runner's actual terminal result.

- Invoke Rust validation remotely with `task remote TASK_NAME=rust:ci`.
- Invoke Loom verification remotely with `task remote TASK_NAME=loom:verify`.
- PR Lifecycle requests label-triggered validation with `task pr:validate PR=<number>`
  (or `FULL_E2E=1` for a Main-fix browser gate). CI/CD owns only the resulting
  workflow execution and observation; it does not mutate pull-request labels.
- Single `preflight`, `rust:ci`, and `arc:runtime` selections may use
  `NOOK_RUNS_ON=nook-k0s`.
- `loom:verify` uses the general `nook-k0s` scale set.
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
- `web:build`, `web:e2e`, `extension:e2e`, `check`, `ci:pr`, and `ci:pr:e2e`
  execute directly inside an ordinary exact-image Pod.

Every dispatch requires:

- a non-`main` branch;
- a clean worktree;
- a branch present on `origin`; and
- a remote branch SHA equal to local `HEAD`.

A captured validation head becomes stale after any later push; recapture the
exact remote SHA before dispatch or promotion.
