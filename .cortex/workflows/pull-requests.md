# Pull Request Workflow

Use this checklist for every change that lands on `main`.

## ⛔ SQUASH MERGE ONLY

**Every PR merged into `main` MUST be squash-merged.**

| Allowed | Forbidden |
|--------|-----------|
| GitHub UI: **Squash and merge** | Create a merge commit |
| CLI: `gh pr merge <n> --squash` | `gh pr merge --merge` |
| One commit per PR on `main` | `gh pr merge --rebase` |
| | Fast-forward that keeps branch commit history on `main` |

`main` must stay linear: **one squash commit per merged PR**. Feature branches can have many commits; that history is discarded at merge time.

If you merge a PR for the user, **confirm squash** before completing the merge. Merging any other way is a process violation.

## Standard flow

1. Branch from `main` (never commit directly on `main`).
2. Implement; run `task format` and `task check` locally before opening a PR.
3. Push the branch; open a PR with summary and test plan. `pr.yml` runs `task ci:pr:publish` plus a Cloudflare preview; `main.yml` runs prepare then `task ci:main:finish` (verify ‖ build ‖ e2e in parallel, GitHub Pages) after squash merge.
4. **Monitor CI until green** (see [CI fix loop](#ci-fix-loop) below).
5. After review, **squash merge** into `main`.
6. Delete the branch (optional but recommended).

## CI fix loop

After implementation is complete, **do not stop at push** — agents must drive the PR to green CI.

1. **Push** the branch (`git push -u origin HEAD`).
2. **Monitor checks** on the open PR — poll about **once per minute** until every required check finishes:
   ```bash
   gh pr checks <number> --watch          # blocks until done
   # or poll manually:
   gh pr view <number> --json statusCheckRollup -q '.statusCheckRollup[] | "\(.name): \(.state) \(.conclusion // "pending")"'
   ```
3. **On failure:** read the failed job log (`gh run view <run-id> --log-failed`), reproduce locally when practical (`task check` for verify/lint/build; `task web:test:e2e:local` for e2e on main), fix the root cause, commit, and **push again**.
4. **Repeat** steps 2–3 until all checks pass.
5. Only then treat the PR as ready to merge (or merge if the user asked).

PR workflow (`pr.yml`): verify + web build. Main workflow (`main.yml`): full e2e after merge — still run local e2e before merge when the change touches web flows.

**Docker:** Never kill the Docker daemon — only stop containers (`docker stop`). See [rules.md §5](../rules.md#docker-daemon--never-kill-it).

## CLI reference

```bash
# Open PR
gh pr create --title "…" --body "…"

# Merge (ONLY this form)
gh pr merge <number> --squash
```

See also [rules.md §6](../rules.md#6-git--pull-request-workflow).
