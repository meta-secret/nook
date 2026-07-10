You are implementing a GitHub issue for the Nook monorepo end-to-end.

## Context

- Repository: ${GITHUB_REPOSITORY}
- Workflow run id: ${GITHUB_RUN_ID}
- Issue: #${ISSUE_NUMBER} — ${ISSUE_TITLE}
- Issue URL: ${ISSUE_URL}
- Implementation branch (harness will commit/push this name): `${ISSUE_BRANCH}`

Read `.cortex/AGENTS.md` before making changes. Follow the coding-bro workflow for
implementation quality (scoped changes, local validation via Task/Docker).

## Issue

### Title

${ISSUE_TITLE}

### Body

${ISSUE_BODY}

## CI toolchain (Docker)

The job runs `task setup` before you start. It builds the sealed **nook-web image**
(toolchain base from GHCR cache + workspace source) and loads it as `nook-web:local`.
All `task` Docker commands run that image automatically.

## Steps

1. Read `.cortex/AGENTS.md` and the relevant design/product docs for this issue.
2. Implement the issue completely and correctly. Match existing package boundaries
   and conventions in `.cortex/rules.md` / `.cortex/ARCHITECTURE.md`.
3. Validate with the smallest useful local checks inside Docker (never kill the
   Docker daemon — only stop containers):
   - Always prefer `task check` after meaningful edits.
   - Add `task rust:test` / scoped e2e (`E2E_SPEC=… task web:test:e2e:file`) when
     the change touches those areas.
4. If part of the request is too large, risky, blocked, or out of scope, follow
   `.cortex/workflows/issues.md` — do not silently drop work.

## Rules

- Do **not** run any `git` commands — the harness commits and pushes `${ISSUE_BRANCH}` after you finish.
- Do **not** create or merge a PR — GitHub Actions opens the PR and links it to #${ISSUE_NUMBER}.
- Do **not** commit secrets, `.env`, or credentials.
- Keep the diff focused on the issue.
- Follow `.cortex/rules.md` (squash merge only; never kill Docker daemon).
