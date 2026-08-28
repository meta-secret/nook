# Team-Oriented Development

## Overview

Use this workflow whenever a request touches one or more Nook engineering teams.

Use [Engineering team ownership](../architecture/team-ownership.md) for the
boundaries and [Subagent delegation](subagent-delegation.md) for worker rules.

## Assign team subagents

Gizmo writes the team assignments before implementation starts.

1. Recursively discover every necessary bounded task record and provider edge.
2. Assign each task to exactly one semantic team identity.
3. Name a second team when that team's expertise is required to change files.
4. Keep shared integration and delivery actions as Gizmo tasks.
5. Freeze the initial known graph before dispatch.
6. Record the exact claims used by each read-only evidence surface.
7. Validate deterministic topology and fail closed on cycles.
8. Report the blocked dependency to Gizmo when a cycle exists.
9. Apply the root [team worker contract](../../AGENTS.md#team-worker-contract).
10. Apply [subagent delegation](subagent-delegation.md) for operational worker
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

- one functional-owner team identity;
- an optional expertise-provider identity;
- that team's entry points and task-relevant authorities;
- team-owned review and validation findings; and
- the consumer contract when expertise crosses a team boundary.

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
2. Name the provider team and the required engineering expertise.
3. Freeze exact code and test paths for the provider.
4. Prohibit consumer Cortex, capability semantics, shared files, and lifecycle
   state.
5. Require provider-owned implementation, tests, review fixes, and validation
   fixes inside the bounded scope.
6. Return the result to the functional owner for semantic acceptance.

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
team and at most one expertise provider for each set of delegated files.
Completion also requires explicit cross-team contracts, team-owned tests and
review fixes, one shared-state writer, root aggregation, and green exact-head
delivery gates.
