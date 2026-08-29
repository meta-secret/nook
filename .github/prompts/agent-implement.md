You are implementing a task for the Nook monorepo via the **coding-bro** workflow.

## Task

${AGENT_TASK}

## Trusted validated plan

The following exact plan was validated and hash-bound by trusted workflow
tooling. It is authoritative even if a workspace file is later changed.

${VALIDATED_PLAN}

## Context

- Repository: ${GITHUB_REPOSITORY}
- Workflow run id: ${GITHUB_RUN_ID}
- Implementation branch (harness commits here — do not git): `${AGENT_BRANCH}`
- The planning phase has already published the task-start record and left its
  validated body in `.nook-workbench-plan.md`.

Read `.cortex/AGENTS.md` and `.cortex/knowledge-graph.md`. Select one functional
owner, then load only that team's `AGENTS.md`, knowledge graph, and exact
task-relevant documents. If the validated plan names an expertise provider,
give that worker only the explicit expertise contract, its own team graph, and
the named consumer interfaces. Do not preload the functional owner's graph or
transfer capability semantics and consumer-team Cortex ownership. The delivery
owner follows
`.cortex/gizmo/workflows/mission-delivery.md` without passing unrelated Gizmo context
to a team worker.

The validated plan selects one semantic team identity. Apply the root
`.cortex/AGENTS.md` team worker contract and
`.cortex/gizmo/workflows/subagent-delegation.md`. Use
`.cortex/gizmo/workflows/team-oriented-development.md` for team-specific
routing.

When a selected team authority links a foreign-team skill as required
engineering policy, load that skill read-only. The functional owner may apply
it directly; this alone does not require an expertise provider.

## Execution environment

The bounded editor has no repository credentials, network access, container
runtime, or Task runner. Trusted host tooling formats and publishes the result
only after the sandboxed editor exits.

**Product validation runs on configured GitHub Actions workers after the harness
opens the PR. Trusted Rust gates may use ARC; runtime-dependent gates stay
hosted.** Your required local action is host-applied formatting only. Do not run
`task check` / `task ci:pr` before finishing. The harness returns the PR to Gizmo
and posts a direct mention. Gizmo runs advisory local review after handoff. It
may use `task remote` for focused execution, then runs `task pr:validate`. Gizmo
stabilizes exact-head Codex review before dispatching GitHub Actions. A bounded
timeout keeps review unavailability from blocking those checks. Gizmo never
activates another review provider. This bounded worker must not invoke Task or
a container runtime.

## Steps

1. Read `.nook-workbench-plan.md` first. Implement only its `Current PR slice
   and acceptance evidence` scope. Treat the remaining PR sequence as feature
   context, not as authorization to implement later slices. Prefer the
   Workbench issue scope. Do not expand into unrelated refactors.
2. Implement the change end-to-end in the working tree. Match the selected
   team's authorities. Load `.cortex/shared/architecture/system.md` or one
   shared skill only when the task names that cross-team dependency; never scan
   the shared tree by default.
3. Do not run formatting, Task commands, full suites, builds, or e2e in this
   bounded worker. The trusted harness applies the deterministic repository
   formatter after the editor exits. Gizmo runs focused and complete hosted
   execution after the harness publishes the branch and PR.
5. If part of the request is too large, risky, blocked, or out of scope, follow
   `.cortex/gizmo/workflows/issues.md` (update/create Workbench Markdown records)
   rather than silently dropping work.
   Before removing work, stop; Gizmo must preserve it in a
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
  opens the PR after you finish and returns it to Gizmo. Gizmo runs advisory
  local review on the committed head, then stabilizes one exact-head Codex
  review before complete validation. For failures, comments, or conflicts,
  Gizmo dispatches scoped fixes to the responsible team agents and integrates
  their verified handoffs. Gizmo runs exact-head readiness and squash-merges
  without separate merge authorization.
- Do **not** commit secrets, `.env`, or credentials.
- Keep the diff focused on the requested task.
- Stay in the harness-provided isolated workspace. Return the work to the
  parent through the harness commit handoff.
- Follow `.cortex/gizmo/workflows/pull-requests.md` (squash merge only) and
  `.cortex/teams/sre/workflows/ci-operations.md` (this Kubernetes-native worker
  must not invoke a container runtime).
- Follow `.cortex/teams/sre/dynamic-skills/github-actions-only-validation.md`: format
  locally; product gates run on GitHub Actions.
