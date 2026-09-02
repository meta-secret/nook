# Agent Self-Improvement

## Purpose

Promote durable, evidenced lessons from agent work without turning Cortex into
a mandatory journal or scratchpad. No Cortex update is a valid outcome.

## Memory boundaries

- **Working memory** is temporary, noisy, and never authoritative.
- **Project knowledge** records durable architecture, domains, invariants, and
  constraints.
- **Agent protocols** record reusable investigation, decision, validation, and
  delivery rules.
- **Project workflows** record repeatable repository-specific procedures.

Session-memory rules:

- Create `.cortex/.session/<task>.md` only when temporary notes materially help
  the current work.
- A session file is optional; substantial work does not require one.
- Never store credentials or secrets.
- Never store private data.
- Never store environment dumps or large logs.
- The directory is ignored.
- Remove every session file before readiness.

## Knowledge classification

Classify a candidate before changing persistent Cortex.

- **Project knowledge:** update the most specific architecture, design,
  product, or reference authority.
- **Agent protocol:** update the owning team rule, shared policy, or workflow.
- **Project workflow:** update the existing owning workflow.
- **Ephemeral knowledge:** do not promote task state, speculation, immediately
  stale facts, obvious nearby-code facts, or duplicated guidance.

Prefer one canonical authority over overlapping notes.

## Self-improvement review

Review discoveries when the work revealed a durable lesson or exposed stale,
duplicated, contradictory, or missing guidance. Ask:

1. What evidence changed a future implementation or agent decision?
2. Which existing authority owns that fact or rule?
3. Would preserving it materially reduce future cost or risk?
4. What should remain ephemeral?

This review may use notes, diffs, tests, command evidence, or the completed
work directly. It does not require creating a session file.

## Promotion criteria

Promote a candidate only when it is durable and supported by authoritative
evidence such as source code, behavior-focused tests, configuration,
repository workflows, observed behavior, or relevant history. Non-obviousness
strengthens a candidate but is not required to correct a Cortex defect. Useful
candidates commonly:

- affect future implementation decisions;
- explain an invariant or non-obvious constraint;
- correct inaccurate or conflicting documentation;
- capture a repeatable workflow; or
- prevent meaningful repeated investigation.

No Cortex update is a valid outcome. Never manufacture documentation changes
to satisfy this skill.

## Evidence and consistency

When evidence is weak or contradictory, investigate further or leave the
candidate ephemeral. Never turn a guess into an architectural rule.

For every promotion:

1. Find the owning document through the root and team graphs.
2. Update an existing authority when possible.
3. Create a document only when no current authority owns the knowledge.
4. Update the owning graph only when document ownership, path, or
   discoverability changes.
5. Apply [Cortex consistency](cortex-consistency/SKILL.md), the canonical writer, and
   article-structure rules.
6. Validate the resulting Cortex tree.

## Protocol evolution safety

Change a protocol only when observed evidence shows one of these triggers:

- repeated mistakes;
- missing validation;
- poor context selection;
- unnecessary repeated work; or
- a clearly safer and simpler workflow.

Every correction must be small, generalizable, and consistent with existing
safeguards. Do not add self-justifying rules. Do not preserve process merely
because tests assert its prose.

## User authority for major architectural initiatives

The user selects major architectural initiatives. Before explicit selection,
an agent may:

- investigate;
- explain the problem;
- compare bounded alternatives;
- recommend a direction; and
- record proposal evidence.

The following signals require this gate:

- a new subsystem, runtime, execution model, or storage model;
- a new security boundary, cross-module ownership direction, or dependency
  direction;
- a new protocol or broad migration;
- a multi-PR program;
- a substantial operational commitment;
- a materially different project pattern; or
- solution complexity or risk disproportionate to the request.

An agent must not implement such a direction from analysis or selection alone.
After the user selects a direction, implementation begins only when the user
explicitly requests that selected solution to be implemented.

This gate does not restrict ordinary fixes, tests, documentation corrections,
or refactors that preserve accepted architecture. After explicit implementation
authorization, agents retain normal autonomy for bounded decisions inside the
selected outcome.

## Workflow improvement review

Review the touched workflow and its one-hop authorities when evidence reveals
any of these triggers:

- duplicated prose;
- repeated deterministic work;
- unclear ownership; or
- recurring friction.

Do not run a broad workflow audit merely because a task was substantial.

### Instruction classification

- Keep semantic policy and judgment in the owning Cortex authority.
- Move deterministic assertions to Loom, Task, or another typed tool.
- Delegate bounded semantic evidence only under the canonical
  [subagent contract](../../../gizmo/workflows/subagent-delegation.md).
- Return shared-edit and synthesis decisions to Gizmo.
- Reject task-specific or speculative instructions.

### Loom extraction procedure

1. Find the owning workflow and inspect its linked implementation and tests.
2. Classify duplicated instructions by the categories above.
3. Move only fully deterministic behavior into a typed leaf.
4. Replace duplicated procedure with a link to the canonical authority.
5. Validate behavior and Cortex coherence.

Never derive executable topology from Markdown, YAML, prompts, temporary notes,
or model output. Processing artifacts are evidence, not durable authority.

## Pull-request completion contract

Before returning an AI-owned Cortex handoff to Gizmo:

- implementation and focused worker proof are complete;
- any promoted knowledge is evidence-backed;
- any promoted knowledge is owned by one authority;
- no speculative or duplicate guidance was promoted;
- optional temporary notes are removed;
- `git ls-files .cortex/.session` is empty; and
- the clean handoff and exact commit are reported.

Promotion enters the same pull request as the work that justified it. A changed
head requires fresh exact-head hosted validation.

## Validation

1. Run required formatters and include their mutations in the owned scope.
2. Remove optional `.cortex/.session/` notes.
3. Return the coherent formatted handoff to Gizmo.
4. Let Gizmo run `task loom:pre-push` and push the exact head.
5. Run `task remote TASK_NAME=loom:verify`.
6. Return any hosted finding to its owning team.

Do not run local product or repository gates or duplicate hosted validation in
this focused sequence.
