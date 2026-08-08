# Project Skill Registry

This directory is the canonical project skill registry for Nook agents. The
directory name `dynamic-skills` means the skills are captured and updated
dynamically from concrete project feedback; it does not mean optional or ad hoc.

Use this index before refactors, review handling, issue-scope decisions, or skill
creation so agents apply the existing repo-specific guidance and keep related
knowledge consolidated. Executable `.agents/skills/` entries (mirrored in `.cursor/skills/` and `.claude/skills/`) enable direct invocation across Antigravity, Cursor, Claude, and Codex; the `.cortex` card remains the source of truth.

| Skill card | Purpose | Executable skill |
|---|---|---|
| [source-file-size.md](source-file-size.md) | **P1 / most critical structure rule:** every authored file, including Rust, has one 1,000-line ceiling; oversized Rust signals excessive domain responsibility and requires cohesive decomposition | [`.agents/skills/source-file-size/SKILL.md`](../../.agents/skills/source-file-size/SKILL.md) |
| [cortex-writer.md](cortex-writer.md) | **P1 / critical `.cortex` writing rule:** split long dense sentences into short sentences, bullets, and lists to reduce cognitive complexity | [`.agents/skills/cortex-writer/SKILL.md`](../../.agents/skills/cortex-writer/SKILL.md) |
| [cortex-consistency.md](cortex-consistency.md) | **P1 / critical `.cortex` GC rule:** verify docs are current, agree with each other, and agree with the code | [`.agents/skills/cortex-consistency/SKILL.md`](../../.agents/skills/cortex-consistency/SKILL.md) |
| [code-review-comments.md](code-review-comments.md) | Handle every active comment without waiting for reviewers: verify, fix or explain, validate, push, reply on-thread, then resolve | [`.agents/skills/code-review-comments/SKILL.md`](../../.agents/skills/code-review-comments/SKILL.md) |
| [dynamic-skill-authoring.md](dynamic-skill-authoring.md) | Capture user feedback as durable `.cortex` skill cards and optional project skills | [`.agents/skills/dynamic-skill/SKILL.md`](../../.agents/skills/dynamic-skill/SKILL.md) |
| [efficient-pr-delivery.md](efficient-pr-delivery.md) | Ship PRs with focused hosted execution, explicit complete validation, and exact-head readiness | [`.agents/skills/efficient-pr-delivery/SKILL.md`](../../.agents/skills/efficient-pr-delivery/SKILL.md) |
| [github-actions-only-validation.md](github-actions-only-validation.md) | Format locally; run focused tasks and complete gates explicitly on GitHub-hosted workers | [`.agents/skills/github-actions-only-validation/SKILL.md`](../../.agents/skills/github-actions-only-validation/SKILL.md) |
| [pre-push-hygiene.md](pre-push-hygiene.md) | Always host-apply `task format` and pass the UI demo contract before every push so Verify does not burn cycles on Prettier/rustfmt/demo misses | [`.agents/skills/pre-push-hygiene/SKILL.md`](../../.agents/skills/pre-push-hygiene/SKILL.md) |
| [browser-extension-release-security.md](browser-extension-release-security.md) | Apply origin, identity, archive, redirect, and profile-isolation checks before shipping extension artifacts | [`.agents/skills/browser-extension-release-security/SKILL.md`](../../.agents/skills/browser-extension-release-security/SKILL.md) |
| [feature-issue-planning.md](feature-issue-planning.md) | Organize each feature as a Workbench directory with a shared summary, focused Markdown issues, dependencies, and explicit automation state | |
| [issue-scope-management.md](issue-scope-management.md) | Preserve deferred, risky, or too-large work in existing Workbench feature/issue records and task worklogs without disrupting other agents | [`.agents/skills/issue-scope-management/SKILL.md`](../../.agents/skills/issue-scope-management/SKILL.md) |
| [rust-coding.md](rust-coding.md) | Keep Rust domain models precise: replace string tags, sentinel values, and cross-workflow `Option<T>` fields with enums and per-variant structs | [`.agents/skills/rust-coding/SKILL.md`](../../.agents/skills/rust-coding/SKILL.md) |
| [rust-macro-minimization.md](rust-macro-minimization.md) | Prohibit repository-defined Rust macros; prefer explicit structs, implementations, functions, and control flow over hidden code generation | [`.agents/skills/rust-macro-minimization/SKILL.md`](../../.agents/skills/rust-macro-minimization/SKILL.md) |
| [rust-typescript-code-separation.md](rust-typescript-code-separation.md) | Keep app/domain data shapes and generated DTOs in Rust/WASM, reserve TypeScript for UI/browser glue, and model sum types as enums | |
| [svelte-state-modeling.md](svelte-state-modeling.md) | Use concise Svelte rune declarations for optional UI state and keep closed domain states in Rust/WASM | |
| [typescript-serial-operation-queues.md](typescript-serial-operation-queues.md) | Encapsulate serial async work behind enqueue, idle, and reset operations instead of exposing mutable promise chains | |
| [typescript-explicit-state.md](typescript-explicit-state.md) | Replace authored `undefined`/`null` state with semantic unions while retaining complete `void` unit/effect returns; reject every value-or-void contract, including nested generics and returns | |
| [typescript-domain-structure.md](typescript-domain-structure.md) | Nest same-prefix closed vocabularies into parent objects + operation enums; use field enums instead of string sets; ban hand-rolled TypeScript `Result`/`Maybe` | |
| [ui-design-skills.md](ui-design-skills.md) | Load `design-taste-frontend` for user-visible UI work; Impeccable is disabled by default and may be used only when the user explicitly requests it | |
| [web-unused-code.md](web-unused-code.md) | Enable class-member analysis in every web Knip graph and remove every valid unused-code finding | |

## How To Add One

1. Scaffold with Loom using a `skillScaffold` domain request YAML.
2. Fill in the problem pattern, preferred pattern, scope, examples, and
   validation.
3. Confirm the new card is in the table above.
4. If the user wants direct invocation, set `createExecutableWrappers: true` or
   create `.agents/skills/<skill-name>/SKILL.md` (with `.cursor` / `.claude`
   symlinks) pointing back to the `.cortex` card, then link it from the table.
5. Verify with `task loom:cortex-audit`.

See [loom-tools.md](../references/loom-tools.md).
