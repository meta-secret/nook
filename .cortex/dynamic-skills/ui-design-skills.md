# UI Design Skill

## Relationships

- [Cortex document navigation](cortex-document-map.md)
  - Defines the mandatory relationship and internal-map structure.
  - Apply whenever this skill card changes.
- [Cortex writer](cortex-writer.md)
  - Keeps the card and its navigation summaries concise.
  - Apply while editing or reviewing this guidance.
- [Cortex consistency](cortex-consistency.md)
  - Requires the card to agree with related guidance and current code.
  - Apply when rules, paths, commands, or examples change.

## Document map

- [Rule](#rule)
  - States the invariant in its normative form.
  - Read before authoring or reviewing affected code.
- [Impeccable Is Opt-In](#impeccable-is-opt-in)
  - Keeps Impeccable outside the default Nook design workflow.
  - Read when deciding whether that optional skill may run.
- [Apply It In Nook](#apply-it-in-nook)
  - Defines the repository-specific design and implementation sequence.
  - Follow while changing a Nook user interface.
- [Nook Takes Precedence](#nook-takes-precedence)
  - Preserves Cortex, Svelte, Rust/WASM, and product authority.
  - Read when generic design advice conflicts with Nook rules.
- [Review And Validation](#review-and-validation)
  - Defines the review and proof required before delivery.
  - Use after implementation and before push.

## Rule

Every task that designs, implements, or reviews user-visible UI must first read
and use:

- [`design-taste-frontend`](../../.agents/skills/design-taste-frontend/SKILL.md)

This includes:

- website and browser-extension pages;
- Svelte components, layouts, styles, and responsive behavior;
- loading, empty, error, disabled, focus, hover, and active states;
- redesigns, visual polish, and UI-focused code review.

## Impeccable Is Opt-In

Impeccable is disabled as a default Nook workflow dependency. Do not install or
load it, run its context, playbook, craft-floor, hook, or detector commands, or
delegate its finish-review process merely because the skill exists locally.

Use Impeccable only when the user explicitly requests it by name. An existing
generated `.agents/skills/impeccable/` directory may remain installed and
ignored; deleting it is unnecessary and would not durably disable future
installation.

## Apply It In Nook

1. Read the complete `design-taste-frontend` entry point before changing UI.
2. Inspect the target at runtime when possible and inspect an incumbent source
   of visual truth: the nearest shipping component, shared primitive, token
   stylesheet, or user-provided reference.
3. State the concise design read required by the skill before implementation.
4. Preserve Nook's established visual language, components, tokens, copy,
   routes, accessibility behavior, analytics contracts, and interaction
   semantics unless the task explicitly changes them.
5. Apply the skill's Svelte implementation, hierarchy, spacing, responsive,
   accessibility, interaction-state, asset, motion, and visual pre-flight
   guidance.
6. Inspect the result at representative desktop and mobile sizes and exercise
   all changed states. Add the focused Playwright demo coverage required by
   Nook's UI demo contract.

## Nook Takes Precedence

The installed design skill is tailored to Nook's Svelte 5 product and
marketing surfaces. Its examples and visual rules remain subordinate to the
specific user brief and `.cortex`; they do not authorize architecture,
dependency, behavior, copy, or product changes outside the requested scope.

Repository rules remain authoritative, especially:

- domain and validation policy belongs in typed Rust/WASM rather than
  TypeScript or Svelte;
- visible copy uses shared translation catalogs;
- accessibility and existing product behavior must not regress;
- changed domain behavior needs Rust tests, and changed user flows need focused
  web coverage; and
- the repository's hosted remote execution, explicit complete validation, and
  pre-push UI demo workflow override generic local commands.

## Review And Validation

A UI change is incomplete when `design-taste-frontend` was skipped, when Nook's
Svelte or typed Rust/WASM boundaries were bypassed, or when the result was not
visually inspected in the changed states and responsive layouts.

Before push:

1. Run `task loom:pre-push`.
2. Run the UI demo contract against `origin/main`.
3. Let repository-owned GitHub Actions run product gates.
