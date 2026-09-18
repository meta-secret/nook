# Mission Delivery

## Outcome

Each feature Gizmo owns one feature branch, parent worktree, and Team Agent
children. Feature delivery ends only after required review, remote
`build:compile`, one remote `type:check` result for the same committed head,
serialized local dev integration, and proof that canonical local `dev` contains
the accepted feature commit. The manually run dev manager owns publication,
slow PR checks, and main promotion.

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
  stable committed branch head before every remote dispatch, review, or landing
  operation. If the branch advances, invalidate review, `build:compile`, and
  `type:check` evidence bound to the older head. Resolve the latest head and
  rerun affected evidence. Team Gizmos and leaves keep temporary branches
  private.
- Preserve functional ownership and required security verdicts.
- Use the active harness for Team Gizmo and internal Team Agent communication.
- Keep every writer within its issued child worktree and explicit file scope.
- Author meaningful behavior tests for the slow stage.
- Keep feature-delivery completion evidence in the handoff.
- Update Workbench issue status and progress when its lifecycle changes.
- Complete every feature stage through local dev landing and manager handoff.
- Stop at an intermediate stage only when the user explicitly requests it.
- Report a genuine blocker through the failure procedure below.
- Apply [self-improvement](../../teams/ai/dynamic-skills/self-improvement.md#self-improvement-review)
  only when a durable lesson qualifies.

## Prohibited actions

- Do not perform team-owned implementation as Gizmo.
- Do not treat local checks as routine prerequisites. Remote checks remain
  authoritative and preferred by default.
- Do not run a local check without explicit bounded controller authorization
  for the current operation. This includes local tests, product compilation,
  Docker work, coverage, and preflight.
- Do not infer a precedent or later requirement from a prior one-off local
  authorization. It applies only to that operation.
- Do not run remote tests, coverage, e2e, or preflight in the feature stage.
- Do not request any remote check other than the required `build:compile` and
  `type:check` gates.
- Do not discover or preflight the remote `type:check` selector.
- Do not mock, simulate, or execute remote `type:check` locally.
- Do not use `type:check` as a replacement for the required `build:compile` gate.
- Do not push dev or main from a feature task.
- Do not introduce a Team Agent lifecycle service, scheduler, or Git-state machinery.
- Do not introduce a persistent Delivery Pipeline or PR Lifecycle Agent
  service, scheduler, or notification journal.
- Do not rebase, squash, force-push, or discard another feature's work.
- Do not treat a worker commit or parent integration as feature completion or
  delivery.
- Do not call a feature complete, done, delivered, successful, or an equivalent
  terminal outcome before post-landing containment is verified.
- Do not let a successful check, review, compilation, or integration-command
  result imply feature completion. Name the intermediate stage explicitly.
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
6. **Review, compile, and type-check.**
   - Have Delivery Pipeline Team Gizmo route PR Lifecycle Agent's feature-stage
     remote packet for the canonical branch.
   - PR Lifecycle re-fetches and resolves a stable committed branch head before
     pushing or dispatching.
   - Complete required review for that head.
   - Run remote `task remote TASK_NAME=build:compile` for that head.
   - Without a branch advance, run exactly one remote
     `task remote TASK_NAME=type:check` request for the same unchanged head.
   - Use the natural terminal remote `type:check` result as evidence.
   - Consume `remote-type-check-<run-id>-<attempt>/report.yaml`.
   - Read every raw log named by a `rawLog` field in `report.yaml`.
   - If `type:check` fails, inventory every diagnostic found in `report.yaml` and
     every diagnostic found in its referenced `rawLog` files before repair.
     Group the full inventory by owning team and coherent competence area.
   - Send one consolidated repair packet per competence area. Do not send one
     agent per diagnostic.
   - Integrate the entire repair wave before one new `type:check` request. Do
     not notify, repair, or rerun after an individual diagnostic.
   - A branch advance invalidates older review, `build:compile`, and
     `type:check` evidence. Resolve the latest committed head and repeat the
     affected gates.
   - `task remote TASK_NAME=web:build` remains the branch-authorized focused
     direct-Pod web-build selector, and `task remote TASK_NAME=web:e2e` remains
     the separately authorized focused browser selector. Neither is the
     feature-stage aggregate build-only path or replaces `build:compile` in
     this stage. The exact feature-stage type-safety selector is `type:check`.
   - Do not request remote tests, coverage, e2e, or preflight in that stage.
   - Do not request any remote check other than the required `build:compile` and
     `type:check` gates.
   - Fast agents review code and required security boundaries.
   - Route complete repair waves to the responsible teams before repeating the
     affected remote gates.
7. **Land the accepted feature commit.**
   - Require positive `build:compile` and `type:check` evidence for the current
     branch head.
   - Require resolved review findings and required security acceptance.
   - Authorize Delivery Pipeline Team Gizmo's bounded local-integration packet
     to PR Lifecycle Agent for `dev:land`.
   - Tooling serializes the shared local dev checkout and verifies build evidence.
   - Record observed feature and resulting local dev SHAs.
   - Resolve canonical local `dev` after landing.
   - Verify that the resulting local dev commit contains the accepted feature
     commit with `git merge-base --is-ancestor`.
   - Treat missing or negative containment evidence as an incomplete landing
     stage.
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
- The current branch head has passing remote `build:compile` evidence.
- The same unchanged head has one passing remote `type:check` result.
- The handoff names the `remote-type-check-<run-id>-<attempt>/report.yaml`
  artifact and every raw log named by its `rawLog` fields.
- Required review and security findings are resolved.
- Tests were authored for execution in the manager's slow stage.
- The accepted feature is present in local dev.
- Post-landing ancestry proves that canonical local `dev` contains the accepted
  feature commit.
- The handoff names all commits and any remaining blocker.
- The final report names the actual last completed stage and remaining stages.
- A blocked report includes the concrete observed blocker and supporting evidence.
