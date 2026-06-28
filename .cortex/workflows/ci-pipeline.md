# CI / GitHub Actions Pipeline

System of record for how Nook validates changes in GitHub Actions. Agents must understand this split before changing workflows or e2e.

## Workflow map

| Workflow | Trigger | What runs | GitHub PAT |
|----------|---------|-----------|------------|
| [`pr.yml`](../../.github/workflows/pr.yml) | PR open/sync | Format, verify, web build, Cloudflare preview | No |
| [`main.yml`](../../.github/workflows/main.yml) | Push to `main` | Verify, build, **local + sync-stub e2e**, Pages deploy, push toolchain | No |
| [`e2e-nightly.yml`](../../.github/workflows/e2e-nightly.yml) | Cron 03:00 UTC + manual | **Live sync provider e2e** (real GitHub API today) | Yes (`NOOK_GITHUB_PAT`) |
| [`e2e-pr.yml`](../../.github/workflows/e2e-pr.yml) | Manual | Debug e2e on a PR branch (local / sync-stub / sync-live) | Only for `sync-live` |

```mermaid
flowchart LR
  PR[Pull request] --> pr_yml[pr.yml]
  pr_yml --> preview[Cloudflare preview]

  merge[Squash merge to main] --> main_yml[main.yml]
  main_yml --> verify[Verify + build]
  main_yml --> e2e_stub[local ‖ sync-stub e2e]
  main_yml --> pages[GitHub Pages deploy]

  cron[Nightly 03:00 UTC] --> nightly[e2e-nightly.yml]
  nightly --> e2e_live[sync-live e2e]
```

## Provider selection (`NOOK_E2E_SYNC_PROVIDER`)

The **same sync spec files** run against different backends. CI swaps providers by setting one env var per job:

| Env | Values | Default |
|-----|--------|---------|
| `NOOK_E2E_SYNC_PROVIDER` | `github`, `google-drive` | `github` |

Registry and factories live in `nook-web/e2e/sync-provider.ts`:

- **`createSyncTarget()`** — isolated stub remote (reads provider from env)
- **`connectSyncGenesisDevice()` / `connectSyncVault()`** — provider-aware connect
- **`live/sync.smoke.spec.ts`** — one nightly smoke per matrix row

**Main CI (`sync-stub`):** defaults to `github`; add a parallel job with `NOOK_E2E_SYNC_PROVIDER=google-drive` when Drive UI connect is wired.

**Nightly (`sync-live`):** matrix in `e2e-nightly.yml`:

```yaml
strategy:
  matrix:
    provider: [github]  # add google-drive when secret exists
env:
  NOOK_E2E_SYNC_PROVIDER: ${{ matrix.provider }}
```

Live credentials per provider:

| Provider | Secret / env |
|----------|----------------|
| `github` | `NOOK_GITHUB_PAT` |
| `google-drive` | `NOOK_GOOGLE_E2E_ACCESS_TOKEN` (when live smoke is wired) |

Stub mode uses in-memory route mocks (`sync-stub.ts`, `drive-stub.ts`) — no API quota.

## Why sync-stub vs sync-live

GitHub REST API rate limits make it expensive to run full Playwright sync coverage on every PR and every main push. Nook therefore:

1. **`sync-stub` project** — Playwright `page.route()` intercepts `api.github.com` with an **in-memory vault stub** (`e2e/sync-stub.ts`, `createLocalE2eGithubVaultStub`). Each suite gets a unique fake repo name; no API calls, no cleanup, unlimited parallelism as tests grow.
2. **`sync-live` project** — Specs under `e2e/live/` hit the **real GitHub API** using `NOOK_GITHUB_PAT`. Minimal smoke coverage; runs **once per day** on the schedule (and manually via workflow dispatch).

When adding Google Drive or other sync providers, add stub-backed specs to `sync-stub` and thin live smoke specs to `e2e/live/`.

## Playwright projects

Defined in `nook-web/playwright.config.ts`:

| Project | Specs | CI |
|---------|-------|-----|
| `local` | IndexedDB-only flows (vault CRUD, login, legal, …) | main, e2e-pr |
| `sync-stub` | GitHub sync flows via route stubs (multi-device, fan-out, password envelope, …) | main, e2e-pr |
| `sync-live` | `e2e/live/**/*.spec.ts` | e2e-nightly, e2e-pr (manual) |

## Task commands (Docker)

All commands run containerized via `Taskfile.yml`:

```bash
# PR / local dev
task check                          # format, clippy, unit tests, web build
task web:test:e2e:local             # local project only
task web:test:e2e:sync-stub         # stub sync (no PAT)

# Main CI equivalent
task ci:main:e2e:parallel           # local ‖ sync-stub in parallel containers

# Nightly / live GitHub (needs NOOK_GITHUB_PAT in env or .env.test.local)
task web:test:e2e:sync-live
task ci:nightly:e2e                 # prepare + build + sync-live

# Legacy aliases
task web:test:e2e:github            # → sync-live
```

E2e serves **production `dist/`** on CI (`vite preview`) with `VITE_VAULT_SYNC_INTERVAL_MS=1000` for fast background sync. Main saves prod dist before e2e and restores after (`web:e2e:restore-prod-dist`).

## Secrets and env

| Secret / env | Used by |
|--------------|---------|
| `NOOK_GITHUB_PAT` | sync-live only (repo scope + delete_repo for cleanup) |
| `NOOK_GITHUB_E2E_REPO` | CI sets per run for live suites (one repo per container) |
| `CLOUD_FLARE_PAGES_TOKEN`, `CLOUD_FLARE_ACCOUNT_ID` | PR preview deploy |
| `GITHUB_TOKEN` | Toolchain GHCR, PR comments |

Local live e2e: copy `nook-web/.env.test.local.example` → `.env.test.local` with your PAT.

## Agent checklist when touching CI or e2e

1. **Do not** move real GitHub API tests back into `main.yml` — extend stub coverage instead.
2. **Do** add new sync-provider integration tests to `sync-stub` first; add a small live smoke under `e2e/live/` if the provider has a real backend.
3. **Do** run `task web:test:e2e:sync-stub` (or `local`) before merge when changing web vault/sync flows.
4. **Do** update this doc and [`pull-requests.md`](pull-requests.md) when workflow behavior changes.
5. PR CI stays fast: no e2e on `pr.yml`. Main carries stub e2e; nightly carries live.

See also: [ARCHITECTURE.md §7](../ARCHITECTURE.md#7-the-engineering-harness), [pull-requests.md](pull-requests.md).
