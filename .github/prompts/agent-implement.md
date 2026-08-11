You are implementing a task for the Nook monorepo via the **coding-bro** workflow.

## Task

${AGENT_TASK}

## Context

- Repository: ${GITHUB_REPOSITORY}
- Workflow run id: ${GITHUB_RUN_ID}
- Implementation branch (harness commits here — do not git): `${AGENT_BRANCH}`
- The planning phase has already published the task-start record and left its
  validated body in `.nook-workbench-plan.md`.

Read `.cortex/AGENTS.md` and `.cortex/workflows/coding-bro.md` before making changes.

## CI toolchain (Docker)

The job runs `task setup` before you start (sealed **nook-web:local**). You run inside the
**nook-ci-agent** container with the repo bind-mounted and the host Docker socket mounted
(`/var/run/docker.sock` — sibling containers, not Docker-in-Docker).

**Product validation runs on GitHub-hosted workers after the harness opens the
PR.** Your required local action is host-applied formatting only. Do not run
`task check` / `task ci:pr` before finishing. The harness assigns the PR to the
continuing task owner and posts a direct mention. That owner uses `task remote`
for focused execution, then explicitly triggers complete PR validation with
`task pr:validate`. Use repository Task targets; do not replace them with
hand-written `docker run` commands.

## Steps

1. Read `.nook-workbench-plan.md` first. Implement only its `Current PR slice
   and acceptance evidence` scope. Treat the remaining PR sequence as feature
   context, not as authorization to implement later slices. Prefer the
   Workbench issue scope. Do not expand into unrelated refactors.
2. Implement the change end-to-end in the working tree. Match existing conventions and package boundaries in `.cortex/ARCHITECTURE.md` / `.cortex/rules.md`.
3. **Always run `task format`** (host-applied) before finishing so the harness
   commits a formatted tree. When UI-facing paths change, pass the UI demo
   contract against the base ref when practical.
4. Do not run `task check`, `task ci:pr`, full suites, builds, or e2e in this
   bounded worker. The assigned continuing owner runs focused and complete
   hosted execution after the harness publishes the branch and PR.
5. If part of the request is too large, risky, blocked, or out of scope, follow
   `.cortex/workflows/issues.md` (update/create Workbench Markdown records)
   rather than silently dropping work.
6. Before finishing, write a concise Markdown work summary to
   `.nook-workbench-worklog.md`. Include `# Work summary` and the sections
   `## Outcome`, `## Progress`, `## Implementation problems`, `## Decisions`,
   `## Validation`, and `## Remaining work`. Do not add YAML frontmatter; the
   workflow adds it when publishing and links it to the task-start plan. Never
   include prompts, chat transcripts, secrets, credentials, vault data, private
   user information, or raw logs.

## Rules

- Do **not** run any `git` commands — the harness commits and pushes `${AGENT_BRANCH}` after you finish.
- Do **not** create, monitor, or merge a PR from this bounded worker. The harness
  opens the PR after you finish. It assigns and directly mentions the continuing
  task owner. That owner monitors the PR, fixes failures/comments/conflicts,
  runs the exact-head readiness audit, and squash-merges without separate merge
  authorization.
- Do **not** commit secrets, `.env`, or credentials.
- Keep the diff focused on the requested task.
- Follow `.cortex/rules.md` (squash merge only; never kill Docker daemon — only stop containers).
- Follow `.cortex/dynamic-skills/github-actions-only-validation.md`: format
  locally; product gates run on GitHub Actions.
