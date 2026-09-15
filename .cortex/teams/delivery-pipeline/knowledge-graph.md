# Delivery Pipeline Knowledge Graph

Load only the authority required by the current delivery-pipeline operation.

The Delivery Pipeline team reports to Gizmo Prime. It is an operational
delivery team, not a functional product-engineering team.

## Team tree

Delivery Pipeline owns one team worktree through Team Gizmo. Its direct child
contexts are:

- Team Gizmo is the high-level orchestrator and evidence synthesizer.
- Dev Manager is the canonical manager policy context.
- PR Lifecycle Agent owns bounded PR lifecycle and delivery mechanics.

Team Gizmo may dispatch multiple internal agents in parallel only when their
scopes are disjoint and dependencies are resolved. It reports only high-level
evidence and blockers to Gizmo Prime. No internal agent creates or updates a
pull request; only the Dev Manager's manager-only `dev:pr-manager` path does.

The direct child agent is named `pr-lifecycle`. The name precisely identifies
PR lifecycle and mechanics without implying stewardship or policy authority.

All Prime-to-Gizmo-to-Team-Agent messages in the active Codex thread follow the
highest-priority [Agent Derailment Circuit Breaker](../../CIRCUIT-BREAKER.md).
Delivery retains checks at real GitHub, Git, credential, artifact,
publication, and promotion boundaries.

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

The root router owns navigation to Gizmo Prime's delivery policy. This graph
indexes only Delivery Pipeline documents and child graphs.
