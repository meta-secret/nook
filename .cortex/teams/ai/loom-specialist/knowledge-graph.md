# Loom Specialist Knowledge Graph

Load only the authority needed for the assigned Loom packet.

## Parent contracts

- [Loom Specialist contract](AGENTS.md)
- [AI Team Gizmo contract](../gizmo/AGENTS.md)
- [AI team contract](../AGENTS.md)
- [AI team knowledge graph](../knowledge-graph.md)
- [Gizmo Prime knowledge graph](../../../gizmo-prime/knowledge-graph.md)

## Specialist focus

- Loom work is limited to the exact AI-owned files and evidence named by the packet.
- The specialist follows AI authorities for Loom workflows, runtime tooling, and deterministic enforcement.
- Foreign-team implementation remains with its owning team.

## Delivery authority

- [Multiagent delivery architecture](../../../gizmo-prime/architecture/multiagent-delivery-diagrams.md)
- [Dev delivery](../../../gizmo-prime/architecture/dev-delivery.md)

The packet names the canonical feature branch and may carry bootstrap evidence:
`originMainSha` for the freshly fetched `origin/main` and `pinnedLocalDevSha`
for the synchronized local-dev feature base. Require the former to be an
ancestor of the latter. Use the current parent frontier for the specialist
worktree. Resolve the latest committed branch head before each stage; a branch
advance follows the latest head and reruns affected evidence. SHAs observed in
packets or results are run evidence only, not feature authority. Reject missing
or unprovable bootstrap/branch evidence.
