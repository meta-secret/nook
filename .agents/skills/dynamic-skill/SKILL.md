---
name: dynamic-skill
description: >-
  Captures user-explained codebase lessons as durable project skills in the
  canonical .cortex/dynamic-skills registry and applies them to refactors. Use
  when the user invokes /dynamic-skill, asks to create or update dynamic skills,
  explains what is wrong with a recurring code pattern, or wants to refactor code
  using accumulated skill guidance.
---

# Dynamic Skill

Use this skill when the user says `/dynamic-skill`, asks to create a reusable
codebase skill, or asks to refactor code using a previously captured dynamic
skill.

System of record: [`.cortex/teams/ai/workflows/dynamic-skills.md`](../../../.cortex/teams/ai/workflows/dynamic-skills.md).
Registry: [`.cortex/teams/ai/dynamic-skills/index.md`](../../../.cortex/teams/ai/dynamic-skills/index.md).
Authoring rule: [`.cortex/teams/ai/dynamic-skills/dynamic-skill-authoring.md`](../../../.cortex/teams/ai/dynamic-skills/dynamic-skill-authoring.md).
The owning `.cortex/**/dynamic-skills/` card is canonical. This `.agents`
entry is the executable wrapper. Cursor and Claude entries are symlink mirrors.

## Intake

1. Read [`.cortex/AGENTS.md`](../../../.cortex/AGENTS.md) and the dynamic skills
   workflow.
2. Inspect the concrete code example before generalizing.
3. Extract the durable lesson:
   - Problem pattern.
   - Preferred pattern.
   - Scope and non-scope.
   - Examples or code references.
   - Validation checks.
4. Update an existing skill card when possible. Otherwise create the card in
   the responsible team's `dynamic-skills/` directory. Use the shared directory
   only for genuinely cross-team skills, and register every card in the
   AI-owned catalog.
5. Update `.cortex/teams/ai/dynamic-skills/index.md`.
6. Create `.agents/skills/<skill-name>/SKILL.md` when direct invocation is
   required. Add matching `.cursor/skills/` and `.claude/skills/` symlinks.

Ask a clarifying question only if the intended scope or preferred pattern cannot
be inferred from the user's example and nearby code.

## Apply

When the user says `Use <skill-name> and refactor <scope>`:

1. Read the named skill card and any linked Cursor skill.
2. Search the requested scope for the problem pattern.
3. Refactor to the preferred pattern without unrelated cleanup.
4. Add or update tests when behavior or a durable invariant changes.
5. Use focused development validation as needed. For implementation tasks,
   follow [coding-bro](../coding-bro/SKILL.md): `task loom:pre-push`, commit and push
   the coherent change, run focused `task remote` jobs, then explicitly trigger
   complete validation with `task pr:validate`.

## Output

After capture or application, report:

- The skill card created or updated.
- Any executable wrapper and mirror symlinks created or updated.
- The code scope changed, if a refactor was applied.
- Validation run or intentionally skipped.
