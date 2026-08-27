---
name: team-oriented-development
description: >-
  Route Nook work through AI, dev-core, security, SRE, and web-development team
  boundaries. Use when a request touches code, scripts, infrastructure, tests,
  Cortex, Loom, or agent workflows owned by one or more teams.
---

# Team-Oriented Development

Read and follow:

- [the canonical skill](../../../.cortex/teams/ai/dynamic-skills/team-oriented-development.md);
- [engineering team ownership](../../../.cortex/teams/ai/architecture/team-ownership.md);
- [the team development workflow](../../../.cortex/teams/ai/workflows/team-oriented-development.md); and
- the selected team's `AGENTS.md` and knowledge graph.

Turn the request into concrete team tasks before assigning files.
Name an expertise provider when another team should change specific files.
Allow a functional owner to consume a specifically linked foreign-team skill
as read-only policy without delegating implementation.
Keep each team agent inside one declared task scope.
Run each team agent with Gizmo's exact model.
Route cross-team dependencies through Gizmo.
Require each team to own implementation, tests, Cortex updates, review fixes,
and validation fixes for its assigned task.
Keep consumer capability semantics and Cortex with the functional owner.
Keep shared files and lifecycle state in the parent-owned join.
