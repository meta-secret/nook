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
machines remain available for editing, inspection, host-applied formatting, UI
demos, and interactive servers.

## Two remote surfaces

Nook separates iterative evidence from merge authorization.

1. **Focused remote tasks**
   - Run through `.github/workflows/remote.yml`.
   - Provide repeatable debugging evidence.
   - Do not authorize merge.
2. **Complete PR validation**
   - Runs through `.github/workflows/pr.yml`.
   - Starts only after Gizmo explicitly requests validation for the integrated
     pushed head.
   - Provides the exact-head checks and deployment required for readiness.

Ordinary PR pushes do not start complete validation.

Every pushed head gets remote evidence immediately: complete validation when
ready, or at least one relevant focused task otherwise.

## Focused remote tasks

List the allowlisted catalog:

```bash
task remote:list
```

Dispatch one Kubernetes-native browser task:

```bash
task remote TASK_NAME=web:e2e
```

Dispatch one ARC-native Rust task:

```bash
task remote TASK_NAME=rust:ci
```

Dispatch the complete Loom suite on the exact pushed head:

```bash
task remote TASK_NAME=loom:verify
```

Reuse one ARC job for a Kubernetes-native batch:

```bash
task remote TASK_NAMES=preflight,rust:ci
```

Routing rules:

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
- Keep one retained 64 GiB BuildKit shard on every qualified node.
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

- Accept only literal catalog names.
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

The allowlisted ARC tasks avoid a general container-runtime requirement:

- `rust:ci` executes formatting, Clippy, tests, and coverage in BuildKit stages.
- `loom:verify` executes the full Loom format, lint, typecheck, unit-test,
  skill, and expert-catalog verification directly on the ARC runner.
  - A Loom-only dispatch installs the repository-pinned Task version.
  - Every Loom dispatch installs the pinned Bun version and stable Rust
    toolchain used by repository policy.
  - It proves Task, Bun, and Cargo before starting the allowlisted task.
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

## Loom validation boundary

The root [team worker contract](../../../AGENTS.md#team-worker-contract) owns
agent-local Loom execution and handoff behavior.

- This remote surface implements its hosted full-suite boundary.
- `task remote TASK_NAME=loom:verify` binds the full suite to the exact pushed
  head.
- The hosted result does not replace complete PR validation or readiness.

## Explicit complete PR validation

When the integrated pushed head is coherent, Gizmo runs:

```bash
task pr:validate PR=<number>
```

Use `FULL_E2E=1` when the change needs the Main-equivalent browser suites.

Complete validation:

- binds every result to the exact PR head;
- runs repository-owned merge gates;
- requests no review by default;
- may add `CODEX_REVIEW=1` on a final coherent head to request one idempotent
  exact-head Codex review without waiting;
- proves preview deployment when required; and
- becomes stale after any later push.

Focused task success never replaces complete validation.

## Failure loop

When a remote task or complete check fails:

1. Inspect the exact job log.
2. Identify the first failing product or infrastructure boundary.
3. Obtain and integrate the responsible Team Agent's formatted exact fix.
4. Run pre-push, returning any team-owned formatter diff, until clean.
5. Push, then immediately validate when ready or run relevant focused proof.

Treat a transient unchanged-head registry or BuildKit read failure as
infrastructure evidence. Replay the unchanged head before changing product code.

## Merge boundary

A PR is ready only when `task pr:ready PR=<number>` succeeds for the current
head.

Readiness requires:

- a current base;
- successful required exact-head checks;
- successful required deployment;
- mergeability;
- no unresolved actionable review thread; and
- a clean Cortex session directory.

Gizmo then squash-merges the PR.

Ordinary delivery stops at the merge boundary. Verify the resulting Main state
only when the user requests live verification or the task owns a Main-failure
repair. Hive repairs retain their separate replacement-Main verification
contract.
