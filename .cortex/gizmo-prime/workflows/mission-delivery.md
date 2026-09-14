# Mission Delivery

## Outcome

Each feature Gizmo owns one feature branch, parent worktree, and Team Agent
children. Feature delivery ends after remote compilation, required review,
and serialized local dev integration. The manually run dev manager owns
publication, slow PR checks, and main promotion.

Gizmo Prime is the mission/root coordinator. Every team reports through a Team
Gizmo. Team Gizmo receives Prime's high-level packet, decomposes only team
mechanics, dispatches internal Team Agents through the active harness,
synthesizes branch/head evidence or blockers, and reports the high-level result
  back to Prime. It is not a second Prime and never decides functional
ownership, readiness, promotion, or final delivery.

Follow [dev delivery](../architecture/dev-delivery.md) for the canonical
contract and [team delegation](subagent-delegation.md) for worker ownership.

## Required actions

- Before planning or any delegation, worktree creation, or edit, Gizmo Prime
  runs `git fetch --prune origin`; a fetch failure fails closed.
  Delivery/Dev Manager synchronizes canonical local `main` to the fetched
  `origin/main` and brings canonical local `dev` onto or including that main
  baseline under the dev-delivery workflow. If either synchronization cannot
  be proved, the run fails closed. Only after both synchronizations, Prime
  resolves the latest committed `refs/heads/dev^{commit}`. It records that
  exact post-synchronization commit as `pinnedLocalDevSha` for bootstrap
  evidence. Every new feature mission, feature branch, and worktree must use
  that exact latest committed canonical local `dev` commit as its base. A
  previously pinned or otherwise older local-dev SHA, `origin/dev`,
  `origin/main`, or another alternate base is invalid. If equality between
  `pinnedLocalDevSha` and the post-synchronization `refs/heads/dev` cannot be
  proved, the run fails closed. The base is preserved after feature creation.
  Prime authorizes the canonical feature branch name, which is the workflow
  authority. Observed base and head SHAs are evidence only and are not
  required packet fields. Delivery re-fetches and resolves the latest
  committed branch head before every remote dispatch, review, or landing
  operation. If the branch advances, follow the latest head and rerun
  affected evidence. Team Gizmos and leaves keep temporary branches private.
- Preserve functional ownership and required security verdicts.
- Use the active harness for Team Gizmo and internal Team Agent communication.
- Keep every writer within its issued child worktree and explicit file scope.
- Author meaningful behavior tests for the slow stage.
- Keep Workbench plans, feature handoffs, and completion evidence attributable.
- Complete every feature stage through local dev landing and manager handoff.
- Stop at an intermediate stage only when the user explicitly requests it.
- Report a genuine blocker through the failure procedure below.
- Apply [self-improvement](../../teams/ai/dynamic-skills/self-improvement.md#self-improvement-review)
  only when a durable lesson qualifies.

## Prohibited actions

- Do not perform team-owned implementation as Gizmo.
- Do not execute local tests, including Loom tests.
- Do not run local product compilation, Docker work, coverage, or preflight.
- Do not run tests, checks, coverage, e2e, or preflight remotely in the feature stage.
- Do not push dev or main from a feature task.
- Do not introduce a Team Agent lifecycle service, scheduler, or Git-state machinery.
- Do not introduce a persistent Delivery Pipeline or PR Lifecycle Agent
  service, scheduler, or notification journal.
- Do not rebase, squash, force-push, or discard another feature's work.
- Do not treat a worker commit or parent integration as completed feature delivery.
- Do not skip a required stage because a separately named tool was not found.

## Procedure

1. **Bootstrap a fresh base.**
   - Run `git fetch --prune origin` before planning, delegation, worktree
     creation, or edits; fail closed if it fails.
   - Have Delivery/Dev Manager synchronize canonical local `main` to the
     fetched `origin/main`, then bring canonical local `dev` onto or including
     that main baseline under the dev-delivery workflow. If either
     synchronization cannot be proved, fail closed.
   - Resolve `refs/heads/dev^{commit}` after both synchronizations complete.
     This is the latest committed canonical local `dev` commit.
   - Record that exact post-synchronization commit as `pinnedLocalDevSha` for
     bootstrap evidence. A previously pinned or otherwise older local-dev SHA
     is invalid. Fail closed when equality with `refs/heads/dev` cannot be
     proved.
   - Create every new feature branch and worktree from that exact commit.
     Preserve the base for the life of the feature.
   - Record any base or branch-head SHA only as observational evidence.
   - Use the canonical branch name as the mission's feature-work authority.
     Do not require a head SHA in the packet.
2. **Interpret and scope the feature.**
   - Identify functional owners and required acceptance evidence.
   - Treat every other active task as read-only.
   - Record the explicit parent feature/integration worktree.
   - Give every child a bounded task/attempt identity.
3. **Prepare the write wave.**
   - Inventory dirty paths and hunks and attribute each to its owner.
   - Block overlap with user or foreign changes without an exact handoff.
   - Name command read, write, and output scopes.
   - Require disjoint scopes for concurrent writers.
   - Preserve dependency order for overlapping or provider-dependent tasks.
4. **Dispatch implementation.**
   - Create one child worktree per Team Agent task from the parent frontier.
   - Start workers through the active harness in their issued child worktrees.
   - Permit only scoped rustfmt and bounded inexpensive TS diagnostics locally.
   - Require authored tests without executing them.
   - Grant one commit turn at a time within the feature's integration sequence.
   - Require each writer's complete scoped iteration commit.
5. **Integrate child results.**
   - Verify each committed handoff before parent integration.
   - Serialize mutations of the parent feature index.
   - Preserve every accepted child change through the ordinary Git integration
     rules in [team delegation](subagent-delegation.md).
   - Parent feature integration is distinct from shared local dev landing.
   - Require handoffs listing each iteration SHA, outcome, evidence, and blockers.
   - Have later iterations inspect the last one or two relevant commits and diffs.
6. **Compile and review.**
   - Have Delivery Pipeline Team Gizmo route PR Lifecycle Agent's remote
     build-only execution packet for the canonical branch.
   - PR Lifecycle re-fetches and resolves the latest committed branch head
     before pushing or dispatching. A branch advance follows the latest head
     and reruns compilation or review as needed.
   - Run only `task remote TASK_NAME=build:compile` for feature-stage remote execution.
   - `task remote TASK_NAME=web:build` remains the branch-authorized focused
     direct-Pod web-build selector, and `task remote TASK_NAME=web:e2e` remains
     the separately authorized focused browser selector. Neither is the
     feature-stage aggregate build-only path or replaces `build:compile` in
     this stage.
   - Do not request tests, checks, coverage, e2e, or preflight in that stage.
   - Fast agents review code and required security boundaries.
   - Route fixes to the responsible team and repeat compilation after each push.
7. **Land the completed feature.**
   - Require positive compilation evidence for the current branch head.
   - Require resolved review findings and required security acceptance.
   - Authorize Delivery Pipeline Team Gizmo's bounded local-integration packet
     to PR Lifecycle Agent for `dev:land`.
   - Tooling serializes the shared local dev checkout and verifies build evidence.
   - Record observed feature and resulting local dev SHAs.
8. **Hand off to the manager.**
   - Name the canonical branch and observed feature and local dev SHAs.
   - Identify the manager-owned stages that remain.
   - The manager selects publication through Delivery Pipeline Team Gizmo's
     packet to PR Lifecycle Agent for snapshot publication.
   - The manager runs the full slow PR cycle.
   - Failure returns to a feature Gizmo through this same procedure.
   - Successful promotion uses the Dev Manager's packet to Delivery Pipeline
     Team Gizmo and PR Lifecycle Agent's guarded fast-forward mechanics.

## Failure handling

Before reporting that a required capability is unavailable:

1. Identify the incomplete stage, owning actor, and required operation.
2. Read the relevant canonical delivery authority and its named runtime entrypoint.
   - Inspect bounded Task definitions or implementation evidence as needed.
   - Route restricted evidence collection through its authorized owner.
   - An absent tool name or empty search result does not establish absence.
3. Use the existing authorized canonical path when it provides the operation.
   - Ordinary parent Git integration does not require a separate module tool.
   - Preserve ownership, security boundaries, and required checks.
4. Report a concrete blocker when capability remains unavailable or execution fails.
   - Name the observed failure and the evidence examined.
   - Identify the last completed stage and the next incomplete stage.
   - State the missing authority, capability, or external condition.
   - Do not invent a fallback or bypass the required operation.

A blocked feature remains incomplete. Its final report must state that outcome
rather than present authored or committed changes as successful delivery.

## Fix ownership

- Development core owns portable Rust and typed WASM fixes.
- Web development owns presentation and browser behavior.
- Security owns its policy and acceptance verdicts.
- SRE owns CI, containers, infrastructure, and delivery tooling.
- AI owns Cortex, Loom, and agent contracts.
- Gizmo retains parent-owned integration/PR policy for its feature.
- The dev manager retains slow-stage publication and promotion policy.

## Completion evidence

- Every worker used its issued child worktree and bounded scope.
- The handoff records the successful fetch and any observed base or branch-head
  SHAs as evidence associated with the current branch state.
- The handoff names the canonical branch and records the latest-head operation.
  A branch advance is followed or rerun rather than rejected as stale.
- Dirty changes remained attributed and unrelated changes were preserved.
- Parent integration and shared local dev integration were serialized.
- The current branch head has passing remote build-only evidence.
- Required review and security findings are resolved.
- Tests were authored for execution in the manager's slow stage.
- The accepted feature is present in local dev.
- The handoff names all commits and any remaining blocker.
- The final report names the actual last completed stage and remaining stages.
- A blocked report includes the concrete observed blocker and supporting evidence.
