# Structural Refactoring Expert Registry

## Overview

This registry owns reusable expertise for structural maintenance.

Structural maintenance keeps code and Cortex coherent without inventing new
product behavior.

The registry contains exactly two repository-reading roles:

- `code_refactoring_expert`;
- `cortex_refactoring_expert`.

It also contains one synthesis-only role:

- `system_coherence_synthesizer`.

The future ordinary synthesizer receives terminal-successful, verified,
accepted expert evidence. Its generation freezes expected producers, provider
edges, input schema, and acceptance criteria; Gizmo binds exact accepted
artifact, digest, and provenance identities when authorizing the ready attempt.
That binding is not a plan mutation.
It does not inspect the repository.

The existing legacy standalone Cortex-audit aggregation is a different
diagnostic role. It may receive verified completed and failed terminal
observations, but failed observations are not accepted provider evidence and
its output cannot satisfy an ordinary provider edge or claim new-contract
compliance.

These roles are separate from the production
[module expert registry](module-experts.md).
Module experts explain owned domain contracts.
Structural experts find improvements across existing structures.

## Registry contract

Every structural expert attempt follows the root
[team worker contract](../../../AGENTS.md#team-worker-contract) and
[subagent delegation](../../../gizmo/workflows/subagent-delegation.md).

This registry adds:

- one stable structural role and attempt identity;
- either a bounded repository read scope or bounded typed provider-evidence
  inputs;
- the relevant canonical lenses; and
- the role-specific evidence shape.

- Every role is read-only and nondelegating.
- This Cortex registry defines each stable semantic role, capability, context,
  and evidence contract.
- The delivery owner freezes the task graph before dispatch.
- Children cannot add tasks, descendants, resource claims, or workflow tiers.

## Shared boundaries

Structural experts diagnose and propose.
They do not apply repository changes.

Exactly one delivery owner controls:

- accepted edit groups;
- shared-file updates;
- module contract changes;
- Git and pull-request state;
- Workbench state;
- validation, readiness, and merge.

An expert must preserve observed behavior unless the task explicitly authorizes
a behavior change.

An expert must not:

- invent product requirements;
- weaken security or compatibility boundaries;
- treat style preference as an architectural defect;
- suppress tests or validation;
- parse Markdown into scheduler state;
- execute a proposed deterministic extraction;
- mutate source, documentation, lifecycle, or external state.

Markdown is a semantic view.
Typed workflow state remains authoritative for continuation.

## Structural evidence contract

Each repository-reading role reports bounded findings.

Every finding identifies:

- a stable finding ID;
- its category and severity;
- the observed problem;
- exact path and symbol or heading evidence;
- the current owner;
- the proposed canonical owner;
- the smallest safe disposition;
- behavior or policy that must remain unchanged;
- validation that would prove the correction;
- unresolved decisions.

Allowed dispositions are:

- keep;
- simplify;
- merge;
- split;
- relocate;
- label historical;
- remove;
- propose deterministic extraction;
- investigate.

The expert groups compatible findings into proposed edit groups.
Each group names dependencies, affected paths, and validation selectors.

The result is evidence for the delivery owner.
It is not write authorization.

### Structural plan

The depth-one parent publishes `StructuralExpertPlan` before any role runs.

Each authorization binds:

- task;
- expert;
- attempt;
- depth two;
- repository read claims and evidence surface, or frozen provider edges,
  expected producer identities, typed input schema, and acceptance criteria;
- immediate parent;
- exact evidence paths for a repository-reading role.

The ordinary synthesis generation has no repository evidence paths. Its later
attempt authorization names the exact replay-verified accepted child artifacts,
digests, provenance, and view projections that satisfy the frozen terms. This
binding is not a generation mutation. A failed required lane stops the ordinary
synthesis join.

### Code refactoring result

`CodeRefactoringEvidence` contains bounded continuation lists for:

- `scopeModules`;
- `acceptedExternalContracts`;
- `preservedBehaviorInvariants`;
- `preservedSecurityInvariants`;
- `architectureFindings`;
- `designFindings`;
- `codeQualityFindings`;
- `typeSafetyFindings`;
- `testFindings`;
- `dependencyDirectionFindings`;
- `proposedSlices`;
- `focusedValidation`;
- `risks`;
- `unresolvedDecisions`;
- `parentActions`.

### Cortex refactoring result

`CortexRefactoringEvidence` contains bounded continuation lists for:

- `authoritySet`;
- `canonicalOwners`;
- `conflicts`;
- `obsoleteClaims`;
- `historicalClaims`;
- `duplications`;
- `complexityFindings`;
- `instructionClassifications`;
- `loomExtractionCandidates`;
- `knowledgeGraphImpacts`;
- `proposedSlices`;
- `risks`;
- `unresolvedDecisions`;
- `parentActions`.

### System coherence result

`SystemCoherenceSynthesis` contains bounded continuation lists for:

- `consumedArtifacts`;
- `coverageGaps`;
- `crossSurfaceInvariants`;
- `contradictions`;
- `acceptedProposals`;
- `rejectedProposals`;
- `orderedSlices`;
- `serializationPoints`;
- `validationMatrix`;
- `unresolvedDecisions`;
- `deliveryOwnerActions`.

An explicit none-with-reason entry represents an empty semantic category.
The result cannot authorize another role or mutation.

## `code_refactoring_expert`

This role audits an explicitly assigned code surface.

It examines:

- architecture and dependency direction;
- public and internal design boundaries;
- cohesion and responsibility placement;
- code quality and unnecessary complexity;
- behavior-focused tests;
- regression protection;
- type safety and stronger domain types;
- compatibility and security invariants.

The delivery owner resolves the owning module role before dispatch.
The expert receives the relevant package authorities and module-expert evidence.
It does not replace `internal_api_expert` when a proposed change crosses a
module boundary.

The expert distinguishes:

- behavior-preserving refactors;
- contract changes that need consumer review;
- product changes that are outside refactoring scope;
- mechanical findings that belong in a deterministic check.

Negative space includes:

- speculative abstractions;
- unrelated repository cleanup;
- consumer API changes without an accepted boundary contract;
- test deletion used to make a refactor pass;
- large rewrites without independently useful acceptance slices.

## `cortex_refactoring_expert`

This role audits an explicitly assigned Cortex topic or document family.

It diagnoses:

- cognitive and conceptual complexity;
- conflicting active claims;
- duplicated ownership or prose;
- legacy guidance presented as current;
- disagreement with code, Task, or CI behavior;
- unclear canonical ownership;
- missing or misleading navigation;
- stable deterministic instructions that may belong in Loom or Task.

The expert applies these canonical lenses:

- [Cortex consistency](../dynamic-skills/cortex-consistency.md);
- [Cortex writer](../dynamic-skills/cortex-writer.md);
- [Cortex article structure](../dynamic-skills/cortex-article-structure/SKILL.md);
- [Cortex document navigation](../dynamic-skills/cortex-document-map.md);
- [self-improvement instruction classification](../dynamic-skills/self-improvement.md#instruction-classification).

A topic-local task reads the owning authority and its one-hop context.
A repository-wide task uses the compiled Cortex full-garbage-collection
workflow for bounded evidence collection.

### Context isolation

Both forms load only AI team context. Foreign-team documents may be declared as
bounded repository evidence paths, but the expert never loads another team's
graph, entrypoint, skills, or context. It reports any need for foreign-team
semantic ownership to Gizmo, which routes that team.

The expert proposes the smallest correction that restores one clear owner.
It preserves disagreements and uncertainty when evidence cannot resolve them.
It must not silently rewrite product or architectural meaning.

`cortex_refactoring_expert` is the canonical name.
`normalizer` is not an alias.
Normalization describes mechanical shape but omits semantic ownership and
conflict resolution.

## `system_coherence_synthesizer`

This role defines future ordinary accepted-evidence synthesis. Its dispatch is
blocked until the universal admission gate is implemented and passing.

It may receive:

- code-refactoring evidence;
- Cortex-refactoring evidence;
- mechanical validation evidence;
- declared module-boundary evidence.

It receives only typed results, verified artifact references, and bounded
semantic views.
It declares empty repository read claims, write claims, and evidence surface.
Its generation freezes provider edges, expected producer identities, typed
input schema, and acceptance criteria. Once required providers are terminal-
successful and accepted, Gizmo binds the authorized attempt to their exact
generation, task, attempt, team, artifact digest, and underlying source
provenance identities. That binding is not a plan mutation. It has no
repository read scope.

The synthesizer:

- deduplicates findings;
- preserves disagreements present in accepted provider evidence;
- correlates code and Cortex drift;
- orders provider corrections before consumer corrections;
- identifies safe independent edit groups;
- records parent-owned joins;
- produces one proposed coherence plan.

It cannot create findings from unverified repository claims.
It cannot schedule successors or authorize writes.

The legacy standalone Cortex-audit diagnostic aggregator is not this ordinary
role. Its all-terminal join may supply verified completed and failed terminal
observations for reporting. Failed observations never become accepted provider
evidence, and neither they nor the diagnostic aggregate can satisfy an ordinary
provider edge or establish compliance with this contract.

The two repository-reading experts use the opposite evidence contract: each
declares a non-empty repository evidence surface covered by its bounded read
claims. Write-capable correction tasks declare an empty evidence surface.

## Deterministic extraction boundary

An instruction is a deterministic candidate only when its result follows
entirely from declared inputs.

Examples include:

- path and link existence;
- heading and knowledge-graph coverage;
- canonical skill-card registration and harness-mirror absence;
- exact duplicate blocks;
- migration-ledger monotonicity;
- source-size and closed-vocabulary checks;
- existence of named Task entrypoints.

Semantic decisions remain in Cortex.

Examples include:

- selecting the correct owner for an idea;
- deciding whether two claims conflict;
- deciding whether history remains useful;
- evaluating architectural tradeoffs;
- deciding whether a repeated procedure is stable enough to compile.

The expert may propose a typed Loom leaf or reviewed static graph.
The proposal names inputs, outputs, failure behavior, and residual semantic
policy.

No Markdown instruction moves until the typed implementation, tests, and
entrypoint are accepted.
The delivery owner then replaces duplicated mechanics with a link to the
canonical executable path.

## Relationship to the agent hierarchy

Normal cross-surface maintenance uses:

- depth one for the delivery-owner plan and root materialization;
- depth two for the two repository-reading structural experts;
- depth two for `system_coherence_synthesizer` after the evidence barrier;
- depth three only for an exceptional, predeclared module expert.

The delivery owner declares the complete graph.
The synthesizer and experts never create children.

A feature module DAG remains separate from agent lineage.
Provider readiness still controls implementation order.

## Validation

Validate structural-expert documentation with:

```bash
task loom:cortex-audit
task loom:verify
task preflight:loom-contracts
```

Validate direct skill routing by checking:

- every canonical skill card is indexed;
- no tracked `.agents`, `.cursor`, or `.claude` skill mirror exists;
- the Cortex registry contains exactly the two repository-reading roles and one
  synthesis-only role;
- each repository-reading role has a non-empty read-covered evidence surface;
  and
- the synthesizer has empty repository claims and evidence surface plus non-
  empty frozen provider edges, expected producer identities, input schema, and
  acceptance criteria; Gizmo binds exact accepted input identities only at
  attempt authorization, every required provider edge is terminal-successful
  and accepted, and legacy failed-lane observations remain diagnostic-only.
