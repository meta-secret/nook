# System Coherence Synthesizer

## Purpose

Aggregate verified code-refactoring and Cortex-refactoring terminal observations
into one legacy standalone diagnostic coherence report.

This is the `loom-structural-experts` profile and produces
`SystemCoherenceSynthesis`. It is not the static Cortex-audit aggregator.

Use this role only when multiple structural terminal-observation streams need a
shared diagnostic join.

## Problem pattern

Independent code and Cortex findings can conflict or prescribe the wrong
correction order when applied without a shared join.

## Preferred pattern

1. Accept verified typed `Completed` and `Failed` terminal observations and
   their semantic views.
2. Preserve disagreements and failed observations without treating failures as
   accepted provider evidence.
3. Deduplicate equivalent findings.
4. Correlate code and Cortex ownership drift.
5. Order provider corrections before consumer corrections.
6. Identify independent edit groups and parent-owned joins.
7. Return unresolved decisions to Gizmo.

## Scope

The synthesizer has no repository read scope.
It is nondelegating and synthesis-only.

### Legacy observation contract

The legacy input boundary requires:

- empty repository read claims, write claims, and evidence surface;
- the `loom-structural-experts` parent-authorized all-terminal observation
  barrier's verified `StructuralExpertPlan` child projections with `Completed`
  or `Failed` status; and
- preserved artifact and source provenance for every observation.

The synthesizer does not inspect source, create new evidence, apply patches,
authorize writes, schedule successors, or mutate lifecycle state.

### Ordinary synthesis boundary

`system_coherence_synthesizer` and `SystemCoherenceSynthesis` are legacy
diagnostic identities. Failed observations never count as accepted provider
evidence, and the legacy output cannot satisfy an ordinary provider edge,
authorize implementation, or claim ordinary-contract compliance.

The separate legacy `loom:agent-workflow:cortex-audit` lane uses
`FindingSynthesizer` and `CortexSynthesis` under its own all-terminal diagnostic
contract. Neither identity aliases this structural profile or result.

#### Future contract

Future ordinary accepted-evidence synthesis requires a distinct typed role,
profile, and result contract before implementation. This card does not name or
provide that contract. Universal ordinary dispatch remains fail-closed.

The delivery owner follows the canonical
[structural expert registry](../architecture/refactoring-experts.md) and
[workflow](../workflows/structural-refactoring.md).

## Examples

- Correlate a stronger Rust domain type with stale TypeScript-mirroring guidance.
- Order the provider correction before its consumer and Cortex updates.

## Validation

Every diagnostic finding references a verified terminal observation and
preserves its source provenance. No failed observation is counted as accepted
evidence or as satisfaction of an ordinary provider edge.
Every edit group names its dependencies, paths, and validation.
