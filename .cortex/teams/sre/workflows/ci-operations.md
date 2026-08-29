# CI Operator and Agent Operations

## Overview

This authority owns CI storage reclamation, application-log inspection, secrets,
provider operations, and automated implementation-agent behavior. The core
workflow graph and runner placement remain in [CI / GitHub Actions Pipeline](ci-pipeline.md).

## Storage reclamation

ARC runner Pods are disposable. Kubelet image garbage collection reclaims Pod
runtime content. Each persistent rootless BuildKit shard applies its own cache
garbage collection. The repository does not run host Docker pruning from a
workflow and does not use the legacy registered `nook` runner.

### CI verification — always check app logs

After tests and static analysis (`task check`, clippy, Playwright report), **app
logs are the most important remaining signal.** They record vault session
lifecycle, sync, and WASM events that neither linters nor DOM assertions expose.

- **Remote e2e failure:** read Playwright attachment `nook-app-logs.json` from
  the CI artifact/report before changing code. The attachment is created for
  every e2e result; failures also print the same entries to test output.
- **Human local repro:** `E2E_SPEC=… task web:test:e2e:file`, then
  `fetchAppLogs(page)` or open `/app-logs?minLevel=debug&limit=1000`. Agents use
  the hosted remote catalog.
- **Human inspection:** `/logs` in the running app.

Full reference: [logging.md § Debugging, troubleshooting, and CI verification](../../../shared/references/logging.md#debugging-troubleshooting-and-ci-verification).

Local `task ci:pr` remains available as an optional warm-cache debug mirror.
See [pull request validation](../../../gizmo/workflows/pull-requests.md#5-hosted-iteration-and-explicit-validation)
and [mission delivery](../../../gizmo/workflows/mission-delivery.md).

E2e serves **production `dist/`** on CI (`vite preview`) with `VITE_VAULT_SYNC_INTERVAL_MS=1000` for fast background sync. Main saves prod dist before e2e and restores after (`web:e2e:restore-prod-dist`).

## Secrets and env

- **`NOOK_GITHUB_PAT`**
  - Used by: `sync-live` e2e; `agent-implement` PR/push
  - Scope: Classic with `repo` scope or fine-grained with contents and pull requests write on this repository.
  - Requirement: PR creation must act as a user so normal workflows fire.
- **`NOOK_GITHUB_E2E_REPO`**
  - Used by: CI sets per run for live suites (one repo per container)
- **`CLOUD_FLARE_PAGES_TOKEN`, `CLOUD_FLARE_ACCOUNT_ID`**
  - Used by: PR preview deploy; main development deploy and domain verification
  - Scope: Account `Cloudflare Pages: Edit` plus `nokey.sh` zone `Zone: Read`, `DNS: Read`, and `Cache Purge`.
- **`GITHUB_TOKEN`**
  - Used by: PR comments, deployment records, portable Rust coverage comment
- **`CURSOR_API_KEY`**
  - Used by: `agent-implement.yml`

**Cloudflare credentials**

- Token requires account `Cloudflare Pages: Edit` plus `nokey.sh` zone `Zone: Read`, `DNS: Read`, and `Cache Purge`.
- Main purges stale development routes before live verification.
- PR CI records its preview as a successful `github-pages` deployment for ruleset enforcement.

Local live e2e: copy `nook-app/nook-web/.env.test.local.example` → `.env.test.local` with your PAT.

## Google Cloud operations

Discover the configured Google Cloud CLI and authenticated project at runtime.
Verify the exact account, project, and target resource before mutation.

OAuth browser-origin changes require the Google Auth Platform client
configuration to contain exact origins. Do not commit client secrets. Do not
assume per-PR Cloudflare preview hosts can be covered by wildcards. See
[auth-providers.md §7](../../dev-core/design-docs/auth-providers.md#7-oauth-origins-and-pr-previews).

## CI agent (dependency updates / implementation)

[`agent-implement.yml`](../../../../.github/workflows/agent-implement.yml) uses
the trusted direct-host CI-agent entrypoint for ready Workbench issues or manual
prompts (see below). Dependency-update and generic-fix workflows retain their
separate Task-backed harness.

**Main failure handoff:**

- An unsuccessful Main run is handled separately by [`main-failure-handoff.yml`](../../../../.github/workflows/main-failure-handoff.yml).
- Trusted default-branch code writes a deduplicated `status: ready`, `automation: hive` Workbench incident without copying raw logs.
- The token-free k0s dispatcher reconciles it into Neo4j.
- One isolated logical task owns diagnosis through exact-head checks, review resolution, squash merge, and replacement Main verification.
- The explicitly dispatched implementation worker does not claim Hive
  incidents.
- Browser E2E and UI-demo failures enter the same durable repair queue as native, WASM, build, deployment, mixed, and unknown failures.

**Hive delivery generations:**

- Each rerun is recorded on the Workbench issue keyed by source SHA.
- Its publication branch, plan, and worklog are generation-specific.
- A later failed rerun supersedes and cancels an active delivery before its new generation is enqueued.
- The failed reconciliation retries only after a poll interval longer than the worker heartbeat.
- Elapsed time is not the termination barrier.
- The old generation remains `CANCELLING` until its worker durably acknowledges that Codex execution stopped or Kubernetes confirms deletion of the exact recorded worker Pod.
- Cancelling exclusive blocker Pods participate in the same barrier.
- Only then can the replacement become claimable.
- A successful rerun retires an existing incident and terminates any active delivery.
- Run IDs and attempts are ordered across the incident so older workflow runs are ignored.
- Reconciliation of the already-current generation is idempotent and never cancels it.
- Any mixed, unknown, native, WASM, build, deployment, or cancelled non-E2E job still queues Hive.

**Rust dependency updates:**

- The weekly Rust dependency workflow uses the same harness through **`task ci-agent:fix`** for its bounded update job.

**Why `NOOK_GITHUB_PAT` (not `GITHUB_TOKEN`)?** GitHub does not fire
`pull_request` workflows for PRs opened with the default Actions token
(`github-actions[bot]`). The implementation job checks out and pushes with
`NOOK_GITHUB_PAT` so the PR is attributed to the PAT owner and `pr.yml` runs.
Merge still requires the standard exact-head readiness audit.

- **Required secrets:** `CURSOR_API_KEY` and `NOOK_GITHUB_PAT`.
  - The PAT is classic with `repo` scope or fine-grained with contents and pull
    requests write on this repository.
- **Execution:**
  1. Keep the workflow-SHA checkout as trusted tooling and install only its
     lockfile-pinned CI-agent and formatter dependencies plus pinned `rustfmt`.
  2. Run the dedicated `CI_AGENT_CMD=plan` equivalent in strict isolation over
     a detached implementation-source worktree.
  3. Run strict implementation editing with network denied, an isolated home,
     and no PAT or registry credentials in the editor process.
  4. After the editor exits, let trusted host tooling format the isolated
     implementation worktree, enforce the authored-line budget, commit, push,
     and use the GitHub API.
- **Runner:** `agent-implement.yml` uses the general `nook-k0s` ARC scale set.
  - Concurrent work scales across the ARC worker pool.
  - No Docker, Podman, nested runtime, privileged container, or host container
    socket is used by this workflow.
- **Teardown:** await `agent[Symbol.asyncDispose]()`, call `process.exit`, and
  best-effort kill direct child PIDs.
- **Optional environment:** `CI_AGENT_PROMPT_FILE` and `CI_FIX_LABEL`.

### Logging

The `task ci-agent:fix` step (`agentic-ai/ci-agent/`) emits **log4j-style** lines so GitHub Actions logs are easy to scan:

```
2026-06-29 20:14:32,879 INFO  [ci-agent/agent-wait] Agent still running (20m 0s)
2026-06-29 20:14:32,879 INFO  [ci-agent/run-agent] Running Cursor SDK agent (run 123, …)
2026-06-29 20:14:33,102 INFO  [ci-agent/cursor] shell grep waitForPendingJoin
2026-06-29 20:14:33,450 INFO  [ci-agent/cursor/agent] agent output
    The agent's streamed reply is indented under the header.
2026-06-29 20:14:34,120 INFO  [ci-agent/cursor/shell] output
    | task: ci:verify:parallel
    | error: test failed
2026-06-29 20:14:35,001 INFO  [ci-agent/cursor] --- stdout ---
2026-06-29 20:14:35,001 INFO  [ci-agent/cursor] shell exit 1
```

### Log fields

- **Timestamp:** UTC, `yyyy-MM-dd HH:mm:ss,SSS`
- **Level:** `TRACE` / `DEBUG` / `INFO` / `WARN` / `ERROR`
- **Component:** `ci-agent/<module>` (e.g. `fix`, `run-agent`, `agent-wait`, `git`, `github`, `cursor`, `cursor/agent`, `cursor/shell`)

- Set `CI_AGENT_LOG_LEVEL=DEBUG` for step and turn traces.
- Log tool starts, shell output, and command results at **INFO**.
- Set heartbeat with `CI_AGENT_HEARTBEAT_MS` (default 60 seconds).
- The local/default agent timeout is 90 minutes.

`agent-implement.yml` sets:

- `timeout-minutes: 360` for the complete job;
- `CI_AGENT_TIMEOUT_MS=18000000` for a five-hour agent run.

- The remaining hour covers setup and result publication.
- The job exits after opening the PR and publishing its bounded handoff.
- `task pr:preflight` and `task pr:ready` are read-only audits.
  - No hosted continuation or CLI command merges from their result.
- The ci-agent entrypoint calls `process.exit` after `runCiFix()` completes.
  - Without it, Cursor SDK child processes and open handles can retain the Node
    event loop after PR creation.
- [CI agent smoke](../../../../.github/workflows/ci-agent-smoke.yml) runs unit tests
  and an `exitCiAgent` open-handle check on `ubuntu-latest` through
  `workflow_dispatch`.

## Agent implement (Workbench issue / manual prompt)

[`agent-implement.yml`](../../../../.github/workflows/agent-implement.yml) runs
the direct-host Cursor SDK harness for intentional implementation work — not CI
failure recovery.

### Agent implement triggers

- **`workflow_dispatch.issue_path`**
  - Behavior: Claims that exact eligible Workbench issue
- **`workflow_dispatch.prompt`**
  - Behavior: Runs the explicit prompt without claiming an issue
- **`workflow_dispatch.major_change_authorized`**
  - Behavior: Confirms that the user discussed, selected, and requested the
    dispatched major architectural solution

Exactly one of `issue_path` or `prompt` is required. Empty or ambiguous
dispatches fail before checkout. Issue eligibility requires `status: ready`,
`automation: agent`, and an owner who is a Nook GitHub collaborator with write
access. The workflow resolves only the requested path. It commits `status:
in_progress` atomically before Docker setup. Prompt mode requires a valid
`continuing_owner` with Nook write access. Each explicit dispatch has an
independent run. A blob-SHA conflict rejects a duplicate claim of the same
issue without collapsing unrelated pending dispatches.

### Major-change authorization

The gate enforces these rules:

- The input defaults to false. Workbench text and other lifecycle records
  cannot set it. Set it only when the user explicitly selected the major
  direction and requested implementation. Ordinary fixes and bounded decisions
  inside an accepted architecture do not require it.
- Before implementation, the planning agent classifies the requested solution.
  An unauthorized major direction produces a public-safe
  authorization-blocker worklog instead of an implementation plan. The
  workflow validates that worklog against the source task, skips the
  implementation worker, publishes the blocker, and leaves any claimed issue
  blocked for a later user decision.

The workflow publishes a Workbench progress update and worklog whether
implementation opens a PR or blocks. Drafts, manually owned issues, and
historical imports cannot trigger it.

Loop: claim Workbench record → strict isolated planning → classify and publish
the planning result → either publish an authorization blocker or run strict
isolated editing → trusted direct-host formatting → trusted budget, commit,
push, and PR publication → assign and directly mention the continuing owner →
publish Workbench progress/worklog → exit. `CURSOR_API_KEY` is supplied only to
the strict planner/editor SDK control plane and trusted plan/worklog secret
validators; it is removed from the editor subprocess environment.
`NOOK_GITHUB_PAT` belongs only to trusted claim, fetch, delivery, and
publication steps. Registry credentials are not used. Prompt:
[`.github/prompts/agent-implement.md`](../../../../.github/prompts/agent-implement.md).

## Agent execution policy

- GitHub Actions is the agent build/test environment and sole merge-validation
  pipeline.
- Format, commit, and push a coherent change before dispatching `task remote`.
- `task pr:validate` explicitly starts complete PR validation; an ordinary push
  does not refresh that gate.
- Agents do not run local Task mirrors of builds, tests, checks, or e2e. They
  inspect remote failures, fix them, and rerun focused remote jobs before the
  final complete gate.
- Interactive development servers and browser sessions may remain local when
  their persistent state is intrinsic to the investigation.

## Agent checklist when touching CI or e2e

1. **Do not** move real GitHub API tests back into `main.yml` — extend stub coverage instead.
2. **Do** add new sync-provider integration tests to the `e2e` spec list first; add a small live smoke under `e2e/live/` if the provider has a real backend.
3. **Do** format, commit, push, use focused `task remote` jobs, and explicitly
   trigger complete validation with `task pr:validate`; never run heavy agent
   product work locally.
4. **Do** update this doc and
   [pull requests](../../../gizmo/workflows/pull-requests.md) when workflow
   behavior changes.
5. Explicitly labeled PR CI runs Rust/WASM/JS unit tests, Svelte/type checks, lint, formatting, and builds.
   - UI-changing PRs additionally record only their changed headless demo specs.
   - Main-fix validation uses `task pr:validate PR=<number> FULL_E2E=1` and runs the Main-equivalent deterministic browser suites before merge.
   - Main runs the same local-provider and extension **e2e**.
   - Every actionable unsuccessful Main run, including browser E2E and UI-demo failures, is reconciled through one `automation: hive` Workbench incident into an isolated task that owns the repair PR, review loop, squash merge, and replacement Main verification.
   - Credentialed **sync-live** checks are explicit manual runs.
6. **Never** add Dockerfile `RUN --mount=type=cache`; dependency installs must use normal image layers. The repository-root Rust suite invoked by `task preflight` rejects violations before app setup.

See also: [ARCHITECTURE.md §7](../../../shared/architecture/system.md#7-the-engineering-harness), [pull requests](../../../gizmo/workflows/pull-requests.md).
