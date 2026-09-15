# Nook Agent Routing Contract

This file is the repository entry point. It selects one owning context and
states only boundaries that apply everywhere. Detailed delivery and delegation
rules belong to Gizmo Prime's linked authorities.

## Canonical Cortex tree

The canonical routing tree is rooted at `.cortex/gizmo-prime`.

- **Teams**
  - The six top-level teams are `ai`, `dev-core`, `security`, `sre`,
    `web-dev`, and `delivery-pipeline`.
  - Each team has exactly one `gizmo` at `teams/<team>/gizmo/`.
  - Every Team Gizmo reports to Gizmo Prime.
- **Team Gizmos**
  - Every Team Gizmo uses `gpt-5.6-sol` with `low` reasoning.
  - It requests Fast mode with `service_tier: fast`.
  - Fast mode resolves as `priority`.
  - Each Team Gizmo owns one team worktree for its packet.
  - Gizmo Prime reuses or creates a compatible Team Gizmo for the packet.
  - The Team Gizmo dispatches bounded internal leaf Team Agents.
  - It integrates their commits into its feature branch.
  - It reports the resulting branch state to Prime.
- **Leaf Team Agents**
  - Each leaf uses `gpt-5.6-luna` with `xhigh` reasoning.
  - It requests Fast mode with `service_tier: fast`.
  - Each leaf receives a separate issued child worktree.
- **Specialist paths**
  - SRE uses `teams/sre/provisioning/` and `teams/sre/cloud-native/`.
  - Development Core uses `teams/dev-core/rust-core-developer/` and
    `teams/dev-core/rust-auth2-developer/`.
  - Delivery Pipeline uses `teams/delivery-pipeline/gizmo/`,
    `teams/delivery-pipeline/dev-manager/`, and
    `teams/delivery-pipeline/pr-lifecycle/`.

Any commit SHA is observational evidence, not workflow authority.

## Mandatory Gizmo Gate — fail closed

Every implementation or delivery run must begin under Gizmo Prime. Gizmo Prime
is the mission/root coordinator and the active Gizmo harness is a prerequisite
for the run. Every team has a Team Gizmo that reports upward to Gizmo Prime.

### Required actions

- Before planning, delegation, worktree creation, or edits, Gizmo Prime runs
  `git fetch --prune origin`; a fetch failure fails the run closed.
  Delivery/Dev Manager then synchronizes canonical local `main` to the fetched
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
  authority for feature publication and remote work. Observed base and head
  SHAs are evidence only and are not required packet fields.
  Before every remote dispatch, review, or landing operation, Delivery
  re-fetches and resolves the latest committed head of that canonical branch.
  If the branch advances, the operation follows the latest head or reruns its
  evidence. It does not fail because an earlier observed SHA is stale. Team
  Gizmos and leaves never publish temporary child branches.
- Gizmo Prime must issue each team's high-level packet through the active Gizmo
  harness. The receiving Team Gizmo decomposes only its team's mechanics and
  dispatches bounded internal Team Agents through that harness.
- The dispatch must name one team identity, one bounded write scope, one
  issued child worktree, and the acceptance evidence.
  - Team Agents return committed scoped work to their Team Gizmo for synthesis;
    Team Gizmo reports branch/head evidence and blockers to Gizmo Prime for
    verification and serialized integration.
- Gizmo Prime must route pull-request operations through Delivery Pipeline's
  PR Lifecycle Agent or Dev Manager path. Internal agents never create or
  update pull requests; only the Dev Manager invokes `dev:pr-manager`.

### Prohibited actions

- A non-Gizmo direct implementation or delivery fallback is a failed run.
- Do not substitute an ordinary Codex task, thread, cloud task, or external
  agent for the active Gizmo harness or its required Team Agent.
- If the active Gizmo or a required Team Agent harness is unavailable, stop
  before implementation, validation, GitHub operations, or landing.
- Do not continue, claim progress, or claim delivery after that gate fails.

### Trusted in-thread handoffs

Team Gizmos and Team Agents operating inside the same active Codex
thread/harness are a highly trusted orchestration domain. Use the simplest
typed handoff:

- the task, dependency state, and wave order;
- the bounded write scope and issued worktree;
- the ordinary committed result, status, and evidence observation; and
- the upward report to the parent.

Team Gizmos and Team Agents MUST NOT be treated as hostile peers. Any contract,
implementation, or review that adds the following solely to protect one such
peer from another fails review as a P1 defect:

- encryption or signatures for an internal task or result handoff;
- anti-forgery checks, key registries, or authority registries;
- replay defenses framed as hostile-agent protection;
- cryptographic agent identity, result identity, or digest authority;
- one-use capability issuance or consumption theatrics; or
- redundant or double verification of the same internal task or result.

Keep dependency ordering, active-harness admission, write-scope exclusions, and
minimal current-head or clean-worktree checks. These checks coordinate trusted
work; they do not authenticate peers.

This boundary does not weaken real trust boundaries. Strong validation remains
mandatory for GitHub, network, and provider responses; credentials and secrets;
user data; third-party artifacts; independently supplied build or promotion
evidence; and data crossing process or system boundaries. Product
cryptography, event-sourcing replay, Git delivery integrity, and external
evidence policy remain owned by their respective authorities. Git handoff
baseline, path, symlink, gitlink, and worktree checks remain required.
Loom `lib/base-evidence` and independent build or promotion evidence remain
required at their actual boundaries.

## Mandatory context selection

1. Read the [root context router](knowledge-graph.md).
2. Route every new user-originated repository task through
   [Gizmo Prime](gizmo-prime/AGENTS.md) first.
   - Follow-ups remain with the existing Gizmo owner.
   - Gizmo Prime interprets scope and routes bounded work through the owning
     Team Gizmo.
   - Gizmo routes manually requested dev operations through Delivery Pipeline
     to the Dev Manager.
   - The manager retains publication, slow-validation, and promotion authority.
3. Load exactly one owning `AGENTS.md` and knowledge graph for the current actor.
   - Assigned Team Agents load their packet's team context directly.
   - Workers do not recursively become Gizmo or restart user-task routing.
   - Trusted CI publishers retain their explicit execution contracts.
4. Open only the documents and headings needed for the assigned work.
5. Stop loading Cortex when the task can be executed safely.

Do not preload all graphs, a whole team corpus, or foreign-team material for
background context. A selected team authority may link a task-relevant
foreign-team skill as read-only engineering policy. A foreign-team writer
requires an explicit expertise task from Gizmo Prime.

Functional team entry points serve assigned work, not direct user-task routing.
Gizmo selects the terminal outcome appropriate to the request. A question or
read-only task does not authorize implementation or require feature landing.

## Mandatory delivery architecture

Before acting in any feature implementation, delegation, review, external
check, local landing, dev validation, repair, pull-request operation, or main
promotion stage, read the complete
[multiagent delivery visual model](gizmo-prime/architecture/multiagent-delivery-diagrams.md).
It is the primary end-to-end explanation of the delivery system. Identify the
current level, owning actor, incoming artifact, feedback path, and terminal
handoff before taking action.

This mandatory read applies to Gizmo Prime, Team Gizmos, Team Agents,
reviewers, the PR Lifecycle Agent, the Dev Manager, and repair Gizmos. After
reading it, load only the
detailed authority required for the selected stage. The
[dev delivery contract](gizmo-prime/architecture/dev-delivery.md) supplies those
detailed authorization, evidence, and failure rules.

## Context routes

- [Gizmo Prime](gizmo-prime/AGENTS.md) owns mission planning, delegation,
  feature-branch sequencing, feature review and acceptance, local landing
  requests, and feature Workbench state.
  - New Prime, Team Gizmo, and leaf branches follow the [branch naming
    contract](gizmo-prime/dynamic-skills/branch-naming.md).
- [Delivery Pipeline](teams/delivery-pipeline/AGENTS.md) owns authorized
  delivery mechanics across CI, pull-request lifecycle, dev publication,
  workflow execution, local landing, evidence, and guarded promotion. Its
  [Team Gizmo](teams/delivery-pipeline/gizmo/AGENTS.md) reports to Gizmo Prime,
  owns one team worktree, and dispatches the
  [PR Lifecycle Agent](teams/delivery-pipeline/pr-lifecycle/AGENTS.md).
  The [Dev Manager](teams/delivery-pipeline/dev-manager/AGENTS.md) owns
  publication, invokes `dev:pr-manager`, and controls slow evidence,
  readiness, and promotion.
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

## Bug fixes

Every bug fix follows the unit-test-first procedure in
[testing and regression coverage](shared/dynamic-skills/testing-pyramid-and-regression.md#mandatory-regression-coverage-for-bug-fixes).
That authority owns test authoring order, regression scope, and execution
evidence within the authorized delivery stage.

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
worktrees. The manually run [Dev Manager](teams/delivery-pipeline/dev-manager/AGENTS.md) owns
publication and promotion. Start with the mandatory
[multiagent delivery visual model](gizmo-prime/architecture/multiagent-delivery-diagrams.md),
then follow the detailed
[dev delivery contract](gizmo-prime/architecture/dev-delivery.md) for the current
stage.

That contract replaces all older delivery-stage instructions below and in
linked authorities concerning local checks, feature full validation, branch
publication, and squash merging. Existing runtime descriptions are reference
material until their implementations conform to the named task contracts.

## Team worker contract

### Required subagent execution model

For Gizmo, bounded Team Gizmos and internal Team Agents are the required
execution model. Gizmo Prime is coordination-only for every worker-executable
implementation or review task: it issues the high-level team packet, and the
Team Gizmo dispatches the bounded internal task through the active harness.
Whether explicit scopes are disjoint controls only whether already-delegated
tasks may run in parallel; it never determines whether delegation occurs. All
existing scope, ownership, isolation, commit, handoff, and
serialized-integration rules remain in force. The session-level generic safety
guard is not repository policy; it does not alter this required subagent model
or relax any repository scope, ownership, or handoff rule.

The active harness owns dynamic admission capacity and actual spawn results.

- Gizmo immediately attempts every dependency-ready Team Gizmo with a
  disjoint scope concurrently. It uses the active harness's current admission
  result.
- A Team Gizmo immediately attempts every dependency-ready Team Agent with a
  disjoint scope concurrently. It uses the active harness's current admission
  result.
- A temporary admission refusal queues the task as backpressure. Gizmo retries
  it when the harness reports released capacity.
- A host or session allocation describes current availability. It is not an
  architecture or product limit.
- Gizmo does not pre-check or budget a dispatch wave against a numeric limit.
- Cortex never encodes, infers, or repeats a fixed numeric agent or subagent
  concurrency cap.

### Required actions

- **Delegation boundary**
  - Each worker task has exactly one team identity, a bounded file scope, and
    named acceptance evidence.
  - Workers write only inside that scope.
  - Gizmo Prime sends the high-level packet to the owning Team Gizmo through
    the active harness.
  - The Team Gizmo decomposes only its team's mechanics and dispatches each
    internal Team Agent through the active harness.
  - This includes implementation and review fixes.
  - Gizmo Prime stops the task and reports the blocker when a required Team
    Agent cannot be created or started.
- **Team Gizmo boundary**
  - Every team has one Team Gizmo that reports high-level results and blockers
    to Gizmo Prime.
  - Team Gizmo preserves the packet's controller and canonical branch target while it
    decomposes only team mechanics and synthesizes child evidence.
  - Team Gizmo is not a second Prime and never decides functional ownership,
    readiness, promotion, or final delivery.
- **Parent and worker ownership**
  - Parent-owned Gizmo control operations remain with Gizmo Prime:
    - planning and shared-branch sequencing;
    - feature authorization packets and feature review-finding disposition;
    - functional-team routing and shared-branch ownership;
    - feature Workbench completion and the feature delivery verdict.
  - Dev PR creation/update, slow evidence, readiness, and promotion remain
    under Dev Manager control. The PR Lifecycle Agent performs only manager-authorized mechanics.
  - Delivery Pipeline's PR Lifecycle Agent owns only explicitly authorized
    external mechanics:
    - repository discovery, authentication checks, and run-log queries;
    - exact parent-authored Workbench publication;
    - GitHub-backed Task, Loom, and script execution;
    - pull-request review, metadata observation, and status verification;
    - review and comment collection;
    - current-branch validation retriggers and bounded waits;
    - readiness evidence collection; and
    - authorized fast-forward promotion and remote PR-state verification.
  - The PR Lifecycle Agent must never decide readiness or promotion itself.
  - It requires the owning Gizmo or dev manager's explicit operation packet.
  - Team workers implement changes and author tests in an isolated child
    worktree created from the parent feature worktree's current commit.
  - Gizmo Prime controls mission-level child-worktree allocation, write waves,
    commit turns, and parent integration. A Team Gizmo coordinates issued
    internal child worktrees and commit handoffs within its packet. PR Lifecycle
    Agent may observe or perform only the named review, check, status, and
    bounded dev mechanics; it never creates or updates pull-request identity
    or metadata.
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
  - Gizmo Prime authorizes the canonical feature branch name for publication
    and remote build-only execution.
  - Delivery Pipeline's PR Lifecycle Agent re-fetches and resolves that branch's
    latest committed head before each packetized push and remote invocation.
    A branch advance follows the latest head and reruns affected evidence.
  - Completed features enter local dev through serialized local integration.
  - The dev manager alone publishes dev and requests full slow PR validation.
- **Feature ownership**
  - Portable security behavior stays in Rust/WASM.
  - Web code receives public typed projections.
  - Agents mutate only their owned feature.
  - See
    [agent feature ownership](gizmo-prime/dynamic-skills/agent-feature-ownership.md).
- **Delivery controls**
  - The manager-only `dev:pr-manager` command/workflow is the sole path that
    creates or updates the aggregate `dev` to `main` pull request. It is not
    part of feature-agent publication and is not delegated to a Team Agent.
  - Gizmo owns feature review and acceptance for the returned head.
  - The dev manager owns subsequent dev PR readiness and promotion.
  - The PR Lifecycle Agent performs only the owning controller's authorized
    mechanics.
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
  - Gizmo Prime is prohibited from performing any worker-executable Team Gizmo
    or Team Agent work itself.
  - Gizmo Prime must never approximate the work, take over the worker scope, or
    continue past that blocked scope.
  - This is the [no-fallback rule](#no-fallback-or-speculative-recovery) for
    worker execution.
  - Separate Codex tasks, threads, cloud tasks, and ordinary external agents
    must not serve as delegation, communication, or handoff transport.
- **Parent and worker ownership**
  - Parent-owned policy and control decisions do not create functional Team
    Agent work. The bounded Delivery Pipeline operation is the sole operational
    exception and remains a child of Team Gizmo under the owning feature Gizmo
    or dev manager.
- **Validation and delivery**
  - Gizmo Prime, Team Agents, and subagents must not run product compilation or
    full repository validation locally, whether directly or through a Task
    target or script.
  - The local prohibition includes preflight, Rust/WASM compilation and tests,
    web builds, browser end-to-end suites, full Loom
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
- **Repository constraints**
  - Moving unit tests or making arbitrary fragments is not source-size
    compliance.
  - Repository-authored automation does not use Python.

## GitHub execution boundary

### Required actions

- Delivery Pipeline's PR Lifecycle Agent executes every live-agent GitHub
  operation under the owning Gizmo or dev manager's packet, issued by Team
  Gizmo.
- This includes all `gh` commands, including read-only queries, authentication
  checks, version checks, repository discovery, and log collection.
- A functional Team Agent needing PR information sends a request to Gizmo
  through the active harness. Include the known target, needed evidence, and
  work that depends on it.
- Gizmo routes dev PR requests to the dev manager.
  The dev manager authorizes the PR Lifecycle Agent's evidence collection
  through Team Gizmo. Gizmo may authorize
  feature compilation evidence and local landing requests. Return the evidence
  or blocker to the worker.
- Only the PR Lifecycle Agent monitors PR state, checks, reviews, and workflow
  runs.
  This includes event subscriptions, bounded waits, and permitted polling.
- The same boundary applies to Task, Loom, scripts, and other wrappers that
  invoke `gh` or perform GitHub API operations.
- Gizmo owns decisions, local authoring, shared-branch sequencing, and ordinary
  `git` preparation, fetch, and commit.
- Gizmo Prime authors the canonical feature branch name in the feature delivery
  packet. The branch name is the workflow authority.
- The PR Lifecycle Agent must re-fetch and resolve the latest committed head of
  that branch before pushing it or invoking its remote task. A branch advance
  follows the latest head and reruns affected evidence. It must not push a
  temporary leaf branch or dispatch while checked out on one.
- The PR Lifecycle Agent also has a narrow local Git exception: it may
  mechanically invoke bounded local integration, snapshot publication, or
  fast-forward promotion under the owning controller's packet. Gizmo
  authorizes local integration; the dev manager authorizes publication and
  promotion. This grants no general shared-branch Git authority.
- Functional teams diagnose evidence returned by the PR Lifecycle Agent.
- Each controller authors its stage's Workbench records and decides outcomes.
  The PR Lifecycle Agent publishes only the issuing controller's exact content
  and destination.
- Use the [authorization handshake](teams/delivery-pipeline/pr-lifecycle/workflows/authorization-handshake.md)
  for PR, repository, run, and Workbench operations.
- This is an agent execution rule, not a credential sandbox. Shared tools and
  credentials do not enforce technical isolation.
- Repository-owned autonomous CI and the existing trusted publishers retain
  their established execution contracts.

### Prohibited actions

- Gizmo, the dev manager, and functional Team Agents must not execute `gh`, even for read-only
  inspection, authentication, or version checks.
- Feature Gizmos, Team Gizmos, the Dev Manager, and functional Team Agents must
  not push the canonical feature branch or invoke its remote task. They return
  typed readiness or evidence packets to Gizmo Prime.
- A read-only worker assignment does not authorize `gh pr view` or monitoring.
- Functional Team Agents must not start or contact the PR Lifecycle Agent
  directly. Route requests through their Team Gizmo and Gizmo Prime even when
  the missing evidence blocks the task.
- They must not bypass the PR Lifecycle Agent through a wrapper, SDK, direct API request,
  browser, or another GitHub connector.
- The PR Lifecycle Agent must not author Workbench content or decide its lifecycle state.
- An unavailable Team Gizmo or PR Lifecycle Agent is a blocker, not permission
  for direct execution.

## Remote task execution

The selectors below describe existing task behavior. The current feature
stage uses only remote build-only execution; the dev manager requests slow checks
through the dev PR. Follow [dev delivery](gizmo-prime/architecture/dev-delivery.md).
These old task descriptions do not authorize feature tests or an automatic
dev-push validation pipeline.

The remote task selectors map local validation work to hosted execution:

- `preflight` runs repository preflight.
- `rust:ci` runs Rust product validation.
- `loom:verify` runs the full Loom suite.
- `web:build` runs the web product build.
- `web:e2e` and `extension:e2e` run browser suites.
- `check`, `ci:pr`, and `ci:pr:e2e` run combined repository and PR validation.
- `arc:runtime` runs the ARC runtime smoke check.

Run hosted validation from a clean, committed non-main branch:

1. Gizmo Prime authors a packet naming the canonical feature branch.
2. Delivery Pipeline Team Gizmo forwards that packet unchanged to the PR
   Lifecycle Agent.
3. The PR Lifecycle Agent re-fetches and resolves the latest committed branch
   head, pushes that canonical ref, then invokes one remote task with
   `task remote TASK_NAME=<task>`; for example,
   `task remote TASK_NAME=loom:verify`.
4. The PR Lifecycle Agent must invoke compatible tasks together with
   `task remote TASK_NAMES=<task-a>,<task-b>` when the Prime packet requests
   one hosted job.
5. The PR Lifecycle Agent inspects the run for the observed latest head and
   returns its URL, observed SHA, and result through Team Gizmo to Gizmo Prime.

The same authority applies to `workflow_dispatch` and every other hosted
remote-task entry point. A temporary leaf or Team Gizmo branch is never a
valid source for publication or dispatch.

`task remote` rejects a dirty checkout, `main`, an unpushed branch, or a local
`HEAD` that differs from the remote branch. The remote runner invokes the
requested Task name; an unknown or otherwise broken Task fails on the remote
runner. Runtime-backed selectors and `arc:runtime` should be dispatched alone
so their Task implementations receive the correct runner image.
When a task requires a current base:

  - The feature base is the exact latest committed canonical local `dev`
    commit resolved after mandatory fetch and synchronization.
  - A previously captured or pinned local-dev SHA is invalid when it is older
    than the post-synchronization canonical local `dev` commit.
  - It preserves that exact base after the feature branch is created.
  - It re-fetches the canonical branch and resolves its latest committed head
    immediately before dispatch.
  - It associates the run with the observed head SHA for diagnostics and
    evidence, but does not require that SHA in the user packet.
  - A later branch advance follows the latest head and reruns the affected
    operation; it is not a stale-authority failure.
  - Readiness must still confirm mergeability, required checks, deployment, and
    clean review state for the current branch state.

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

### Mission workflow

The delivery workflow is mandatory. Follow
[mission delivery](gizmo-prime/workflows/mission-delivery.md) through feature landing
and the manager handoff. A worker commit is not feature completion.
Before declaring a capability unavailable, follow that workflow's bounded
blocker-verification procedure. A missing tool name alone is not evidence
that the canonical operation is unavailable.

An implementation request defaults to complete delivery. Complete delivery
passes through reviewed, remotely compiled changes merging into local dev,
followed by the dev manager's slow validation and promotion process. Only an
explicit user instruction such as `stop at PR` selects an intermediate
handoff. Silence about
merge is not an intermediate selection.

### Delivery completion

Feature delivery completes after reviewed, remotely compiled changes merge
into local dev through local integration. The manually run dev manager owns the
slow delivery stage through snapshot publication, full dev PR validation, and
guarded fast-forward promotion. Delivery Pipeline Team Gizmo routes authorized
mechanics to the PR Lifecycle Agent for the owning controller. Promotion
fast-forwards main to the tested dev SHA. A worker commit alone does not
complete feature delivery. Every change passes through dev.

### Failed validation waves

When a dev PR validation wave fails, the terminal evidence must include every
failed or cancelled required GitHub Actions job before repair begins. Gizmo
Prime groups the complete diagnostics by owning team and coherent competence
area, then dispatches affected Team Gizmos in parallel. Team Gizmos give one
agent each consolidated area list and batch all known test, compiler, and
static-analysis fixes into one iteration. Prime integrates all team clusters
into local dev before one new snapshot is published and full validation is
rerun once. No individual fix may trigger a push or validation rerun.

### Scheduled-task and PR scope

- Codex scheduled tasks are prohibited. Do not create, suggest, or update a
  Codex automation, heartbeat, reminder, recurring follow-up, or deferred task
  for repository work.
- Plan sequencing and host-bounded waits inside the active task.
  Use reactive event hints instead of routine GitHub polling.
  The PR Lifecycle Agent's five-minute-inactivity check is the narrow read-only exception.
  Do not materialize this ephemeral plan as a Codex scheduled task.
- Repository-owned GitHub Actions and Workbench automation fields are separate
  systems governed by their existing authorities.
- A request to test, monitor, and merge a PR when ready remains one active
  delivery task. Have Delivery Pipeline Team Gizmo route bounded observation
  to the PR Lifecycle Agent.
  The Dev Manager controls dev PR observation, readiness, and promotion in
  that task. The PR Lifecycle Agent executes each mechanical operation under a
  manager packet.
- The target PR is the delivery scope. Consult `origin/main` only when the PR
  workflow requires base freshness. Do not monitor, diagnose, or repair the
  Main workflow or unrelated default-branch health unless the user explicitly
  assigns that separate work.

Use the detailed authority only when its stage is reached:

- [Team Agent delegation](gizmo-prime/workflows/subagent-delegation.md) owns worker
  scope and shared-branch sequencing.
- [Mission delivery](gizmo-prime/workflows/mission-delivery.md) owns the end-to-end
  delivery sequence.
- [Pull requests](gizmo-prime/workflows/pull-requests.md) owns branch-head review,
  validation, readiness, and merge.

Cortex instruction-only changes do not require local preflight or Loom checks.
Knowledge graphs index documents, not their headings; update a graph only when
document ownership, path, or discoverability changes.
