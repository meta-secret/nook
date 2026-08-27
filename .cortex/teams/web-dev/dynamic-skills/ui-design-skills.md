# UI Design

## Purpose

Produce accessible, responsive, and visually coherent Nook interfaces without
changing product semantics or crossing the typed Rust/WASM boundary.

## Scope

Apply this guidance when a task designs, implements, or reviews user-visible UI.

This includes:

- website and browser-extension pages;
- Svelte components, layouts, styles, and responsive behavior;
- loading, empty, error, disabled, focus, hover, and active states; and
- redesigns, visual polish, and UI-focused code review.

## Canonical Authorities

Start with the [Web development team contract](../AGENTS.md) and select the
smallest relevant authority from the
[Web development knowledge graph](../knowledge-graph.md).

Use the task-relevant web authorities:

- [Browser extension](../product-specs/browser-extension.md) for extension
  presentation and interaction behavior;
- [Website passkey manager](../design-docs/passkey-manager.md) for the website's
  established interaction design;
- [Svelte state modeling](svelte-state-modeling.md) for component-local visual
  and browser lifecycle state; and
- [Svelte, Vite, and Bun](../references/bun-svelte.md) for web implementation
  and UI evidence workflows.

Inspect the nearest shipping component, shared primitive, token stylesheet, or
user-provided reference as the incumbent visual source of truth.

## External Design Capabilities

The active harness may expose native design analysis, generation, or review
capabilities. Use a relevant capability when the user requests it or when the
task contract makes it part of the required workflow.

External capabilities supplement the canonical Web Cortex authorities. They do
not define repository architecture, product behavior, dependencies, copy, or
validation policy.

## Procedure

1. Read the task-relevant authorities and inspect the incumbent visual source
   of truth.
2. State a concise design read before implementation.
   - Identify the visual hierarchy, interaction model, responsive constraints,
     and changed states.
3. Preserve established components, tokens, copy, routes, accessibility
   behavior, analytics contracts, and interaction semantics.
   - Change them only when the task explicitly requires it.
4. Implement the hierarchy, spacing, responsive behavior, accessibility,
   interaction states, assets, and motion within the requested scope.
5. Inspect representative desktop and mobile sizes.
   - Exercise every changed state.
   - Add focused Playwright demo coverage required by the UI demo contract.

## Engineering Rules

- Domain and validation policy belongs in typed Rust/WASM.
- TypeScript and Svelte consume public typed projections.
- Visible copy uses shared translation catalogs.
- Accessibility and established product behavior must not regress.
- Changed domain behavior needs Rust tests.
- Changed user flows need focused web coverage.
- Repository-owned validation workflows override generic capability advice.

## Validation

A UI change is complete when:

- the relevant Web Cortex authorities were applied;
- the Svelte and typed Rust/WASM boundaries remain intact;
- every changed state was visually inspected at representative sizes; and
- focused web evidence covers the changed user flow.

Run `task loom:cortex-audit` for Cortex edits. Before a parent-owned push, run
the repository's pre-push and UI demo workflows required by the task contract.
