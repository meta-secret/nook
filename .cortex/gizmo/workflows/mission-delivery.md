# Mission Delivery

## Outcome

Gizmo Prime delivers each implementation mission through bounded Team Agents.

Gizmo Prime is the single existing root Gizmo mission owner and owns integrated
and external delivery state. The active harness alone owns worker-attempt
lifecycle. Gizmo Prime never implements the feature or a resulting fix.

For one feature or PR, Gizmo Prime creates one named immutable feature-slice
Gizmo record in the Workbench plan. The record groups the PR by stable ID and
name, scope, estimate, acceptance evidence, and ownership-unit mappings. It is
not a process, agent, worker attempt, or controller. Team Agent count never
determines PR count.

## Required authorities

- Use [team-oriented development](team-oriented-development.md) to assign each
  capability to one functional owner.
- Use [subagent delegation](subagent-delegation.md) for task contracts,
  serialized writers, barriers, and direct commits.
- Use [module-oriented development](module-oriented-development.md) when a
  change crosses registered module boundaries.
- Use [pull request delivery](pull-requests.md) for exact-head validation,
  readiness, and merge policy.
- Use [Workbench issue management](issues.md) for plans, scope, and worklogs.
- Ask the AI team to apply the
  [major architectural initiative rule](../../teams/ai/dynamic-skills/self-improvement.md#user-authority-for-major-architectural-initiatives)
  when a proposed direction is broad, novel, or cross-cutting.

## Terminal condition

An implementation mission continues through the complete delivery procedure.
A worker handoff, local commit, pushed branch, or open pull request is an
intermediate state.

Stop before merge only when:

- the user explicitly limited the request to an intermediate state;
- the user prohibited the required external mutation; or
- a concrete blocker prevents further progress.

Report the exact blocker in the final case. Never report an intermediate state
as completed delivery.

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
   - Limit the planned PR to 2,000 authored changed lines.
   - Keep one PR and one record. Team Agent count never triggers another PR.
   - Do not split or rebuild the PR when it grows.
   - Review fixes may grow the existing PR beyond 2,000 lines.
   - Stop immediately if the PR reaches 3,000 authored changed lines.
   - Apply the reporting contract in
     [pull requests](pull-requests.md#review-growth-stop).
   - A trusted assigned Gizmo ID permits exactly one PR record and must appear
     on every ownership unit.
   - Record the module DAG and provider-consumer contracts when applicable.
3. **Assign team tasks.**
   - Name one functional owner for each capability.
   - Name an expertise provider only for declared foreign-team files.
   - Select one team identity under the root worker contract.
   - Apply the root [team worker contract](../../AGENTS.md#team-worker-contract).
   - Apply [subagent delegation](subagent-delegation.md) for operational worker
     rules.
   - Let Loom/Nook compute eligible candidates, conflicts, capacity, leases,
     and exact frontier data.
   - Validate the computed batch, select and admission-authorize ready task
     records, freeze their exact starting frontiers, and supply their contracts
     to the active harness with the trusted focused-issue Gizmo ID in plan/task
     context when one is assigned.
4. **Accept implementation results.**
   - Wait for each required dependency or terminal barrier.
   - Verify each commit against its baseline and write scope.
   - Verify the team's focused tests and Cortex evidence.
   - Verify that the team ran required formatters and committed all mutations
     in its allowed source or Cortex paths.
   - Reject incomplete or out-of-scope handoffs.
   - Receive each Team Agent's result directly. Do not add a slice-process
     transport or intermediate agent.
   - Aggregate each verified result under its assigned passive Gizmo record.
   - Treat exactly two trusted GitHub Actions publishers as narrow exceptions
     to the ordinary committed-handoff sequence:
     `agent-implement.yml` and `rust-dependency-updates.yml` through
     `task ci-agent:fix` with `CI_AGENT_FIX_PROFILE=rust-dependency-update`.
     Follow the root [team worker contract](../../AGENTS.md#team-worker-contract)
     for their isolation, publication, and exact-head verification rules.
5. **Continue from accepted commits.**
   - Run write-capable Team Agents sequentially in deterministic dependency
     order on the current shared branch.
   - Continue directly from each accepted Team Agent commit.
   - Bind each downstream task to that exact commit.
   - Keep shared files and external delivery-state mutations serialized under
     Gizmo.
6. **Prepare the delivery head.**
   - Continue from the exact accepted or published head.
   - Do not create another commit for the same accepted change.
   - Immediately resume Gizmo ownership of PR, review, and validation work.
   - Do not add advisory local review after the publisher handoff.
   - Use immediate focused remote evidence or complete exact-head validation.
     Hosted Repository policy and PR verification enforce the UI-demo and
     other product or publication contracts.
   - Run `task loom:pre-push PR=<number>` before each review-fix push.
   - Gizmo may commit only parent-owned delivery state.
   - If pre-push hygiene mutates team-owned source or Cortex content, do not
     author or commit that diff as Gizmo.
   - Return the diff to the responsible team for a fresh formatted commit.
   - Continue from that commit and rerun `task loom:pre-push PR=<number>` before
     pushing a review fix.
   - Promptly commit any parent-owned delivery state and push the coherent head.
   - Do not add broad local builds, tests, e2e, container product gates, local
     review, or duplicate hosted-check mirrors before the push.
   - Immediately choose remote evidence for every pushed coherent head.
   - If the head is not ready for complete validation, dispatch at least one
     relevant focused `task remote TASK_NAME=<name>` job.
   - Use `task remote TASK_NAME=web:build` for focused build-only web evidence.
   - Use `task remote TASK_NAME=web:e2e` separately for direct-Pod browser
     proof. Never batch the build and browser tasks together.
   - After focused evidence returns, reassess whether the head is
     validation-ready. Do not flow unconditionally into complete validation.
   - If the head is validation-ready, dispatch complete exact-head validation
     immediately. Focused tasks are optional on that path.
7. **Validate and repair through teams.**
   - Trigger the repository-owned exact-head review and validation path.
   - Route each review or CI finding to its functional owner.
   - Admission-authorize a bounded fix task from the current delivery head
     and request its attempt through the active harness.
   - Require a verified coherent fix commit. Remote evidence follows after
     Gizmo continues from and pushes it.
   - Promptly push the fix commit and obtain fresh exact-head remote
     validation for the replacement head.
   - Gizmo must not edit the implementation to resolve a finding.
8. **Collect required verdicts.**
   - Require a verdict from every team whose acceptance is mandatory.
   - Require security's verdict for security architecture, cryptographic
     policy, trust boundaries, or security acceptance.
   - Treat every verdict as exact-head evidence unless it is explicitly
     head-stable.
9. **Issue the delivery verdict.**
   - Mark the PR ready only when all required evidence is satisfied.
   - Keep the PR blocked while any required team verdict is blocking.
   - Keep the PR blocked while a required security verdict is blocking.
   - Never waive or override either block.
10. **Promote durable discoveries when justified.**
    - Apply the
      [self-improvement review](../../teams/ai/dynamic-skills/self-improvement.md#self-improvement-review)
      only when the work revealed a durable lesson or Cortex defect.
    - No Cortex update is required when no candidate qualifies.
    - When a promotion is justified, continue from its clean commit in the same
      PR.
    - If promotion changes the head, rerun pre-push hygiene through the owning
      teams, push, and obtain fresh exact-head hosted validation.
    - When promotion changes the head, recollect every required team and
      security verdict that is not explicitly head-stable.
    - When promotion changes the head, issue the final delivery verdict for
      that promoted exact head before readiness. Never carry a stale
      pre-promotion verdict forward.
11. **Finish delivery.**
    - Run the exact-head readiness audit after any justified promotion.
    - Squash-merge when readiness succeeds.
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
- Gizmo continues from accepted fixes and controls delivery state.

Gizmo reports a blocker when the required team cannot act. It does not take
over the implementation.

## Review verdict

Gizmo owns the final exact-head PR verdict.

- A ready verdict names the exact delivery head.
- A ready verdict cites the required team evidence.
- A blocking team verdict can be cleared only by that team.
- A blocking security verdict can be cleared only by security.
- Gizmo may add a delivery block.
- Gizmo cannot remove an unresolved required block.

## Validation

Delivery is complete only when:

- all requested behavior is implemented by its responsible teams;
- every accepted direct commit is verified and becomes delivery state;
- repository-owned checks pass on the exact head;
- actionable review threads are resolved;
- all required team and security verdicts are satisfied;
- `task pr:ready PR=<number>` succeeds; and
- the pull request is squash-merged and remote state confirms the merge; and
- Workbench completion records are published.
