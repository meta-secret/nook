# Project Skill Registry

This directory is the canonical project skill registry for Nook agents. The
name `dynamic-skills` means the cards evolve from concrete project feedback; it
does not mean optional or ad hoc guidance.

Meta-Cortex owns generic roles, skill selection, programming practice, and
context engineering. This index catalogs Nook-owned product, tooling, and
delivery cards. The [dynamic-skill authoring workflow](dynamic-skill-authoring.md)
owns their creation and registry maintenance.

AI-authored TypeScript packet requirements live in the
[AI team contract](../AGENTS.md#validation). This index catalogs the linked
authorities without copying their policies.

## Skill catalog

- **[Branch naming](../../../gizmo-prime/dynamic-skills/branch-naming.md)**
  - Purpose: Name feature, Team Gizmo, and Team Agent branches consistently.
- **[Pre-push hygiene](../../sre/dynamic-skills/pre-push-hygiene.md)**
  - Purpose: Preserve repository and generated-state hygiene before publication.
- **[Team-oriented development](../../../gizmo-prime/dynamic-skills/team-oriented-development.md)**
  - Purpose: Route capabilities across the root/controller graphs and six
    engineering and operational owner graphs, including Delivery Pipeline's
    nested graphs.
- **[TypeScript and Rust automation only](../../../shared/dynamic-skills/typescript-rust-automation-only.md)**
  - Purpose: **P1 hard rule:** prohibit repository-authored Python; use Bun and
    TypeScript, Rust, and Taskfiles for automation.
- **[Source-file size](../../../shared/dynamic-skills/source-file-size.md)**
  - Purpose: **P1:** enforce the non-bypassable 1,000-line limit for every
    authored file, including Rust; require architectural review and cohesive
    decomposition when a file exceeds it.
- **[Secret lifecycle](../../security/dynamic-skills/secret-lifecycle.md)**
  - Purpose: **P1:** give each secret an owner, purpose, lifetime, and
    destruction event; keep durable behavior in Rust/WASM and browser plaintext
    narrowly scoped in TypeScript/Svelte.
- **[Cortex writer](cortex-writer.md)**
  - Purpose: Integrate Nook density lint with upstream authoring practices.
- **[Cortex article structure](cortex-article-structure/SKILL.md)**
  - Purpose: Define Nook's executable Markdown article audit.
- **[Executable-skill host](executable-skill-host/SKILL.md)**
  - Purpose: Discover and invoke the closed executable-skill catalog through one strict bounded YAML argument.
- **[Cortex consistency](cortex-consistency/SKILL.md)**
  - Purpose: Compile Nook's typed Cortex policy contracts and workflow bindings.
- **[Delegation visualization](delegation-visualization/SKILL.md)**
  - Purpose: Render Gizmo's ordered ephemeral Team Agent plan without acquiring lifecycle authority.
- **[Product-spec lifecycle](product-spec-lifecycle.md)**
  - Purpose: Read owning product specs before implementation and update them
    when chat, task, or PR iterations establish durable knowledge.
- **[Agent feature ownership](../../../gizmo-prime/dynamic-skills/agent-feature-ownership.md)**
  - Purpose: Keep every agent inside its assigned feature and focused issue set.
- **[Code-review comments](../../../gizmo-prime/dynamic-skills/code-review-comments.md)**
  - Purpose: Address active actionable feedback and resolve its review conversations.
- **[Dynamic-skill authoring](dynamic-skill-authoring.md)**
  - Purpose: Capture user feedback as durable team-owned Cortex skill cards.
- **[Efficient PR delivery](../../../gizmo-prime/dynamic-skills/efficient-pr-delivery.md)**
  - Purpose: Route current development delivery and retain prior PR runtime reference.
- **[GitHub Actions-only validation](../../sre/dynamic-skills/github-actions-only-validation.md)**
  - Purpose: Route feature compilation and required PR checks to remote execution.
- **[Kubernetes-native cluster execution](../../sre/dynamic-skills/kubernetes-native-cluster-execution.md)**
  - Purpose: Prohibit nested container runtimes in Kubernetes and k0s; require direct Pod execution for Playwright and other workloads.
- **[Browser-extension release security](../../security/dynamic-skills/browser-extension-release-security.md)**
  - Purpose: Apply origin, identity, archive, redirect, and profile-isolation checks before shipping extension artifacts.
- **[Feature-issue planning](../../../gizmo-prime/dynamic-skills/feature-issue-planning.md)**
  - Purpose: Organize each feature as a Workbench directory with a shared summary, focused Markdown issues, dependencies, and explicit automation state.
- **[Issue-scope management](../../../gizmo-prime/dynamic-skills/issue-scope-management.md)**
  - Purpose: Keep deferred, risky, or oversized work in a focused Workbench issue while preserving ownership and append-only issue history.
- **[Module expert](module-expert.md)**
  - Purpose: Route exact-baseline production-module analysis through one named read-only expert without granting write or scheduling authority.
- **[Internal API expert](internal-api-expert.md)**
  - Purpose: Design the smallest provider-consumer contract across Rust crates, both WASM bridges, generated bindings, and TypeScript adapters.
- **[Code-refactoring expert](code-refactoring-expert.md)**
  - Purpose: Audit one code surface for architecture, design, quality, tests, and stronger types without granting write authority.
- **[Cortex-refactoring expert](cortex-refactoring-expert.md)**
  - Purpose: Audit Cortex complexity, conflicts, duplication, legacy guidance, ownership drift, and deterministic extraction candidates.
- **[System-coherence synthesizer](system-coherence-synthesizer.md)**
  - Purpose: Reconcile verified code and Cortex evidence without repository access or write authority.
- **[Prefer popular libraries](../../../shared/dynamic-skills/prefer-popular-libraries.md)**
  - Purpose: Prefer mature, high-adoption libraries; reject obscure, low-use
    dependencies and validate popularity with Loom's `dependencyPopularity`
    action.
- **[UI design skills](../../web-dev/dynamic-skills/ui-design-skills.md)**
  - Purpose: Apply Web-owned UI design guidance to user-visible interface work.
- **[User-facing security abstractions](../../security/dynamic-skills/user-facing-security-abstractions.md)**
  - Purpose: Present product-level security objects and keep implementation keys subordinate or advanced.
- **[Web unused code](../../web-dev/dynamic-skills/web-unused-code.md)**
  - Purpose: Map the main web app's Knip 5 class-member analysis and Research Knip 6 caller review to Nook's hosted unused-code checks.
- **[Cortex document map](cortex-document-map/SKILL.md)**
  - Purpose: Centralize Nook Cortex navigation across root, controller, team, shared, and nested Delivery Pipeline graphs.
- **[Testing pyramid and regression](../../../shared/dynamic-skills/testing-pyramid-and-regression.md)**
  - Purpose: Enforce approximately 99% Rust domain coverage, regression tests
    for bug fixes, and the 90% Rust line-coverage floor.
- **[Docker container harness](../../sre/dynamic-skills/docker-container-harness.md)**
  - Purpose: Prohibit Dockerfile cache mounts and killing the Docker daemon; enforce exact dependency pinning and Bun lockfiles.
- **[Agent self-improvement](self-improvement.md)**
  - Purpose: Promote evidenced Nook knowledge while respecting product authority and session boundaries.

## How to add a Nook skill

Follow the Nook [dynamic-skill authoring](dynamic-skill-authoring.md) and
[dynamic-skills workflow](../workflows/dynamic-skills.md). Generic authoring
requirements come from Meta-Cortex
[Context Engineering](../../../../.meta-cortex/teams/ai-team/agents/tech-writer/skills/context-engineering/SKILL.md).
Keep harness-specific discovery outside the tracked repository, as described by
the Nook workflow.

See [Loom tools](../references/loom-tools.md).
