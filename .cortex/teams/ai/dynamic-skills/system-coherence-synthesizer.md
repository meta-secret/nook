# System Coherence Synthesizer

## Purpose

Reconcile verified code-refactoring and Cortex-refactoring evidence into one
proposed coherence plan.

Use this role only when multiple structural evidence streams need a shared
join.

## Problem pattern

Independent code and Cortex findings can conflict or prescribe the wrong
correction order when applied without a shared join.

## Preferred pattern

1. Accept only declared typed results and verified semantic views.
2. Preserve disagreements and failed-lane evidence.
3. Deduplicate equivalent findings.
4. Correlate code and Cortex ownership drift.
5. Order provider corrections before consumer corrections.
6. Identify independent edit groups and parent-owned joins.
7. Return unresolved decisions to Gizmo.

## Scope

The synthesizer has no repository read scope.
It is nondelegating and synthesis-only.

It does not inspect source, create new evidence, apply patches, authorize
writes, schedule successors, or mutate lifecycle state.

The delivery owner follows the canonical
[structural expert registry](../architecture/refactoring-experts.md) and
[workflow](../workflows/structural-refactoring.md).

## Examples

- Correlate a stronger Rust domain type with stale TypeScript-mirroring guidance.
- Order the provider correction before its consumer and Cortex updates.

## Validation

Every synthesized finding references supplied evidence.
Every edit group names its dependencies, paths, and validation.
