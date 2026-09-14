# Delivery Pipeline Knowledge Graph

Load only the authority required by the current delivery-pipeline operation.

The Delivery Pipeline team reports to Gizmo Prime. It is an operational
delivery team, not a functional product-engineering team.

## Team tree

Delivery Pipeline owns one team worktree through Team Gizmo. Its direct child
contexts are:

- [Team Gizmo](gizmo/AGENTS.md), the high-level orchestrator and evidence
  synthesizer;
- [Dev Manager](dev-manager/AGENTS.md), the canonical manager policy context;
  and
- [PR Lifecycle Agent](pr-lifecycle/AGENTS.md), the bounded PR lifecycle and
  delivery-mechanics context.

Team Gizmo may dispatch multiple internal agents in parallel only when their
scopes are disjoint and dependencies are resolved. It reports only high-level
evidence and blockers to Gizmo Prime. No internal agent creates or updates a
pull request; only the Dev Manager's manager-only `dev:pr-manager` path does.

The direct child agent is named `pr-lifecycle`. The name precisely identifies
PR lifecycle and mechanics without implying stewardship or policy authority.

## Team contract

- [Delivery Pipeline contract](AGENTS.md) defines the team boundary,
  responsibility split, packets, handoffs, and delivery invariants.

## Child graphs

- [Team Gizmo knowledge graph](gizmo/knowledge-graph.md) indexes its internal
  authorities and escalation paths.
- [Dev Manager knowledge graph](dev-manager/knowledge-graph.md) indexes the
  canonical manager policy and bounded operations.
- [PR Lifecycle Agent knowledge graph](pr-lifecycle/knowledge-graph.md)
  indexes its authorization and lifecycle workflows.

## Parent and policy authorities

- [Gizmo Prime](../../gizmo-prime/AGENTS.md) is the parent delivery owner.
- [Multiagent delivery architecture](../../gizmo-prime/architecture/multiagent-delivery-diagrams.md)
  defines levels, ownership, and exact-SHA handoffs.
- [Dev delivery](../../gizmo-prime/architecture/dev-delivery.md) defines detailed
  authorization and promotion rules.
- [Dev Manager](dev-manager/AGENTS.md) owns dev validation, readiness,
  promotion, and `dev:pr-manager`.
