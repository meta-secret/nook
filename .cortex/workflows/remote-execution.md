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
   - Starts only after the agent explicitly requests validation.
   - Provides the exact-head checks and deployment required for readiness.

Ordinary PR pushes do not start complete validation.

## Focused remote tasks

List the allowlisted catalog:

```bash
task remote:list
```

Dispatch one task:

```bash
task remote TASK_NAME=rust:test
```

Dispatch one ARC-native Rust task:

```bash
task remote TASK_NAME=rust:ci
```

Reuse one ARC job for a batch:

```bash
task remote TASK_NAMES=rust:test,web:check,web:test
```

Routing rules:

- Single `preflight`, `rust:ci`, and `arc:runtime` selections may use
  `NOOK_RUNS_ON=nook-k0s`.
- Trusted `hive:verify` uses `NOOK_HIVE_RUNS_ON=nook-k0s-hive`.
- Batches containing `hive:verify` use `nook-k0s-hive`.
- Other mixed batches use the general `nook-k0s` scale set.
- Fork and Dependabot jobs stay hosted and secret-free.
- Browser jobs use ordinary Pods on `nook-k0s-container`.

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

The narrow ARC tasks avoid a general container-runtime requirement:

- `rust:ci` executes formatting, Clippy, tests, and coverage in BuildKit stages.
- `arc:runtime` exports and verifies a BuildKit result without `docker run`.
- `hive:verify` executes exported tests through its pinned native runtime
  sidecar.

Every dispatch requires:

- a non-`main` branch;
- a clean worktree;
- a branch present on `origin`; and
- a remote branch SHA equal to local `HEAD`.

## Explicit complete PR validation

When the pushed head is coherent, run:

```bash
task pr:validate PR=<number>
```

Use `FULL_E2E=1` when the change needs the Main-equivalent browser suites.

Complete validation:

- binds every result to the exact PR head;
- runs repository-owned merge gates;
- requests the configured exact-head review;
- proves preview deployment when required; and
- becomes stale after any later push.

Focused task success never replaces complete validation.

## Failure loop

When a remote task or complete check fails:

1. Inspect the exact job log.
2. Identify the first failing product or infrastructure boundary.
3. Fix only the causal defect.
4. Apply host formatting.
5. Commit and push the coherent change.
6. Rerun focused evidence when useful.
7. Request complete validation again for the new head.

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

The delivery owner then squash-merges the PR and verifies the resulting Main
state.
