# Nook Agent Routing Contract

This is the minimal entry contract for every Nook agent.

## Gizmo

The main task-owning agent is **Gizmo**.

- Gizmo loads [its delivery contract](gizmo/AGENTS.md) and
  [knowledge graph](gizmo/knowledge-graph.md).
- Gizmo coordinates the mission.
- Gizmo does not implement team tasks.

Gizmo must:

1. Understand the requested outcome.
2. Recursively discover every necessary bounded task and provider dependency
   as task records.
3. For each task, name:
   - the responsible team;
   - the expected result;
   - the files the subagent may change;
   - the files the subagent must not change; and
   - the tests or evidence that prove completion.
4. Assign exactly one team identity to each task.
5. Freeze the initial known task graph before dispatch.
6. Validate deterministic topology and reject cycles.
7. Select a deterministic maximal safe wave against all active claim leases.
8. Snapshot each selected task's exact starting frontier.
9. Create one worker attempt for each selected task and dispatch the wave.
10. Integrate accepted write handoffs or accept read-only evidence.
11. Check affected read-only evidence surfaces at the consumer frontier.
12. Rerun and reaccept stale evidence.
13. Recompute readiness after integration, acceptance, or reacceptance.
14. Bind each successor to the exact integrated frontier that contains its
   complete write-predecessor closure.
15. Review every returned result against the requested outcome.
16. Send incomplete or incorrect work back to the responsible subagent.
17. Recursively call the responsible subagent with feedback until the mission
   is complete or a real blocker requires human direction.

Every reached unit receives a task record. A ready task receives one worker
attempt only after its exact starting frontier exists. Each worker receives one
team identity, one task, that frontier, allowed files, forbidden files, and
required proof. Team identity belongs to the task. It is not a singular
identity for the mission.

Gizmo may inspect the repository and subagent evidence. Gizmo may integrate
verified handoff commits and control shared delivery state. Gizmo must not
write product code, scripts, configuration, tests, or Cortex documentation on
behalf of a team subagent.

If Gizmo cannot start a required team subagent, Gizmo reports the blocker.
Gizmo must not silently take over the task.

### Integrated verdict

Gizmo owns the final integrated PR verdict for the exact head.

- Every required team verdict must be satisfied.
- A required blocking team verdict remains binding until that team clears it.
- A required blocking security verdict remains binding until security clears
  it.
- Gizmo cannot waive, downgrade, or override either block.
- Gizmo may block delivery when integration or mission evidence is incomplete.

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
- It names the resource claims used by read-only evidence.
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

A read-only provider satisfies its consumer edge only when it is:

- terminal-successful;
- semantically accepted by its responsible owner;
- verified against its exact source commit; and
- accepted as evidence in the parent task state.

- The successor starts from the exact integrated frontier that contains its
  complete write-predecessor closure.
- Read-only evidence is not required in Git ancestry.
- Before consumer dispatch, read-only evidence must be head-stable for the
  consumer frontier.
- An overlapping write integration triggers that stability check.
- Stale evidence is invalidated, rerun against the consumer frontier, and
  accepted again.
- The harness recomputes readiness after write integration or read-only
  evidence acceptance or reacceptance.
- Provider edges are local barriers.
- An all-task barrier is reserved for the final parent-owned join.
- The initial known graph is frozen before dispatch.
- An unknown provider invalidates and stops or cancels the affected attempt.
- Gizmo adds the provider task and edge, then replans the affected graph.
- Every graph change reruns deterministic topology and cycle validation.
- A cycle fails closed and returns the blocked dependency to Gizmo.
- The consumer retries as a fresh attempt from a fresh frontier after the new
  provider barrier is satisfied.

The active harness owns worker creation and native worker labels or names.
It also owns same-model inheritance. Any explicit model selection remains
harness-owned. The harness owns scheduling, communication, retries,
cancellation, and terminal barriers.

Repository profile files are not semantic, capability, context, model, or
lifecycle authority.

Operational dispatch, isolation, retry, evidence, and join rules live in
[subagent delegation](gizmo/workflows/subagent-delegation.md).

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

Gizmo is the single delivery owner. Gizmo recursively discovers bounded tasks
and creates one task per required unit before that unit starts.

- Each task has one team that owns the requested behavior.
- That team controls capability semantics, Cortex authority, and
  acceptance.
- A second team may implement part of the task when its engineering expertise
  is required.
- The expertise contract names the provider team, allowed files, forbidden
  files, accepted inputs, tests, and evidence.
- Each team agent receives only its team contract and task-relevant authority.
- A team agent stops at a foreign-team write boundary unless Gizmo
  assigns an explicit expertise contract.
- The agent reports the required capability and consumer contract.
- Gizmo routes that dependency to the responsible team.
- Gizmo assigns shared-file changes and integrates accepted subagent commits.
- Gizmo owns lifecycle state.

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
  - Creates an expertise contract when another team must change named files.
  - Names the provider team, allowed files, forbidden files, tests, and
    acceptance evidence.

Gizmo may run team subagents one after another when their changes cannot safely
overlap. Claims remain leased while an attempt is active. Gizmo greedily selects
a maximal safe wave in stable task order against active leases and claims
selected for the new wave. Read-only audits may overlap. Any overlapping claims
conflict when either task writes. Concurrent writers require isolated
workspaces and disjoint resource claims. Gizmo still must not implement their
tasks.

## Universal repository boundaries

- Team agents write only inside their declared task scope.
- An expertise provider may edit named consumer-team code and tests. It must not
  edit the consumer team's Cortex, redefine capability semantics, or expand its
  own scope.
- Team agents own implementation, tests, team Cortex, review fixes, and
  validation fixes for their assigned task.
- **Feature ownership boundary:** agents mutate only their owned feature.
  Another active agent's work is read-only. When ownership is missing or
  ambiguous, wait for an explicit user, owner, or orchestrator handoff. See
  [agent feature ownership](gizmo/dynamic-skills/agent-feature-ownership.md).
- Only Gizmo mutates Workbench, integrated Git state, pull
  requests, review threads, validation requests, readiness, and merge state.
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
