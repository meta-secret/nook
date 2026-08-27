# Team-Oriented Development

## Purpose

Route Nook work through the five canonical team-agent types:

- `ai_team_agent`;
- `development_core_team_agent`;
- `security_team_agent`;
- `sre_team_agent`; and
- `web_development_team_agent`.

Use this skill whenever a request touches code, scripts, infrastructure, tests, or Cortex owned by one or more engineering teams.

## Preferred pattern

1. Read [Engineering team ownership](../architecture/team-ownership.md).
2. Turn the request into concrete tasks and assign each task to one team.
3. Identify whether another team should provide implementation expertise.
4. Freeze every capability or expertise contract before assigning files.
5. Select the exact canonical team-agent type for each task.
6. Start one team subagent for each task with clear files and acceptance proof.
7. Preserve Gizmo's exact model without a profile or spawn override.
8. Keep every team agent inside its declared task scope.
9. Route cross-team dependencies through Gizmo.
10. Require each team to implement its own tests, Cortex updates, and review
   fixes for its assigned task.
11. Keep shared files and lifecycle mutations in the parent-owned join.
12. Follow [Team-oriented development](../workflows/team-oriented-development.md) for execution and validation.

The profile supplies only the team routing default. The parent task contract
supplies the exact baseline, bounded paths, dependencies, acceptance evidence,
hierarchy bound, and join.

When a unit changes a security boundary, name security acceptance separately
from implementation ownership. Security review does not transfer the
implementation to the security team.

## Context boundary

Each team agent loads only its own `AGENTS.md`, knowledge graph, and exact
task-relevant documents. Shared and foreign-team documents are opt-in
dependencies. They are never default context.

An expertise provider may additionally load one named consumer contract. That
contract is read-only. It does not authorize loading the consumer team's graph.

A functional owner may load a foreign-team skill when its selected authority
names that skill as required engineering policy. The skill remains read-only.
Applying it to owner-written code does not create an expertise provider.

## Scope

This skill does not replace module ownership, internal API review, or subagent evidence rules.

- Use module experts inside the selected team when a production module boundary changes.
- Use the internal API expert when a contract crosses modules or teams.
- Follow the universal subagent workflow for baselines, isolation, views, and joins.

## Validation

Confirm that every capability has one functional owner. Confirm that every
expertise provider stayed inside its explicit code and test scope.
