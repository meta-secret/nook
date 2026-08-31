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

`system_coherence_synthesizer` is that legacy `loom-structural-experts` role.
It receives verified typed `Completed` and `Failed` structural terminal
observations and does not inspect the repository. Failed observations are not
accepted provider evidence, and its output cannot satisfy an ordinary provider
edge or claim ordinary-contract compliance.

#### Future ordinary boundary

Future ordinary accepted-evidence synthesis must use a distinct typed role,
profile, and result contract before implementation. None is named or registered
here, and ordinary dispatch remains fail-closed.

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
- one of three disjoint input categories: repository evidence for readers,
  terminal-observation inputs for the legacy structural aggregator, or accepted
  provider-evidence inputs for a future unnamed ordinary role;
- the relevant canonical lenses; and
- the role-specific input and result shape.

- Every role is read-only and nondelegating.
- This Cortex registry defines each stable semantic role, capability, context,
  and input/result contract.
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

The depth-one parent publishes `StructuralExpertPlan` before any role runs.

Every authorization binds task, expert, attempt, depth two, and immediate
parent. Its evidence alternative is exactly one of:

- a repository-reading expert binds the exact source commit, bounded read
  claims, non-empty evidence surface, and exact evidence paths;
- the legacy `system_coherence_synthesizer` binds the exact
  `loom-structural-experts` parent-authorized structural all-terminal
  observation barrier, including each verified `StructuralExpertPlan` child
  task, expert, attempt, `Completed` or `Failed` status, result/view identity,
  digest, and inherited source provenance; or
- a future unnamed ordinary accepted-evidence role would bind generation-frozen
  provider edges, expected producer identities, typed input schema, and
  acceptance criteria, then exact accepted artifacts, digests, and provenance
  when Gizmo authorizes its ready attempt.

The third alternative is documentary only: no role/profile/result identity or
runtime support exists, and ordinary dispatch remains fail-closed. Its later
binding would not be a generation mutation. A failed required provider would
stop that ordinary synthesis join.

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

### Legacy system coherence diagnostic result

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
The result cannot authorize another role or mutation, satisfy an ordinary
provider edge, or serve as the result identity for future ordinary synthesis.

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

This is the legacy standalone structural/Cortex diagnostic aggregator used by
`loom-structural-experts`.

Its terminal-observation inputs may carry:

- code-refactoring child output;
- Cortex-refactoring child output;
- mechanical-validation child output;
- declared module-boundary child output.

It receives verified typed `Completed` and `Failed` terminal observations,
artifact references, and bounded semantic views.
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

It cannot create findings from unverified repository claims.
It cannot schedule successors or authorize writes.

Its `SystemCoherenceSynthesis` output is diagnostic-only. Neither an input
failure nor the aggregate can satisfy an ordinary provider edge, authorize
implementation, or establish compliance with ordinary accepted-evidence
synthesis.

### Future ordinary boundary

Future ordinary synthesis requires a distinct typed role/profile/result
contract that freezes provider edges, expected producer identities, input
schema, and acceptance criteria before Gizmo later binds exact accepted inputs
at attempt authorization. This registry does not name or implement that future
contract. Universal ordinary dispatch remains fail-closed.

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
- existence of named Task entrypoints.

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

Normal cross-surface maintenance uses:

- depth one for the delivery-owner plan and root materialization;
- depth two for the two repository-reading structural experts;
- the `loom-structural-experts` parent-authorized synthesis position for
  `system_coherence_synthesizer` after the `StructuralExpertPlan` child-
  projection all-terminal observation barrier;
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
  legacy standalone diagnostic aggregation role;
- each repository-reading role has a non-empty read-covered evidence surface;
  and
- `system_coherence_synthesizer` and `SystemCoherenceSynthesis` remain legacy
  diagnostic identities accepting verified `Completed` and `Failed`
  observations, never satisfy ordinary provider edges, and are not reused for
  future ordinary synthesis.
