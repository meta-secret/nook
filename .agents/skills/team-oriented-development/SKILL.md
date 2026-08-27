---
name: team-oriented-development
description: >-
  Route Nook work through AI, dev-core, security, SRE, and web-development team
  boundaries. Use when a request touches code, scripts, infrastructure, tests,
  Cortex, Loom, or agent workflows owned by one or more teams.
---

# Team-Oriented Development

Read and follow:

- [the canonical skill](../../../.cortex/gizmo/dynamic-skills/team-oriented-development.md);
- [engineering team ownership](../../../.cortex/gizmo/architecture/team-ownership.md);
- [the team development workflow](../../../.cortex/gizmo/workflows/team-oriented-development.md); and
- the selected team's `AGENTS.md` and knowledge graph.

Turn the request into concrete team tasks before assigning files.
Dispatch each task through exactly one canonical type:

- `ai_team_agent`;
- `development_core_team_agent`;
- `security_team_agent`;
- `sre_team_agent`; or
- `web_development_team_agent`.

Name an expertise provider when another team should change specific files.
Allow a functional owner to consume a specifically linked foreign-team skill
as read-only policy without delegating implementation.
Keep each team agent inside one parent-declared task scope and isolated
workspace.
Treat the profile as a routing default only.
Preserve Gizmo's exact model without a profile or spawn override.
Route cross-team dependencies through Gizmo. Gizmo delegates every
implementation and validation fix to the responsible team.
Require each team to own implementation, tests, Cortex updates, review fixes,
and validation fixes for its assigned task.
Keep consumer capability semantics and Cortex with the functional owner.
Keep shared files and lifecycle state in the parent-owned join. Gizmo owns the
final integrated verdict but cannot override a required blocking team or
security verdict.
Require every successful writer to return a verified commit handoff.
