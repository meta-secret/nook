# Team-Oriented Development

## Overview

Use this workflow whenever a request touches one or more Nook engineering teams.

Use [Engineering team ownership](../architecture/team-ownership.md) for the
boundaries and [Subagent delegation](subagent-delegation.md) for worker rules.

## Assign team subagents

Gizmo writes the team assignments before implementation starts.

1. Turn the request into concrete team tasks.
2. Assign each task to `ai`, `dev-core`, `security`, `sre`, or `web-dev`.
3. Name a second team when that team's expertise is required to change files.
4. Keep shared integration and delivery actions as Gizmo tasks.
5. Give each subagent an exact starting commit.
6. Name the files each subagent may and must not change.
7. Name the expected output, tests, and acceptance evidence.
8. State which subagent results another subagent must wait for.
9. Integrate results only after every required subagent has finished.

Team subagents may run in parallel only when they change different files.
A dependent subagent waits for the provider subagent to finish.

## Dispatch team agents

Use a team subagent when the task has clear ownership, files, and proof.

- A `dev-core` agent loads `.cortex/teams/dev-core/AGENTS.md` and its team knowledge graph.
- An `sre` agent loads `.cortex/teams/sre/AGENTS.md` and its team knowledge graph.
- A `web-dev` agent loads `.cortex/teams/web-dev/AGENTS.md` and its team knowledge graph.
- A `security` agent loads `.cortex/teams/security/AGENTS.md` and its team
  knowledge graph.
- An `ai` agent loads `.cortex/teams/ai/AGENTS.md` and its team knowledge
  graph.

These are entry points, not bulk context manifests.

- The worker selects one relevant graph category.
- It opens only documents needed for its assigned functionality.
- It does not preload the rest of its team corpus.
- It does not load shared or foreign-team documents unless the task contract
  names that dependency.
- It may load a foreign-team skill read-only when a selected team authority
  names that skill as required engineering policy.
- Skill consumption alone does not create an expertise provider.

Each team agent receives:

- one team identity;
- Gizmo's exact model;
- one functional-owner or expertise-provider role;
- one exact commit;
- allowed code and Cortex paths;
- forbidden paths;
- accepted input contracts;
- required outputs and tests;
- review and validation findings in that team's scope; and
- the parent-owned handoff contract.

When implementation changes a security boundary, the contract also names the
security invariant and security acceptance evidence. Security review is not a
foreign-team write grant.

If Gizmo cannot start a required team subagent, Gizmo reports an implementation
blocker.

- Gizmo must not implement the assigned task.
- Gizmo must not invent an undocumented subagent runtime.
- Gizmo resumes after subagents become available or a human changes the
  mission.

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
5. Resume only after the provider contract is accepted and the parent authorizes continuation.

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

Gizmo waits for every required team subagent to finish.

1. Verify each team's role, baseline, scope, result, tests, and semantic view.
2. Reconcile cross-team contract disagreements.
3. Integrate accepted provider work before consumers.
4. Serialize shared manifests, bindings, registries, and knowledge-graph edits.
5. Route review and validation failures back to the responsible team.
6. Repeat until every team-owned correction is complete.
7. Run exact-head validation and readiness through Gizmo's delivery workflow.
8. Keep GitHub, Workbench, push, check, readiness, and merge mutations with
   Gizmo.

Gizmo owns the final integrated verdict. Gizmo cannot override a required
blocking team verdict or a required blocking security verdict.

## Validation

Completion requires one owner team per capability and at most one expertise
provider for each set of delegated files. It also requires explicit
cross-team contracts, team-owned tests and review fixes, one shared-state
writer, root aggregation, and green exact-head delivery gates.
