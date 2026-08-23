# Project Skill Registry

This directory is the canonical project skill registry for Nook agents. The
directory name `dynamic-skills` means the skills are captured and updated
dynamically from concrete project feedback; it does not mean optional or ad hoc.

Use this index before refactors, review handling, issue-scope decisions, or skill
creation. Apply existing repository guidance and keep related knowledge
consolidated.

Agent skill adapters under `.agents/skills/` enable direct invocation. `.cursor/skills/`
and `.claude/skills/` contain symlink mirrors. The `.cortex` card remains the
source of truth.

## Skill catalog

- **[typescript-rust-automation-only.md](typescript-rust-automation-only.md)**
  - Purpose: **P1 hard rule:** prohibit repository-authored Python and use Bun/TypeScript, Rust, and Taskfiles for automation
  - Agent skill adapter: [`.agents/skills/typescript-rust-automation-only/SKILL.md`](../../.agents/skills/typescript-rust-automation-only/SKILL.md)
- **[source-file-size.md](source-file-size.md)**
  - Purpose: **P1 / most critical structure rule:** every authored file, including Rust, has one 1,000-line ceiling; oversized Rust signals excessive domain responsibility and requires cohesive decomposition
  - Agent skill adapter: [`.agents/skills/source-file-size/SKILL.md`](../../.agents/skills/source-file-size/SKILL.md)
- **[cortex-writer.md](cortex-writer.md)**
  - Purpose: **P1 / critical `.cortex` writing rule:** split long dense sentences into short sentences, bullets, and lists; reserve tables for compact repeated fields or exact mappings
  - Agent skill adapter: [`.agents/skills/cortex-writer/SKILL.md`](../../.agents/skills/cortex-writer/SKILL.md)
- **[cortex-article-structure.md](cortex-article-structure.md)**
  - Purpose: **P1 / critical `.cortex` article rule:** expose explanation, rules, procedures, branches, and reference data through semantic hierarchy
  - Agent skill adapter: [`.agents/skills/cortex-article-structure/SKILL.md`](../../.agents/skills/cortex-article-structure/SKILL.md)
- **[cortex-consistency.md](cortex-consistency.md)**
  - Purpose: **P1 / critical `.cortex` GC rule:** verify docs are current, agree with each other, and agree with the code
  - Agent skill adapter: [`.agents/skills/cortex-consistency/SKILL.md`](../../.agents/skills/cortex-consistency/SKILL.md)
- **[product-spec-lifecycle.md](product-spec-lifecycle.md)**
  - Purpose: **P1 / critical product spec rule:** read owning product specs before implementation; update specs on new knowledge from chat, tasks, or PR iterations
  - Agent skill adapter: [`.agents/skills/product-spec-lifecycle/SKILL.md`](../../.agents/skills/product-spec-lifecycle/SKILL.md)
- **[agent-feature-ownership.md](agent-feature-ownership.md)**
  - Purpose: Keep every agent inside its assigned feature and focused issue set
  - Agent skill adapter: [`.agents/skills/agent-feature-ownership/SKILL.md`](../../.agents/skills/agent-feature-ownership/SKILL.md)
- **[code-review-comments.md](code-review-comments.md)**
  - Purpose: Address active actionable feedback and resolve its review conversations
  - Agent skill adapter: [`.agents/skills/code-review-comments/SKILL.md`](../../.agents/skills/code-review-comments/SKILL.md)
- **[dynamic-skill-authoring.md](dynamic-skill-authoring.md)**
  - Purpose: Capture user feedback as durable `.cortex` skill cards and optional project skills
  - Agent skill adapter: [`.agents/skills/dynamic-skill/SKILL.md`](../../.agents/skills/dynamic-skill/SKILL.md)
- **[efficient-pr-delivery.md](efficient-pr-delivery.md)**
  - Purpose: Ship PRs with focused configured-runner execution, complete exact-head validation, and readiness
  - Agent skill adapter: [`.agents/skills/efficient-pr-delivery/SKILL.md`](../../.agents/skills/efficient-pr-delivery/SKILL.md)
- **[github-actions-only-validation.md](github-actions-only-validation.md)**
  - Purpose: Format locally; run focused tasks and trusted Rust gates on the configured Actions runner while runtime-dependent gates stay GitHub-hosted
  - Agent skill adapter: [`.agents/skills/github-actions-only-validation/SKILL.md`](../../.agents/skills/github-actions-only-validation/SKILL.md)
- **[pre-push-hygiene.md](pre-push-hygiene.md)**
  - Purpose: Always host-apply `task format` and pass the UI demo contract before every push so Verify does not burn cycles on Prettier/rustfmt/demo misses
  - Agent skill adapter: [`.agents/skills/pre-push-hygiene/SKILL.md`](../../.agents/skills/pre-push-hygiene/SKILL.md)
- **[browser-extension-release-security.md](browser-extension-release-security.md)**
  - Purpose: Apply origin, identity, archive, redirect, and profile-isolation checks before shipping extension artifacts
  - Agent skill adapter: [`.agents/skills/browser-extension-release-security/SKILL.md`](../../.agents/skills/browser-extension-release-security/SKILL.md)
- **[feature-issue-planning.md](feature-issue-planning.md)**
  - Purpose: Organize each feature as a Workbench directory with a shared summary, focused Markdown issues, dependencies, and explicit automation state
- **[issue-scope-management.md](issue-scope-management.md)**
  - Purpose: Preserve deferred, risky, or too-large work in existing Workbench feature/issue records and task worklogs without disrupting other agents
  - Agent skill adapter: [`.agents/skills/issue-scope-management/SKILL.md`](../../.agents/skills/issue-scope-management/SKILL.md)
- **[module-expert.md](module-expert.md)**
  - Purpose: Route exact-baseline production-module analysis through one named read-only expert without granting write or scheduling authority
  - Agent skill adapter: [`.agents/skills/module-expert/SKILL.md`](../../.agents/skills/module-expert/SKILL.md)
- **[internal-api-expert.md](internal-api-expert.md)**
  - Purpose: Design the smallest provider-consumer contract across Rust crates, both WASM bridges, generated bindings, and TypeScript adapters
  - Agent skill adapter: [`.agents/skills/internal-api-expert/SKILL.md`](../../.agents/skills/internal-api-expert/SKILL.md)
- **[code-refactoring-expert.md](code-refactoring-expert.md)**
  - Purpose: Audit one code surface for architecture, design, quality, tests, and stronger types without granting write authority
  - Agent skill adapter: [`.agents/skills/code-refactoring-expert/SKILL.md`](../../.agents/skills/code-refactoring-expert/SKILL.md)
- **[cortex-refactoring-expert.md](cortex-refactoring-expert.md)**
  - Purpose: Audit Cortex complexity, conflicts, duplication, legacy guidance, ownership drift, and deterministic extraction candidates
  - Agent skill adapter: [`.agents/skills/cortex-refactoring-expert/SKILL.md`](../../.agents/skills/cortex-refactoring-expert/SKILL.md)
- **[system-coherence-synthesizer.md](system-coherence-synthesizer.md)**
  - Purpose: Reconcile verified code and Cortex evidence without repository access or write authority
  - Agent skill adapter: [`.agents/skills/system-coherence-synthesizer/SKILL.md`](../../.agents/skills/system-coherence-synthesizer/SKILL.md)
- **[rust-coding.md](rust-coding.md)**
  - Purpose: Keep Rust domain models precise: replace string tags, sentinel values, and cross-workflow `Option<T>` fields with enums and per-variant structs
  - Agent skill adapter: [`.agents/skills/rust-coding/SKILL.md`](../../.agents/skills/rust-coding/SKILL.md)
- **[rust-macro-minimization.md](rust-macro-minimization.md)**
  - Purpose: Prohibit repository-defined Rust macros; prefer explicit structs, implementations, functions, and control flow over hidden code generation
  - Agent skill adapter: [`.agents/skills/rust-macro-minimization/SKILL.md`](../../.agents/skills/rust-macro-minimization/SKILL.md)
- **[rust-typescript-code-separation.md](rust-typescript-code-separation.md)**
  - Purpose: Keep app and extension policy in Rust/WASM; reserve TypeScript for UI, browser observation, and lifecycle glue
- **[rust-wasm-name-coherence.md](rust-wasm-name-coherence.md)**
  - Purpose: Keep exported Rust WASM functions and methods directly searchable under their authored names across generated bindings and TypeScript
- **[svelte-state-modeling.md](svelte-state-modeling.md)**
  - Purpose: Use concise Svelte rune declarations for optional UI state and keep closed domain states in Rust/WASM
- **[typescript-serial-operation-queues.md](typescript-serial-operation-queues.md)**
  - Purpose: Encapsulate serial async work behind enqueue, idle, and reset operations instead of exposing mutable promise chains
- **[typescript-explicit-state.md](typescript-explicit-state.md)**
  - Purpose: Replace authored `undefined`/`null` state with semantic unions while retaining complete `void` unit/effect returns; reject every value-or-void contract, including nested generics and returns
- **[typescript-domain-structure.md](typescript-domain-structure.md)**
  - Purpose: Nest same-prefix closed vocabularies into parent objects + operation enums; use field enums instead of string sets; ban hand-rolled TypeScript `Result`/`Maybe`
- **[typescript-single-parameter.md](typescript-single-parameter.md)**
  - Purpose: Limit authored functions to one parameter
  - Agent skill adapter: [`.agents/skills/typescript-single-parameter/SKILL.md`](../../.agents/skills/typescript-single-parameter/SKILL.md)
- **[typescript-no-unknown.md](typescript-no-unknown.md)**
  - Purpose: Ban `unknown`, `object`, and generic domain values; allow `unknown` only for immediate boundary narrowing
  - Agent skill adapter: [`.agents/skills/typescript-no-unknown/SKILL.md`](../../.agents/skills/typescript-no-unknown/SKILL.md)
- **[typescript-named-args.md](typescript-named-args.md)**
  - Purpose: Require semantic named object parameter contracts and named typed values at object call boundaries
  - Agent skill adapter: [`.agents/skills/typescript-named-args/SKILL.md`](../../.agents/skills/typescript-named-args/SKILL.md)
- **[prefer-popular-libraries.md](prefer-popular-libraries.md)**
  - Purpose: Before writing boilerplate, prefer mature high-adoption libraries; reject obscure low-star/low-download deps; validate with Loom `dependencyPopularity`
  - Agent skill adapter: [`.agents/skills/prefer-popular-libraries/SKILL.md`](../../.agents/skills/prefer-popular-libraries/SKILL.md)
- **[ui-design-skills.md](ui-design-skills.md)**
  - Purpose: Load `design-taste-frontend` for user-visible UI work; Impeccable is disabled by default and may be used only when the user explicitly requests it
- **[web-unused-code.md](web-unused-code.md)**
  - Purpose: Enable class-member analysis in every web Knip graph and remove every valid unused-code finding
- **[cortex-document-map.md](cortex-document-map.md)**
  - Purpose: Centralize Cortex navigation and section anchors in `.cortex/knowledge-graph.md`
  - Agent skill adapter: [`.agents/skills/cortex-document-map/SKILL.md`](../../.agents/skills/cortex-document-map/SKILL.md)
- **[testing-pyramid-and-regression.md](testing-pyramid-and-regression.md)**
  - Purpose: Enforce ~99% domain coverage in Rust, mandatory regression tests for bug fixes, and 90% Rust line coverage floor
- **[docker-container-harness.md](docker-container-harness.md)**
  - Purpose: Prohibit Dockerfile cache mounts and killing the Docker daemon; enforce exact dependency pinning and Bun lockfiles
- **[self-improvement.md](self-improvement.md)**
  - Purpose: Capture provisional discoveries, promote durable knowledge, and extract stable workflow mechanics into reviewed Loom tools and graphs
  - Agent skill adapter: [`.agents/skills/self-improvement/SKILL.md`](../../.agents/skills/self-improvement/SKILL.md)

## How to add one

1. Scaffold with Loom using a `skillScaffold` domain request YAML.
2. Fill in the problem pattern, preferred pattern, scope, examples, and
   validation.
3. Confirm the new card is in the catalog above.
4. If the user wants direct invocation, set `createExecutableWrappers: true` or
   create `.agents/skills/<skill-name>/SKILL.md` (with `.cursor` / `.claude`
   symlinks) pointing back to the `.cortex` card, then link it from the catalog.
5. Verify with `task loom:cortex-audit`.

See [Loom tools](../references/loom-tools.md).
