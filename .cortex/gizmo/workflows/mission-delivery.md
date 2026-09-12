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
   - When necessary scope still cannot fit, define independently useful
     sequential PR slices.
   - Give every slice observable acceptance evidence.
3. **Assign Team Agent work.**
   - Give each task one team identity.
   - Name allowed files, forbidden files, and acceptance evidence.
   - Name acceptance command read, write, and output scopes.
   - Assign one writer for shared files.
   - Treat shared generated and output paths as shared files.
   - Inventory and attribute existing dirty paths and hunks.
   - Block scope overlap with user or foreign changes without an exact handoff
     or same-task attribution.
4. **Run write waves.**
   - Group dependency-ready tasks only when their explicit file scopes are
     disjoint.
   - Require concurrency-safe acceptance command scopes.
   - Run those Team Agents in parallel in the current checkout and branch.
   - Preserve dependency order for overlapping or provider-dependent tasks.
   - Let every Team Agent run concurrency-safe focused checks.
   - Grant one commit turn at a time.
   - Require every writer to commit its complete scoped iteration.
   - Run deferred checks serially after the wave has a stable committed head.
   - Require the terminal handoff to enumerate every iteration commit.
   - Have later iterations read the last one or two relevant commits and diffs.
   - Continue directly from the resulting shared-branch state.
5. **Prepare the delivery head.**
   - Verify changed paths and focused evidence.
   - Co-validate named provider and consumer interface evidence.
   - Use only locally permitted checks or hosted evidence for co-validation.
   - Route formatter or implementation corrections to the owning team.
   - Run `task loom:pre-push PR=<number>` before a push.
   - Push the coherent shared branch as the shared-branch owner.
   - Give PR Steward an explicit packet for pull-request publication.
6. **Validate and repair.**
   - Gizmo creates a fresh PR Steward child with the fixed Luna profile for
     each check-observation iteration on one PR.
   - Wait for the child's result, NATS drain, and exit before the next iteration.
   - Have PR Steward launch the documented direct Bun subscriber in a foreground
     PTY. For an explicit stop, direct PR Steward to send Ctrl-C there.
     Require exit status zero.
   - Never stop or switch another Gizmo's independently active child.
   - Route compact review/comment hints by path and line; never transfer bodies through the reactive stream.
   - Treat each matching notification as a hint to issue a bounded PR Steward
     operation packet.
   - Authorize PR Steward to trigger the repository-owned exact-head review and
     validation path.
   - Have PR Steward use `task remote TASK_NAME=web:build` for a remote web build.
   - Have PR Steward use `task remote TASK_NAME=web:e2e` for remote browser validation.
   - Route every finding to its functional owner.
   - Assign the responsible provider, consumer, or both in the current
     checkout.
   - Run disjoint, dependency-ready repair scopes in parallel.
   - Push the corrected head and obtain fresh exact-head evidence.
7. **Finish delivery.**
   - Tell the reactive PR Steward child to stop and wait for its exit.
   - Authorize PR Steward to re-read final GitHub state and return evidence.
     Require this even when every expected notification arrived.
   - Authorize PR Steward to run `task pr:ready PR=<number>` and return its
     read-only evidence.
   - Issue a separate merge authorization only after Gizmo's final readiness
     verdict succeeds.
   - Have PR Steward squash-merge and verify remote merge state.
   - Authorize PR Steward to publish the exact final Workbench update.
   - If another planned slice remains, fetch current `origin/main`.
   - Create the next branch only after the current slice is remotely verified
     and closed out.
   - Begin only that next slice.

## Prohibited complexity

Mission delivery must not introduce:

- Team Agent worktrees;
- a Team Agent lifecycle service, scheduler, or Git-state machinery; or
- a persistent PR Steward service, scheduler, or notification journal; or
- deletion-report fields or schema versions.
- stacked branches, stacked pull requests, or implementation against an
  unmerged predecessor.

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

- all requested behavior is implemented by its functional owners across every
  planned slice;
- concurrent writers had disjoint explicit file scopes;
- overlapping and dependent tasks ran in order;
- dirty paths and hunks were attributed before dispatch;
- no commit included unrelated pre-existing changes;
- acceptance commands were concurrency-safe or ran serially on a stable
  committed head;
- only one writer mutated the Git index or committed at a time;
- every writer committed its complete scoped iteration;
- terminal handoffs enumerated every iteration SHA, outcome, evidence, and
  unresolved blockers;
- provider-consumer evidence passed on the combined branch;
- the shared branch contains every accepted change;
- repository-owned checks pass on the exact head;
- actionable review findings are resolved;
- any reactive PR Steward child has stopped;
- Gizmo has reconciled final GitHub evidence returned by PR Steward;
- `task pr:ready PR=<number>` succeeds;
- every pull request is squash-merged;
- every remote merge is verified; and
- Workbench completion records are published for every slice.

## Reactive observation completion

- Start a fresh PR Steward child for each check-observation iteration.
- The child subscribes before its initial snapshot and freezes that head.
- Current-head check events trigger completion snapshots.
- More than five minutes of event inactivity permits a silent completion query.
- Incomplete checks keep the child subscribed. Completed checks end the iteration,
  including failed conclusions. The child drains and returns one result.
- PR closure stops the child with a distinct outcome, not check completion.
- Gizmo acts on the result before starting another iteration.
- Gizmo reconciles final evidence returned by PR Steward.
- Gizmo retains the mission completion verdict.
