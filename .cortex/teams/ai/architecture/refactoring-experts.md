# Structural Refactoring Expert Registry

## Overview

This registry owns reusable expertise for structural maintenance.

Structural maintenance keeps code and Cortex coherent without inventing new
product behavior.

The registry contains exactly two repository-reading roles:

- `code_refactoring_expert`;
- `cortex_refactoring_expert`.

It also preserves one legacy standalone diagnostic aggregation role:

- `system_coherence_synthesizer`.

### Lane identities

`system_coherence_synthesizer` is the `loom-structural-experts` diagnostic
role. It receives typed `Completed` and `Failed` structural observations from
the active harness and does not inspect the repository. A failed observation
remains failed. The aggregate is diagnostic output for the delivery owner.

Team Gizmos and Team Agents follow the root
[Agent Derailment Circuit Breaker](../../../CIRCUIT-BREAKER.md). This registry
adds only its typed structural-observation fields.

These roles are separate from the production
[module expert registry](module-experts.md).
Module experts explain owned domain contracts.
Structural experts find improvements across existing structures.

## Registry contract

Every structural expert attempt follows the root
[team worker contract](../../../AGENTS.md#team-worker-contract) and
[subagent delegation](../../../gizmo-prime/workflows/subagent-delegation.md).

This registry adds:

- one stable structural role;
- repository evidence for readers or terminal observations for the diagnostic
  aggregator;
- the relevant canonical lenses; and
- the role-specific input and result shape.

- Every role is read-only and nondelegating.
- This Cortex registry defines each stable semantic role, context, and
  input/result contract.
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

## Repository-reader evidence contract

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

Repository-reader results are evidence for the delivery owner. The legacy
structural aggregate is diagnostic output. Neither is write authorization.

### Structural plan

The delivery owner declares the structural tasks, dependencies, bounded scopes,
and expected result before any role runs. A repository-reading expert receives
the exact source commit, bounded read claims, and exact evidence paths. The
diagnostic aggregator receives the child status and result observations after
their declared dependencies complete.

This is a typed task and result handoff. The parent reviews the ordinary result
before assigning edits.

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

### System coherence diagnostic result

`SystemCoherenceSynthesis` is the legacy standalone diagnostic result. It
contains bounded continuation lists for:

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
The result is diagnostic only. It cannot authorize another role or mutation.

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

- [Cortex consistency](../dynamic-skills/cortex-consistency/SKILL.md);
- [Cortex writer](../dynamic-skills/cortex-writer.md);
- [Cortex article structure](../dynamic-skills/cortex-article-structure/SKILL.md);
- [Cortex document navigation](../dynamic-skills/cortex-document-map/SKILL.md);
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

This is the standalone structural/Cortex diagnostic aggregator used by
`loom-structural-experts`.

Its terminal-observation inputs may carry:

- code-refactoring child output;
- Cortex-refactoring child output;
- mechanical-validation child output;
- declared module-boundary child output.

It receives typed `Completed` and `Failed` terminal observations and bounded
semantic views.
It declares empty repository read claims, write claims, and evidence surface.
It has no repository read scope.

The synthesizer:

- deduplicates findings;
- preserves disagreements and failed terminal observations without treating
  failures as accepted provider evidence;
- correlates code and Cortex drift;
- orders provider corrections before consumer corrections;
- identifies safe independent edit groups;
- records parent-owned joins;
- produces one proposed coherence plan.

It cannot create findings from observations outside its declared child tasks.
It cannot schedule successors or authorize writes.

Its `SystemCoherenceSynthesis` output is diagnostic-only. A failed child does
not become accepted evidence, and the aggregate cannot authorize implementation.
The handoff remains ordinary typed data between trusted peers.

The repository-reader category remains separate: each reader declares a non-
empty repository evidence surface covered by its bounded read claims. Write-
capable correction tasks declare an empty evidence surface.

## Deterministic extraction boundary

An instruction is a deterministic candidate only when its result follows
entirely from declared inputs.

Examples include:

- path and link existence;
- heading and knowledge-graph coverage;
- canonical skill-card registration and harness-mirror absence;
- exact duplicate blocks;
- source-size and closed-vocabulary checks;
- existence of Task entrypoints declared by canonical Cortex workflow
  contracts.

User-requested remote Task selectors are dispatch input. Their existence is not
a deterministic pre-dispatch candidate. Follow the root
[Agent Derailment Circuit Breaker](../../../CIRCUIT-BREAKER.md).

Semantic decisions remain in Cortex.

Examples include:

- selecting the correct owner for an idea;
- deciding whether two claims conflict;
- deciding whether history remains useful;
- evaluating architectural tradeoffs;
- deciding whether a repeated procedure is stable enough to compile.

The expert may propose a typed Loom leaf.
The proposal names inputs, outputs, failure behavior, and residual semantic
policy.

No Markdown instruction moves until the typed implementation, tests, and
entrypoint are accepted.
The delivery owner then replaces duplicated mechanics with a link to the
canonical executable path.

## Relationship to the agent hierarchy

Normal cross-surface maintenance uses the delivery owner's declared task graph.
The owner orders dependencies and waits for each required child status before a
diagnostic join.

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
  standalone diagnostic aggregation role;
- each repository-reading role has a non-empty read-covered evidence surface;
  and
- `system_coherence_synthesizer` and `SystemCoherenceSynthesis` accept typed
  `Completed` and `Failed` observations and remain diagnostic-only.
