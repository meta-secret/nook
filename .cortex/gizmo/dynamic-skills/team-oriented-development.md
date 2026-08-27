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
4. Identify whether another team should provide implementation expertise.
5. Freeze the initial known graph and every capability or expertise contract.
6. Validate deterministic topology and fail closed on cycles.
7. Report a cycle's blocked dependency to Gizmo.
8. Keep active claims leased until terminal completion or confirmed
   cancellation.
9. Select a stable-order maximal safe wave against all active claim leases.
10. Snapshot an exact starting frontier for each selected task.
11. Create one worker attempt per selected task and dispatch the wave.
12. Apply the root [team worker contract](../../AGENTS.md#team-worker-contract).
13. Follow [subagent delegation](../workflows/subagent-delegation.md) for
   dispatch and integration.
14. Route cross-team dependencies through Gizmo.
15. Invalidate and stop or cancel an attempt that discovers an unknown provider.
16. Add the provider task and edge, then revalidate the affected graph.
17. Prove read-only evidence head-stable before consumer dispatch.
18. Retry the consumer as a fresh attempt after the provider barrier.
19. Require each team to implement its own tests, Cortex updates, and review
   fixes for its assigned task.
20. Follow [Team-oriented development](../workflows/team-oriented-development.md)
   for team-specific execution and validation.

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
- Follow the universal subagent workflow for operational worker rules.

## Validation

Confirm that every capability has one functional owner. Confirm that every
task has one team identity. Confirm that every ready selected task received one
worker attempt after its exact frontier existed. Confirm that every expertise
provider stayed inside its explicit code and test scope. Confirm that Git
frontiers contain write predecessors while accepted read-only evidence remains
in parent task state. Confirm that active claim leases constrained wave
selection. Confirm that every graph mutation passed cycle validation. Confirm
that read-only evidence remained head-stable for its consumer frontier.
