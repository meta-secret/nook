# Team-Oriented Development

## Purpose

Route Nook work through the five semantic team identities:

- AI;
- development core;
- security;
- SRE; and
- web development.

Use this skill whenever a request touches code, scripts, infrastructure, tests, or Cortex owned by one or more engineering teams.

## Preferred pattern

1. Read [Engineering team ownership](../architecture/team-ownership.md).
2. Recursively discover every necessary bounded task record and provider edge.
3. Assign exactly one team identity to each task.
4. When another team must provide implementation expertise, create a separate
   task whose only team identity is the provider team.
5. Record the functional owner as acceptance metadata and acceptance owner on
   that expertise task.
6. Freeze the initial known graph and every capability or expertise contract.
7. Validate deterministic topology and fail closed on cycles.
8. Report a cycle's blocked dependency to Gizmo.
9. Keep claims leased until Gizmo conclusively accepts, rejects, or cancels the
   output.
10. Apply canonical [subagent delegation](../workflows/subagent-delegation.md).
11. Snapshot an exact starting frontier for each selected task.
12. Create one worker attempt for each selected task.
13. Apply the root [team worker contract](../../AGENTS.md#team-worker-contract).
14. Follow [subagent delegation](../workflows/subagent-delegation.md) for
   dispatch and integration.
15. Route cross-team dependencies through Gizmo.
16. Require each team to implement its own tests, Cortex updates, and review
   fixes for its assigned task.
17. Follow [Team-oriented development](../workflows/team-oriented-development.md)
   for team-specific execution and validation.

When a unit changes a security boundary, name security acceptance separately
from implementation ownership. Security review does not transfer the
implementation to the security team.

## Context boundary

Each team agent loads only its own `AGENTS.md`, knowledge graph, and exact
task-relevant documents. Shared and foreign-team documents are opt-in
dependencies. They are never default context.

An expertise worker loads only the provider team's context. Its task includes
one named, frozen consumer contract as read-only metadata. It does not load the
consumer team's graph, and it cannot redefine the functional contract.

A functional owner may load a foreign-team skill when its selected authority
names that skill as required engineering policy. The skill remains read-only.
Applying it to owner-written code does not create an expertise provider.

## Scope

This skill does not replace module ownership, internal API review, or subagent evidence rules.

- Use module experts inside the selected team when a production module boundary changes.
- Use the internal API expert when a contract crosses modules or teams.
- Follow the universal subagent workflow for operational worker rules.

## Validation

Confirm that every capability has one functional owner. Confirm that every
task has one team identity. Confirm that every expertise implementation is a
separate task whose team identity is the provider team and whose functional
owner is explicit acceptance metadata. Confirm that every ready selected task
received one worker attempt after its exact frontier existed. Confirm that
every expertise provider stayed inside its explicit code and test scope,
preserved the frozen contract, and returned to the functional owner for
acceptance before Gizmo integration. Confirm that Git frontiers contain write
predecessors while accepted read-only evidence remains in parent task state.
Confirm the remaining canonical delegation criteria.
