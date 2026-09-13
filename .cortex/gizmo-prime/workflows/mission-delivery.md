# Mission Delivery

## Outcome

Each feature Gizmo owns one feature branch, parent worktree, and Team Agent
children. Feature delivery ends after remote compilation, required review,
and serialized local dev integration. The manually run dev manager owns
publication, slow PR checks, and main promotion.

Gizmo Prime is the mission/root coordinator. Every team reports through a Team
Gizmo. Team Gizmo receives Prime's high-level packet, decomposes only team
mechanics, dispatches internal Team Agents through the active harness,
synthesizes exact-SHA evidence or blockers, and reports the high-level result
back to Prime. It is not a second Prime and never decides functional
ownership, readiness, promotion, or final delivery.

Follow [dev delivery](../architecture/dev-delivery.md) for the canonical
contract and [team delegation](subagent-delegation.md) for worker ownership.

## Required actions

- Before planning or any delegation, worktree creation, or edit, Gizmo Prime
  runs `git fetch --prune origin`; a fetch failure fails closed.
  Delivery/Dev Manager synchronizes canonical local `main` to the fetched
  `origin/main` and brings canonical local `dev` onto or including that main
  baseline under the dev-delivery workflow. If local dev is not current with
  main, the run fails closed. Prime records `originMainSha` for the exact
  freshly fetched `origin/main`, `pinnedLocalDevSha` for the exact synchronized
  local-dev SHA, and `featureHeadSha` for the exact canonical feature frontier
  in the mission packet and every child handoff. Require the chain
  `originMainSha` ancestor of `pinnedLocalDevSha` ancestor of `featureHeadSha`.
  The initial frontier may equal the pinned local-dev SHA. Prime creates new
  feature branch and worktree strictly from the exact `pinnedLocalDevSha`; no
  alternate base is permitted. An existing canonical feature ref
  and detached implementation HEAD must equal `featureHeadSha` exactly.
  Descendant frontiers are valid for reruns. Team Gizmos and leaves consume all
  three pinned identities. Missing, stale, mismatched, or unprovable evidence
  fails closed.
- Preserve functional ownership and required security verdicts.
- Use the active harness for Team Gizmo and internal Team Agent communication.
- Keep every writer within its issued child worktree and explicit file scope.
- Author meaningful behavior tests for the slow stage.
- Keep Workbench plans, feature handoffs, and completion evidence attributable.
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

## Procedure

1. **Bootstrap a fresh base.**
   - Run `git fetch --prune origin` before planning, delegation, worktree
     creation, or edits; stop closed if it fails.
   - Have Delivery/Dev Manager synchronize canonical local `main` to the
     fetched `origin/main`, then bring canonical local `dev` onto or including
     that main baseline under the dev-delivery workflow. Stop closed if local
     dev is not current with main.
   - Resolve and record `originMainSha` for the exact freshly fetched
     `origin/main` commit and `pinnedLocalDevSha` for the exact synchronized
     local-dev commit.
   - Create or read the canonical feature ref and record its exact
     `featureHeadSha`.
   - Prove `originMainSha` ancestor of `pinnedLocalDevSha` ancestor of
     `featureHeadSha`. Allow equality only between the pinned local-dev and
     initial feature head; allow later feature heads only as descendants for
     reruns.
   - Pin `pinnedLocalDevSha` as the mission's sole feature-work source.
   - Start every feature branch and worktree strictly from the exact
     `pinnedLocalDevSha`; no alternate base is permitted.
   - Require the existing canonical feature ref and detached implementation
     HEAD to equal `featureHeadSha` exactly. Stop closed on missing, stale,
     mismatched, or unprovable evidence.
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
   - Preserve every accepted child commit.
   - Require handoffs listing each iteration SHA, outcome, evidence, and blockers.
   - Have later iterations inspect the last one or two relevant commits and diffs.
6. **Compile and review.**
   - Push the coherent feature branch.
   - Have Delivery Pipeline Team Gizmo route PR Lifecycle Agent's remote
     build-only execution packet for that SHA.
   - Run only `task remote TASK_NAME=build:compile` for feature-stage remote execution.
   - Do not request tests, checks, coverage, e2e, or preflight in that stage.
   - Fast agents review code and required security boundaries.
   - Route fixes to the responsible team and repeat compilation after each push.
7. **Land the completed feature.**
   - Require positive compilation evidence for the final feature SHA.
   - Require resolved review findings and required security acceptance.
   - Authorize Delivery Pipeline Team Gizmo's bounded local-integration packet
     to PR Lifecycle Agent.
   - Tooling serializes the shared local dev checkout and verifies build evidence.
   - Record feature and resulting local dev SHAs.
8. **Hand off to the manager.**
   - The manager selects publication through Delivery Pipeline Team Gizmo's
     packet to PR Lifecycle Agent for snapshot publication.
   - The manager runs the full slow PR cycle.
   - Failure returns to a feature Gizmo through this same procedure.
   - Successful promotion uses the Dev Manager's packet to Delivery Pipeline
     Team Gizmo and PR Lifecycle Agent's guarded fast-forward mechanics.

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
- The handoff records the successful fetch, `originMainSha`,
  `pinnedLocalDevSha`, and `featureHeadSha` for the exact feature source.
- The handoff proves the ordered ancestry chain and exact canonical feature-ref
  equality. Initial equality and descendant reruns are recorded explicitly.
- Dirty changes remained attributed and unrelated changes were preserved.
- Parent integration and shared local dev integration were serialized.
- The feature's final SHA has passing remote build-only evidence.
- Required review and security findings are resolved.
- Tests were authored for execution in the manager's slow stage.
- The accepted feature is present in local dev.
- The handoff names all commits and any remaining blocker.
