# Project Skill Registry

This directory is the canonical project skill registry for Nook agents. The
directory name `dynamic-skills` means the skills are captured and updated
dynamically from concrete project feedback; it does not mean optional or ad hoc.

Use this index before refactors, review handling, issue-scope decisions, or skill
creation. Apply existing repository guidance and keep related knowledge
consolidated.

Team-owned Cortex cards are the sole repository-local semantic skill authority.
Harness profile directories must not mirror or redefine these cards.

## Skill catalog

- **[team-oriented-development.md](../../../gizmo/dynamic-skills/team-oriented-development.md)**
  - Purpose: Route capabilities through all five implementation teams with optional bounded expertise providers and Gizmo-owned cross-team joins
- **[typescript-rust-automation-only.md](../../../shared/dynamic-skills/typescript-rust-automation-only.md)**
  - Purpose: **P1 hard rule:** prohibit repository-authored Python and use Bun/TypeScript, Rust, and Taskfiles for automation
- **[source-file-size.md](../../../shared/dynamic-skills/source-file-size.md)**
  - Purpose: **P1 / most critical structure rule:** every authored file, including Rust, has one non-bypassable 1,000-line ceiling; a violation requires architectural review and cohesive decomposition
- **[cortex-writer.md](cortex-writer.md)**
  - Purpose: **P1 / critical `.cortex` writing rule:** split long dense sentences into short sentences, bullets, and lists; reserve tables for compact repeated fields or exact mappings
- **[cortex-article-structure/SKILL.md](cortex-article-structure/SKILL.md)**
  - Purpose: **P1 / critical `.cortex` article rule:** expose semantic Markdown hierarchy; authored HTML nodes are prohibited, while literal HTML belongs in inline or block code
- **[cortex-consistency.md](cortex-consistency.md)**
  - Purpose: **P1 / critical `.cortex` GC rule:** verify docs are current, agree with each other, and agree with the code
- **[product-spec-lifecycle.md](product-spec-lifecycle.md)**
  - Purpose: **P1 / critical product spec rule:** read owning product specs before implementation; update specs on new knowledge from chat, tasks, or PR iterations
- **[agent-feature-ownership.md](../../../gizmo/dynamic-skills/agent-feature-ownership.md)**
  - Purpose: Keep every agent inside its assigned feature and focused issue set
- **[code-review-comments.md](../../../gizmo/dynamic-skills/code-review-comments.md)**
  - Purpose: Address active actionable feedback and resolve its review conversations
- **[dynamic-skill-authoring.md](dynamic-skill-authoring.md)**
  - Purpose: Capture user feedback as durable team-owned Cortex skill cards
- **[efficient-pr-delivery.md](../../../gizmo/dynamic-skills/efficient-pr-delivery.md)**
  - Purpose: Ship PRs with focused configured-runner execution, complete exact-head validation, and readiness
- **[github-actions-only-validation.md](../../sre/dynamic-skills/github-actions-only-validation.md)**
  - Purpose: Format locally; run focused tasks and trusted Rust gates on the configured Actions runner while runtime-dependent gates stay GitHub-hosted
- **[kubernetes-native-cluster-execution.md](../../sre/dynamic-skills/kubernetes-native-cluster-execution.md)**
  - Purpose: Prohibit nested container runtimes in k8s and k0s and require direct Pod execution for Playwright and other workloads
- **[pre-push-hygiene.md](../../sre/dynamic-skills/pre-push-hygiene.md)**
  - Purpose: Always host-apply `task format` and pass the UI demo contract before every push so Verify does not burn cycles on Prettier/rustfmt/demo misses
- **[browser-extension-release-security.md](../../security/dynamic-skills/browser-extension-release-security.md)**
  - Purpose: Apply origin, identity, archive, redirect, and profile-isolation checks before shipping extension artifacts
- **[feature-issue-planning.md](../../../gizmo/dynamic-skills/feature-issue-planning.md)**
  - Purpose: Organize each feature as a Workbench directory with a shared summary, focused Markdown issues, dependencies, and explicit automation state
- **[issue-scope-management.md](../../../gizmo/dynamic-skills/issue-scope-management.md)**
  - Purpose: Preserve deferred, risky, or too-large work in existing Workbench feature/issue records and task worklogs without disrupting other agents
- **[module-expert.md](module-expert.md)**
  - Purpose: Route exact-baseline production-module analysis through one named read-only expert without granting write or scheduling authority
- **[internal-api-expert.md](internal-api-expert.md)**
  - Purpose: Design the smallest provider-consumer contract across Rust crates, both WASM bridges, generated bindings, and TypeScript adapters
- **[code-refactoring-expert.md](code-refactoring-expert.md)**
  - Purpose: Audit one code surface for architecture, design, quality, tests, and stronger types without granting write authority
- **[cortex-refactoring-expert.md](cortex-refactoring-expert.md)**
  - Purpose: Audit Cortex complexity, conflicts, duplication, legacy guidance, ownership drift, and deterministic extraction candidates
- **[system-coherence-synthesizer.md](system-coherence-synthesizer.md)**
  - Purpose: Reconcile verified code and Cortex evidence without repository access or write authority
- **[rust-coding.md](../../dev-core/dynamic-skills/rust-coding.md)**
  - Purpose: Keep Rust domain models precise: replace string tags, sentinel values, and cross-workflow `Option<T>` fields with enums and per-variant structs
- **[rust-macro-minimization.md](../../dev-core/dynamic-skills/rust-macro-minimization.md)**
  - Purpose: Prohibit repository-defined Rust macros; prefer explicit structs, implementations, functions, and control flow over hidden code generation
- **[rust-typescript-code-separation.md](../../dev-core/dynamic-skills/rust-typescript-code-separation.md)**
  - Purpose: Keep app and extension policy in Rust/WASM; reserve TypeScript for UI, browser observation, and lifecycle glue
- **[rust-wasm-name-coherence.md](../../dev-core/dynamic-skills/rust-wasm-name-coherence.md)**
  - Purpose: Keep exported Rust WASM functions and methods directly searchable under their authored names across generated bindings and TypeScript
- **[svelte-state-modeling.md](../../web-dev/dynamic-skills/svelte-state-modeling.md)**
  - Purpose: Use concise Svelte rune declarations for optional UI state and keep closed domain states in Rust/WASM
- **[typescript-serial-operation-queues.md](../../web-dev/dynamic-skills/typescript-serial-operation-queues.md)**
  - Purpose: Encapsulate serial async work behind enqueue, idle, and reset operations instead of exposing mutable promise chains
- **[typescript-explicit-state.md](../../web-dev/dynamic-skills/typescript-explicit-state.md)**
  - Purpose: Replace authored `undefined`/`null` state with semantic unions while retaining complete `void` unit/effect returns; reject every value-or-void contract, including nested generics and returns
- **[typescript-domain-structure.md](../../web-dev/dynamic-skills/typescript-domain-structure.md)**
  - Purpose: Nest same-prefix closed vocabularies into parent objects + operation enums; use field enums instead of string sets; ban hand-rolled TypeScript `Result`/`Maybe`
- **[typescript-single-parameter.md](../../web-dev/dynamic-skills/typescript-single-parameter.md)**
  - Purpose: Limit authored functions to one parameter
- **[typescript-no-unknown.md](../../web-dev/dynamic-skills/typescript-no-unknown.md)**
  - Purpose: Ban `unknown`, `object`, and generic domain values; allow `unknown` only for immediate boundary narrowing
- **[typescript-named-args.md](../../web-dev/dynamic-skills/typescript-named-args.md)**
  - Purpose: Require semantic named object parameter contracts and named typed values at object call boundaries
- **[prefer-popular-libraries.md](../../../shared/dynamic-skills/prefer-popular-libraries.md)**
  - Purpose: Before writing boilerplate, prefer mature high-adoption libraries; reject obscure low-star/low-download deps; validate with Loom `dependencyPopularity`
- **[ui-design-skills.md](../../web-dev/dynamic-skills/ui-design-skills.md)**
  - Purpose: Apply the Web-owned UI design guidance for user-visible interface work
- **[user-facing-security-abstractions.md](../../security/dynamic-skills/user-facing-security-abstractions.md)**
  - Purpose: Present product-level security objects and keep implementation keys subordinate or advanced
- **[web-unused-code.md](../../web-dev/dynamic-skills/web-unused-code.md)**
  - Purpose: Enable class-member analysis in every web Knip graph and remove every valid unused-code finding
- **[cortex-document-map.md](cortex-document-map.md)**
  - Purpose: Centralize Cortex navigation in the root router, one Gizmo graph, five team graphs, and one shared graph
- **[testing-pyramid-and-regression.md](../../../shared/dynamic-skills/testing-pyramid-and-regression.md)**
  - Purpose: Enforce ~99% domain coverage in Rust, mandatory regression tests for bug fixes, and 90% Rust line coverage floor
- **[docker-container-harness.md](../../sre/dynamic-skills/docker-container-harness.md)**
  - Purpose: Prohibit Dockerfile cache mounts and killing the Docker daemon; enforce exact dependency pinning and Bun lockfiles
- **[self-improvement.md](self-improvement.md)**
  - Purpose: Optionally capture provisional discoveries, promote evidenced durable knowledge, and extract only fully deterministic behavior into typed Loom leaves

## How to add one

1. Scaffold with Loom using a `skillScaffold` domain request YAML. Set
   `skillOwner` to `gizmo`, `ai`, `shared`, `dev-core`, `security`, `sre`, or
   `web-dev`.
2. Fill in the problem pattern, preferred pattern, scope, examples, and
   validation.
   Keep prose-only cards as `<slug>.md`. For an executable skill, convert the
   card to `<slug>/SKILL.md` and co-locate its independent Bun and TypeScript
   project under `<slug>/scripts/`.
3. Confirm the new card is in the catalog above and its owning Gizmo or team
   graph. Use the shared graph only for ownerless cross-team knowledge.
4. Keep harness-specific profiles outside the tracked repository. Do not create
   `.agents/skills`, `.cursor/skills`, or `.claude/skills` mirrors.
5. Verify with `task loom:cortex-audit`.

See [Loom tools](../references/loom-tools.md).
