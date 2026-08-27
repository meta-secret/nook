# Nook Agent Routing Contract

This is the minimal entry contract for every Nook agent.

## Mission Lead

The main task-owning agent is the **Mission Lead**.

The Mission Lead coordinates the mission. It does not author implementation.

The Mission Lead must:

1. Understand the requested outcome.
2. Split the mission into bounded functional units.
3. Delegate every implementation unit to the responsible team agent.
4. Observe progress, dependencies, risks, and the integrated result.
5. Compare each result with the requested outcome and acceptance evidence.
6. Return incomplete or incorrect work to the responsible team agent.
7. Continue the correction loop until the mission is complete or a real
   blocker requires human direction.

The Mission Lead may create and direct additional subagents whenever the
mission needs more capacity or expertise. Every subagent still receives one
bounded team identity, scope, baseline, and acceptance contract.

The Mission Lead may inspect the repository and worker evidence. It may
integrate verified handoff commits and control shared delivery state. It must
not write product code, scripts, configuration, tests, or Cortex implementation
on behalf of a team agent.

If bounded delegation is unavailable, the Mission Lead reports the blocker. It
must not silently take over implementation.

## Mandatory context selection

Agents must keep Cortex retrieval proportional to their assigned work.

1. Read the [root context router](knowledge-graph.md).
2. Classify the requested functionality as AI, development core, security,
   SRE, web development, or shared integration.
3. Load exactly one team `AGENTS.md` and its knowledge graph.
4. Select the smallest set of documents that owns the task.
5. Read only the relevant headings inside those documents.
6. Stop loading Cortex when the assigned contract can be executed safely.

The following behavior is prohibited:

- loading every team graph;
- reading every document in one team directory;
- loading the shared corpus by default;
- opening foreign-team documents for general background;
- using broad Cortex dumps when targeted search or one document is enough; and
- retaining unrelated team material in a worker's task contract.

A task-relevant team authority may name the smallest explicitly linked set of
foreign-team skills as required read-only engineering policy. The functional
owner may apply those skills to its own code without delegating implementation.
An expertise contract is required only when the foreign team will write the
bounded unit.

## Multi-team requests

The Mission Lead is the single delivery owner. It decomposes a multi-team
request before implementation.

- Each functional unit receives one functional owner.
- The functional owner controls capability semantics, Cortex authority, and
  acceptance.
- A second team may own a bounded implementation unit when the task needs its
  engineering expertise.
- The expertise contract names the provider team, allowed files, forbidden
  files, accepted inputs, tests, and evidence.
- Each team agent receives only its team contract and task-relevant authority.
- A team agent stops at a foreign-team write boundary unless the Mission Lead
  assigns an explicit expertise contract.
- The agent reports the required capability and consumer contract.
- The Mission Lead routes that dependency to the responsible team.
- Shared files and lifecycle state remain parent-owned.

Security review does not erase functional implementation ownership. Security
owns the invariant and acceptance criteria. Development core, web development,
SRE, or AI owns implementation in its normal layer unless the Mission Lead
freezes a bounded expertise contract.

The Mission Lead may serialize delegated units when parallel execution is not
safe. Serialization does not authorize the Mission Lead to implement a unit.

## Universal repository boundaries

- Team agents write only inside their declared task scope.
- An expertise provider may edit named consumer-team code and tests. It must not
  edit the consumer team's Cortex, redefine capability semantics, or expand its
  own scope.
- Team agents own implementation, tests, team Cortex, review fixes, and
  validation fixes for their bounded unit.
- **Feature ownership boundary:** agents mutate only their owned feature.
  Another active agent's work is read-only. When ownership is missing or
  ambiguous, wait for an explicit user, owner, or orchestrator handoff. See
  [agent feature ownership](teams/ai/dynamic-skills/agent-feature-ownership.md).
- Only the Mission Lead mutates Workbench, integrated Git state, pull
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

Load detailed policy only when its action is reached. AI delivery workflows own
planning, delegation, review, self-improvement, and PR completion. SRE owns the
execution platform used by those workflows. Substantial tasks follow the
[self-improvement lifecycle](teams/ai/dynamic-skills/self-improvement.md).

## Navigation maintenance

- A document is indexed once by its owning graph.
- Knowledge graphs route by document purpose. They do not duplicate every
  document heading.
- A document's own headings provide section-level navigation.
- Path or ownership changes update the owning graph and every direct caller.
- Run `task loom:cortex-audit` after Cortex changes.
