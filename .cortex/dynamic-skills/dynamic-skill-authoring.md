# Dynamic Skill Authoring

## Purpose

Capture a user's concrete code feedback as durable project knowledge, then make
that knowledge reusable for future refactors.

## Problem Pattern

The user has to repeatedly explain the same architectural or logic mistake in
prompts because the lesson exists only in chat context. Agents then rediscover
the rule instead of applying it from the repository.

## Preferred Pattern

When the user invokes `/dynamic-skill` or explains a reusable mistake:

1. Inspect the referenced code.
2. Convert the explanation into a concise `.cortex/dynamic-skills/<skill>.md`
   card.
3. Update `.cortex/dynamic-skills/index.md`.
4. Create `.cursor/skills/<skill>/SKILL.md` when the pattern should be invokable
   directly by future agents.
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

## Application Checklist

- [ ] Read `.cortex/workflows/dynamic-skills.md`.
- [ ] Decide whether to update an existing skill card or create a new one.
- [ ] Keep the card concrete: problem, preferred pattern, scope, examples,
      validation.
- [ ] Create a Cursor project skill only when direct invocation is useful.
- [ ] Update `.cortex/dynamic-skills/index.md`.

## Validation

For documentation-only captures, verify links and skill metadata. For code
refactors using a dynamic skill, run the smallest relevant checks first and
finish with `task check` before push.
