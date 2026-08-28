# System Coherence Synthesizer

## Purpose

Reconcile verified code-refactoring and Cortex-refactoring evidence into one
proposed coherence plan.

This card defines future ordinary accepted-evidence synthesis. It remains
unexecutable while the universal ordinary-delegation gate is fail-closed.

Use this role only when multiple structural evidence streams need a shared
join.

## Problem pattern

Independent code and Cortex findings can conflict or prescribe the wrong
correction order when applied without a shared join.

## Preferred pattern

1. Accept as provider evidence only declared terminal-successful results and
   verified semantic views whose handoffs were accepted.
2. Preserve disagreements present in accepted provider evidence.
3. Deduplicate equivalent findings.
4. Correlate code and Cortex ownership drift.
5. Order provider corrections before consumer corrections.
6. Identify independent edit groups and parent-owned joins.
7. Return unresolved decisions to Gizmo.

## Scope

The synthesizer has no repository read scope.
It is nondelegating and synthesis-only.

### Evidence input contract

The input boundary requires:

- empty repository read claims, write claims, and evidence surface;
- generation-frozen provider edges, expected producer identities, typed input
  schema, and acceptance criteria; and
- every required provider edge to be terminal-successful, verified, and
  accepted before synthesis is ready.

When Gizmo authorizes the ready synthesis attempt, it binds the exact accepted
provider generation, task, attempt, team, artifact digest, and inherited source
provenance identities that match the frozen input contract. This binding is not
a plan mutation.

A failed or cancelled required lane stops the synthesis join. Its output is not
an ordinary synthesis input and cannot satisfy a provider edge or appear in the
accepted provider-evidence input set.

The synthesizer does not inspect source, create new evidence, apply patches,
authorize writes, schedule successors, or mutate lifecycle state.

### Legacy diagnostic distinction

The existing standalone static Cortex-audit aggregation is not this ordinary
role. Its all-terminal join may supply verified completed and failed terminal
observations so its diagnostic report retains lane failures. Failed
observations never count as accepted provider evidence, and the legacy output
cannot satisfy an ordinary provider edge, authorize implementation, or claim
compliance with this contract.

The delivery owner follows the canonical
[structural expert registry](../architecture/refactoring-experts.md) and
[workflow](../workflows/structural-refactoring.md).

## Examples

- Correlate a stronger Rust domain type with stale TypeScript-mirroring guidance.
- Order the provider correction before its consumer and Cortex updates.

## Validation

Every synthesized finding references an attempt-bound typed accepted provider-
evidence input matching the frozen input contract and preserves its source
provenance.
No failed or cancelled lane is counted as accepted evidence or as satisfaction
of a required provider edge.
Every edit group names its dependencies, paths, and validation.
