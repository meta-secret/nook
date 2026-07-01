# Dynamic Skills Registry

Dynamic skills are reusable, project-specific instructions captured from concrete
code review or refactor feedback. Use this index before creating a new skill card
so related knowledge stays consolidated.

| Skill card | Purpose | Cursor skill |
|---|---|---|
| [dynamic-skill-authoring.md](dynamic-skill-authoring.md) | Capture user feedback as durable `.cortex` skill cards and optional Cursor project skills | [`.cursor/skills/dynamic-skill/SKILL.md`](../../.cursor/skills/dynamic-skill/SKILL.md) |
| [rust-typescript-code-separation.md](rust-typescript-code-separation.md) | Keep app/domain data shapes in Rust and reserve TypeScript for UI presentation state and browser glue | |

## How To Add One

1. Copy [`_template.md`](_template.md) to `<skill-name>.md`.
2. Fill in the problem pattern, preferred pattern, scope, examples, and
   validation.
3. Add the new card to the table above.
4. If the user wants direct invocation, create `.cursor/skills/<skill-name>/SKILL.md`
   and link it from the table.
