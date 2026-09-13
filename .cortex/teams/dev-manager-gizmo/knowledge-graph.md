# Dev Manager Gizmo Knowledge Graph

This graph indexes the separate manual/on-demand dev-manager context. It does
not create a new delivery authority. The canonical Dev Manager contract owns
the policy; this context makes that policy available for one active task.

## Context entry points

- [Role contract](AGENTS.md)
- [Exact activation prompt](activation-prompt.md)

## Canonical delivery authorities

- [Root routing contract](../../AGENTS.md)
- [Root context router](../../knowledge-graph.md)
- [Multiagent delivery model](../../gizmo/architecture/multiagent-delivery-diagrams.md)
- [Feature compilation and dev promotion](../../gizmo/architecture/dev-delivery.md)
- [Dev Manager contract](../dev-manager/AGENTS.md)
- [Dev Manager knowledge graph](../dev-manager/knowledge-graph.md)
- [Publish and validate](../dev-manager/dynamic-skills/dev-publish.md)
- [Promote tested dev](../dev-manager/dynamic-skills/dev-promote.md)

## PR Steward seam

- [PR Steward contract](../pr-steward/AGENTS.md)
- [Authorization handshake](../pr-steward/workflows/authorization-handshake.md)
- [Pull-request lifecycle](../pr-steward/workflows/pull-request-lifecycle.md)

The Dev Manager decides snapshot selection, validation readiness, repair
routing, and promotion. PR Steward performs only the exact packetized GitHub,
review, check, status, publication, and promotion mechanics that the manager
authorizes. Feature Gizmos and Team Agents never create or update pull
requests.
