# Project Skill Registry

This directory is the canonical project skill registry for Nook agents. The
directory name `dynamic-skills` means the skills are captured and updated
dynamically from concrete project feedback; it does not mean optional or ad hoc.

Use this index before refactors, review handling, issue-scope decisions, or skill
creation so agents apply the existing repo-specific guidance and keep related
knowledge consolidated. Optional `.cursor/skills/` entries mirror these cards for
direct invocation; the `.cortex` card remains the source of truth.

| Skill card | Purpose | Cursor skill |
|---|---|---|
| [code-review-comments.md](code-review-comments.md) | Make CodeRabbit review handling auditable: verify, fix or explain, validate, push, reply on-thread, then resolve | [`.cursor/skills/code-review-comments/SKILL.md`](../../.cursor/skills/code-review-comments/SKILL.md) |
| [dynamic-skill-authoring.md](dynamic-skill-authoring.md) | Capture user feedback as durable `.cortex` skill cards and optional Cursor project skills | [`.cursor/skills/dynamic-skill/SKILL.md`](../../.cursor/skills/dynamic-skill/SKILL.md) |
| [issue-scope-management.md](issue-scope-management.md) | Manage deferred, risky, or too-large work through existing issues, aggregate parent issues, and focused sub-issues without disrupting other agents | [`.cursor/skills/issue-scope-management/SKILL.md`](../../.cursor/skills/issue-scope-management/SKILL.md) |
| [rust-coding.md](rust-coding.md) | Keep Rust domain models precise: replace string tags, sentinel values, and cross-workflow `Option<T>` fields with enums and per-variant structs | [`.cursor/skills/rust-coding/SKILL.md`](../../.cursor/skills/rust-coding/SKILL.md) |
| [rust-typescript-code-separation.md](rust-typescript-code-separation.md) | Keep app/domain data shapes in Rust and reserve TypeScript for UI presentation state and browser glue; model sum types as enums and treat `Option<T>` as a missing enum | |

## How To Add One

1. Copy [`_template.md`](_template.md) to `<skill-name>.md`.
2. Fill in the problem pattern, preferred pattern, scope, examples, and
   validation.
3. Add the new card to the table above.
4. If the user wants direct invocation, create `.cursor/skills/<skill-name>/SKILL.md`
   that points back to the `.cortex` card, then link it from the table.
