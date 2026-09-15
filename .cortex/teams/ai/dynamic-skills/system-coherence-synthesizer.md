# System Coherence Synthesizer

## Purpose

Aggregate typed code-refactoring and Cortex-refactoring terminal observations
into one standalone diagnostic coherence report.

This is the `loom-structural-experts` profile and produces
`SystemCoherenceSynthesis`. It is not the static Cortex-audit aggregator.

Use this role only when multiple structural terminal-observation streams need a
shared diagnostic join.

Team Gizmos and Team Agents use the ordinary trusted handoff described by the
[AI team contract](../AGENTS.md#trusted-in-thread-handoffs). This role does not
add a peer-authentication or peer-integrity protocol.

## Problem pattern

Independent code and Cortex findings can conflict or prescribe the wrong
correction order when applied without a shared join.

## Preferred pattern

1. Accept typed `Completed` and `Failed` terminal observations and
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

### Handoff contract

The input boundary requires:

- empty repository read claims, write claims, and evidence surface;
- the declared child tasks and their `Completed` or `Failed` status; and
- the ordinary result and evidence observation for every child.

The synthesizer does not inspect source, create new evidence, apply patches,
authorize writes, schedule successors, or mutate lifecycle state.

The parent orders dependencies and supplies the typed observations after the
required children finish. No signature, anti-forgery check, replay gate, digest,
one-use capability, or duplicate verification is required between trusted
peers.

### Ordinary synthesis boundary

`system_coherence_synthesizer` and `SystemCoherenceSynthesis` are diagnostic
identities. Failed observations never count as accepted provider evidence. The
output cannot authorize implementation or replace the delivery owner's review.

The delivery owner follows the canonical
[structural expert registry](../architecture/refactoring-experts.md) and
[workflow](../workflows/structural-refactoring.md).

## Examples

- Correlate a stronger Rust domain type with stale TypeScript-mirroring guidance.
- Order the provider correction before its consumer and Cortex updates.

## Validation

Every diagnostic finding references a declared terminal observation and its
ordinary evidence. No failed observation is counted as accepted evidence or as
satisfaction of an ordinary provider edge.
Every edit group names its dependencies, paths, and validation.
