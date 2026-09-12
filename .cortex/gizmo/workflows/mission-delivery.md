# Mission Delivery

## Outcome

Each feature Gizmo owns one feature branch, parent worktree, and Team Agent
children. Feature delivery ends after remote compilation, required review,
and serialized local dev integration. The manually run dev manager owns
publication, slow PR checks, and main promotion.

Follow [dev delivery](../architecture/dev-delivery.md) for the canonical
contract and [team delegation](subagent-delegation.md) for worker ownership.

## Required actions

- Preserve functional ownership and required security verdicts.
- Use the active harness for Team Agent communication.
- Keep every writer within its issued child worktree and explicit file scope.
- Author meaningful behavior tests for the slow stage.
- Keep Workbench plans, feature handoffs, and completion evidence attributable.
- Apply [self-improvement](../../teams/ai/dynamic-skills/self-improvement.md#self-improvement-review)
  only when a durable lesson qualifies.

## Prohibited actions

- Do not perform team-owned implementation as Gizmo.
- Do not execute local tests, including Loom tests.
- Do not run local product compilation, Docker work, coverage, or preflight.
- Do not run tests, coverage, e2e, or preflight remotely in the feature stage.
- Do not push dev or main from a feature task.
- Do not introduce a Team Agent lifecycle service, scheduler, or Git-state machinery.
- Do not introduce a persistent PR Steward service, scheduler, or notification journal.
- Do not rebase, squash, force-push, or discard another feature's work.

## Procedure

1. **Interpret and scope the feature.**
   - Identify functional owners and required acceptance evidence.
   - Treat every other active task as read-only.
   - Record the explicit parent feature/integration worktree.
   - Give every child a bounded task/attempt identity.
2. **Prepare the write wave.**
   - Inventory dirty paths and hunks and attribute each to its owner.
   - Block overlap with user or foreign changes without an exact handoff.
   - Name command read, write, and output scopes.
   - Require disjoint scopes for concurrent writers.
   - Preserve dependency order for overlapping or provider-dependent tasks.
3. **Dispatch implementation.**
   - Create one child worktree per Team Agent task from the parent frontier.
   - Start workers through the active harness in their issued child worktrees.
   - Permit only scoped rustfmt and bounded inexpensive TS diagnostics locally.
   - Require authored tests without executing them.
   - Grant one commit turn at a time within the feature's integration sequence.
   - Require each writer's complete scoped iteration commit.
4. **Integrate child results.**
   - Verify each committed handoff before parent integration.
   - Serialize mutations of the parent feature index.
   - Preserve every accepted child commit.
   - Require handoffs listing each iteration SHA, outcome, evidence, and blockers.
   - Have later iterations inspect the last one or two relevant commits and diffs.
5. **Compile and review.**
   - Push the coherent feature branch.
   - Authorize PR Steward to run remote build-only execution for that SHA.
   - For web changes, use `task remote TASK_NAME=web:build` and
     `task remote TASK_NAME=web:e2e` as applicable.
   - Fast agents review code and required security boundaries.
   - Route fixes to the responsible team and repeat compilation after each push.
6. **Land the completed feature.**
   - Require positive compilation evidence for the final feature SHA.
   - Require resolved review findings and required security acceptance.
   - Authorize Steward's bounded local integration.
   - Tooling serializes the shared local dev checkout and verifies build evidence.
   - Record feature and resulting local dev SHAs.
7. **Hand off to the manager.**
   - The manager selects publication through Steward's snapshot publication.
   - The manager runs the full slow PR cycle.
   - Failure returns to a feature Gizmo through this same procedure.
   - Successful promotion uses Steward's guarded fast-forward promotion.

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
- Dirty changes remained attributed and unrelated changes were preserved.
- Parent integration and shared local dev integration were serialized.
- The feature's final SHA has passing remote build-only evidence.
- Required review and security findings are resolved.
- Tests were authored for execution in the manager's slow stage.
- The accepted feature is present in local dev.
- The handoff names all commits and any remaining blocker.
