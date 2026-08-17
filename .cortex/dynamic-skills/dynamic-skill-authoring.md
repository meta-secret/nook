# Dynamic Skill Authoring

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

