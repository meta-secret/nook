You are implementing a task for the Nook monorepo via the **coding-bro** workflow.

## Task

${AGENT_TASK}

## Context

- Repository: ${GITHUB_REPOSITORY}
- Workflow run id: ${GITHUB_RUN_ID}
- Implementation branch (harness commits here — do not git): `${AGENT_BRANCH}`
- The planning phase has already published the task-start record and left its
  validated body in `.nook-workbench-plan.md`.

Read `.cortex/AGENTS.md` and `.cortex/knowledge-graph.md`. Select one owning
team, then load only that team's `AGENTS.md`, knowledge graph, and exact
task-relevant documents. The delivery owner follows
`.cortex/teams/ai/workflows/coding-bro.md` without passing unrelated AI context
to a team worker.

## CI toolchain (Docker)

The job runs `task setup` before you start (sealed **nook-web:local**). You run inside the
**nook-ci-agent** container with the repo bind-mounted and the host Docker socket mounted
(`/var/run/docker.sock` — sibling containers, not Docker-in-Docker).

**Product validation runs on configured GitHub Actions workers after the harness
opens the PR. Trusted Rust gates may use ARC; runtime-dependent gates stay
hosted.** Your required local action is host-applied formatting only. Do not run
`task check` / `task ci:pr` before finishing. The harness assigns the PR to the
continuing task owner and posts a direct mention. That owner runs advisory local
review after handoff. The owner may use `task remote` for focused execution,
then runs `task pr:validate`. It stabilizes exact-head Codex review before
dispatching GitHub Actions. A bounded timeout keeps review unavailability from
blocking those checks. It never activates another review provider. Use
repository Task targets; do not replace them with
hand-written `docker run` commands.

## Steps

1. Read `.nook-workbench-plan.md` first. Implement only its `Current PR slice
   and acceptance evidence` scope. Treat the remaining PR sequence as feature
   context, not as authorization to implement later slices. Prefer the
   Workbench issue scope. Do not expand into unrelated refactors.
2. Implement the change end-to-end in the working tree. Match the selected
   team's authorities. Load `.cortex/shared/architecture/system.md` or one
   shared skill only when the task names that cross-team dependency; never scan
   the shared tree by default.
3. **Always run `task format`** (host-applied) before finishing so the harness
   commits a formatted tree. When UI-facing paths change, pass the UI demo
   contract against the base ref when practical.
4. Do not run `task check`, `task ci:pr`, full suites, builds, or e2e in this
   bounded worker. The assigned continuing owner runs focused and complete
   hosted execution after the harness publishes the branch and PR.
5. If part of the request is too large, risky, blocked, or out of scope, follow
   `.cortex/teams/ai/workflows/issues.md` (update/create Workbench Markdown records)
   rather than silently dropping work.
   Before removing work, stop; the continuing owner must preserve it in a
   linked successor and record its inventory in Workbench.
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
  task owner. That owner runs advisory local review on the committed head, then
  stabilizes one exact-head Codex review before dispatching complete validation.
  The owner fixes failures/comments/conflicts, runs the exact-head readiness
  audit, and squash-merges without separate merge authorization.
- Do **not** commit secrets, `.env`, or credentials.
- Keep the diff focused on the requested task.
- Follow `.cortex/teams/ai/workflows/pull-requests.md` (squash merge only) and `.cortex/teams/sre/dynamic-skills/docker-container-harness.md` (never kill Docker daemon).
- Follow `.cortex/teams/sre/dynamic-skills/github-actions-only-validation.md`: format
  locally; product gates run on GitHub Actions.
