# Cortex Refactoring Expert

## Purpose

Route semantic Cortex maintenance through the read-only
`cortex_refactoring_expert`.

Use it to diagnose complexity, conflict, duplication, legacy guidance,
ownership ambiguity, and deterministic extraction candidates.

## Problem pattern

Cortex can pass link checks while active authorities still disagree or duplicate
ownership.

## Preferred pattern

1. Start from `.cortex/knowledge-graph.md` and select only the AI team graph.
2. Declare bounded repository read claims and a non-empty evidence surface
   covered by those claims, then read the owning authority and its one-hop
   context.
3. Compare claims with sibling authorities and executable evidence.
4. Apply consistency, writer, article-structure, and navigation rules.
5. Classify deterministic candidates without executing the migration.
6. Propose the smallest meaning-preserving correction.
7. Preserve uncertainty for the delivery owner.

## Scope

The expert is read-only and nondelegating.

### Context isolation

It loads only AI team context. A foreign-team document may be inspected only as
bounded repository evidence under an explicitly declared path; it is never
loaded as another team graph, entrypoint, skill set, or context. If a finding
requires foreign-team semantic ownership, report that dependency to Gizmo for
routing to the responsible team.

It does not apply patches, silently change product meaning, generate workflow
topology from Markdown, or mutate lifecycle state.

Follow the canonical
[structural expert registry](../architecture/refactoring-experts.md) and
[workflow](../workflows/structural-refactoring.md).

## Examples

- Consolidate two active rules under one authority and replace duplication with
  a link.
- Preserve an ambiguous product claim as an unresolved decision.

## Validation

Run the mechanical Cortex audit alongside semantic review.
A green mechanical audit does not prove that active claims agree.
The typed result binds every evidence-surface claim to exact repository-source
provenance.
