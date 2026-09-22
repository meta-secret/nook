# Project Skill Registry

Generic practices are selected through the responsible Meta-Cortex role and
its skills. The retained local cards own Nook tooling, product, or delivery details.


This directory is the canonical project skill registry for Nook agents. The
directory name `dynamic-skills` means the skills are captured and updated
dynamically from concrete project feedback; it does not mean optional or ad hoc.

Use this index before refactors, review handling, issue-scope decisions, or skill
creation. Apply existing repository guidance and keep related knowledge
consolidated.

Meta-Cortex owns generic practices. Team-owned Cortex cards supply Nook-specific
requirements and executable tooling. Harness profiles must not duplicate either.

AI-authored TypeScript packet requirements live in the
[AI team contract](../AGENTS.md#authored-implementation-routing). This index
catalogs the linked authorities without copying their policies.

## Skill catalog

- **[Branch naming](../../../gizmo-prime/dynamic-skills/branch-naming.md)**
  - Purpose: Name feature, Team Gizmo, and Team Agent branches consistently.
- **[Pre-push hygiene](../../sre/dynamic-skills/pre-push-hygiene.md)**
  - Purpose: Preserve repository and generated-state hygiene before publication.
- **[team-oriented-development.md](../../../gizmo-prime/dynamic-skills/team-oriented-development.md)**
  - Purpose: Route capabilities across the root/controller graphs plus six engineering/operational owner graphs, including Delivery Pipeline and its nested internal graphs, with optional bounded expertise providers and Gizmo-owned cross-team joins
- **[typescript-rust-automation-only.md](../../../shared/dynamic-skills/typescript-rust-automation-only.md)**
  - Purpose: **P1 hard rule:** prohibit repository-authored Python and use Bun/TypeScript, Rust, and Taskfiles for automation
- **[source-file-size.md](../../../shared/dynamic-skills/source-file-size.md)**
  - Purpose: **P1 / most critical structure rule:** every authored file, including Rust, has one non-bypassable 1,000-line ceiling; a violation requires architectural review and cohesive decomposition
- **[function-ownership.md](../../../../.meta-cortex/agents/teams/dev-team/common/coding-skill/practices/function-ownership.md)**
  - Purpose: **P1 / primary action-structure rule**
    - Require every authored function in every implementation language to
      belong to a meaningful owner.
    - Reject free functions, module-only ownership, and catch-all utility
      containers.
- **[domain-api-integrity.md](../../../../.meta-cortex/agents/teams/dev-team/common/coding-skill/practices/domain-api-integrity.md)**
  - Purpose: **P1 / universal domain API rule**
    - Require named domain types, concrete values, one-parameter request APIs,
      validated capabilities, typed failures, and exhaustive states.
    - Require explicit schema versions and migration decisions at persisted and
      wire boundaries.
- **[secret-lifecycle.md](../../security/dynamic-skills/secret-lifecycle.md)**
  - Purpose: **P1 / cross-language secret-handling rule**
    - Give every secret an explicit owner, purpose, lifetime, and destruction
      event.
    - Keep durable secret behavior in Rust/WASM and browser plaintext narrowly
      scoped in TypeScript/Svelte.
- **[cortex-writer.md](cortex-writer.md)**
  - Purpose: Nook density-lint integration for upstream authoring practices.
- **[cortex-article-structure/SKILL.md](cortex-article-structure/SKILL.md)**
  - Purpose: Nook executable Markdown article audit.
- **[executable-skill-host/SKILL.md](executable-skill-host/SKILL.md)**
  - Purpose: Discover and invoke the closed executable-skill catalog through one strict bounded YAML argument
- **[cortex-consistency](cortex-consistency/SKILL.md)**
  - Purpose: **P1 / critical `.cortex` GC rule:** verify docs are current, agree with each other, and agree with the code
- **[delegation-visualization](delegation-visualization/SKILL.md)**
  - Purpose: Render Gizmo's ordered ephemeral Team Agent plan without acquiring lifecycle authority
- **[product-spec-lifecycle.md](product-spec-lifecycle.md)**
  - Purpose: **P1 / critical product spec rule:** read owning product specs before implementation; update specs on new knowledge from chat, tasks, or PR iterations
- **[agent-feature-ownership.md](../../../gizmo-prime/dynamic-skills/agent-feature-ownership.md)**
  - Purpose: Keep every agent inside its assigned feature and focused issue set
- **[code-review-comments.md](../../../gizmo-prime/dynamic-skills/code-review-comments.md)**
  - Purpose: Address active actionable feedback and resolve its review conversations
- **[dynamic-skill-authoring.md](dynamic-skill-authoring.md)**
  - Purpose: Capture user feedback as durable team-owned Cortex skill cards
- **[efficient-pr-delivery.md](../../../gizmo-prime/dynamic-skills/efficient-pr-delivery.md)**
  - Purpose: Route current dev delivery and retain prior PR runtime reference
- **[github-actions-only-validation.md](../../sre/dynamic-skills/github-actions-only-validation.md)**
  - Purpose: Route feature compilation and feature PR required checks to remote execution
- **[kubernetes-native-cluster-execution.md](../../sre/dynamic-skills/kubernetes-native-cluster-execution.md)**
  - Purpose: Prohibit nested container runtimes in k8s and k0s and require direct Pod execution for Playwright and other workloads
- **[browser-extension-release-security.md](../../security/dynamic-skills/browser-extension-release-security.md)**
  - Purpose: Apply origin, identity, archive, redirect, and profile-isolation checks before shipping extension artifacts
- **[feature-issue-planning.md](../../../gizmo-prime/dynamic-skills/feature-issue-planning.md)**
  - Purpose: Organize each feature as a Workbench directory with a shared summary, focused Markdown issues, dependencies, and explicit automation state
- **[issue-scope-management.md](../../../gizmo-prime/dynamic-skills/issue-scope-management.md)**
  - Purpose: Keep deferred, risky, or oversized work in a focused Workbench issue while preserving ownership and append-only issue history
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
- **[rust-coding.md](../../../../.meta-cortex/agents/teams/dev-team/rust-dev/skills/rust-dev-skill/SKILL.md)**
  - Purpose: Keep Rust domain models precise with enums and per-variant structs instead of booleans, string tags, sentinel values, and cross-workflow `Option<T>` fields. Require one non-receiver parameter and named request aggregates for multi-value APIs and command handlers. Outside `use` declarations, limit paths to two inline segments and retain meaningful owning module or type context.
- **[rust-macro-minimization.md](../../../../.meta-cortex/agents/teams/dev-team/rust-dev/skills/rust-dev-skill/practices/tooling/rust-macro-minimization.md)**
  - Purpose: Prohibit repository-defined Rust macros; prefer explicit structs, implementations, functions, and control flow over hidden code generation
- **[rust-typescript-code-separation.md](../../../../.meta-cortex/agents/teams/dev-team/rust-dev/skills/rust-dev-skill/practices/boundaries/rust-typescript-code-separation.md)**
  - Purpose: Keep app and extension policy in Rust/WASM; reserve TypeScript for UI, browser observation, and lifecycle glue
- **[rust-wasm-name-coherence.md](../../../../.meta-cortex/agents/teams/dev-team/rust-dev/skills/rust-dev-skill/practices/boundaries/rust-wasm-name-coherence.md)**
  - Purpose: Keep exported Rust WASM functions and methods directly searchable under their authored names across generated bindings and TypeScript
- **[svelte-state-modeling.md](../../../../.meta-cortex/agents/teams/dev-team/typescript-dev/skills/ts-dev-skill/practices/svelte-state-modeling.md)**
  - Purpose: Model browser and visual lifecycle state explicitly while keeping closed portable domain states in Rust/WASM
- **[typescript-serial-operation-queues.md](../../../../.meta-cortex/agents/teams/dev-team/typescript-dev/skills/ts-dev-skill/practices/typescript-serial-operation-queues.md)**
  - Purpose: Encapsulate serial async work behind enqueue, idle, and reset operations instead of exposing mutable promise chains
- **[typescript-explicit-state.md](../../../../.meta-cortex/agents/teams/dev-team/typescript-dev/skills/ts-dev-skill/practices/typescript-explicit-state.md)**
  - Purpose: Replace authored `undefined`/`null` state with semantic unions while retaining complete `void` unit/effect returns; reject every value-or-void contract, including nested generics and returns
- **[typescript-enums-over-booleans.md](../../../../.meta-cortex/agents/teams/dev-team/typescript-dev/skills/ts-dev-skill/practices/typescript-enums-over-booleans.md)**
  - Purpose: Replace authored domain, state, policy, mode, configuration, and owned-contract booleans with semantic enums; retain booleans only at required boundaries or as immediately consumed predicates
- **[typescript-domain-structure.md](../../../../.meta-cortex/agents/teams/dev-team/typescript-dev/skills/ts-dev-skill/practices/typescript-domain-structure.md)**
  - Purpose:
    - Require named domain types and named unions instead of raw primitives or
      inline alternatives.
    - Require validated construction, operation ownership, and typed state
      transitions.
    - Nest same-prefix closed vocabularies into parent objects plus operation
      enums.
    - Use field enums instead of string sets.
    - Use Effect's typed error channel for effectful workflows; prohibit new
      `neverthrow` and hand-rolled Promise error workflows.
- **[typescript-effect.md](../../../../.meta-cortex/agents/teams/dev-team/typescript-dev/skills/ts-dev-skill/practices/typescript-effect.md)**
  - Purpose: Require Effect for new or materially changed TypeScript workflows
    that model async work, expected failure, resources, concurrency, services,
    or untrusted boundary decoding while preserving Rust/WASM ownership.
- **[typescript-single-parameter.md](../../../../.meta-cortex/agents/teams/dev-team/typescript-dev/skills/ts-dev-skill/practices/typescript-single-parameter.md)**
  - Purpose: Limit authored functions to one parameter
- **[typescript-no-unknown.md](../../../../.meta-cortex/agents/teams/dev-team/typescript-dev/skills/ts-dev-skill/practices/typescript-no-unknown.md)**
  - Purpose: Ban `unknown`, `object`, and generic domain values; allow `unknown` only for immediate boundary narrowing
- **[typescript-named-args.md](../../../../.meta-cortex/agents/teams/dev-team/typescript-dev/skills/ts-dev-skill/practices/typescript-named-args.md)**
  - Purpose: Require semantic named object parameter contracts and named typed values at object call boundaries
- **[prefer-popular-libraries.md](../../../shared/dynamic-skills/prefer-popular-libraries.md)**
  - Purpose: Before writing boilerplate, prefer mature high-adoption libraries; reject obscure low-star/low-download deps; validate with Loom `dependencyPopularity`
- **[ui-design-skills.md](../../web-dev/dynamic-skills/ui-design-skills.md)**
  - Purpose: Apply the Web-owned UI design guidance for user-visible interface work
- **[user-facing-security-abstractions.md](../../security/dynamic-skills/user-facing-security-abstractions.md)**
  - Purpose: Present product-level security objects and keep implementation keys subordinate or advanced
- **[web-unused-code.md](../../web-dev/dynamic-skills/web-unused-code.md)**
  - Purpose: Map the main web app's Knip 5 class-member analysis and Research
    Knip 6 caller review to Nook's hosted unused-code checks.
- **[cortex-document-map](cortex-document-map/SKILL.md)**
  - Purpose: Centralize Cortex navigation across root/controller graphs, six engineering/operational owner graphs including Delivery Pipeline, shared knowledge, and nested Delivery Pipeline internals
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
   card to `<slug>/SKILL.md` and co-locate its Bun and TypeScript package under
   `<slug>/scripts/`. The shared `.cortex` workspace owns installation and the
   frozen lockfile.
3. Confirm the new card is in the catalog above and its owning Gizmo or team
   graph. Use the shared graph only for ownerless cross-team knowledge.
4. Keep harness-specific profiles outside the tracked repository. Do not create
   `.agents/skills`, `.cursor/skills`, or `.claude/skills` mirrors.
5. Verify with `task loom:cortex-audit`.

See [Loom tools](../references/loom-tools.md).
