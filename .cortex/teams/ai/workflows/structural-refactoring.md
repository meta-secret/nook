# Structural Refactoring Workflow

## Overview

Use this workflow to improve existing code or Cortex structure while preserving
system coherence.

The workflow routes evidence through the
[structural refactoring expert registry](../architecture/refactoring-experts.md).
It follows the universal
[subagent delegation contract](../../../gizmo/workflows/subagent-delegation.md).

Gizmo plans and delivers the correction process. Gizmo assigns every accepted
edit to the responsible team subagent. Experts remain read-only and
nondelegating.

## Select the maintenance surface

Choose the smallest surface that can answer the request.

- Use `code_refactoring_expert` for architecture, design, code quality, tests,
  and stronger types in an assigned code surface.
- Use `cortex_refactoring_expert` for Cortex complexity, conflict, duplication,
  legacy guidance, ownership, and deterministic extraction candidates.
- Use both when code and durable guidance may disagree.
- Use the legacy standalone `system_coherence_synthesizer` only when
  `loom-structural-experts` needs an all-terminal structural diagnostic
  aggregate.

A topic-local Cortex correction does not require a full-tree audit.
A single cohesive code correction does not require cross-surface synthesis.

## Freeze the evidence plan

Before dispatch, the delivery owner:

1. Resolves one exact Git baseline.
2. States the behavior or policy that must remain unchanged.
3. Declares each task, attempt, parent, and depth. Repository-reading experts
   receive bounded read claims and non-empty read-covered evidence surfaces;
   the legacy synthesizer receives empty repository claims and evidence surface
   plus verified typed `StructuralExpertPlan` child projections from its parent-
   authorized all-terminal observation barrier.
4. Resolves owning module and Cortex authorities.
5. Declares expected evidence and acceptance proof.
6. Declares the legacy diagnostic run's all-terminal observation barrier.
7. Freezes every task and dependency.

Children cannot extend this plan.

## Collect code-refactoring evidence

The code expert starts from the consumer-visible behavior.

1. Identify the owning module and its public boundary.
2. Inspect dependencies and consumers.
3. Separate behavior-preserving structure from contract or product changes.
4. Examine architecture, design, cohesion, and responsibility placement.
5. Examine tests, regression coverage, and failure behavior.
6. Identify stronger domain types that eliminate invalid states.
7. Record deterministic enforcement candidates separately.
8. Return bounded findings and proposed edit groups.

If a boundary may change, require `internal_api_expert` evidence before the
Gizmo accepts that edit group.

## Collect Cortex-refactoring evidence

The Cortex expert begins with the root routing graph and the AI team knowledge
graph. It loads only AI team context.

1. Find the most specific authority for the topic.
2. Read its one-hop authorities and canonical skill cards.
3. Compare active claims with code, Task, CI, and product evidence.
4. Identify complexity, conflicts, duplication, legacy, and ownership drift.
5. Classify instruction ownership.
6. Separate deterministic candidates from semantic policy.
7. Propose the smallest meaning-preserving corrections.
8. Return uncertainty instead of guessing.

A foreign-team document may appear only as bounded repository evidence under
an explicitly declared path. The expert does not load that team's graph,
entrypoint, skills, or context. When resolving a finding requires foreign-team
semantic ownership, it reports the dependency and Gizmo routes the responsible
team.

## Synthesize system coherence

This section defines the legacy `loom-structural-experts`
`system_coherence_synthesizer` and its `SystemCoherenceSynthesis` diagnostic
result. It is not ordinary admitted delegation.

### Readiness

The role waits for the `loom-structural-experts` parent-authorized structural
all-terminal observation barrier and accepts the verified `StructuralExpertPlan`
child projections with `Completed` or `Failed` status.

It receives no live repository access.

### Observation verification

Before the role starts, Loom verifies every terminal observation and view
against the declared baseline, lineage, paths, and hashes. Each observation
preserves its task, attempt, status, artifact digest, and repository-source
provenance. The synthesizer receives no repository read authority.

The synthesizer then:

1. Preserves disagreements and failed observations without calling failures
   accepted provider evidence.
2. Deduplicates equivalent findings.
3. Correlates code findings with Cortex findings.
4. Orders provider work before consumer work.
5. Builds independent edit groups with non-overlapping resource claims.
6. Returns unresolved decisions to Gizmo.

`SystemCoherenceSynthesis` is diagnostic-only. It cannot satisfy an ordinary
provider edge, authorize implementation, or claim ordinary accepted-evidence
synthesis compliance.

## Future ordinary synthesis boundary

Future ordinary accepted-evidence synthesis must use a distinct typed role,
profile, and result contract before implementation. This workflow does not name
or register that contract. Its generation will freeze provider edges, expected
producer identities, typed input schema, and acceptance criteria; Gizmo will
bind exact accepted inputs only when authorizing a ready attempt. Universal
ordinary dispatch remains fail-closed until runtime enforcement exists.

## Apply accepted corrections

Gizmo reviews every finding before assigning edits.

1. Reject unsupported or out-of-scope findings.
2. Resolve decisions that affect product behavior or public contracts.
3. Freeze the accepted edit groups and their order.
4. Assign the lowest provider or canonical authority correction first.
5. Require the responsible team subagent to add or strengthen behavior-focused
   tests for code invariants.
6. Assign dependent consumer changes after their provider contract is
   accepted.
7. Update canonical Cortex cards when durable guidance changes.
8. Update the owning knowledge graph when document ownership, path, or
   discoverability changes.
9. Have Gizmo dispatch the hosted validation owned by each edit group after
   the coherent head is pushed.

Shared registries, lockfiles, generated bindings, and lifecycle state remain
serialized.

## Promote deterministic candidates

A proposal moves into Loom or Task only through a reviewed implementation.

1. Prove that output follows entirely from declared inputs.
2. Search existing typed leaves and deterministic tools.
3. Define typed input, output, and failure behavior.
4. Add behavior-focused tests for the deterministic contract.
5. Add or update the canonical Task entrypoint.
6. Have Gizmo dispatch applicable hosted validation on the updated exact head.
7. Replace duplicated prose with a short semantic rule and executable link.

Do not generate topology from Markdown, prompts, or model output.
Do not delete semantic policy merely because some validation became mechanical.

## Acceptance

A structural refactor is complete when:

- behavior and security invariants remain intact;
- public contract changes have explicit provider and consumer evidence;
- tests protect the improved structure;
- invalid states are reduced when stronger types are justified;
- Cortex has one clear owner for each durable claim;
- legacy material is removed or labeled historical;
- deterministic mechanics have typed enforcement or remain explicit proposals;
- tracked harness skill mirrors remain absent;
- the knowledge graph indexes every owned document exactly once;
- the updated exact head passes its required gates.

Running the same semantic audit again should not propose equivalent churn.

## Validation

For Cortex and workflow guidance, return the coherent commit to Gizmo. Gizmo
pushes the exact head and runs:

```bash
task remote TASK_NAME=loom:verify
```

For implementation work, add the focused module and consumer validations from
the accepted edit groups.
Finish through the ordinary Coding Bro delivery workflow.
