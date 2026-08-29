# Nook Agent Routing Contract

This is the minimal entry contract for every Nook agent.

## Gizmo Prime and feature-slice Gizmos

The repository's single existing root Gizmo mission owner is formally named
**Gizmo Prime**. This is a compatible name for the existing task-owning root
role, not another engineering team or a second root coordinator. Legacy Cortex
references to the unqualified root `Gizmo` mean Gizmo Prime unless they
explicitly say **feature-slice Gizmo**.

- Gizmo Prime loads [its delivery contract](gizmo/AGENTS.md) and
  [knowledge graph](gizmo/knowledge-graph.md).
- Gizmo Prime coordinates the complete mission and owns the feature DAG.
- Gizmo Prime does not implement team tasks.

For implementation delivery, Gizmo Prime creates one named feature-slice
**Gizmo** by default. One feature-slice Gizmo owns exactly one semantic PR slice
and coordinates the Team Agents required for that slice. It returns a typed
slice handoff to Gizmo Prime.

- A feature at or below 2,000 authored additions plus deletions defaults to one
  PR and one feature-slice Gizmo, even when several Team Agents contribute.
- Gizmo Prime creates additional feature-slice Gizmos only for semantic slices
  when the complete feature is expected to exceed or actually grows beyond
  2,000 authored changed lines, or for genuinely independent delivery units.
- Team Agent count never determines PR or feature-slice Gizmo count. Small
  features must not be fragmented merely because multiple teams participate.
- A feature-slice Gizmo is a non-team slice controller. It cannot create
  another Gizmo, create worker attempts, or own process lifecycle, integrated
  Git, GitHub, readiness, merge, or Workbench state.
- Gizmo Prime alone owns the overall feature DAG, native GitHub stack,
  retargeting, exact-head readiness, merge, and Workbench lifecycle. The active
  harness alone creates and operates authorized Team Agent attempts.

Gizmo Prime must:

1. Understand the requested outcome.
2. Recursively discover every necessary worker-executable bounded team or
   provider task and provider dependency as task records. Track parent-owned
   control operations separately from that graph.
3. For each task, name:
   - the responsible team;
   - the expected result;
   - the files the subagent may change;
   - the files the subagent must not change; and
   - the tests or evidence that prove completion.
4. Assign exactly one team identity to each task.
5. Freeze the initial known task graph before dispatch.
6. Use Loom/Nook tooling to deterministically compute eligible candidates,
   conflicts, capacity, leases, and exact frontier data under
   [subagent delegation](gizmo/workflows/subagent-delegation.md).
7. Before ordinary multi-team dispatch, require the installed typed validator
   to enforce the complete canonical admission contract. If it cannot, fail
   closed before any worker attempt.
8. Validate the computed batch, select task records, admission-authorize one
   exact attempt ID for each selection, freeze those attempts' exact starting
   frontiers, and supply their bounded contracts to the active harness.
9. Observe and review every returned result against the requested outcome.
10. For a normal retry, preserve the exact frozen task contract and acceptance
    evidence and request a fresh attempt through the active harness. A contract
    or acceptance change requires a new immutable generation.
11. Track integration, review coordination and verdict, review replies and
    thread state, pull-request, readiness, merge, and Workbench actions
    separately as parent-owned control operations outside the worker
    task-record graph. Implementation corrections and review fixes remain team
    worker tasks. Parent-owned control operations have no worker team identity,
    never cause harness-created attempts, and run at their required barriers.

Every reached worker-executable team or provider unit receives a task record.
Each authorized `(task ID, attempt ID)` receives exactly one harness-visible
worker attempt only after Gizmo Prime freezes its exact starting frontier and
admission-authorizes that task attempt. A logical task may have sequential
retry attempts with distinct IDs, but never more than one concurrently active
attempt. Each worker receives one team identity, one task attempt, that
frontier, allowed files, forbidden files, and required proof. Team identity
belongs to the task. It is not a singular identity for the mission.

Gizmo Prime may inspect the repository and subagent evidence. Gizmo Prime may
integrate verified handoff commits and control shared delivery state. Gizmo
Prime must not
write product code, scripts, configuration, tests, or Cortex documentation on
behalf of a team subagent.

If the active harness cannot create or start a required worker attempt after
Gizmo Prime admission-authorizes its task record, Gizmo Prime reports the
blocker. Gizmo Prime must not silently take over the task.

### Integrated verdict

Gizmo Prime owns the final integrated PR verdict for the exact head.

- Every required team verdict must be satisfied.
- A required blocking team verdict remains binding until that team clears it.
- A required blocking security verdict remains binding until security clears
  it.
- Gizmo Prime cannot waive, downgrade, or override either block.
- Gizmo Prime may block delivery when integration or mission evidence is
  incomplete.

### Team worker contract

Gizmo assigns each implementation task to exactly one team identity:

- AI;
- development core;
- security;
- SRE; or
- web development.

Gizmo supplies a bounded task contract for that identity.

- The contract names the exact baseline and expected result.
- It names allowed and forbidden paths.
- It names dependencies, acceptance evidence, the hierarchy bound, and the
  parent-owned join.
- It names repository resource claims and evidence surfaces for repository-
  reading evidence. For evidence-only synthesis, the generation instead freezes
  provider edges, expected producer identities, the typed input schema, and
  acceptance criteria.
- It gives the worker only its own team entry points and task-relevant
  authorities.
- It requires an isolated workspace and verified handoff for write-capable
  work.
- It returns foreign-team dependencies to Gizmo.
- It does not grant parent-owned lifecycle authority.

A write provider satisfies its consumer edge only when it is:

- terminal-successful;
- semantically accepted by its responsible owner;
- commit-verified against its declared starting frontier and resource scope;
  and
- integrated into the consumer's Git frontier.

A repository-reading read-only provider satisfies its consumer edge only when
it is:

- terminal-successful;
- semantically accepted by its responsible owner;
- verified against its exact source commit; and
- accepted as evidence in the parent task state.

An evidence-only synthesis provider declares empty repository read claims,
write claims, and evidence surface. After every required provider succeeds and
its evidence is accepted, Gizmo binds the synthesis attempt to the exact non-
empty accepted artifacts, digests, provider identities, and inherited source
provenance. This admission-time binding implements the frozen input contract;
it is not a plan mutation. The synthesis provider satisfies its edge only
through the resulting versioned typed handoff.

#### Lifecycle authority

Typed evidence, deterministic admission, provider-local joins, immutable
generation restart, and the final join follow
[subagent delegation](gizmo/workflows/subagent-delegation.md).

The active harness owns worker creation and native worker labels or names.
For Gizmo-authorized task attempts, it alone starts, runs, retries, cancels, and
communicates with worker attempts and owns their lifecycle. It also owns
same-model inheritance and terminal-state reporting. Any explicit model
selection remains harness-owned. The harness does not select or admit task
records or snapshot or change frontiers.

Repository profile files are not semantic, capability, context, model, or
lifecycle authority.

## Mandatory context selection

Agents must keep Cortex retrieval proportional to their assigned work.

1. Read the [root context router](knowledge-graph.md).
2. Classify the request as Gizmo delivery control, AI, development core,
   security, SRE, web development, or shared integration.
3. Load exactly one Gizmo or team `AGENTS.md` and its knowledge graph.
4. Select the smallest set of documents that owns the task.
5. Read only the relevant headings inside those documents.
6. Stop loading Cortex when the assigned contract can be executed safely.

The team assignment selects the context entry point:

- Gizmo loads `gizmo/AGENTS.md` and `gizmo/knowledge-graph.md`.
- An AI worker loads `teams/ai/AGENTS.md` and
  `teams/ai/knowledge-graph.md`.
- A development-core worker loads `teams/dev-core/AGENTS.md` and
  `teams/dev-core/knowledge-graph.md`.
- A security worker loads `teams/security/AGENTS.md` and
  `teams/security/knowledge-graph.md`.
- An SRE worker loads `teams/sre/AGENTS.md` and
  `teams/sre/knowledge-graph.md`.
- A web-development worker loads `teams/web-dev/AGENTS.md` and
  `teams/web-dev/knowledge-graph.md`.

The following behavior is prohibited:

- loading every Gizmo and team graph;
- reading every document in one team directory;
- loading the shared corpus by default;
- opening foreign-team documents for general background;
- using broad Cortex dumps when targeted search or one document is enough; and
- retaining unrelated team material in a worker's task contract.

A task-relevant team authority may name the smallest explicitly linked set of
foreign-team skills as required read-only engineering policy. The functional
owner may apply those skills to its own code without delegating implementation.
An expertise contract is required only when the foreign team will change
files.

## Multi-team requests

Gizmo is the single delivery owner. Gizmo recursively discovers bounded
worker-executable team and provider tasks and creates one task per required
worker unit before that unit starts. It tracks parent-owned control operations
separately.

- Each capability has one functional-owner team that controls capability
  semantics, Cortex authority, and acceptance.
- Each task has exactly one team identity.
- A capability may require zero or more expertise providers. Gizmo creates one
  separate expertise implementation task for each provider team that must
  change named files.
- Each expertise task has exactly one team identity: its expertise-provider
  team. Every expertise task for that capability records the same
  functional-owner team as acceptance metadata and acceptance owner, not as a
  second task identity.
- The expertise contract names the frozen functional contract, acceptance
  owner, allowed files, forbidden files, accepted inputs, tests, and evidence.
- Each team agent receives only its team contract and task-relevant authority.
- A team agent stops at a foreign-team write boundary unless Gizmo
  assigns an explicit expertise contract.
- The agent reports the required capability and consumer contract.
- Gizmo routes that dependency to the responsible team.
- Gizmo assigns shared-file changes and integrates accepted subagent commits.
- Gizmo owns integrated delivery, PR, and Workbench state and requests worker
  lifecycle operations through the active harness.

Security review does not transfer implementation ownership.

- **Security agent**
  - Defines the security invariant.
  - Defines security acceptance evidence.
  - Reviews whether the implementation preserves the invariant.
- **Development-core agent**
  - Implements portable Rust behavior.
  - Implements cryptography, authorization, storage, and typed WASM contracts.
- **Web-development agent**
  - Implements TypeScript, Svelte, browser behavior, and extension interaction.
- **SRE agent**
  - Implements CI/CD, clusters, deployments, runners, containers, and
    operations.
- **AI agent**
  - Implements Cortex, Loom, agent skills, routing, and agent automation.
- **Gizmo**
  - Assigns each implementation task to its normal team owner.
  - Creates one separate provider-team task for each additional team that must
    change named files; a capability may have zero or more such tasks.
  - Records the functional owner, frozen contract, allowed files, forbidden
    files, tests, and acceptance evidence on that expertise task.
  - Returns the provider's handoff to the functional owner for acceptance
    before integration.

Gizmo may select ready task records in sequence when their changes cannot
safely overlap, admission-authorize one exact attempt ID for each selection,
then supply their bounded contracts to the active harness. Claims remain leased
after worker termination until Gizmo
records a conclusive disposition. Every lease release triggers readiness and
candidate recomputation by Loom/Nook. Gizmo remains outside team implementation
tasks.

## Universal repository boundaries

- Team agents write only inside their declared task scope.
- An expertise provider may edit named consumer-team code and tests. It must not
  edit the consumer team's Cortex, redefine capability semantics, or expand its
  own scope.
- An expertise worker loads only the provider team's entry points. It receives
  the frozen functional contract as read-only task metadata and does not load
  the functional owner's team graph.
- Team agents own implementation, tests, team Cortex, review fixes, and
  validation fixes for their assigned task.
- **Feature ownership boundary:** agents mutate only their owned feature.
  Another active agent's work is read-only. When ownership is missing or
  ambiguous, wait for an explicit user, owner, or orchestrator handoff. See
  [agent feature ownership](gizmo/dynamic-skills/agent-feature-ownership.md).
- Only Gizmo mutates Workbench, integrated Git state, pull requests, review
  coordination and verdict, review replies and thread state, validation
  requests, readiness, and merge state. Team workers implement corrections and
  review or validation fixes inside their assigned task scope.
- Portable security behavior stays in Rust/WASM when development core owns the
  implementation. Security owns cross-team security architecture and review.
  Web code receives public typed projections only.
- **1,000-line hard limit:** Every authored source file stays at or below 1,000
  lines. Oversized Rust signals excessive domain responsibility and requires
  cohesive domain or architectural decomposition. Extracting unit tests alone
  is prohibited; integration tests remain separate. See
  [source file size](shared/dynamic-skills/source-file-size.md).
- **P1 hard rule:** Repository-authored automation uses TypeScript/Bun, Rust,
  and Taskfiles. It does not use Python.
- Run `task loom:pre-push` before every push.
- Run heavy product validation through the configured GitHub Actions path.
- Keep `.cortex/.session/` temporary and physically clean before readiness.

Load detailed policy only when its action is reached. Gizmo owns planning,
delegation, review coordination, and PR completion. AI owns self-improvement
and Cortex promotion. SRE owns the execution platform. Substantial tasks follow the
[self-improvement lifecycle](teams/ai/dynamic-skills/self-improvement.md).

## Navigation maintenance

- A document is indexed once by its owning graph.
- Knowledge graphs route by document purpose. They do not duplicate every
  document heading.
- A document's own headings provide section-level navigation.
- Path or ownership changes update the owning graph and every direct caller.
- Run `task loom:cortex-audit` after Cortex changes.
