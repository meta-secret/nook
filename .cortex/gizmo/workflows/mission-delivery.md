# Mission Delivery

## Outcome

Gizmo delivers each implementation mission through bounded team subagents.

Gizmo owns integration and lifecycle state. Gizmo never implements the feature
or a resulting fix.

## Required authorities

- Use [team-oriented development](team-oriented-development.md) to assign each
  capability to one functional owner.
- Use [subagent delegation](subagent-delegation.md) for task contracts,
  isolated writers, barriers, and commit handoffs.
- Use [module-oriented development](module-oriented-development.md) when a
  change crosses registered module boundaries.
- Use [pull request delivery](pull-requests.md) for exact-head validation,
  readiness, and merge policy.
- Use [Workbench issue management](issues.md) for plans, scope, worklogs, and
  multi-PR sequences.
- Ask the AI team to apply the
  [major architectural initiative rule](../../teams/ai/dynamic-skills/self-improvement.md#user-authority-for-major-architectural-initiatives)
  when a proposed direction is broad, novel, or cross-cutting.

## Mission procedure

1. **Interpret the mission.**
   - State the requested outcome in public-safe language.
   - Identify completion evidence and explicit exclusions.
   - Fetch the required baseline.
   - A team subagent may mutate only:
     - the current task's owned feature and focused issue set.
   - Treat every other active task as read-only.
   - Require an explicit handoff first when ownership must change.
   - Do not copy the raw prompt or chat transcript.
2. **Plan delivery.**
   - Publish the Workbench task plan before implementation edits.
   - Estimate authored changed lines.
   - Split work that exceeds the current PR size boundary.
   - Record the module DAG and provider-consumer contracts when applicable.
3. **Assign team tasks.**
   - Name one functional owner for each capability.
   - Name an expertise provider only for declared foreign-team files.
   - Give each subagent an exact baseline, allowed writes, forbidden writes,
     dependencies, and acceptance evidence.
   - Give each subagent only its team contract and knowledge graph.
   - Run every native subagent with Gizmo's exact model.
4. **Accept implementation handoffs.**
   - Wait for each required dependency or terminal barrier.
   - Verify each commit against its baseline and write scope.
   - Verify the team's focused tests and Cortex evidence.
   - Reject incomplete or out-of-scope handoffs.
5. **Integrate accepted commits.**
   - Integrate in deterministic dependency order.
   - Bind each downstream task to the exact integrated commit.
   - Keep shared files and lifecycle mutations serialized under Gizmo.
6. **Prepare the integrated head.**
   - Run `task loom:pre-push` before each push.
   - Commit and push the coherent integrated change.
   - Run the required advisory review before the first owner-authored push.
   - Use `task remote TASK_NAME=web:build` for focused web build evidence.
   - Use `task remote TASK_NAME=web:e2e` for focused browser evidence.
   - Dispatch each focused command separately.
7. **Validate and repair through teams.**
   - Trigger the repository-owned exact-head review and validation path.
   - Route each review or CI finding to its functional owner.
   - Dispatch a bounded fix task from the current integrated head.
   - Require a verified fix commit and focused evidence.
   - Integrate the fix, push, and validate the replacement head.
   - Gizmo must not edit the implementation to resolve a finding.
8. **Collect required verdicts.**
   - Require a verdict from every team whose acceptance is mandatory.
   - Require security's verdict for security architecture, cryptographic
     policy, trust boundaries, or security acceptance.
   - Treat every verdict as exact-head evidence unless it is explicitly
     head-stable.
9. **Issue the integrated verdict.**
   - Mark the PR ready only when all required evidence is satisfied.
   - Keep the PR blocked while any required team verdict is blocking.
   - Keep the PR blocked while a required security verdict is blocking.
   - Never waive or override either block.
10. **Finish delivery.**
    - Run the exact-head readiness audit.
    - Squash-merge when readiness succeeds.
    - Ask the AI team to complete the
      [self-improvement lifecycle](../../teams/ai/dynamic-skills/self-improvement.md).
    - Publish the Workbench issue update, linked worklog, and
      [agent statistics](agent-statistics.md).
    - Report duration and any authorized remaining work.

## Fix ownership

Every finding returns to the team that owns the behavior.

- Development core fixes portable Rust, security-control implementation,
  storage, and typed WASM contracts.
- Web development fixes TypeScript, Svelte, browser, and extension behavior.
- SRE fixes CI/CD, runners, containers, deployments, and operations.
- Security fixes security-owned policy and reviews security acceptance.
- AI fixes Cortex, Loom, agent skills, expert registries, and AI automation.
- Gizmo integrates accepted fixes and controls delivery state.

Gizmo reports a blocker when the required team cannot act. It does not take
over the implementation.

## Review verdict

Gizmo owns the final integrated PR verdict.

- A ready verdict names the exact integrated head.
- A ready verdict cites the required team evidence.
- A blocking team verdict can be cleared only by that team.
- A blocking security verdict can be cleared only by security.
- Gizmo may add an integration block.
- Gizmo cannot remove an unresolved required block.

## Validation

Delivery is complete only when:

- all requested behavior is implemented by its responsible teams;
- every accepted handoff is verified and integrated;
- repository-owned checks pass on the exact head;
- actionable review threads are resolved;
- all required team and security verdicts are satisfied;
- `task pr:ready PR=<number>` succeeds; and
- Workbench completion records are published.
