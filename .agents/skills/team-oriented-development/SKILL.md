---
name: team-oriented-development
description: >-
  Route Nook work through AI, dev-core, SRE, and web-development team
  boundaries. Use when a request touches code, scripts, infrastructure, tests,
  Cortex, Loom, or agent workflows owned by one or more teams.
---

# Team-Oriented Development

Read and follow:

- [the canonical skill](../../../.cortex/teams/ai/dynamic-skills/team-oriented-development.md);
- [engineering team ownership](../../../.cortex/teams/ai/architecture/team-ownership.md);
- [the team development workflow](../../../.cortex/teams/ai/workflows/team-oriented-development.md); and
- the selected team's `AGENTS.md` and knowledge graph.

Classify functional ownership before assigning files.
Name an expertise provider when another team should implement a bounded unit.
Allow a functional owner to consume a specifically linked foreign-team skill
as read-only policy without delegating implementation.
Keep each team agent inside one declared task scope.
Route cross-team dependencies through the delivery owner.
Require each team to own implementation, tests, Cortex updates, review fixes,
and validation fixes for its bounded unit.
Keep consumer capability semantics and Cortex with the functional owner.
Keep shared files and lifecycle state in the parent-owned join.
