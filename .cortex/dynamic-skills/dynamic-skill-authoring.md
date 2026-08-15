# Dynamic Skill Authoring

## Relationships

- [Cortex document navigation](cortex-document-map.md)
  - Defines the mandatory relationship and internal-map structure.
  - Apply whenever this skill card changes.
- [Cortex writer](cortex-writer.md)
  - Keeps the card and its navigation summaries concise.
  - Apply while editing or reviewing this guidance.
- [Cortex consistency](cortex-consistency.md)
  - Requires the card to agree with related guidance and current code.
  - Apply when rules, paths, commands, or examples change.
- [Dynamic skill workflow](../workflows/dynamic-skills.md)
  - Owns canonical card capture, executable wrappers, and host mirrors.
  - Follow when publishing or invoking a dynamic skill.

## Document map

- [Purpose](#purpose)
  - Explains why the skill exists and what invariant it protects.
  - Read first to decide whether the skill applies.
- [Problem Pattern](#problem-pattern)
  - Identifies the recurring rejected pattern and its warning signs.
  - Read while locating or reviewing violations.
- [Capture procedure](#capture-procedure)
  - Orders inspection, durable capture, registration, and optional refactoring.
  - Follow when recording reusable project guidance.
- [Scope](#scope)
  - Sets the applicable paths and explicit boundaries.
  - Read before expanding the task.
- [Examples](#examples)
  - Contrasts rejected and preferred forms.
  - Read when the rule needs a concrete illustration.
- [Card requirements](#card-requirements)
  - Defines the content and registration invariants for a durable card.
  - Use while authoring and reviewing the card.
- [Validation](#validation)
  - Names the smallest relevant mechanical and semantic proof.
  - Run before completing the task.

## Purpose

Capture a user's concrete code feedback as durable project knowledge in the
canonical `.cortex/dynamic-skills/` registry, then make that knowledge reusable
for future refactors.

## Problem Pattern

The user has to repeatedly explain the same architectural or logic mistake in
prompts because the lesson exists only in chat context. Agents then rediscover
the rule instead of applying it from the repository.

## Capture procedure

When the user invokes `/dynamic-skill` or explains a reusable mistake:

1. Inspect the referenced code.
2. Convert the explanation into a concise `.cortex/dynamic-skills/<skill>.md`
   card. This card is the source of truth.
3. Update `.cortex/dynamic-skills/index.md`.
4. Create `.agents/skills/<skill>/SKILL.md` when the pattern should be invokable
   directly by future agents.
   - Keep the wrapper concise and point it back to the `.cortex` card.
   - Keep `.cursor/skills/` and `.claude/skills/` as symlink mirrors of the
     canonical `.agents` wrapper.
5. Apply the skill to code when the user asks for capture plus refactor.

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

- Read `.cortex/workflows/dynamic-skills.md` before capture.
- Update an existing skill card when it already owns the lesson.
- For a new card:
  - scaffold with
    `task loom:skill-scaffold CONFIG=<skill-scaffold-request.yaml>`;
  - keep problem, preferred pattern, scope, examples, and validation concrete;
  - set `createExecutableWrappers: true` only when direct invocation is useful;
    and
  - update `.cortex/dynamic-skills/index.md` if Loom did not.
- Run `task loom:cortex-audit` after the card and registry agree.

## Validation

For documentation-only captures, run `task loom:cortex-audit`.

For code refactors using a dynamic skill, run `task loom:pre-push`, commit and
push, use focused hosted tasks as useful, then explicitly trigger complete
validation with `task pr:validate`.
