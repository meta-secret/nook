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
2. Reproduce locally inside Docker when practical (never kill the Docker daemon — only stop containers):
   ```bash
   task ci:main:prepare VITE_BASE=/ VITE_VAULT_SYNC_INTERVAL_MS=1000
   task ci:main:parallel VITE_BASE=/ VITE_VAULT_SYNC_INTERVAL_MS=1000
   # If e2e failed (match main.yml — save prod dist before e2e, restore after):
   cp -a nook-web/dist nook-web/dist-prod
   task ci:main:e2e VITE_BASE=/ VITE_VAULT_SYNC_INTERVAL_MS=1000
   task web:e2e:restore-prod-dist
   ```
3. Implement the minimal correct fix (match existing conventions).
4. Verify the same CI tasks pass locally before pushing.
5. Push the fix branch (the workflow opens the PR and merges after CI):
   ```bash
   git checkout -B ${FIX_BRANCH}
   git add -A
   git commit -m "Fix main CI failure (run ${GITHUB_RUN_ID})."
   git push -u origin HEAD
   ```

## Rules

- Do **not** create or merge a PR — GitHub Actions opens the PR and squash-merges after checks pass.
- Do **not** commit secrets, `.env`, or credentials.
- Keep the diff focused on the CI failure root cause.
- Follow `.cortex/rules.md` (squash merge only; never kill Docker daemon).
