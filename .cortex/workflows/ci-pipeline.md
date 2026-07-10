# CI / GitHub Actions Pipeline

System of record for how Nook validates changes in GitHub Actions. Agents must understand this split before changing workflows or e2e.

## Workflow map

| Workflow                                                     | Trigger                 | What runs                                                                 | GitHub PAT                                |
| ------------------------------------------------------------ | ----------------------- | ------------------------------------------------------------------------- | ----------------------------------------- |
| [`pr.yml`](../../.github/workflows/pr.yml)                   | PR open/sync            | Format, verify, wasm-bindgen tests, web build, Cloudflare preview, `github-pages` deployment status | No                                        |
| [`main.yml`](../../.github/workflows/main.yml)               | Push to `main`          | Verify, wasm-bindgen tests, build, **full local-provider e2e**, Cloudflare Pages deploy to development `dev.nokey.sh`, push toolchain | No |
| [`release-v1.yml`](../../.github/workflows/release-v1.yml)   | Push to `release/v1` + manual | Verify, wasm-bindgen tests, build, **full local-provider e2e**, GitHub Pages deploy to stable `nokey.sh` | No |
| [`e2e-nightly.yml`](../../.github/workflows/e2e-nightly.yml) | Cron 03:00 UTC + manual | **Live sync provider e2e** (real GitHub API today); **ci-fix** on failure | Yes (`NOOK_GITHUB_PAT`, `CURSOR_API_KEY`) |
| [`agent-implement.yml`](../../.github/workflows/agent-implement.yml) | Issue labeled `ai-agent`, or manual prompt | Cursor SDK implement → PR → wait for checks → **squash merge** (GitHub-hosted `ubuntu-latest`, not self-hosted `nook`) | Yes (`NOOK_GITHUB_PAT`, `CURSOR_API_KEY`) |
| [`e2e-pr.yml`](../../.github/workflows/e2e-pr.yml)           | Manual                  | Debug e2e on a PR branch (`e2e-pr` / `e2e` / `sync-live`)                 | Only for `sync-live`                      |
| [`runner-cleanup.yml`](../../.github/workflows/runner-cleanup.yml) | Cron 13:00 UTC + manual | Prune unused Docker data and anonymous volumes on the self-hosted Nook runners | No                                        |

```mermaid
flowchart LR
  PR[Pull request] --> pr_yml[pr.yml]
  pr_yml --> preview[Cloudflare preview]
  pr_yml --> pr_deployment[github-pages deployment status]

  merge[Squash merge to main] --> main_yml[main.yml]
  main_yml --> main_verify[Verify + build + e2e]
  main_yml --> toolchain_push[Push toolchain to GHCR]
  main_yml --> cf_dev[Cloudflare Pages dev]

  release[v1 branch update] --> release_yml[release-v1.yml]
  release_yml --> release_verify[Verify + build + e2e]
  release_yml --> pages[GitHub Pages stable]

  cron[Nightly 03:00 UTC] --> nightly[e2e-nightly.yml]
  nightly --> e2e_live[sync-live e2e]

  cleanup_cron[Daily 13:00 UTC] --> cleanup[runner-cleanup.yml]
  cleanup --> docker_prune["docker system prune --volumes"]
```

## Provider selection (`NOOK_E2E_SYNC_PROVIDER`)

The **same sync spec files** run against different backends. CI swaps providers by setting one env var per job:

| Env                      | Values                   | Default  |
| ------------------------ | ------------------------ | -------- |
| `NOOK_E2E_SYNC_PROVIDER` | `file`, `local`, `google-drive`, `github` | `file` |

Registry and factories live in `nook-app/nook-web/e2e/sync-provider.ts`:

- **`createSyncTarget()`** — isolated e2e remote (reads provider from env)
- **`connectSyncGenesisDevice()` / `connectSyncVault()`** — provider-aware connect
- **`live/sync.smoke.spec.ts`** — one nightly smoke per matrix row
- **`local` is a legacy alias for `file`** in e2e; new tests should use
  `file` when they need the default local file-backed provider explicitly.

**Main and release CI (`e2e`):** default to the `file` provider. The e2e remote stores
event files in a real temp directory while Playwright serves the oauth-file HTTP
calls, so default sync tests exercise local file-backed replication without
external API quota.

**Nightly (`sync-live`):** matrix in `e2e-nightly.yml`:

```yaml
strategy:
  matrix:
    provider: [github] # add google-drive when secret exists
env:
  NOOK_E2E_SYNC_PROVIDER: ${{ matrix.provider }}
```

Live credentials per provider:

| Provider       | Secret / env                                              |
| -------------- | --------------------------------------------------------- |
| `github`       | `NOOK_GITHUB_PAT`                                         |
| `google-drive` | `NOOK_GOOGLE_E2E_ACCESS_TOKEN` (when live smoke is wired) |

No-live-provider mode uses Playwright route handlers (`sync-stub.ts`,
`drive-stub.ts`, `file-sync-stub.ts`) — no API quota. For the default `file`
provider, those handlers read and write real event files under a temp directory.

## Why local-provider e2e vs sync-live

Real provider API calls are slow and brittle at CI scale. Nook therefore:

1. **`e2e` project** — IndexedDB flows plus sync-provider specs through isolated e2e remotes. One Playwright process, fully parallel, one preview server.
2. **`e2e-pr` project** — subset of `e2e` (IndexedDB-only specs) for fast manual/debug runs.
3. **`sync-live` project** — Specs under `e2e/live/` hit the **real provider API** using `NOOK_GITHUB_PAT`. Minimal smoke; nightly + manual only.

When adding Google Drive or other sync providers, add local e2e remote specs to
the `e2e` list and thin live smoke specs to `e2e/live/`.

## Parallelism and isolation

Do **not** set `workers` in `playwright.config.ts` — use Playwright defaults locally and override with `--workers=N` when you want more parallelism than the default. Spec files that need ordering use `test.describe.configure({ mode: 'serial' })` within the file only.

`sync-live` keeps `fullyParallel: false` because CI assigns one `NOOK_GITHUB_E2E_REPO` per container; parallel live files would share that remote. Local e2e projects (`e2e`, `e2e-pr`) use `fullyParallel: true`.

**One web server per Playwright process is enough.** CI serves static `dist/` via `vite preview`; workers share that HTTP endpoint. Isolation is at the browser layer:

- Each test gets a fresh browser context → separate IndexedDB / `localStorage`.
- Local e2e sync uses `page.route()` with a unique remote id per suite — no shared remote state.
- The Nook server is stateless; vault data never lives on the server in e2e.

Do **not** spin up multiple Nook servers for parallel e2e unless debugging port conflicts locally with `reuseExistingServer`.

## Playwright projects

Defined in `nook-app/nook-web/playwright.config.ts`:

| Project     | Specs                                          | CI                            |
| ----------- | ---------------------------------------------- | ----------------------------- |
| `e2e`       | All local-provider specs (IndexedDB + sync remotes) | pr.yml, main, e2e-pr (manual) |
| `e2e-pr`    | IndexedDB-only subset                          | e2e-pr (manual/debug)         |
| `sync-live` | `e2e/live/**/*.spec.ts`                        | e2e-nightly, e2e-pr (manual)  |

Legacy script aliases: `test:e2e:local` → `e2e-pr`, `test:e2e:sync-stub` → `e2e`.

## Task commands (Docker)

All commands run containerized via Taskfile. The root `Taskfile.yml` is the repo entrypoint; app commands are included through `nook-app/Taskfile.yml`, with cross-package app tasks in `nook-app/.task/`, Docker tasks in `nook-app/docker/Taskfile.yml`, and web-family tasks in `nook-app/nook-web/Taskfile.yml` plus `nook-app/nook-web/.task/`:

```bash
# Minimum local final gate after final-validation push
task check                          # format, clippy, unit tests, wasm-bindgen tests, web build (dev/no-opt wasm)

# Full PR CI mirror — parallel local gate; mandatory before merge/handoff after broad remote failure
WASM_BUILD_MODE=prod task ci:pr      # prepare → verify ‖ build → full local-provider e2e

# E2e projects
task web:test:e2e                   # full local-provider e2e (PR/main gate)
task web:test:e2e:pr                # fast e2e-pr subset (manual/debug only)

# WASM tests
task wasm:test                      # wasm-bindgen smoke tests in Node (PR/main gate)
task wasm:test:browser              # browser-only wasm tests (manual/debug)

# Single spec — preferred during fix/debug (E2E_SPEC paths relative to nook-app/nook-web/)
E2E_SPEC=e2e/connect.spec.ts task web:test:e2e:file

# Main CI equivalent
task ci:main:e2e                    # one container, full e2e project

# Nightly / live GitHub (needs NOOK_GITHUB_PAT in env or .env.test.local)
task web:test:e2e:sync-live
task ci:nightly:e2e                 # prepare + build + sync-live

# Legacy aliases
task web:test:e2e:github            # → sync-live
```

## nook-core + nook-auth2 coverage export

The `nook-core + nook-auth2` coverage gate runs during the Docker image build in
`nook-app/nook-core/Dockerfile` (`builder-debug`). The source-sensitive layers are
ordered by Rust dependency edge: `nook-auth2` is copied, linted, and coverage-tested
before `nook-core`; the `nook-core` coverage run uses `--no-clean` and the final
`cargo llvm-cov report -p nook-core -p nook-auth2` enforces the committed floor
and writes reusable artifacts to `/opt/nook/coverage/nook-core` in the image.

PR coverage export must remain a copy-out step: `task docker:extract:coverage`
creates a stopped container from the already-built `nook-web:local` image and
copies `summary.txt`, `summary.json`, `lcov.info`, and `coverage-floor.json`.
Do not make coverage export start a container and rerun `cargo llvm-cov`; PR CI
exports current and base coverage, so a runtime coverage command would duplicate
the same Rust tests after the image build.

When PR CI builds the base worktree for comparison, it measures the base source in
the base worktree's own layout. The current PR image is built first, so this
branch's Dockerfile/task plumbing is still validated before base coverage is
exported.

## Local vs remote CI

**Remote (GitHub Actions) is cold and heavy.** Every run starts on a fresh `ubuntu-latest` runner: pull the toolchain Docker image from GHCR, build wasm/web from scratch, run the full prepared test set. PR workflow runs **`task ci:pr`** (verify, web build, full local-provider e2e, Cloudflare preview, and a successful `github-pages` deployment status for the PR head SHA — no toolchain image push). PR coverage always checks the current `nook-core + nook-auth2` artifact against the floor; the expensive base-worktree coverage rebuild runs only when Rust/auth/core/Cargo/Docker coverage inputs changed, otherwise the current coverage artifact is reused as the base comparison. Main pushes the commit-tagged toolchain image after green verify and deploys the active development channel to Cloudflare Pages for `dev.nokey.sh`. `release-v1.yml` runs the main-equivalent gate without pushing the toolchain, then deploys the pinned `release/v1` build to GitHub Pages for stable `nokey.sh`. Expect several minutes per PR run plus queue time. Use remote CI as the **PR validation gate** — not as the primary place to discover fmt/clippy/unit/e2e failures.

Main's toolchain publish must authenticate immediately before the GHCR
`toolchain-push` bake. Do not assume a prior Docker login from setup is still
visible to Buildx on every self-hosted runner; a green verify/e2e run can still
block the Pages deploy if the final push falls back to anonymous GHCR auth and
gets a 403. `main.yml` passes `GITHUB_TOKEN` / `GITHUB_ACTOR` into
`task ci:main:publish`, and `docker:push` re-logins before pushing. After the
publish gate, `main.yml` deploys the Cloudflare artifact with
`VITE_SITE_URL=https://dev.nokey.sh` and
`VITE_PUBLIC_APP_URL=https://dev.nokey.sh`, ensures the Cloudflare Pages custom
domain exists, verifies the preconfigured Cloudflare DNS CNAME and HTTPS
response, and records a `development` deployment status whose URL is
`https://dev.nokey.sh/`.

**Local Docker is warm and fast.** Toolchain images are **cached** on the developer machine. The same Task gates (`task check`, `task ci:pr`, e2e) finish much faster locally. **Prefer local runs** to check tests, fix issues, and iterate. Once the current iteration is functionally complete, push/open/update the PR before the long final local gate, then run local validation while remote CI runs.

**E2e debug — one spec at a time.** During a fix/debug session, do not re-run the full e2e suite after every change. Run individual specs for fast feedback:

```bash
E2E_SPEC=e2e/connect.spec.ts task web:test:e2e:file
```

After targeted fixes pass and the iteration is ready for final validation, push/open/update the PR, then run the relevant project or full PR mirror while remote CI runs.

**Agent efficiency rules:**

1. **Before long final local checks** — push/open/update the PR once the iteration is functionally complete so remote CI can start.
2. **Parallel local gate** — run `task check` minimum; add `task web:test:e2e` or `task ci:pr` when web/vault/sync flows change. Use `E2E_SPEC=… task web:test:e2e:file` while debugging a specific e2e failure.
3. **After any remote CI failure** — read test output and static-analysis errors,
   then **persisted app logs** (see below), fix locally (prefer single-spec e2e
   while iterating), push the completed fix, then run the required local gate
   while remote CI refreshes.

## Runner cleanup

[`runner-cleanup.yml`](../../.github/workflows/runner-cleanup.yml) runs daily on
the self-hosted `nook` runner label and can also be triggered manually. It runs
`docker system prune --force --volumes` to reclaim unused containers, networks,
build cache, dangling images, and anonymous volumes without touching the Docker
daemon itself.

### CI verification — always check app logs

After tests and static analysis (`task check`, clippy, Playwright report), **app
logs are the most important remaining signal.** They record vault session
lifecycle, sync, and WASM events that neither linters nor DOM assertions expose.

- **Remote e2e failure:** read Playwright attachment `nook-app-logs.json` from
  the CI artifact/report before changing code. The attachment is created for
  every e2e result; failures also print the same entries to test output.
- **Local repro:** `E2E_SPEC=… task web:test:e2e:file`, then `fetchAppLogs(page)`
  or open `/app-logs?minLevel=debug&limit=1000`.
- **Human inspection:** `/logs` in the running app.

Full reference: [logging.md § Debugging, troubleshooting, and CI verification](../references/logging.md#debugging-troubleshooting-and-ci-verification).

Local `task ci:pr` is still much faster on a warm cached toolchain image than a cold remote run. See [pull-requests.md § Local checks](pull-requests.md#4-local-checks) and [coding-bro.md](coding-bro.md).

E2e serves **production `dist/`** on CI (`vite preview`) with `VITE_VAULT_SYNC_INTERVAL_MS=1000` for fast background sync. Main saves prod dist before e2e and restores after (`web:e2e:restore-prod-dist`).

## Secrets and env

| Secret / env                                        | Used by                                                                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NOOK_GITHUB_PAT`                                   | sync-live e2e, ci-fix PR/push, and agent-implement PR/push (repo scope; PRs must be opened as a user, not `GITHUB_TOKEN`, so `pr.yml` runs and auto-merge is not blocked on bot approval) |
| `NOOK_GITHUB_E2E_REPO`                              | CI sets per run for live suites (one repo per container)                                                                                                            |
| `CLOUD_FLARE_PAGES_TOKEN`, `CLOUD_FLARE_ACCOUNT_ID` | PR preview deploy; PR CI then records that preview as a successful `github-pages` GitHub deployment for ruleset enforcement                                         |
| `GITHUB_TOKEN`                                      | Toolchain GHCR, PR comments, nook-core + nook-auth2 coverage comment                                                                                                 |
| `CURSOR_API_KEY`                                    | ci-fix agent (main.yml, e2e-nightly.yml) and agent-implement.yml                                                                                                   |

Local live e2e: copy `nook-app/nook-web/.env.test.local.example` → `.env.test.local` with your PAT.

## Google Cloud operations

The local Codex machine has Google Cloud CLI 575.0.0 installed at
`/Users/bynull/google-cloud-sdk/bin/gcloud`. It is authenticated as
`bynull@meta-secret.org` with active project `nook-500604` (`name: nook`,
`projectNumber: 327685619872`). New interactive shells should resolve `gcloud`
from `.zshrc`; non-interactive agent commands may use the full binary path.

Use this CLI for Nook Google Cloud project inspection and safe operational
changes. OAuth browser-origin changes still require the Google Auth Platform
client configuration to contain exact origins; do not commit client secrets, and
do not assume per-PR Cloudflare preview hosts can be covered by wildcards. See
[auth-providers.md §7](../design-docs/auth-providers.md#7-oauth-origins-and-pr-previews).

## CI agent (`ci-fix` / `ci-agent:implement`)

Both [`main.yml`](../../.github/workflows/main.yml) and [`e2e-nightly.yml`](../../.github/workflows/e2e-nightly.yml) run a **`ci-fix`** job on failure: Cursor SDK agent → fix branch → PR → wait for checks → squash merge. Nightly uses `.github/prompts/ci-fix-nightly-agent.md` and `CI_FIX_LABEL=nightly e2e`; main uses the default main-CI prompt. [`agent-implement.yml`](../../.github/workflows/agent-implement.yml) uses the same harness via **`task ci-agent:implement`** for labeled issues / manual prompts (see below).

**Why `NOOK_GITHUB_PAT` (not `GITHUB_TOKEN`)?** GitHub does not fire `pull_request` workflows for PRs opened with the default Actions token (`github-actions[bot]`). Those PRs also sit behind branch protection as bot-authored and need a manual approval you cannot self-grant. The ci-fix job checks out and pushes with `NOOK_GITHUB_PAT` so the fix PR is attributed to the PAT owner, `pr.yml` runs, and squash merge can proceed without a manual approve step (assuming the PAT owner can merge per branch rules).

Required secrets for ci-fix: `CURSOR_API_KEY`, `NOOK_GITHUB_PAT` (classic PAT with `repo` scope, or fine-grained with contents + pull requests write on this repo).

The `ci-fix` / `ci-agent:implement` jobs run **`task setup`** (bake sealed `nook-web:local`) then **`task ci-agent:fix`** / **`task ci-agent:implement`**, which build and run the **`nook-ci-agent:local`** image. That container uses **`docker run --init`**, bind-mounts the checkout, and mounts **`/var/run/docker.sock`** so the agent can spawn sibling containers on the host Docker daemon (not Docker-in-Docker).

**Runner split:** `ci-fix` (main/nightly) still runs on self-hosted **`nook`**. **`agent-implement.yml` runs on GitHub-hosted `ubuntu-latest`** so intentional agent work does not share the self-hosted machine with other CI. Host Node is not required for these jobs.

After the agent finishes, ci-agent **awaits** `agent[Symbol.asyncDispose]()` (not fire-and-forget `close()`), then calls `process.exit` (and best-effort SIGKILL of direct child PIDs) so orphaned SDK children cannot keep the container alive.

Optional env: `CI_AGENT_PROMPT_FILE` (agent instructions), `CI_FIX_LABEL` (PR title/body label), `DOCKER_SOCK` (default `/var/run/docker.sock`).

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

| Field     | Meaning                                                                                                                |
| --------- | ---------------------------------------------------------------------------------------------------------------------- |
| Timestamp | UTC, `yyyy-MM-dd HH:mm:ss,SSS`                                                                                         |
| Level     | `TRACE` / `DEBUG` / `INFO` / `WARN` / `ERROR`                                                                          |
| Component | `ci-agent/<module>` — e.g. `fix`, `run-agent`, `agent-wait`, `git`, `github`, `cursor`, `cursor/agent`, `cursor/shell` |

Set `CI_AGENT_LOG_LEVEL=DEBUG` in the job env to include step/turn traces (`step started`, `turn ended`). Tool starts, shell output, and command results are always logged at **INFO**. Heartbeat interval: `CI_AGENT_HEARTBEAT_MS` (default 60s). Timeout: `CI_AGENT_TIMEOUT_MS` (default 90m).

The ci-agent entrypoint calls `process.exit` after `runCiFix()` completes. Without an explicit exit, the Cursor SDK local executor can leave child processes and open handles that keep the Node event loop alive and the `ci-fix` job running long after the agent merges its PR.

## Agent implement (`ai-agent` label / manual prompt)

[`agent-implement.yml`](../../.github/workflows/agent-implement.yml) runs the same Cursor SDK harness (`task ci-agent:implement`) for intentional implementation work — not CI failure recovery.

| Trigger | When it runs |
| ------- | ------------ |
| `issues: [labeled]` | Only when the label being assigned is exactly **`ai-agent`** (not on issue open, not when other labels are added) |
| `workflow_dispatch` | Always, using the required `prompt` input |

Opt-in only: create milestones/epics/sub-issues first, then assign `ai-agent` to the focused issue you want executed. Opening an issue (even with labels pre-selected) does not start the job unless GitHub emits a `labeled` event for `ai-agent`. The workflow does **not** auto-create the label — maintainers create it once (`gh label create ai-agent` or the GitHub UI).

Loop: `task setup` → **`task ci-agent:implement`** (nook-ci-agent container + docker.sock) → push branch → open PR → comment on the issue with the PR URL (issue runs) → wait for checks → **squash merge** → optional merged comment. Same secrets as ci-fix: `CURSOR_API_KEY`, `NOOK_GITHUB_PAT`. Prompt: [`.github/prompts/agent-implement.md`](../../.github/prompts/agent-implement.md).

## Agent checklist when touching CI or e2e

1. **Do not** move real GitHub API tests back into `main.yml` — extend stub coverage instead.
2. **Do** add new sync-provider integration tests to the `e2e` spec list first; add a small live smoke under `e2e/live/` if the provider has a real backend.
3. **Do** run `task ci:pr` (or `task web:test:e2e` for the full local-provider suite) before merge when changing web vault/sync flows.
4. **Do** update this doc and [`pull-requests.md`](pull-requests.md) when workflow behavior changes.
5. PR CI and main both run full local-provider **e2e**; nightly runs **sync-live**.

See also: [ARCHITECTURE.md §7](../ARCHITECTURE.md#7-the-engineering-harness), [pull-requests.md](pull-requests.md).
