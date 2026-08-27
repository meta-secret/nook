# Nook Agent Routing Contract

This is the minimal entry contract for every Nook agent.

## Mandatory context selection

Agents must keep Cortex retrieval proportional to their assigned work.

1. Read the [root context router](knowledge-graph.md).
2. Classify the requested functionality as AI, development core, SRE, web
   development, or shared integration.
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

## Multi-team requests

One delivery owner decomposes a multi-team request before implementation.

- Each functional unit receives one team owner.
- Each team agent receives only its team contract and task-relevant authority.
- A team agent stops at a foreign-team boundary.
- The agent reports the required capability and consumer contract.
- The delivery owner routes that dependency to the responsible team.
- Shared files and lifecycle state remain parent-owned.

When bounded delegation is unavailable, the delivery owner executes units
serially. The same context and write boundaries still apply.

## Universal repository boundaries

- Team agents write only inside their declared team code and Cortex scope.
- Team agents own implementation, tests, team Cortex, review fixes, and
  validation fixes for their bounded unit.
- **Feature ownership boundary:** agents mutate only their owned feature.
  Another active agent's work is read-only. When ownership is missing or
  ambiguous, wait for an explicit user, owner, or orchestrator handoff. See
  [agent feature ownership](teams/ai/dynamic-skills/agent-feature-ownership.md).
- Only the delivery owner mutates Workbench, integrated Git state, pull
  requests, review threads, validation requests, readiness, and merge state.
- Product and security rules stay in portable Rust/WASM when that layer owns
  them. Web code receives public typed projections only.
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
