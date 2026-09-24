# Agent Self-Improvement

## Purpose

Use concrete work evidence to improve Nook's durable context without turning
Cortex into a mandatory journal. No documentation change is a valid outcome.
Generic documentation ownership, authoring, and consistency practices belong to
Meta-Cortex [Context Engineering](../../../../.meta-cortex/teams/ai-team/agents/tech-writer/skills/context-engineering/SKILL.md).
This Nook card owns project-specific promotion targets, session boundaries, and
product authority.

## Session notes

- Create `.cortex/.session/<task>.md` only when temporary notes materially help
  the current task. Session files are optional.
- Never store credentials, secrets, private data, environment dumps, or large
  logs in session memory.
- Remove optional session notes before the Cortex handoff. Confirm that no
  session file is tracked with `git ls-files .cortex/.session`.

## Promote Nook knowledge

Promote a lesson only when evidence from Nook source, behavior-focused tests,
configuration, repository workflows, observed behavior, or an accepted product
decision supports it.

- Update the most specific current product specification or architecture
  authority for product behavior.
- Update the owning team rule or workflow for Nook-specific agent procedures.
- Use the [dynamic-skill authoring workflow](dynamic-skill-authoring.md) for
  reusable code feedback or implementation patterns; update the central index
  and owning graph when a skill is added, moved, or retired.
- Use upstream Context Engineering for generic writing, policy ownership,
  graph, and consistency requirements instead of creating a local duplicate.
- Keep task state, speculation, immediately stale observations, and facts
  already evident from nearby code ephemeral.

Prefer an existing authority over a new document. Use implementation evidence
to correct inaccurate guidance, and report an implementation mismatch when code
violates an active requirement. The [root graph](../../../../knowledge-graph.md)
and owning team graph identify Nook document owners.

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

## Nook Cortex handoff

Before returning an AI-owned Cortex change to Gizmo:

- Every promoted rule has supporting evidence and one owning authority.
- Related callers and catalogs reflect the changed ownership, path, or
  discoverability.
- Optional session notes are removed and no session file is tracked.
- The report names the branch, focused evidence, and unresolved blockers.

For semantic review, follow the upstream authoring practices. Mechanical Nook
Cortex checks run only in the required PR stage listed by the
[Cortex document-map card](cortex-document-map/SKILL.md#validation). Do not run
those checks locally or during feature work.
