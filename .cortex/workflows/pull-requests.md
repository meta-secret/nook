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
3. Push the branch; open a PR with summary and test plan. `pr.yml` runs `task check` plus a Cloudflare preview; `main.yml` runs the full release pipeline (check, e2e, GitHub Pages) after squash merge.
4. After review, **squash merge** into `main`.
5. Delete the branch (optional but recommended).

## CLI reference

```bash
# Open PR
gh pr create --title "…" --body "…"

# Merge (ONLY this form)
gh pr merge <number> --squash
```

See also [rules.md §6](../rules.md#6-git--pull-request-workflow).
