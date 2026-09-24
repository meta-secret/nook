# Agent Self-Improvement

## Purpose

Use concrete Nook evidence to improve durable context without making Cortex a
mandatory journal. No Cortex update is a valid outcome. Generic documentation
ownership and authoring follow Meta-Cortex
[Context Engineering](../../../../.meta-cortex/teams/ai-team/agents/tech-writer/skills/context-engineering/SKILL.md);
this card owns Nook promotion targets, session boundaries, and product
authority.

## Session notes

- A session file is optional; create `.cortex/.session/<task>.md` only when
  temporary notes materially help the task.
- Never store secrets, private data, environment dumps, or large logs there.
- Remove session notes before handoff and confirm
  `git ls-files .cortex/.session` is empty.

## Knowledge classification

Use upstream [Context Engineering](../../../../.meta-cortex/teams/ai-team/agents/tech-writer/skills/context-engineering/SKILL.md)
for generic knowledge classification and review. Use its
[knowledge-graph guidance](../../../../.meta-cortex/teams/ai-team/agents/tech-writer/skills/context-engineering/practices/knowledge-graphs.md)
to locate the owning authority.

## Self-improvement review

Use upstream [bounded review](../../../../.meta-cortex/teams/ai-team/agents/tech-writer/skills/context-engineering/practices/consistency.md#bounded-review)
when Nook work reveals durable lessons or stale, duplicated, contradictory,
or missing guidance. A session file is not required.

## Promotion criteria

Promote only when Nook source, behavior-focused tests, configuration, repository
workflow, observed behavior, or an accepted product decision supports the
lesson. Update the specific product authority for behavior, the owning team
rule for Nook procedures, or use the
[dynamic-skill authoring workflow](dynamic-skill-authoring.md) for reusable
implementation patterns; update its index and graph when ownership or path
changes. Route generic writing and consistency rules upstream. Keep task state,
speculation, stale observations, and facts evident from nearby code ephemeral.

## Evidence and consistency

When evidence conflicts or is weak, resolve it with upstream
[bounded review](../../../../.meta-cortex/teams/ai-team/agents/tech-writer/skills/context-engineering/practices/consistency.md#bounded-review)
or keep the candidate ephemeral. Use the
[root graph](../../../knowledge-graph.md) and owning team graph to find the
Nook authority; update a graph only when ownership, path, or discoverability
changes. Correct inaccurate Nook guidance from implementation evidence and
report code that violates an active requirement.

## Protocol evolution safety

Change a Nook protocol when observed work shows repeated mistakes, missing
validation, poor context selection, unnecessary repeated work, or a clearly
safer, simpler workflow. Preserve existing safeguards.

## User authority for major architectural initiatives

The user selects major architectural initiatives. Before explicit selection, an
agent may investigate, explain the problem, compare bounded alternatives,
recommend a direction, and record proposal evidence. Implementation starts only
after the user selects the direction and explicitly asks to implement it.

This gate applies to a new subsystem, runtime, execution or storage model,
security boundary, cross-module ownership or dependency direction, broad
protocol migration, multi-PR program, substantial operational commitment,
materially different project pattern, or solution whose complexity or risk is
disproportionate to the request. It does not restrict ordinary fixes, tests,
documentation corrections, or architecture-preserving refactors.

## Workflow improvement review

Use upstream [bounded review](../../../../.meta-cortex/teams/ai-team/agents/tech-writer/skills/context-engineering/practices/consistency.md#bounded-review)
for a touched Nook workflow when evidence shows duplicated guidance, repeated
deterministic work, unclear ownership, or recurring friction.

### Instruction classification

Follow upstream [Context Engineering](../../../../.meta-cortex/teams/ai-team/agents/tech-writer/skills/context-engineering/SKILL.md)
for generic instruction classification; use Nook's
[subagent-delegation contract](../../../gizmo-prime/workflows/subagent-delegation.md)
for bounded delegation and shared-edit ownership.

### Loom extraction procedure

1. Find the owning Nook authority in the root and team knowledge graphs.
2. Keep semantic policy there; put only deterministic assertions in Nook Loom or Task tooling.
3. Validate the changed policy through hosted PR checks.

## Pull-request completion contract

Before returning an AI-owned Cortex change to Gizmo:

- Focused implementation evidence supports each promoted rule, with one owning
  authority; update related callers when ownership or discoverability changes.
- Remove optional session notes and confirm no session file is tracked.
- PR readiness requires removing temporary Cortex session memory. The hosted
  check runs `task loom:cortex-session-clean` against the ignored session
  directory.
- Include the branch, focused evidence, and unresolved blockers in the report.
- Include promotion in the PR for the work that justified it; rerun required
  hosted checks after the head changes.

For semantic review, follow the upstream authoring practices. Mechanical Nook
Cortex checks run only in the required PR stage listed by the
[Cortex document-map card](cortex-document-map/SKILL.md#validation); do not run
them locally or during feature work.
