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
- Use `system_coherence_synthesizer` only when multiple verified evidence
  streams need reconciliation.

A topic-local Cortex correction does not require a full-tree audit.
A single cohesive code correction does not require cross-surface synthesis.

## Freeze the evidence plan

Before dispatch, the delivery owner:

1. Resolves one exact Git baseline.
2. States the behavior or policy that must remain unchanged.
3. Declares each task, attempt, parent, depth, and read scope.
4. Resolves owning module and Cortex authorities.
5. Declares expected evidence and acceptance proof.
6. Declares the terminal barrier and synthesis join.
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

The Cortex expert begins with the root routing graph and the selected team's
knowledge graph.

1. Find the most specific authority for the topic.
2. Read its one-hop authorities and canonical skill cards.
3. Compare active claims with code, Task, CI, and product evidence.
4. Identify complexity, conflicts, duplication, legacy, and ownership drift.
5. Classify instruction ownership.
6. Separate deterministic candidates from semantic policy.
7. Propose the smallest meaning-preserving corrections.
8. Return uncertainty instead of guessing.

Use the compiled full Cortex garbage-collection workflow when two or more
document families need independent evidence.
That workflow remains read-only.

## Synthesize system coherence

The synthesis role waits for the declared all-terminal barrier.

It receives no live repository access.

Before the role starts, Loom verifies every supplied result and view against the
declared baseline, lineage, paths, and hashes.
The synthesizer then:

1. Preserves failed-lane evidence and disagreements.
2. Deduplicates equivalent findings.
3. Correlates code findings with Cortex findings.
4. Orders provider work before consumer work.
5. Builds independent edit groups with non-overlapping resource claims.
6. Returns unresolved decisions to Gizmo.

The synthesis is a proposed plan.
It does not authorize mutation.

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
8. Update the owning knowledge graph when document headings or paths change.
9. Run the validation owned by each edit group.

Shared registries, lockfiles, generated bindings, and lifecycle state remain
serialized.

## Promote deterministic candidates

A proposal moves into Loom or Task only through a reviewed implementation.

1. Prove that output follows entirely from declared inputs.
2. Search existing typed leaves and compiled workflows.
3. Define typed input, output, and failure behavior.
4. Add behavior-focused tests for the deterministic contract.
5. Add or update the canonical Task entrypoint.
6. Validate the implementation on the updated exact head.
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
- the knowledge graph matches the final headings;
- the updated exact head passes its required gates.

Running the same semantic audit again should not propose equivalent churn.

## Validation

For Cortex and workflow guidance, run:

```bash
task loom:cortex-audit
task loom:verify
task preflight:loom-contracts
```

For implementation work, add the focused module and consumer validations from
the accepted edit groups.
Finish through the ordinary Coding Bro delivery workflow.
