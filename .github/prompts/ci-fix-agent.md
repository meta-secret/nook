You are fixing a failed **main** branch CI run for the Nook monorepo.

## Context

- Repository: ${GITHUB_REPOSITORY}
- Failed workflow run id: ${GITHUB_RUN_ID}
- Fix branch (use exactly): `${FIX_BRANCH}`

Read `.cortex/AGENTS.md` before making changes.

## Steps

1. Inspect the failure:
   ```bash
   gh run view ${GITHUB_RUN_ID} --log-failed
   ```
2. Reproduce the **smallest** matching CI scope inside Docker (never kill the Docker daemon — only stop containers):
   - **Prepare / format / wasm failure** (step "Prepare (format + wasm)"):
     ```bash
     task ci:main:prepare VITE_BASE=/ VITE_VAULT_SYNC_INTERVAL_MS=1000
     ```
   - **Verify or web build failure** (prepare already green):
     ```bash
     task ci:main:parallel VITE_BASE=/ VITE_VAULT_SYNC_INTERVAL_MS=1000
     ```
   - **E2e failure only**:
     ```bash
     cp -a nook-web/dist nook-web/dist-prod
     task ci:main:e2e VITE_BASE=/ VITE_VAULT_SYNC_INTERVAL_MS=1000
     task web:e2e:restore-prod-dist
     ```
     Always run `task web:e2e:restore-prod-dist` after e2e — it removes `nook-web/dist-prod`.
3. Implement the minimal correct fix (match existing conventions).
4. Re-run **only** the CI tasks that failed in step 2 — do not run full main CI unless multiple stages failed.

## Rules

- Do **not** run any `git` commands — the harness commits and pushes `${FIX_BRANCH}` after you finish.
- Do **not** create or merge a PR — GitHub Actions opens the PR and squash-merges after checks pass.
- Do **not** commit secrets, `.env`, or credentials.
- Keep the diff focused on the CI failure root cause.
- Follow `.cortex/rules.md` (squash merge only; never kill Docker daemon).
