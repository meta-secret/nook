You are fixing a failed **main** branch CI run for the Nook monorepo.

## Context

- Repository: ${GITHUB_REPOSITORY}
- Failed workflow run id: ${GITHUB_RUN_ID}
- Fix branch (use exactly): `${FIX_BRANCH}`

Read `.cortex/AGENTS.md` before making changes.

## CI toolchain (Docker)

The job runs `task setup` before you start. It builds the sealed **nook-web image** (toolchain base from GHCR cache + workspace source) and loads it as `nook-web:local`. All `task` Docker commands run that image automatically.

## Steps

1. Inspect the failure:
   ```bash
   gh run view ${GITHUB_RUN_ID} --log-failed
   ```
2. **Always run prepare first** before verify, build, or e2e (wasm must exist or `svelte-check` fails):
   ```bash
   task ci:main:prepare VITE_BASE=/ VITE_VAULT_SYNC_INTERVAL_MS=1000
   ```
3. Reproduce the **smallest** matching CI scope inside Docker (never kill the Docker daemon — only stop containers):
   - **Verify or web build failure**:
     ```bash
     task ci:main:parallel VITE_BASE=/ VITE_VAULT_SYNC_INTERVAL_MS=1000
     ```
   - **E2e failure** — identify the failing spec file(s) in the logs first. After prepare + parallel (dist must exist), prefer a **scoped** Playwright run over the full 72-test suite:
     ```bash
     cp -a nook-app/nook-web/nook-web-app/dist nook-app/nook-web/nook-web-app/dist-prod
     task web:test:e2e:file E2E_SPEC='e2e/multi-device-local.spec.ts'
     task web:e2e:restore-prod-dist
     ```
     Set `E2E_SPEC` to the path(s) from the log (space-separated for multiple). Use full main e2e only when many unrelated specs fail:
     ```bash
     task ci:main:e2e VITE_BASE=/ VITE_VAULT_SYNC_INTERVAL_MS=1000
     task web:e2e:restore-prod-dist
     ```
4. Implement the minimal correct fix (match existing conventions). E2e sync flakes often need `triggerVaultSyncRefresh`, `dismissSyncConflictIfVisible`, or `waitForVaultSyncIdle` from `nook-app/nook-web/nook-web-app/e2e/helpers.ts` — see `password-envelope-sync.spec.ts`. Failing specs auto-attach the app's persisted logs (`nook-app-logs.json`) via `e2e/fixtures.ts`; to capture more detail rebuild with `VITE_LOG_LEVEL=debug` or add `page.addInitScript(() => localStorage.setItem('nook_log_level', 'trace'))`. See [.cortex/references/logging.md](../../.cortex/references/logging.md).
5. Re-run **only** the CI tasks that failed in steps 2–3 — do not run full main CI unless multiple stages failed.

## Rules

- Do **not** run any `git` commands — the harness commits and pushes `${FIX_BRANCH}` after you finish.
- Do **not** create or merge a PR — GitHub Actions opens the PR and squash-merges after checks pass.
- Do **not** commit secrets, `.env`, or credentials.
- Keep the diff focused on the CI failure root cause.
- Follow `.cortex/rules.md` (squash merge only; never kill Docker daemon).
