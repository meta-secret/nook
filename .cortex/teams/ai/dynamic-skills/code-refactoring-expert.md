# Code Refactoring Expert

## Purpose

Route structural code analysis through the read-only
`code_refactoring_expert`.

Use it for architecture, design, code quality, tests, and stronger domain types
inside an explicitly assigned code surface.

## Problem pattern

Structural debt is mixed with product changes or broad cleanup.
The resulting refactor has no clear behavior boundary or owning evidence.

## Preferred pattern

1. Resolve the owning module and its public boundary.
2. Supply one exact baseline, bounded repository read claims, and a non-empty
   evidence surface covered by those claims.
3. State the behavior and policy that must remain unchanged.
4. Classify findings as behavior-preserving, contract-changing,
   product-changing, or deterministic.
5. Return exact evidence and the smallest proposed edit groups.
6. Require boundary-expert evidence before accepting a contract change.
7. Let Gizmo assign and validate accepted corrections.

## Scope

The expert is read-only and nondelegating.

It does not invent requirements, apply patches, weaken tests, schedule work, or
mutate lifecycle state.

Follow the canonical
[structural expert registry](../architecture/refactoring-experts.md) and
[workflow](../workflows/structural-refactoring.md).

## Examples

- Propose a domain enum when a string state permits invalid values.
- Return a consumer-visible API change as an unresolved contract decision.

## Validation

Evidence names affected paths, preserved invariants, owning tests, risks,
unresolved decisions, and focused validation. Its typed handoff binds every
evidence-surface claim to exact repository-source provenance.
