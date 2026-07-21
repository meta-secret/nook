You are implementing a task for the Nook monorepo via the **coding-bro** workflow.

## Task

${AGENT_TASK}

## Context

- Repository: ${GITHUB_REPOSITORY}
- Workflow run id: ${GITHUB_RUN_ID}
- Implementation branch (harness commits here — do not git): `${AGENT_BRANCH}`

Read `.cortex/AGENTS.md` and `.cortex/workflows/coding-bro.md` before making changes.

## CI toolchain (Docker)

The job runs `task setup` before you start (sealed **nook-web:local**). You run inside the
**nook-ci-agent** container with the repo bind-mounted and the host Docker socket mounted
(`/var/run/docker.sock` — sibling containers, not Docker-in-Docker).

**Product validation is GitHub Actions `pr.yml` after the harness opens the PR.**
Your required local action is host-applied formatting only. Do not require
`task check` / `task ci:pr` before finishing — a continuing task-owning agent
monitors the PR workflows. Optional focused debug commands are allowed when
reproducing a specific failure. Use repository Task targets; do not replace them
with hand-written `docker run` commands.

## Steps

1. Understand the task fully. Prefer the issue/prompt scope; do not expand into unrelated refactors.
2. Implement the change end-to-end in the working tree. Match existing conventions and package boundaries in `.cortex/ARCHITECTURE.md` / `.cortex/rules.md`.
3. **Always run `task format`** (host-applied) before finishing so the harness
   commits a formatted tree. When UI-facing paths change, pass the UI demo
   contract against the base ref when practical.
4. Do **not** require `task check`, `task ci:pr`, full suites, builds, or e2e
   before finishing. Optional `E2E_SPEC=… task web:test:e2e:file` is allowed for
   focused debug only.
5. If part of the request is too large, risky, blocked, or out of scope, follow `.cortex/workflows/issues.md` (update/create issues) rather than silently dropping work.

## Rules

- Do **not** run any `git` commands — the harness commits and pushes `${AGENT_BRANCH}` after you finish.
- Do **not** create, monitor, or merge a PR from this bounded worker. The harness
  opens the PR after you finish; a continuing task-owning agent then monitors it,
  fixes failures/comments/conflicts, runs the exact-head readiness audit, and
  squash-merges without separate merge authorization.
- Do **not** commit secrets, `.env`, or credentials.
- Keep the diff focused on the requested task.
- Follow `.cortex/rules.md` (squash merge only; never kill Docker daemon — only stop containers).
- Follow `.cortex/dynamic-skills/github-actions-only-validation.md`: format
  locally; product gates run on GitHub Actions.
