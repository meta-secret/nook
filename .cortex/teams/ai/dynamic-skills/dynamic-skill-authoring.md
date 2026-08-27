# Dynamic Skill Authoring

## Purpose

Capture a user's concrete code feedback as durable project knowledge in the
canonical team-owned dynamic-skill registry, then make that knowledge reusable
for future refactors.

## Problem Pattern

The user has to repeatedly explain the same architectural or logic mistake in
prompts because the lesson exists only in chat context. Agents then rediscover
the rule instead of applying it from the repository.

## Capture procedure

When the user invokes `/dynamic-skill` or explains a reusable mistake:

1. Inspect the referenced code.
2. Select the responsible team through
   [Engineering team ownership](../../../gizmo/architecture/team-ownership.md).
3. Convert the explanation into a concise card in the owner's
   `dynamic-skills/` directory.
   - Use Gizmo for delivery-control knowledge.
   - Use the responsible engineering team for implementation knowledge.
   - Use shared only for ownerless repository-wide policy.
   - Preserve security ownership for security policy and acceptance.
   Multi-team consumption does not erase a clear owner. This card is the
   source of truth.
4. Update `.cortex/teams/ai/dynamic-skills/index.md`.
5. Keep harness-specific profile directories outside the tracked repository.
   Do not duplicate semantic guidance under `.agents`, `.cursor`, or `.claude`.
6. Apply the skill to code when the user asks for capture plus refactor.

## Scope

Applies to:

- Durable architecture, boundary, logic, testing, and refactor guidance.
- Patterns that can be reused across future tasks.
- Prompt conventions such as `/dynamic-skill` and `Use <skill-name> to refactor`.

Does not apply to:

- One-off task status.
- Secrets, credentials, or private data.
- Temporary debugging observations that do not change how future code should be
  written.

## Examples

- Before: User repeats the same code organization critique in every prompt.
- After: User says `/dynamic-skill`, the agent creates or updates a skill card,
  and later agents can apply that named skill to a requested scope.

## Card requirements

- Read `.cortex/teams/ai/workflows/dynamic-skills.md` before capture.
- Update an existing skill card when it already owns the lesson.
- For a new card:
  - scaffold with
    `task loom:skill-scaffold CONFIG=<skill-scaffold-request.yaml>`;
  - set `skillOwner` to `gizmo` for delivery control, to the responsible team
    for implementation knowledge, to `ai` for AI-system knowledge, or to
    `shared` for ownerless repository-wide policy;
  - use `security` for security policy, trust boundaries, and acceptance;
  - keep problem, preferred pattern, scope, examples, and validation concrete;
  - update `.cortex/teams/ai/dynamic-skills/index.md` and the owning knowledge graph if
    Loom did not.
- Run `task loom:cortex-audit` after the card and registry agree.

## Validation

For documentation-only captures, run `task loom:cortex-audit`.

For code refactors using a dynamic skill, run `task loom:pre-push`, commit and
push, use focused hosted tasks as useful, then explicitly trigger complete
validation with `task pr:validate`.
