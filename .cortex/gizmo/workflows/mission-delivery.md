# Mission Delivery

## Outcome

Gizmo Prime delivers each implementation mission through bounded Team Agents.

Gizmo Prime is the single existing root Gizmo mission owner and owns integrated
and external delivery state. The active harness alone owns worker-attempt
lifecycle. Gizmo Prime never implements the feature or a resulting fix.

For one feature or PR, Gizmo Prime creates one named immutable feature-slice
Gizmo record in the Workbench plan by default. The record groups one semantic
PR slice by stable ID and name, scope, predecessor, estimate, acceptance
evidence, and ownership-unit mappings. It is not a process, agent, worker
attempt, or controller. Additional records exist only for a semantic split when
the feature is expected to exceed or actually grows beyond 2,000 authored
additions plus deletions, or for genuinely independent delivery units. Team
Agent count never determines PR count.

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
   - At or below 2,000 authored changed lines, default to one PR and one record.
     Add records only for a required semantic size split above 2,000 or for
     genuinely independent delivery units. Team Agent count never triggers a
     split.
   - Additional records at or below 2,000 use predecessor-free independent PRs,
     never a stack.
   - Map one feature-slice Gizmo to each semantic PR slice. Do not increase PR
     or Gizmo count merely because multiple Team Agents are required.
   - For multi-PR delivery, persist each slice's canonical Gizmo ID as the
     matching focused issue's `gizmo_id`; later one-PR plans must retain it.
     A trusted assigned ID permits exactly one slice and must appear on every
     ownership unit.
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
4. **Accept implementation handoffs.**
   - Wait for each required dependency or terminal barrier.
   - Verify each commit against its baseline and write scope.
   - Verify the team's focused tests and Cortex evidence.
   - Verify that the team ran required formatters and committed all mutations
     in its allowed source or Cortex paths.
   - Reject incomplete or out-of-scope handoffs.
   - Receive each Team Agent's existing typed handoff directly. Do not add a
     slice-process transport or intermediate agent.
   - Aggregate each verified handoff under its assigned passive Gizmo record.
   - Treat exactly two trusted GitHub Actions publishers as narrow exceptions
     to the ordinary committed-handoff sequence.
   - For `agent-implement.yml`, require trusted host formatting, change-budget
     and branch or PR identity validation, publication, and exact-head handoff.
   - For `rust-dependency-updates.yml` through `task ci-agent:fix`, require the
     exact `CI_AGENT_FIX_PROFILE=rust-dependency-update` profile, a clean exact
     HEAD and index, hard-coded regular Rust dependency mission-file scope,
     unchanged orchestration controls, and streamed dependency-update validation
     without publication credentials remotely inside trusted GitHub Actions
     before publication.
   - Require the dependency-update harness to publish and return the exact head
     to Gizmo after verifying the PR number, base, head ref, and remote head SHA,
     including on existing-PR reruns. Do not treat its remote pre-publication
     validation as a developer-host local gate.
5. **Integrate accepted commits.**
   - Integrate in deterministic dependency order.
   - Bind each downstream task to the exact integrated commit.
   - Keep shared files and integrated or external delivery-state mutations
     serialized under Gizmo.
6. **Prepare the integrated head.**
   - For either accepted trusted publication, continue from its exact published
     head. Do not require a duplicate integration commit.
   - Immediately resume Gizmo ownership of PR, review, and validation work.
   - Do not add advisory local review after the publisher handoff.
   - Use immediate focused remote evidence or complete exact-head validation.
     Hosted Repository policy and PR verification enforce the UI-demo and
     other product or publication contracts.
   - Run `task loom:pre-push` before each push.
   - Gizmo may commit deterministic integration-only state.
   - If pre-push hygiene mutates team-owned source or Cortex content, do not
     author or commit that diff as Gizmo.
   - Return the diff to the responsible team for a fresh formatted commit.
   - Reintegrate that commit and rerun `task loom:pre-push` before pushing.
   - Promptly commit any integration-only state and push the coherent head.
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
   - Admission-authorize a bounded fix task from the current integrated head
     and request its attempt through the active harness.
   - Require a verified coherent fix commit. Remote evidence follows after
     Gizmo integrates and pushes it.
   - Integrate the fix, promptly push, and obtain fresh exact-head remote
     validation for the replacement head.
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
10. **Complete substantial-task self-improvement.**
    - Before final readiness, ask the AI team to complete the
      [self-improvement lifecycle](../../teams/ai/dynamic-skills/self-improvement.md).
    - Integrate the clean committed promotion handoff into the same PR.
    - If promotion changes the head, rerun pre-push hygiene through the owning
      teams, push, and obtain fresh exact-head hosted validation.
    - When promotion changes the head, recollect every required team and
      security verdict that is not explicitly head-stable.
    - When promotion changes the head, issue the final integrated verdict for
      that promoted exact head before readiness. Never carry a stale
      pre-promotion verdict forward.
11. **Finish delivery.**
    - Run the exact-head readiness audit only after required self-improvement.
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
