# Team-Oriented Development

## Overview

Use this workflow whenever a request touches one or more Nook engineering teams.

Use [Engineering team ownership](../architecture/team-ownership.md) for the
boundaries and [Subagent delegation](subagent-delegation.md) for worker rules.

## Plan the team work graph

The delivery owner creates one immutable work graph before team execution.

1. Classify each functional unit as `ai`, `dev-core`, `sre`, or `web-dev`.
2. Declare shared integration and lifecycle work separately.
3. Freeze provider-consumer contracts between teams.
4. Give every team unit an exact baseline and bounded read/write scope.
5. Give every unit its own tests and acceptance evidence.
6. Declare the all-terminal barrier and parent-owned integration join.

Team work units may run in parallel only when their write scopes are isolated and disjoint.
Provider work completes before a dependent consumer starts.

## Dispatch team agents

Use a team agent whenever delegation is available and the unit is independently bounded.

- A `dev-core` agent loads `.cortex/teams/dev-core/AGENTS.md` and its team knowledge graph.
- An `sre` agent loads `.cortex/teams/sre/AGENTS.md` and its team knowledge graph.
- A `web-dev` agent loads `.cortex/teams/web-dev/AGENTS.md` and its team knowledge graph.
- An `ai` agent loads `.cortex/teams/ai/AGENTS.md` and its team knowledge
  graph.

These are entry points, not bulk context manifests.

- The worker selects one relevant graph category.
- It opens only documents needed for its assigned functionality.
- It does not preload the rest of its team corpus.
- It does not load shared or foreign-team documents unless the task contract
  names that dependency.

Each team agent receives:

- one team identity;
- one exact commit;
- allowed code and Cortex paths;
- forbidden paths;
- accepted input contracts;
- required outputs and tests;
- review and validation findings in that team's scope; and
- the parent-owned handoff contract.

If bounded delegation is unavailable, the delivery owner executes each team unit serially.
It must preserve the same ownership boundaries.
It must not invent an undocumented worker runtime.

## Execute within one team

Each team agent owns its entire declared technical slice.

1. Read the team entry point and select the smallest relevant graph category.
2. Open only the task-relevant authorities and headings.
3. Confirm the scope does not include another team's responsibility.
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
4. Return the dependency to the delivery owner.
5. Resume only after the provider contract is accepted and the parent authorizes continuation.

Cross-team requests do not authorize direct edits in the provider team's paths.

## Integrate and deliver

The delivery owner waits for the declared barrier.

1. Verify each team's baseline, scope, result, tests, and semantic view.
2. Reconcile cross-team contract disagreements.
3. Integrate accepted provider work before consumers.
4. Serialize shared manifests, bindings, registries, and knowledge-graph edits.
5. Route review and validation failures back to the responsible team.
6. Repeat until every team-owned correction is complete.
7. Run exact-head validation and readiness through the AI-owned delivery workflow.
8. Keep GitHub, Workbench, push, check, readiness, and merge mutations with the delivery owner.

## Validation

Completion requires one owner per unit, explicit cross-team contracts,
team-owned tests and review fixes, one shared-state writer, root aggregation,
and green exact-head delivery gates without cross-team writes.
