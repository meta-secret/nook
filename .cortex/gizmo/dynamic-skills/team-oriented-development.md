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
2. Recursively discover every necessary bounded worker-executable team or
   provider task record and provider edge. Track parent-owned Gizmo control
   operations separately outside the worker graph.
3. Assign exactly one team identity to each worker-executable team or provider
   task.
4. For every other team that must provide implementation expertise, create a
   separate task whose only team identity is that provider team. A capability
   may require zero or more such tasks.
5. Record the same functional owner as acceptance metadata and acceptance owner
   on every expertise task for that capability.
6. Freeze the initial known graph and every capability or expertise contract.
7. Validate deterministic topology and fail closed on cycles.
8. Report a cycle's blocked dependency to Gizmo.
9. Keep claims leased until Gizmo records a conclusive output disposition. The
   active harness performs cancellation and owns worker-attempt lifecycle.
10. Apply canonical [subagent delegation](../workflows/subagent-delegation.md)
    and fail closed before ordinary multi-team dispatch while the installed
    typed validator cannot enforce the complete admission contract.
11. Let Loom/Nook compute eligible candidates, conflicts, capacity, leases, and
    exact frontier data.
12. Gizmo validates the computed batch, selects task records, admission-
    authorizes one exact attempt ID per selection, freezes and owns those
    attempts' exact starting frontiers, and supplies their contracts to the
    active harness.
13. The active harness alone creates and operates attempts for the authorized
    records. It does not select or admit records or snapshot or change
    frontiers.
14. Apply the root [team worker contract](../../AGENTS.md#team-worker-contract).
15. Resolve the task's dynamic skill paths from its resource claims and named
    domain-specific skills.
    - A write claim that overlaps `.cortex/**` adds the canonical Cortex
      authoring bundle.
    - A team-specific authoring skill adds only domain policy.
    - It does not wrap or duplicate the canonical bundle.
16. Follow [subagent delegation](../workflows/subagent-delegation.md) for
   dispatch and integration.
17. Route cross-team dependencies through Gizmo.
18. Require each team to implement its own tests, Cortex updates, and review
   fixes for its assigned task.
19. Follow [Team-oriented development](../workflows/team-oriented-development.md)
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

Loom automatically adds the canonical Cortex authoring bundle when the task's
write claims overlap `.cortex/**`. A functional owner may load another
foreign-team skill when its selected authority names that skill as required
engineering policy. Skills remain read-only policy. Applying them to
owner-written files does not create an expertise provider.

## Scope

This skill does not replace module ownership, internal API review, or subagent evidence rules.

- Use module experts inside the selected team when a production module boundary changes.
- Use the internal API expert when a contract crosses modules or teams.
- Follow the universal subagent workflow for operational worker rules.

## Validation

Confirm all of these ownership and admission properties:

- Every worker capability has one functional owner.
- Every worker task has one team identity.
- Parent-owned controls stayed outside the worker graph.
- Parent-owned controls received no team identity or harness attempt.
- Loom/Nook computed candidates and exact frontiers.
- Gizmo validated and admission-authorized each selected record.
- Gizmo froze each selected frontier before the harness created the attempt.
- Each authorized attempt had one harness-visible worker attempt.
- Logical tasks retried sequentially and never had concurrent attempts.
- Each expertise provider stayed inside its code and test scope.
- The provider preserved its frozen contract and obtained owner acceptance.
- Gizmo continued only from the accepted commit.
- Git frontiers contained all write predecessors.
- Accepted read-only evidence remained in parent task state.
- The harness did not select records, admit records, or change frontiers.
- Normal retries preserved the frozen contract and acceptance evidence.
- A contract or acceptance change created a new immutable generation.
- The replacement generation used fresh attempts for every authorized record.
- Repository-reading tasks used non-empty read-covered evidence surfaces.
- Evidence-only synthesis tasks used empty repository claims and evidence
  surfaces.
- Synthesis froze provider edges, producer identities, schema, and acceptance.
- Gizmo bound exact accepted evidence only when authorizing a ready attempt.
- That binding was not treated as a plan mutation.
- Write-capable tasks used empty evidence surfaces.
- The remaining canonical delegation criteria passed.
