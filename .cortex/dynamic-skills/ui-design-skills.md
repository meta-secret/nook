# UI Design Skills

## Rule

Every task that designs, implements, or reviews user-visible UI must first read
and use both installed skills:

- [`impeccable`](../../.agents/skills/impeccable/SKILL.md)
- [`design-taste-frontend`](../../.agents/skills/design-taste-frontend/SKILL.md)

Do not treat either skill as an optional finishing pass.

This includes:

- website and browser-extension pages;
- Svelte components, layouts, styles, and responsive behavior;
- loading, empty, error, disabled, focus, hover, and active states;
- redesigns, visual polish, and UI-focused code review.

## Apply It In Nook

1. Read both complete skill entry points before changing UI.
2. Follow Impeccable's setup: run its context script once per session, load the
   one playbook that owns the request, and inspect an incumbent source of visual
   truth. Load its `craft-floor.md` immediately before editing UI.
3. Classify the surface with Impeccable's Persuade, Operate, Read, or Experience
   mode. Make the taste skill's one-line design read before implementation and
   audit the existing UI first for redesigns.
4. Preserve Nook's established visual language, components, tokens, copy,
   routes, accessibility behavior, analytics contracts, and interaction
   semantics unless the task explicitly changes them.
5. Use Impeccable's surface-specific playbook as the primary design workflow,
   then apply the Nook-specific taste skill's Svelte implementation, anti-slop,
   hierarchy, spacing, responsive, accessibility, interaction-state, asset,
   motion, and visual pre-flight guidance.
6. Inspect the result at representative desktop and mobile sizes and exercise
   all changed states. Add the focused Playwright demo coverage required by
   Nook's UI demo contract.
7. Keep Impeccable's project detector hook enabled when the harness supports
   it, resolve relevant findings, and treat it as a supplemental design check
   rather than a replacement for Nook's UI demo contract or GitHub Actions.

## Nook Takes Precedence

The installed taste skill is tailored to Nook's Svelte 5 product and marketing
surfaces. Its Svelte examples and visual rules remain subordinate to the
specific user brief and `.cortex`; they do not authorize architecture,
dependency, behavior, copy, or product changes outside the requested scope.
Impeccable's Operate mode and Nook's existing product patterns own dense product
surfaces.

Repository rules remain authoritative, especially:

- domain and validation policy belongs in typed Rust/WASM rather than
  TypeScript or Svelte;
- visible copy uses shared translation catalogs;
- accessibility and existing product behavior must not regress;
- changed domain behavior needs Rust tests, and changed user flows need focused
  web coverage;
- the repository's GitHub-Actions-only validation and pre-push UI demo
  workflow overrides generic commands such as unconditional local Lighthouse
  or full-suite runs.

## Review And Validation

A UI change is incomplete when either design skill was skipped, when Nook's
Svelte or typed Rust/WASM boundaries were bypassed, or when the result was not
visually inspected in the changed states and responsive layouts.

Before push:

1. Run `task format`.
2. Run the UI demo contract against `origin/main`.
3. Let repository-owned GitHub Actions run product gates.

For marketing or landing surfaces, use the full applicable Impeccable playbook
and taste pre-flight matrix. For product UI, use Impeccable's Operate mode and
the taste skill's Nook product-UI rules.
