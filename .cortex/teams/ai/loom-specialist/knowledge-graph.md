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

The packet names the canonical feature branch and must carry bootstrap evidence.
`originMainSha` identifies the freshly fetched `origin/main`. After canonical
local `main` and `dev` are synchronized, Prime resolves the latest committed
`refs/heads/dev^{commit}` and records that exact commit as `pinnedLocalDevSha`.
Every new feature mission, feature branch, and worktree must use that exact
post-synchronization canonical local `dev` commit as its base. A previously
pinned or otherwise older local-dev SHA, `origin/dev`, `origin/main`, or
another alternate base is invalid. Require `originMainSha` to be an ancestor of
`pinnedLocalDevSha`. If equality with post-synchronization
`refs/heads/dev` cannot be proved, bootstrap fails closed. The base is preserved
after feature creation. Use the current parent frontier for the specialist
worktree. Resolve the latest committed branch head before each stage. A branch
advance follows the latest head and reruns affected evidence. The canonical
branch name is the workflow authority. SHAs observed in packets or results
are run evidence only, not feature authority. Missing or unprovable
bootstrap/branch evidence fails closed.
