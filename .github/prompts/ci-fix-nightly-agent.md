You are fixing a failed **nightly live sync provider e2e** run for the Nook monorepo.

## Context

- Repository: ${GITHUB_REPOSITORY}
- Failed workflow run id: ${GITHUB_RUN_ID}
- Fix branch (use exactly): `${FIX_BRANCH}`

This workflow runs **sync-live** Playwright specs against real provider APIs (GitHub today). Stub-backed e2e runs on every main merge — do not confuse the two.

Read `.cortex/AGENTS.md` before making changes.

## CI toolchain (Docker)

The job runs `task setup` before you start (sealed **nook-web:local**). You run inside the
**nook-ci-agent** container with the repo bind-mounted and the host Docker socket mounted
(`/var/run/docker.sock` — sibling containers, not Docker-in-Docker). All `task` Docker
commands talk to the host daemon and run the sealed nook-web image.

Live e2e requires `NOOK_GITHUB_PAT` and a disposable `NOOK_GITHUB_E2E_REPO` (already set in the job environment).

## Steps

1. Inspect the failure:
   ```bash
   gh run view ${GITHUB_RUN_ID} --log-failed
   ```
2. Reproduce the **smallest** matching CI scope inside Docker (never kill the Docker daemon — only stop containers):
   - **Prepare / format / wasm failure**:
     ```bash
     task ci:main:prepare VITE_BASE=/ VITE_VAULT_SYNC_INTERVAL_MS=1000
     ```
   - **Verify or web build failure** (prepare already green):
     ```bash
     task ci:main:parallel VITE_BASE=/ VITE_VAULT_SYNC_INTERVAL_MS=1000
     ```
   - **Sync-live e2e failure only** (most common for this workflow):
     ```bash
     cp -a nook-app/nook-web/nook-web-app/dist nook-app/nook-web/nook-web-app/dist-prod
     task web:test:e2e:sync-live:parallel VITE_BASE=/ VITE_VAULT_SYNC_INTERVAL_MS=1000
     task web:e2e:restore-prod-dist
     ```
     Always run `task web:e2e:restore-prod-dist` after e2e — it removes `nook-app/nook-web/nook-web-app/dist-prod`.
   - **Full nightly scope** (when unsure which stage failed):
     ```bash
     task ci:nightly:e2e VITE_BASE=/ VITE_VAULT_SYNC_INTERVAL_MS=1000
     ```
3. Implement the minimal correct fix (match existing conventions). Prefer local-provider coverage in `e2e` over relying on live API behavior.
4. Re-run **only** the CI tasks that failed in step 2 — do not run full nightly e2e unless the failure spans multiple stages.

## Rules

- Do **not** run any `git` commands — the harness commits and pushes `${FIX_BRANCH}` after you finish.
- Do **not** create or merge a PR — GitHub Actions opens the PR for explicit review and merge authorization.
- Do **not** commit secrets, `.env`, or credentials.
- Keep the diff focused on the CI failure root cause.
- Follow `.cortex/rules.md` (squash merge only; never kill Docker daemon).
