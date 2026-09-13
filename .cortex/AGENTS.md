# Nook Agent Routing Contract

This file is the repository entry point. It selects one owning context and
states only boundaries that apply everywhere. Detailed delivery and delegation
rules belong to Gizmo's linked authorities.

## Mandatory context selection

1. Read the [root context router](knowledge-graph.md).
2. Classify the work as feature Gizmo control, dev-manager control, PR Steward operations, AI,
   development core, security, SRE, web development, or shared ownership.
3. Load exactly one owning `AGENTS.md` and knowledge graph.
4. Open only the documents and headings needed for the assigned work.
5. Stop loading Cortex when the task can be executed safely.

Do not preload all graphs, a whole team corpus, or foreign-team material for
background context. A selected team authority may link a task-relevant
foreign-team skill as read-only engineering policy. A foreign-team writer
requires an explicit expertise task from Gizmo Prime.

## Mandatory delivery architecture

Before acting in any feature implementation, delegation, review, external
check, local landing, dev validation, repair, pull-request operation, or main
promotion stage, read the complete
[multiagent delivery visual model](gizmo/architecture/multiagent-delivery-diagrams.md).
It is the primary end-to-end explanation of the delivery system. Identify the
current level, owning actor, incoming artifact, feedback path, and terminal
handoff before taking action.

This mandatory read applies to Feature Gizmos, Team Agents, reviewers, PR
Steward, the Dev Manager, and repair Gizmos. After reading it, load only the
detailed authority required for the selected stage. The
[dev delivery contract](gizmo/architecture/dev-delivery.md) supplies those
detailed authorization, evidence, and failure rules.

## Context routes

- [Gizmo Prime](gizmo/AGENTS.md) owns mission planning, delegation,
  feature-branch sequencing, feature review and acceptance, local landing
  requests, and feature Workbench state.
- [PR Steward](teams/pr-steward/AGENTS.md) owns explicitly authorized
  mechanical operations and returns evidence to the issuing controller. Its
  [knowledge graph](teams/pr-steward/knowledge-graph.md) is a separate
  operational Team Agent context, not a functional engineering authority.
- [Dev manager](teams/dev-manager/AGENTS.md) owns manually operated dev
  publication, dev PR creation/update, slow evidence, readiness, repair
  delegation, and promotion. The manager invokes `dev:pr-manager`; Steward
  observes the PR and executes only review, check, status, and promotion
  mechanics under the manager's packet.
- [AI contract](teams/ai/AGENTS.md) and
  [graph](teams/ai/knowledge-graph.md): Cortex, Loom, agent skills, routing, and
  agent automation.
- [Development core contract](teams/dev-core/AGENTS.md) and
  [graph](teams/dev-core/knowledge-graph.md): portable Rust behavior,
  cryptography, authorization, storage, and typed WASM contracts.
- [Security contract](teams/security/AGENTS.md) and
  [graph](teams/security/knowledge-graph.md): security architecture, trust
  boundaries, security policy, and security review.
- [SRE contract](teams/sre/AGENTS.md) and
  [graph](teams/sre/knowledge-graph.md): CI/CD, clusters, deployments, runners,
  containers, and operations.
- [Web development contract](teams/web-dev/AGENTS.md) and
  [graph](teams/web-dev/knowledge-graph.md): TypeScript, Svelte, browser
  behavior, and extension interaction.

## Primary code-structure rule

Every authored function in every implementation language belongs to a
meaningful owner. This includes public, private, nested, test, callback, and
adapter functions. A file, module, namespace, or generic utility container is
not an owner by itself.

Treat a new or changed unowned free function as a P1 finding. Follow
[function ownership](shared/dynamic-skills/function-ownership.md) for owner
selection, narrow external boundaries, and language-specific authorities.

### Domain APIs

Every authored domain and application API follows
[domain API integrity](shared/dynamic-skills/domain-api-integrity.md). Require
named domain types, concrete values, one-parameter request APIs, validated
capabilities, typed failures, exhaustive states, and explicit schema evolution.
Treat a violation as a P1 finding.

### Secrets

Every secret-bearing value follows the security-owned
[secret lifecycle](teams/security/dynamic-skills/secret-lifecycle.md). Treat an
unowned lifetime, plaintext persistence, or sensitive log as a P1 finding.

Each concurrent feature has its own Gizmo delivery owner and isolated team
worktrees. The manually run [dev manager](teams/dev-manager/AGENTS.md) owns
publication and promotion. Start with the mandatory
[multiagent delivery visual model](gizmo/architecture/multiagent-delivery-diagrams.md),
then follow the detailed
[dev delivery contract](gizmo/architecture/dev-delivery.md) for the current
stage.

That contract replaces all older delivery-stage instructions below and in
linked authorities concerning local checks, feature full validation, branch
publication, and squash merging. Existing runtime descriptions are reference
material until their implementations conform to the named task contracts.

## Team worker contract

### Required subagent execution model

For Gizmo, bounded subagents/Team Agents are the required execution model.
Gizmo Prime is coordination-only for every worker-executable implementation or
review task: it must always dispatch that task to a bounded Team Agent/subagent
and must never execute the worker task itself. Whether explicit scopes are
disjoint controls only whether already-delegated Team Agent/subagent tasks may
run in parallel; it never determines whether delegation occurs. All existing
scope, ownership, isolation, commit, handoff, and serialized-integration rules
remain in force. The session-level generic safety guard is not repository
policy; it does not alter this required subagent model or relax any repository
scope, ownership, or handoff rule.

### Required actions

- **Delegation boundary**
  - Each worker task has exactly one team identity, a bounded file scope, and
    named acceptance evidence.
  - Workers write only inside that scope.
  - Gizmo Prime delegates every worker-executable Team Agent task through the
    active harness.
  - This includes implementation and review fixes.
  - Gizmo Prime stops the task and reports the blocker when a required Team
    Agent cannot be created or started.
- **Parent and worker ownership**
  - Parent-owned Gizmo control operations remain with Gizmo Prime:
    - planning and shared-branch sequencing;
    - feature authorization packets and feature review-finding disposition;
    - functional-team routing and shared-branch ownership;
    - feature Workbench completion and the feature delivery verdict.
  - Dev PR creation/update, slow evidence, readiness, and promotion remain
    under dev-manager control. Steward performs only manager-authorized mechanics.
  - PR Steward owns only explicitly authorized external mechanics:
    - repository discovery, authentication checks, and run-log queries;
    - exact parent-authored Workbench publication;
    - GitHub-backed Task, Loom, and script execution;
    - pull-request review, metadata observation, and status verification;
    - review and comment collection;
    - exact-head validation retriggers and bounded waits;
    - readiness evidence collection; and
    - authorized fast-forward promotion and remote PR-state verification.
  - PR Steward must never decide readiness or promotion itself.
  - It requires the owning Gizmo or dev manager's explicit operation packet.
  - Team workers implement changes and author tests in an isolated child
    worktree created from the parent feature worktree's current commit.
  - Gizmo Prime controls child-worktree allocation, write waves, commit turns,
    and parent integration. PR Steward may observe or perform only the named
    review, check, status, and promotion mechanics; it never creates or updates
    pull-request identity or metadata.
  - Write-capable Team Agents may run concurrently only when their explicit
    file scopes are disjoint and they have no unresolved dependency.
  - Tasks with overlapping scopes or provider-consumer dependencies run in
    dependency order.
  - Before dispatch, Gizmo inventories every dirty path and hunk.
  - Gizmo attributes each dirty change to its owner and task.
  - A proposed scope that overlaps pre-existing user or foreign changes is
    blocked unless those exact changes are handed off or attributed to the same
    task.
  - Acceptance evidence names each command's read, write, and output scopes.
  - Concurrent acceptance commands must not read changing peer scopes or write
    overlapping outputs.
  - Shared generated or output paths receive one assigned writer.
  - Unsafe commands wait for a stable committed head and run serially.
  - Read-only Team Agents may run concurrently when their evidence scopes are
    safe to inspect while writers run.
  - Each child worktree has one task and attempt identity. Workers must not
    create or select worktrees outside the identity issued by Gizmo.
  - A worker mutates only its child worktree's Git index. Gizmo mutates only the
    parent integration worktree's index. Parent integration is serialized.
  - Every write-capable Team Agent commits its complete scoped iteration during
    the commit turn granted by Gizmo.
  - Its terminal handoff enumerates every iteration commit in order.
    - Each entry names the SHA, outcome, evidence, and unresolved blockers.
  - Gizmo verifies each child commit and integrates it into the parent feature
    worktree before continuing.
  - A later worker iteration reads the last one or two relevant commits and
    diffs before changing its owned scope.
- **Validation and delivery**
  - Team workers author meaningful tests but do not execute them locally.
  - Only scoped rustfmt and bounded inexpensive TS diagnostics or formatting
    are permitted local feedback.
  - Gizmo pushes the feature branch and requests remote build-only execution.
  - Completed features enter local dev through serialized local integration.
  - The dev manager alone publishes dev and requests full slow PR validation.
- **Feature ownership**
  - Portable security behavior stays in Rust/WASM.
  - Web code receives public typed projections.
  - Agents mutate only their owned feature.
  - See
    [agent feature ownership](gizmo/dynamic-skills/agent-feature-ownership.md).
- **Trusted publishers**
  - Exactly two trusted GitHub Actions agent publishers are narrow exceptions
    to the committed worker-handoff path:
    - `agent-implement.yml` uses trusted host tooling for publication.
      - The tooling formats the change.
      - It validates change budget and exact feature-branch identity.
      - It publishes and returns the exact head.
    - `rust-dependency-updates.yml` may publish only through
      `task ci-agent:fix` with
      `CI_AGENT_FIX_PROFILE=rust-dependency-update`.
      - It freezes HEAD and index.
      - It accepts only declared Rust dependency files.
      - It verifies the exact fix-branch ref and remote SHA before
        publication; it does not create a pull request.
  - The manager-only `dev:pr-manager` command/workflow is the sole path that
    creates or updates the aggregate `dev` to `main` pull request. It is not
    part of feature-agent publication and is not delegated to a Team Agent.
  - Gizmo owns feature review and acceptance for the returned head.
  - The dev manager owns subsequent dev PR readiness and promotion.
  - PR Steward performs only the owning controller's authorized mechanics.
- **Repository constraints**
  - The source-size limit is a non-bypassable hard rule.
  - Every authored source file stays at or below the **1,000-line delivery
    limit**.
  - A violation blocks delivery and requires a cohesive domain or architectural
    decomposition.
  - Rust unit tests remain inline with their focused implementation.
  - Crate-level integration tests remain separate.
  - See [source file size](shared/dynamic-skills/source-file-size.md).
  - Repository-authored automation uses TypeScript/Bun, Rust, and Taskfiles.
  - Keep `.cortex/.session/` temporary and physically clean before readiness.

### Prohibited actions

- **Delegation boundary**
  - Gizmo Prime is prohibited from performing any worker-executable Team Agent
    work itself.
  - Gizmo Prime must never approximate the work, take over the worker scope, or
    continue past that blocked scope.
  - This is the [no-fallback rule](#no-fallback-or-speculative-recovery) for
    worker execution.
  - Separate Codex tasks, threads, cloud tasks, and ordinary external agents
    must not serve as delegation, communication, or handoff transport.
  - This ordinary-transport prohibition preserves the two trusted publisher
    handoffs above.
  - Those publishers are not ordinary delegation transport.
- **Parent and worker ownership**
  - Parent-owned policy and control decisions do not create functional Team
    Agent work. The bounded PR Steward operation is the sole operational
    exception and remains a child of the owning feature Gizmo or dev manager.
- **Validation and delivery**
  - Gizmo Prime, Team Agents, and subagents must not run product compilation or
    full repository validation locally, whether directly or through a Task
    target or script.
  - The local prohibition includes preflight, Rust/WASM compilation and tests,
    web builds, browser end-to-end suites, Hive verification, full Loom
    verification, and combined repository or PR validation.
  - Do not bypass the prohibition by invoking an underlying compiler, test
    runner, package script, or workflow script directly.
  - Focused local Loom tests are also prohibited.
  - The feature stage must not run tests, coverage, e2e, or preflight remotely.
  - Team workers must not run the full `task loom:verify` suite locally.
  - Missing hosted validation is a blocker, not permission to run locally.
  - Only the user may authorize an exact local command for the current task.
- **Feature ownership**
  - Security review does not transfer implementation ownership.
  - Another active agent's work is read-only until ownership is explicitly
    transferred.
- **Trusted publishers**
  - Neither trusted-publisher exception grants publication authority to an
    ordinary worker.
  - The `agent-implement.yml` bounded editor has no Git or external delivery
    authority.
  - The `rust-dependency-updates.yml` bounded editor has no Git or external
    delivery authority.
  - The `rust-dependency-updates.yml` job rejects persisted checkout
    credentials.
- **Repository constraints**
  - Moving unit tests or making arbitrary fragments is not source-size
    compliance.
  - Repository-authored automation does not use Python.

## GitHub execution boundary

### Required actions

- PR Steward executes every live-agent GitHub operation under the owning
  Gizmo or dev manager's packet.
- This includes all `gh` commands, including read-only queries, authentication
  checks, version checks, repository discovery, and log collection.
- A functional Team Agent needing PR information sends a request to Gizmo
  through the active harness. Include the known target, needed evidence, and
  work that depends on it.
- Gizmo routes dev PR requests to the dev manager, which authorizes Steward's
  evidence collection. Gizmo may authorize feature compilation evidence and
  local landing requests. Return the evidence or blocker to the worker.
- Only PR Steward monitors PR state, checks, reviews, and workflow runs.
  This includes event subscriptions, bounded waits, and permitted polling.
- The same boundary applies to Task, Loom, scripts, and other wrappers that
  invoke `gh` or perform GitHub API operations.
- Gizmo owns decisions, local authoring, shared-branch sequencing, and ordinary
  `git` preparation, fetch, commit, and push.
- PR Steward has one narrow local Git exception: mechanically invoke bounded
  local integration, snapshot publication, or fast-forward promotion under the owning controller's
  packet. Gizmo authorizes local integration; the dev manager authorizes publication
  and promotion. This grants no general shared-branch Git authority.
- Functional teams diagnose evidence returned by PR Steward.
- Each controller authors its stage's Workbench records and decides outcomes.
  Steward publishes only the issuing controller's exact content and destination.
- Use the [authorization handshake](teams/pr-steward/workflows/authorization-handshake.md)
  for PR, repository, run, and Workbench operations.
- This is an agent execution rule, not a credential sandbox. Shared tools and
  credentials do not enforce technical isolation.
- Repository-owned autonomous CI and the existing trusted publishers retain
  their established execution contracts.

### Prohibited actions

- Gizmo, the dev manager, and functional Team Agents must not execute `gh`, even for read-only
  inspection, authentication, or version checks.
- A read-only worker assignment does not authorize `gh pr view` or monitoring.
- Functional Team Agents must not start or contact PR Steward directly.
  Route requests through Gizmo even when the missing evidence blocks the task.
- They must not bypass PR Steward through a wrapper, SDK, direct API request,
  browser, or another GitHub connector.
- PR Steward must not author Workbench content or decide its lifecycle state.
- An unavailable PR Steward is a blocker, not permission for direct execution.

## Remote task execution

The selectors below describe existing task behavior. The current feature
stage uses only remote build-only execution; the dev manager requests slow checks
through the dev PR. Follow [dev delivery](gizmo/architecture/dev-delivery.md).
These old task descriptions do not authorize feature tests or an automatic
dev-push validation pipeline.

The remote task selectors map local validation work to hosted execution:

- `preflight` runs repository preflight.
- `rust:ci` runs Rust product validation.
- `loom:verify` runs the full Loom suite.
- `web:build` runs the web product build.
- `web:e2e` and `extension:e2e` run browser suites.
- `hive:verify` runs Hive verification.
- `check`, `ci:pr`, and `ci:pr:e2e` run combined repository and PR validation.
- `arc:runtime` runs the ARC runtime smoke check.

Run hosted validation from a clean, committed non-main branch:

1. Push the branch and confirm that the remote branch is at the same commit as
   local `HEAD`.
2. Have PR Steward dispatch one task with `task remote TASK_NAME=<task>`, for example
   `task remote TASK_NAME=loom:verify`.
3. Have PR Steward dispatch compatible tasks together with
   `task remote TASK_NAMES=<task-a>,<task-b>` when one hosted job is preferred.
4. Have PR Steward inspect the exact-head run and return its URL and result.

`task remote` rejects a dirty checkout, `main`, an unpushed branch, or a local
`HEAD` that differs from the remote branch. The remote runner invokes the
requested Task name; an unknown or otherwise broken Task fails on the remote
runner. Runtime-backed selectors and `arc:runtime` should be dispatched alone
so their Task implementations receive the correct runner image.
When a task requires a current base:

- It verifies that the branch contains the current `origin/main` before
  dispatch.
- A later push invalidates the earlier run as delivery evidence.
- A later advance of `main` does not invalidate successful exact-head PR
  evidence by itself.
- Readiness must still confirm mergeability, required checks, deployment, and
  clean review state.

## No fallback or speculative recovery

Agent-authored fallback behavior and speculative recovery machinery are
prohibited. This is a universal P1 rule.

### Required actions

- Implement the smallest direct path that satisfies the accepted scope.
- Keep every unsupported or failed state observable.
- Fail closed when the required path cannot complete.
- Treat recovery as a separate product capability.
- Require explicit user authorization before implementing that capability.
- Report a blocker when the required behavior cannot be implemented exactly.

### Prohibited actions

- Do not add an alternate execution path when the intended path is unavailable
  or fails.
- Do not add compatibility branches, legacy branches, shims, or aliases.
- Do not add recovery, replay, resume, reconciliation, or repair engines for
  failures that are not part of the accepted scope.
- Do not add journals, checkpoints, leases, tombstones, retry queues, or
  lifecycle state machines to support speculative recovery.
- Do not infer recovery authority from review suggestions, possible future
  failures, autonomy, or general reliability goals.
- Do not generalize one required failure case into reusable recovery
  infrastructure.
- Existing fallback behavior does not create an exception. Do not extend or
  duplicate it.
- Lower-level Cortex guidance cannot authorize fallback behavior. Report the
  policy conflict and stop.
- Do not silently degrade behavior or substitute a default result.
- Do not catch a failure and continue as if the operation succeeded.
- Do not approximate required behavior with fallback or recovery
  functionality.

## Agent communication

Default to quiet execution for Gizmo Prime, Team Agents, subagents, and skills.
Follow higher-priority host instructions when they require progress updates.

### Required actions

- **Meaningful changes**
  - Report a new actionable blocker, material risk, or required user decision.
  - Report a consequential change to the expected outcome.
  - Explain the impact and any action the recipient needs to take.
  - Update a reported issue only when its impact changes or it resolves.
  - Answer explicit requests for status or detail.
  - Keep updates required by higher-priority host instructions concise.
- **Completion and handoffs**
  - Finish with the outcome and essential verification evidence.
  - Include unresolved blockers or material limitations.
  - Keep worker handoffs to the result, evidence references, and blockers.
  - Include only context the recipient needs for the next action.
  - Preserve required delivery records in their owning workflow.
- **Tool evidence**
  - Request narrow fields and relevant log excerpts.
  - Retain sufficient evidence to diagnose failures and verify completion.
  - Link to detailed evidence instead of repeating it in chat.

### Prohibited actions

- Do not repeat unchanged state or previously reported evidence.
- Do not narrate routine commands, successful checks, polling, or waits.
- Do not emit separate updates for routine skill loading or application.
- Do not announce each activity or bounded wait merely because it occurred.
- Do not repeat task history in handoffs or final responses.
- Do not suppress failures or reduce required checks to save tokens.
- Do not treat quiet execution as permission to skip delivery records.

### Message format

- Use plain Markdown with the outcome first.
- Prefer one sentence for a meaningful change.
- Send one compact terminal handoff per assigned task.
- Include identifiers only when needed to act or verify the result.
- Keep timing and statistics in required delivery records.
- Do not add metadata fences or fetch the clock for a message.
- Emit only the required content for a strict machine-readable protocol.

## Cortex authoring

A task whose write claims overlap `.cortex/**` requires the canonical typed
Cortex authoring composition:

- `teams/ai/dynamic-skills/cortex-writer.md`;
- `teams/ai/dynamic-skills/cortex-article-structure/SKILL.md`; and
- `teams/ai/dynamic-skills/cortex-consistency/SKILL.md`.

Gizmo gives the writer these three authorities with its bounded file scope.
Team-specific authoring skills may add domain policy but must not copy or
rename the canonical skills.

Promote durable lessons only when evidence justifies them. The
[self-improvement skill](teams/ai/dynamic-skills/self-improvement.md) keeps
temporary notes optional and requires cleanup before readiness.

## Autonomous mission execution

- Proceed without asking for confirmation while safe progress remains inside
  the authorized scope.
- Make reasonable, evidence-backed assumptions for bounded choices.
- Record consequential assumptions in progress updates or the final handoff.
- Routine uncertainty, implementation breadth, validation failures, and
  delivery sequencing are not blockers or reasons to ask the user.
- Continue implementation, validation, repair, and authorized delivery until
  complete delivery or an explicitly requested intermediate stop is reached.
- Team Agents report missing authority, cross-team dependencies, and
  non-inferable material decisions to Gizmo through the active harness.
- Gizmo Prime alone asks the user when safe progress still requires new
  authority or a material decision that cannot be inferred from evidence.
- Autonomy does not expand permissions or ownership.
- Autonomy does not weaken security, no-fallback behavior, or an explicit stop.
- Autonomy does not authorize destructive or unrelated actions.
- The user still selects major architectural initiatives under the
  [self-improvement authority](teams/ai/dynamic-skills/self-improvement.md#user-authority-for-major-architectural-initiatives).
- When a concrete blocker remains, exhaust safe in-scope evidence and
  alternatives before stopping.
- Report the exact missing authority, decision, or external state to Gizmo.

## Delivery and validation

Feature delivery completes after reviewed, remotely compiled changes merge
into local dev through local integration. The manually run dev manager owns the slow
delivery stage through snapshot publication, full dev PR validation, and guarded
fast-forward promotion. PR Steward executes authorized GitHub mechanics for the owning
controller. Promotion fast-forwards main to the tested dev SHA. A worker commit
alone does not complete feature delivery. Every change passes through dev.

### Scheduled-task and PR scope

- Codex scheduled tasks are prohibited. Do not create, suggest, or update a
  Codex automation, heartbeat, reminder, recurring follow-up, or deferred task
  for repository work.
- Plan sequencing and host-bounded waits inside the active task.
  Use reactive event hints instead of routine GitHub polling.
  PR Steward's five-minute-inactivity check is the narrow read-only exception.
  Do not materialize this ephemeral plan as a Codex scheduled task.
- Repository-owned GitHub Actions, Workbench automation fields, and Hive
  reconciliation are separate systems governed by their existing authorities.
- A request to test, monitor, and merge a PR when ready remains one active
  delivery task. Have PR Steward perform bounded observation of that PR.
  The dev manager controls dev PR observation, readiness, and promotion in
  that task. Steward executes each mechanical operation under a manager packet.
- The target PR is the delivery scope. Consult `origin/main` only when the PR
  workflow requires base freshness. Do not monitor, diagnose, or repair the
  Main workflow or unrelated default-branch health unless the user explicitly
  assigns that separate work.

Use the detailed authority only when its stage is reached:

- [Team Agent delegation](gizmo/workflows/subagent-delegation.md) owns worker
  scope and shared-branch sequencing.
- [Mission delivery](gizmo/workflows/mission-delivery.md) owns the end-to-end
  delivery sequence.
- [Pull requests](gizmo/workflows/pull-requests.md) owns exact-head review,
  validation, readiness, and merge.

Cortex instruction-only changes do not require local preflight or Loom checks.
Knowledge graphs index documents, not their headings; update a graph only when
document ownership, path, or discoverability changes.
