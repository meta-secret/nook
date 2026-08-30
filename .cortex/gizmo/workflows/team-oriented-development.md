# Team-Oriented Development

## Overview

Use this workflow whenever a request touches one or more Nook engineering teams.

Use [Engineering team ownership](../architecture/team-ownership.md) for the
boundaries and [Subagent delegation](subagent-delegation.md) for worker rules.

## Assign team subagents

Gizmo writes the team assignments before implementation starts.

1. Recursively discover every necessary worker-executable team or provider
   task record and provider edge.
2. Assign each task to exactly one semantic team identity.
3. For every other team whose expertise is required to change files, create a
   separate expertise task whose only team identity is that provider team. A
   capability may require zero or more such tasks.
4. Track integration, review coordination and verdict, review replies and
   thread state, pull-request, readiness, merge, and Workbench actions
   separately as parent-owned Gizmo control operations. Implementation
   corrections and review fixes remain worker tasks. Parent-owned control
   operations are outside the worker task-record graph, have no worker team
   identity, and never cause harness-created attempts.
5. Record the same functional-owner team as acceptance metadata and acceptance
   owner on every expertise task for that capability.
6. Freeze the initial known graph before dispatch.
7. For repository-reading read-only work, record the exact non-empty evidence
   surface covered by read claims. For evidence-only synthesis, record empty
   repository claims and evidence surface, and freeze provider edges, expected
   producer identities, typed input schema, and acceptance criteria.
8. Validate deterministic topology and fail closed on cycles.
9. Report the blocked dependency to Gizmo when a cycle exists.
10. Apply the root [team worker contract](../../AGENTS.md#team-worker-contract).
11. Apply [subagent delegation](subagent-delegation.md) for operational worker
   rules and integration.
   Ordinary multi-team dispatch fails closed while the installed typed
   validator cannot enforce the complete canonical admission contract.
12. Let Loom/Nook compute eligible candidates, conflicts, capacity, leases, and
    exact frontier data.
13. Let Gizmo validate the computed batch, select task records, admission-
    authorize one exact attempt ID per selection, freeze and own those
    attempts' exact starting frontiers, and supply their contracts to the active
    harness.
14. Let the active harness create and operate attempts only for those
    authorized records. It does not select or admit records or snapshot or
    change frontiers.

Worker termination does not release claims. Gizmo records the conclusive output
disposition; Loom/Nook then releases the lease and recomputes eligibility and
capacity. The active harness does neither.

- Accepted write output is verified and integrated.
- Accepted read-only evidence is verified and accepted into parent task state.
- Rejected or cancelled output is recorded and cannot be used.

The canonical workflow defines Loom/Nook capacity and candidate computation,
Gizmo admission authorization and frontier ownership, hazard ordering,
provider-local joins, and immutable generation restart.

Recursive task discovery applies only to worker-executable team and provider
tasks. Gizmo performs each separately tracked control operation when its
required provider-local or final delivery barrier is satisfied.

## Dispatch team agents

Use a team subagent when the task has clear ownership, files, and proof.

### Dispatch meaning

Here, **dispatch** means Gizmo admission-authorizes the bounded task record and
submits its contract to the active harness; the harness creates and runs the
attempt. Dispatch does not give the harness task-selection or admission
authority.

The root [context selection contract](../../AGENTS.md#mandatory-context-selection)
maps each team identity to its entry points.

These are entry points, not bulk context manifests.

- The worker selects one relevant graph category.
- It opens only documents needed for its assigned functionality.
- It does not preload the rest of its team corpus.
- It does not load shared or foreign-team documents unless the task contract
  names that dependency.
- Loom adds the canonical Cortex authoring bundle when the task's write claims
  overlap `.cortex/**`.
- Loom composes that bundle with the smallest selected team-specific skills.
- A team-specific authoring skill contains only domain-specific additions. It
  does not wrap or duplicate a canonical authoring skill.
- It may load a foreign-team skill read-only when a selected team authority
  names that skill as required engineering policy.
- Skill consumption alone does not create an expertise provider.

This workflow adds team-specific context to the universal worker contract:

- exactly one task team identity;
- a dynamic skill list resolved separately from that identity;
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

The team agent must not mutate integrated delivery state or worker-attempt
lifecycle.

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
2. Create one separate expertise implementation task for every required
   provider team; zero tasks are valid when no provider is needed.
3. Assign each task exactly one team identity: its provider team.
4. Record the same requesting team on every task as acceptance metadata and
   acceptance owner.
5. Freeze the functional contract and exact code and test paths for the
   provider.
6. Give the worker only the provider team's context and the frozen contract as
   read-only task metadata.
7. Prohibit consumer Cortex, capability semantics, shared files, and lifecycle
   state.
8. Require provider-owned implementation, tests, review fixes, and validation
   fixes inside the bounded scope.
9. Require the provider to preserve the functional contract.
10. Return the result to the functional owner.
11. Integrate through Gizmo only after the functional owner accepts the
    handoff.

An expertise contract is an explicit task-scoped handoff. It is not general
permission to edit another team's code.

## Integrate and deliver

Gizmo uses provider edges as local barriers. It does not wait for unrelated
tasks before validating and admission-authorizing a Loom/Nook-computed
successor.

The following steps are parent-owned control operations, not task records.
They cover review coordination and verdict, review replies, and thread state,
but not implementation corrections or review fixes. Those remain responsible-
team worker tasks. Parent-owned operations do not receive team identities or
cause worker attempts. Gizmo tracks them separately from the worker graph and
performs them at their named barriers.

1. Verify each task's team identity, frontier, scope, result, tests, and
   semantic view.
2. Reconcile cross-team contract disagreements.
3. Require each write provider to be terminal-successful and accepted.
4. Verify each write provider's commit and scope, then integrate it into the
   consumer's Git frontier.
Canonical delegation supplies the intervening evidence and lease steps.
5. Require each read-only provider to be terminal-successful and accepted.
6. Verify each read-only provider according to its evidence kind, then accept
   its evidence into parent task state:
   - for a repository-reading provider, bind the handoff to its exact source
     commit and every read-covered evidence-surface content identity; and
   - for evidence-only synthesis, bind the handoff to its exact immutable typed
     accepted provider-evidence input identities and their inherited source
     provenance, without requiring a fictitious repository source commit.
7. Record any other rejected or cancelled output as unusable.
8. After Gizmo records each conclusive disposition, let Loom/Nook release the
    lease and recompute eligibility and capacity. The harness does neither.
9. Freeze each authorized successor's exact Git frontier containing its
    complete write-predecessor closure.
10. Serialize shared manifests, bindings, registries, and knowledge-graph edits.
11. Route review and validation failures back to the responsible team.
12. Repeat until every team-owned correction is complete.
13. Reserve the all-worker-task barrier for the final parent-owned join.
14. Run exact-head validation and readiness through Gizmo's delivery workflow.
15. Keep GitHub, Workbench, push, check, readiness, and merge mutations with
    Gizmo.

Gizmo owns the final integrated verdict. Gizmo cannot override a required
blocking team verdict or a required blocking security verdict.

## Validation

Completion requires one exact team identity per worker-executable team or
provider task. Each authorized `(task ID, attempt ID)` has exactly one harness-
visible worker attempt; a logical task may retry sequentially but never has
more than one concurrently active attempt. Parent-owned control operations
remain outside that graph and never create attempts. Loom/Nook
computes candidates and exact frontier data; Gizmo validates, selects task
records, admission-authorizes exact attempt IDs, and freezes frontiers; the
harness does not perform those
actions. Each capability has one owner team and zero or more expertise tasks.
Each expertise task has one provider-team identity, with the same functional
owner recorded as acceptance metadata and acceptance owner.
Completion also requires zero or more separate expertise tasks per capability,
each with one provider identity and the same functional acceptance owner;
explicit cross-team contracts; team-owned tests and review fixes; one shared-
state writer; root aggregation; and green exact-head delivery gates. Ordinary
multi-team dispatch also requires executable enforcement of the complete
canonical admission contract. Normal retries preserve the frozen contract and
acceptance evidence; contract or acceptance changes create a new generation
whose authorized records all receive fresh attempts.
Repository-reading read-only tasks require non-empty read-covered evidence
surfaces and acceptance verification against their exact source commit and
surface content identities. Evidence-only synthesis tasks require empty
repository claims and evidence surfaces. Their generations freeze provider
edges, expected producer identities, input schema, and acceptance criteria;
Gizmo binds exact accepted artifacts, digests, provider identities, and
inherited provenance when authorizing the ready attempt. That binding is not a
plan mutation and does not use a repository source commit.
Write-capable tasks require empty evidence surfaces.
