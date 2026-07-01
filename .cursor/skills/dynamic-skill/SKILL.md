---
name: dynamic-skill
description: >-
  Captures user-explained codebase lessons as durable project dynamic skills and
  applies them to refactors. Use when the user invokes /dynamic-skill, asks to
  create or update dynamic skills, explains what is wrong with a recurring code
  pattern, or wants to refactor code using accumulated skill guidance.
---

# Dynamic Skill

Use this skill when the user says `/dynamic-skill`, asks to create a reusable
codebase skill, or asks to refactor code using a previously captured dynamic
skill.

System of record: [`.cortex/workflows/dynamic-skills.md`](../../.cortex/workflows/dynamic-skills.md).
Registry: [`.cortex/dynamic-skills/index.md`](../../.cortex/dynamic-skills/index.md).

## Intake

1. Read [`.cortex/AGENTS.md`](../../.cortex/AGENTS.md) and the dynamic skills
   workflow.
2. Inspect the concrete code example before generalizing.
3. Extract the durable lesson:
   - Problem pattern.
   - Preferred pattern.
   - Scope and non-scope.
   - Examples or code references.
   - Validation checks.
4. Update an existing skill card when possible; otherwise create
   `.cortex/dynamic-skills/<skill-name>.md` from the template.
5. Update `.cortex/dynamic-skills/index.md`.
6. Create `.cursor/skills/<skill-name>/SKILL.md` only when the user wants direct
   invocation for future agents.

Ask a clarifying question only if the intended scope or preferred pattern cannot
be inferred from the user's example and nearby code.

## Apply

When the user says `Use <skill-name> and refactor <scope>`:

1. Read the named skill card and any linked Cursor skill.
2. Search the requested scope for the problem pattern.
3. Refactor to the preferred pattern without unrelated cleanup.
4. Add or update tests when behavior or a durable invariant changes.
5. Run focused validation first. For implementation tasks, follow
   [coding-bro](../coding-bro/SKILL.md) and finish with `task check` before push.

## Output

After capture or application, report:

- The skill card created or updated.
- Any Cursor skill created or updated.
- The code scope changed, if a refactor was applied.
- Validation run or intentionally skipped.
