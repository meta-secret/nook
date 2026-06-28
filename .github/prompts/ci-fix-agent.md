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
   # If e2e failed:
   task ci:main:e2e:parallel VITE_BASE=/ VITE_VAULT_SYNC_INTERVAL_MS=1000
   ```
3. Implement the minimal correct fix (match existing conventions).
4. Verify the same CI tasks pass locally before opening a PR.
5. Git workflow (squash merge policy — one commit per PR on main):
   ```bash
   git checkout -B ${FIX_BRANCH}
   git add -A
   git commit -m "Fix main CI failure (run ${GITHUB_RUN_ID})."
   git push -u origin HEAD
   gh pr create --title "Fix main CI (run ${GITHUB_RUN_ID})" --body "$(cat <<'EOF'
   ## Summary
   Auto-fix for failed main CI run ${GITHUB_RUN_ID}.

   ## Test plan
   - [ ] CI green on this PR
   EOF
   )"
   ```

## Rules

- Do **not** squash merge or merge the PR — the outer CI script merges after checks pass.
- Do **not** commit secrets, `.env`, or credentials.
- Keep the diff focused on the CI failure root cause.
- Follow `.cortex/rules.md` (squash merge only; never kill Docker daemon).
