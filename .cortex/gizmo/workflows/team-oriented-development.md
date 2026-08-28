# Team-Oriented Development

## Overview

Use this workflow whenever a request touches one or more Nook engineering teams.

Use [Engineering team ownership](../architecture/team-ownership.md) for the
boundaries and [Subagent delegation](subagent-delegation.md) for worker rules.

## Assign team subagents

Gizmo writes the team assignments before implementation starts.

1. Recursively discover every necessary bounded task record and provider edge.
2. Assign each task to exactly one semantic team identity.
3. When another team's expertise is required to change files, create a separate
   expertise task whose only team identity is the provider team.
4. Keep shared integration and delivery actions as Gizmo tasks.
5. Record the functional-owner team as acceptance metadata and acceptance owner
   on the expertise task.
6. Freeze the initial known graph before dispatch.
7. Record the exact claims used by each read-only evidence surface.
8. Validate deterministic topology and fail closed on cycles.
9. Report the blocked dependency to Gizmo when a cycle exists.
10. Apply the root [team worker contract](../../AGENTS.md#team-worker-contract).
11. Apply [subagent delegation](subagent-delegation.md) for operational worker
   rules and integration.

Worker termination does not release claims. Gizmo releases a lease only after
the output is conclusively dispositioned.

- Accepted write output is verified and integrated.
- Accepted read-only evidence is verified and accepted into parent task state.
- Rejected or cancelled output is recorded and cannot be used.

The canonical workflow defines capacity, hazard ordering, provider-local joins,
and immutable generation restart.

## Dispatch team agents

Use a team subagent when the task has clear ownership, files, and proof.

The root [context selection contract](../../AGENTS.md#mandatory-context-selection)
maps each team identity to its entry points.

These are entry points, not bulk context manifests.

- The worker selects one relevant graph category.
- It opens only documents needed for its assigned functionality.
- It does not preload the rest of its team corpus.
- It does not load shared or foreign-team documents unless the task contract
  names that dependency.
- It may load a foreign-team skill read-only when a selected team authority
  names that skill as required engineering policy.
- Skill consumption alone does not create an expertise provider.

This workflow adds team-specific context to the universal worker contract:

- exactly one task team identity;
- that team's entry points and task-relevant authorities;
- team-owned review and validation findings; and
- for an expertise task, the provider-team identity plus the functional owner,
  frozen consumer contract, and acceptance evidence as read-only metadata.

An expertise worker loads only the provider team's entry points and graph. It
does not load the functional owner's graph. The frozen consumer contract is an
input, not authority to change capability semantics.

When implementation changes a security boundary, the contract also names the
security invariant and security acceptance evidence. Security review is not a
foreign-team write grant.

If the required team cannot act, follow the blocker rule in
[subagent delegation](subagent-delegation.md).

## Execute within one team

Each team agent owns its entire declared technical slice.

1. Read the team entry point and select the smallest relevant graph category.
2. Open only the task-relevant authorities and headings.
3. Confirm the scope contains only the assigned functional responsibility or
   explicitly delegated expertise unit.
4. Implement the accepted contract only in allowed paths.
5. Update the team's Cortex authority when durable knowledge changes.
6. Add or update the team's behavior and regression tests.
7. Diagnose review or validation findings assigned to the team.
8. Implement every valid team-scoped correction.
9. Return typed artifacts and an agent-authored semantic view.

The team agent must not mutate shared lifecycle state.

## Request another team's functionality

When a team needs a provider owned elsewhere:

1. Stop before implementing the foreign responsibility.
2. Report the provider team and required external contract.
3. State acceptance evidence and affected consumer work.
4. Return the dependency to Gizmo.
5. Let Gizmo apply the canonical late-plan mutation procedure when the provider
   was absent from the frozen graph.

Cross-team requests do not authorize direct edits in the provider team's paths.

## Request another team's expertise

Use expertise delegation when the requesting team already owns the capability
contract but needs another team's implementation discipline.

Do not create an expertise unit merely to consume another team's skill. The
functional owner may apply specifically linked read-only policy to its own
implementation.

1. Keep the requesting team as functional owner.
2. Create a separate expertise implementation task.
3. Assign exactly one task team identity: the provider team.
4. Record the requesting team as acceptance metadata and acceptance owner.
5. Freeze the functional contract and exact code and test paths for the
   provider.
6. Give the worker only the provider team's context and the frozen contract as
   read-only task metadata.
7. Prohibit consumer Cortex, capability semantics, shared files, and lifecycle
   state.
8. Require provider-owned implementation, tests, review fixes, and validation
   fixes inside the bounded scope.
9. Require the provider to preserve the functional contract and return the
   result to the functional owner for semantic acceptance.
10. Integrate through Gizmo only after the functional owner accepts the
    handoff.

An expertise contract is an explicit task-scoped handoff. It is not general
permission to edit another team's code.

## Integrate and deliver

Gizmo uses provider edges as local barriers. It does not wait for unrelated
tasks before activating a successor.

1. Verify each task's team identity, frontier, scope, result, tests, and
   semantic view.
2. Reconcile cross-team contract disagreements.
3. Require each write provider to be terminal-successful and accepted.
4. Verify each write provider's commit and scope, then integrate it into the
   consumer's Git frontier.
Canonical delegation supplies the intervening evidence and lease steps.
10. Require each read-only provider to be terminal-successful and accepted.
11. Verify each read-only provider's exact source commit, then accept its
    evidence into parent task state.
12. Record any other rejected or cancelled output as unusable.
13. Release each lease after conclusive disposition.
18. Bind every ready successor to the exact Git frontier containing its complete
   write-predecessor closure.
20. Serialize shared manifests, bindings, registries, and knowledge-graph edits.
21. Route review and validation failures back to the responsible team.
22. Repeat until every team-owned correction is complete.
23. Reserve the all-task barrier for the final parent-owned join.
24. Run exact-head validation and readiness through Gizmo's delivery workflow.
25. Keep GitHub, Workbench, push, check, readiness, and merge mutations with
   Gizmo.

Gizmo owns the final integrated verdict. Gizmo cannot override a required
blocking team verdict or a required blocking security verdict.

## Validation

Completion requires one exact team identity per team task.
Each ready selected task has one worker attempt. Each capability has one owner
team. Each expertise implementation is a separate task whose one team identity
is its provider team, with the functional owner recorded as acceptance metadata
and acceptance owner.
Completion also requires explicit cross-team contracts, team-owned tests and
review fixes, one shared-state writer, root aggregation, and green exact-head
delivery gates.
