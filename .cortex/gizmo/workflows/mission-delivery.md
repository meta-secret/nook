# Mission Delivery

## Outcome

Gizmo delivers each implementation mission through the responsible teams and
one shared-branch sequence.

A Team Agent result, local commit, push, or open pull request is an intermediate
state. Delivery continues to the user-selected terminal condition.

## Required authorities

- Use [team-oriented development](team-oriented-development.md) for functional
  ownership and writer sequencing.
- Use [Team Agent delegation](subagent-delegation.md) for worker scope.
- Use [module-oriented development](module-oriented-development.md) for real
  provider-consumer order.
- Use [pull request delivery](pull-requests.md) for validation and merge.
- Use [PR Steward](../../teams/pr-steward/AGENTS.md) for the authorized external pull-request
  mechanics within that delivery sequence.
- Use [Workbench issue management](issues.md) for plans and worklogs.
- Use the
  [self-improvement review](../../teams/ai/dynamic-skills/self-improvement.md#self-improvement-review)
  only when the work reveals a durable lesson or Cortex defect.

## Terminal condition

Stop before merge only when:

- the user requested an intermediate state;
- the user prohibited the required external action; or
- a concrete blocker prevents further progress.

Report the blocker instead of reporting an intermediate state as complete.

## Procedure

1. **Interpret the mission.**
   - State the requested outcome and completion evidence.
   - Identify explicit exclusions.
   - Treat every other active task as read-only.
2. **Plan the change.**
   - Identify functional owners and real dependencies.
   - Estimate authored additions.
   - Count additions only for the pull-request limit.
   - Do not count or limit deletions.
   - Warn at 1,500 additions and stop before 2,000 additions.
   - Simplify the design when growth approaches the limit.
3. **Assign Team Agent work.**
   - Give each task one team identity.
   - Name allowed files, forbidden files, and acceptance evidence.
   - Assign one writer for shared files.
4. **Sequence writers.**
   - Run only one write-capable Team Agent at a time.
   - Use the current checkout and current branch.
   - Let the Team Agent run focused checks.
   - Ask for a complete scoped commit when useful.
   - Continue directly from that shared-branch state.
5. **Prepare the delivery head.**
   - Verify changed paths and focused evidence.
   - Route formatter or implementation corrections to the owning team.
   - Run `task loom:pre-push PR=<number>` before a push.
   - Push the coherent shared branch as the shared-branch owner.
   - Give PR Steward an explicit packet for pull-request publication.
6. **Validate and repair.**
   - Gizmo may create one mission-scoped PR Steward child with the fixed Luna
     profile and start its subscription for exactly one active pull request.
   - Before this Gizmo advances to another pull request, stop the old child,
     wait for its NATS drain and exit, then start a fresh child for the new PR.
   - Launch the subscriber as the documented direct Bun process in a foreground
     PTY. Stop it by sending Ctrl-C to that same PTY and require exit status zero.
   - Never stop or switch another Gizmo's independently active child.
   - Treat each matching notification as a hint to issue a bounded PR Steward
     operation packet.
   - Authorize PR Steward to trigger the repository-owned exact-head review and
     validation path.
   - Use `task remote TASK_NAME=web:build` for a remote web build.
   - Use `task remote TASK_NAME=web:e2e` for remote browser validation.
   - Route every finding to its functional owner.
   - Sequence the responsible writer in the current checkout.
   - Push the corrected head and obtain fresh exact-head evidence.
7. **Finish delivery.**
   - Tell the reactive PR Steward child to stop and wait for its exit.
   - Re-read the final GitHub state directly. Do this even when every expected
     notification arrived.
   - Authorize PR Steward to run `task pr:ready PR=<number>` and return its
     read-only evidence.
   - Issue a separate merge authorization only after Gizmo's final readiness
     verdict succeeds.
   - Have PR Steward squash-merge and verify remote merge state.
   - Publish the final Workbench update.

## Prohibited complexity

Mission delivery must not introduce:

- Team Agent worktrees;
- parallel Team Agent lifecycle or Git-state machinery; or
- a persistent PR Steward service, scheduler, or notification journal; or
- deletion-report fields or schema versions.

## Fix ownership

- Development core fixes portable Rust and typed WASM behavior.
- Web development fixes TypeScript, Svelte, browser, and extension behavior.
- SRE fixes CI/CD, runners, containers, deployments, and operations.
- Security fixes security-owned policy and reviews security acceptance.
- AI fixes Cortex, Loom, agent skills, and AI automation.
- Gizmo sequences the shared branch and controls external delivery policy and
  authorization. PR Steward performs only the named external pull-request
  mechanics.

## Validation

Delivery is complete only when:

- all requested behavior is implemented by its functional owners;
- only one writer changed the shared checkout at a time;
- the shared branch contains every accepted change;
- repository-owned checks pass on the exact head;
- actionable review findings are resolved;
- any reactive PR Steward child has stopped;
- Gizmo has reconciled final GitHub state directly;
- `task pr:ready PR=<number>` succeeds;
- the pull request is squash-merged; and
- Workbench completion records are published.
