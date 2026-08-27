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
2. Recursively discover every necessary bounded task and provider dependency.
3. Assign exactly one team identity to each task.
4. Identify whether another team should provide implementation expertise.
5. Freeze every capability or expertise contract before assigning files.
6. Create one worker for every reached task.
7. Dispatch every dependency-ready, non-conflicting task in the same wave.
8. Apply the root [team worker contract](../../AGENTS.md#team-worker-contract).
9. Follow [subagent delegation](../workflows/subagent-delegation.md) for
   dispatch and integration.
10. Route cross-team dependencies through Gizmo.
11. Require each team to implement its own tests, Cortex updates, and review
   fixes for its assigned task.
12. Follow [Team-oriented development](../workflows/team-oriented-development.md)
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
task has one team identity. Confirm that every reached task received a worker.
Confirm that every expertise provider stayed inside its explicit code and test
scope. Confirm that successor baselines contain their complete accepted and
integrated predecessor closure.
