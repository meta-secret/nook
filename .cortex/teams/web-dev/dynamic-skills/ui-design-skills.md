# Nook Svelte UI Taste

Ship Nook interfaces that feel deliberate, calm, trustworthy, and distinctly
crafted without weakening product truth or security boundaries.

This Web Cortex article is the canonical Nook-specific design authority. Do not
translate examples from React, Next.js, or another design system into Nook.

## 1. Start With Evidence

Before editing:

1. Read the [Web development team contract](../AGENTS.md).
2. Select the most specific product, design, skill, or reference from the
   [Web development knowledge graph](../knowledge-graph.md).
3. Inspect the target at runtime when possible.
4. Inspect at least one source of incumbent visual truth:
   - `nook-app/nook-web/nook-web-shared/src/vault-app/app.css`;
   - the nearest shared `lib/components/ui/` primitive;
   - one comparable shipping Svelte component; or
   - existing light and dark rendered states.
5. State one concise design read before implementation:

   `Reading this as: <surface and mode> for <user and task>, preserving <Nook
pattern>, with <visual direction> and <interaction priority>.`

Do not ask for aesthetic clarification when the existing product, brief, or
reference makes the direction clear. Ask one focused question only when two
materially different directions remain plausible.

## 2. Choose The Surface Mode

Classify the surface mode and tune taste accordingly:

| Surface                                            | Mode       | Default taste                                                  |
| -------------------------------------------------- | ---------- | -------------------------------------------------------------- |
| Vault, settings, import, security, sync, extension | Operate    | Fast scanning, explicit state, restrained motion, high trust   |
| Landing and product explanation                    | Persuade   | Strong hierarchy, memorable composition, real product evidence |
| Help, legal, logs, documentation                   | Read       | Comprehension, navigation, readable measure, quiet chrome      |
| Research visualization or showcase                 | Experience | Artifact-led composition within explicit experimental scope    |

Suggested dials:

| Surface                    | Variance | Motion | Density |
| -------------------------- | -------: | -----: | ------: |
| Vault product UI           |        4 |      3 |       6 |
| Authentication or recovery |        3 |      2 |       5 |
| Browser-extension popup    |        3 |      2 |       7 |
| Landing page               |        7 |      5 |       3 |
| Help or legal              |        4 |      2 |       4 |

Treat these as starting points. Existing product rhythm and the brief win.

## 3. Nook's UI Stack

Use the established repository stack:

- Svelte 5 with `$props`, `$state`, `$derived`, and focused `$effect` runes.
- Vite and Bun through repository Taskfile workflows.
- Tailwind CSS v4 utilities plus semantic CSS variables from `app.css`.
- Shared Svelte UI primitives under
  `nook-web-shared/src/vault-app/lib/components/ui/`.
- `tailwind-variants`, `tailwind-merge`, and the existing `cn` helper for
  component variants.
- `@lucide/svelte` for ordinary interface icons. Keep one icon family.
- `tw-animate-css`, CSS transitions, and Svelte-native behavior for normal
  motion.

Do not add React, Next.js, JSX/TSX, `motion/react`, React icon packages, shadcn
React components, or a second component system.

Do not add an animation or design dependency when CSS, Svelte, or an existing
primitive is enough. Before adding any dependency:

1. Inspect the owning `package.json`.
2. Explain why the existing stack cannot do the job.
3. Follow Nook's pinned Bun workflow.

## 4. Svelte 5 Implementation Rules

Keep markup readable and components thin:

```svelte
<script lang="ts">
  import type { VaultState } from '$lib/vault.svelte'
  import { Button } from '$lib/components/ui/button'

  let { vault, disabled = false }: { vault: VaultState; disabled?: boolean } =
    $props()
  let expanded = $state(false)
  const canContinue = $derived(!disabled && vault.activeVault !== undefined)
</script>
```

- Use `undefined`, never authored `null`.
- Use typed props and generated `$app-wasm` types directly.
- Use keyed `{#each items as item (item.id)}` blocks for stable collections.
- Use semantic elements before ARIA patches.
- Use `onclick` and Svelte event conventions already present in the package.
- Return cleanup from `$effect` when registering observers, listeners, timers,
  or external animation state.
- Keep continuous pointer and scroll values outside component-wide reactive
  state.
  - Prefer CSS, `IntersectionObserver`, or a narrowly scoped action.
- Do not create a React-style store abstraction.
  - Put application-wide reactive state and side effects in the existing
    `.svelte.ts` state-controller pattern.

Svelte renders and coordinates. It does not own vault policy.

## 5. Architecture And Security Boundaries

The dependency direction is:

`nook-auth2 -> nook-core -> nook-wasm -> nook-web`

Apply it to every UI decision:

- Put validation, authorization, cryptography, vault state decisions, data
  shaping, and durable domain behavior in typed Rust.
  - Expose that behavior through WASM.
- Keep Svelte to presentation state, browser ceremonies, lifecycle,
  accessibility, and explicit user interaction.
- Do not mirror Rust enums or DTOs with string unions in TypeScript.
- Do not expose secrets in URLs, logs, DOM attributes, test IDs, analytics, or
  hidden fallback markup.
- Do not persist plaintext secrets in browser convenience state.
- Mask sensitive values until explicit reveal.
  - Clear temporary revealed or generated state when it is hidden or dismissed.
- Keep passkey creation explicit.
  - Default setup to authentication with an existing credential.
  - Never infer credential absence from cancellation.
- Keep the extension a thin Simple Vault companion, not a second vault UI.
- Preserve Simple and Sentinel product separation.

Any visual shortcut that weakens these boundaries is a failed design.

## 6. Components, Tokens, And Theme

Use the incumbent system before inventing:

- Reuse `Button`, `Card`, `Select`, separators, and nearby shared components.
- Extend a primitive variant when the pattern repeats.
  - Do not paste long utility strings into multiple feature components.
- Use semantic tokens such as `bg-background`, `text-foreground`, `bg-card`,
  `text-muted-foreground`, `border-border`, `bg-primary`, and
  `text-destructive`.
- Preserve the established radius scale rooted at `--radius: 0.375rem`.
- Use hard-coded color only for a real semantic or third-party identity that
  the token system cannot express.
- Support the existing `.dark` theme.
  - Do not add a second theme mechanism.
  - Do not flip theme per section.
- Use `min-height: 100svh` or `100dvh` intentionally.
  - Never introduce `100vh` or `h-screen` mobile jumping.
- Prevent horizontal overflow at narrow widths.
  - Do not hide broken layout with arbitrary clipping inside components.

Nook's restrained neutral palette is intentional. Create visual distinction
with hierarchy, rhythm, typography, state, and precise details before adding
new accent colors.

## 7. Product UI Taste

### Hierarchy

- Give each surface one obvious primary task.
- Keep the primary action visually dominant.
- Separate destructive actions from the primary action.
- Use typography, spacing, and alignment before adding containers.
- Avoid cards inside cards. Use cards only for true grouping or elevation.
- Avoid badge and status-chip soup. Show state where it changes a decision.
- Prefer progressive disclosure over rendering every advanced option at once.
- Keep security and recovery consequences adjacent to the action they explain.

### Forms

- Put a persistent label above every field.
- Put helper text below the label or control.
- Put error text next to the failing field.
- Preserve meaningful `autocomplete`, `inputmode`, input type, and browser
  behavior.
- Do not use placeholder text as the only label.
- Disable a control only when interaction is genuinely unavailable.
  - Preserve a clear reason when the disabled state is not self-evident.
- Prevent button-label wrapping at desktop and normal mobile widths.
- Preserve focus after inline state changes.
- Return focus when dialogs close.

### States

Design the full cycle:

- loading without layout collapse;
- honest empty state with the next useful action;
- inline validation and actionable error state;
- disabled and pending states;
- success acknowledgment that does not obscure the next task; and
- offline, locked, stale, conflict, and recovery states when the workflow can
  reach them.

Never render a successful static mock while leaving real error or recovery paths
unstyled.

### Responsive Behavior

- Inspect at phone, compact desktop, and normal desktop sizes.
- Collapse multi-column product layouts deliberately below `768px`.
- Keep tap targets at least 44 by 44 CSS pixels where practical.
- Keep dialogs and forms inside the visual viewport with reachable actions.
- Account for translated copy expansion, long vault names, long provider names,
  and browser zoom.
- Use capability and state detection for browser or extension functionality.
  - Do not use viewport heuristics for that purpose.

### Motion

- Add motion only for feedback, hierarchy, state transition, or comprehension.
- Prefer CSS transitions and existing animation utilities.
- Animate `transform` and `opacity`.
  - Avoid layout-property animation.
- Honor `prefers-reduced-motion`.
- Do not add perpetual motion to security, recovery, or dense Operate surfaces.
- Do not use custom cursors, scroll hijacking, magnetic buttons, or decorative
  parallax in the vault product.

## 8. Marketing And Explanatory Surfaces

For landing or product-explanation work, preserve the strongest anti-slop rules:

- No automatic purple-blue glow, centered gradient hero, glass everywhere, or
  three identical feature cards.
- No fake product UI assembled from decorative rectangles.
  - Use a real product screenshot, a real component state, or an approved
    generated asset.
- No fabricated metrics, testimonials, customer logos, security claims, or
  compatibility claims.
- No generic "Acme", "John Doe", "revolutionize", "seamless", or
  "next-generation" filler.
- No decorative version stamps, section numbering, weather strips, scroll
  instructions, fake terminal metadata, or non-semantic status dots.
- Avoid repeated eyebrow labels.
  - Use at most one small label per three sections.
- Do not repeat the same section layout throughout the page.
- Keep the hero focused.
  - Use one headline, concise supporting text, and at most two actions.
- Keep extension production calls to action pointed at the Chrome Web Store.
  - Manual ZIP loading belongs only to development or preview guidance.

Use image generation only when the surface genuinely needs a new bitmap asset.
Do not generate images for ordinary product controls, icons, code-native
diagrams, or existing Nook brand assets.

## 9. Copy And Accessibility

- Put every visible product string in the shared Rust-owned translation
  catalogs.
  - Render it through the existing `vault.t(...)` path.
- Preserve English and Russian catalog parity.
- Do not hide English literals behind conditionals, fallback expressions, or
  ARIA-only attributes.
- Use field-specific labels and descriptions.
  - Accessibility semantics outrank deduplication.
- Ensure keyboard navigation and visible focus.
- Preserve logical focus order and dialog focus management.
- Give every interactive element a screen-reader name.
- Check WCAG AA contrast for text, controls, placeholders, focus rings, and
  errors in light and dark themes.
- Do not use color alone to convey lock, sync, success, error, or destructive
  state.
- Re-read every visible string for clarity, factual truth, and translation
  expansion before shipping.

## 10. External Design Capabilities

The active harness may expose native design analysis, generation, or review
capabilities. Use one when the user requests it or the task contract requires
it.

External capabilities supplement this article. They do not define repository
architecture, dependencies, product behavior, copy, or validation policy.

## 11. Validation Workflow

For every visible UI change:

1. Inspect the real rendered flow before editing when possible.
2. Implement the smallest coherent visual and behavior change.
3. Inspect every changed state in light and dark themes.
4. Inspect representative phone and desktop widths.
5. Add or update focused Playwright UI-demo coverage for the visible behavior.
6. Run `task format` before the parent-owned push.
7. Run the repository UI demo contract against current `origin/main`.
8. Use focused hosted tasks when they provide useful evidence.
9. Leave complete product validation and other shared delivery state to Gizmo.
10. On Playwright or UI CI failure, inspect the attached app logs before
    changing code.

Do not replace the repository workflow with raw host Playwright, Vitest,
Lighthouse, or generic framework commands. Agents use the hosted remote catalog
and explicit complete validation.

For a Cortex-only update, run `task loom:cortex-audit` and `git diff --check`.

## 12. Final Pre-flight

Before calling a Nook UI change complete, verify:

- [ ] This UI design authority was applied.
- [ ] The design read and surface mode match the real user task.
- [ ] Existing components, tokens, routes, copy voice, and analytics contracts
      were preserved unless explicitly in scope.
- [ ] No React, Next.js, JSX/TSX, React-only package, or parallel component
      system was introduced.
- [ ] Svelte uses typed props, runes, `undefined`, and keyed stable lists.
- [ ] Domain and security decisions remain in Rust/WASM.
- [ ] No secret entered URLs, logs, DOM metadata, analytics, or plaintext
      persistence.
- [ ] Visible copy and accessible names use shared translations.
- [ ] The primary action is obvious and destructive actions are distinct.
- [ ] Loading, empty, error, disabled, pending, success, and recovery states
      relevant to the flow are complete.
- [ ] Forms have persistent labels, correct browser attributes, inline errors,
      and stable focus behavior.
- [ ] Light and dark contrast, hierarchy, and focus states work.
- [ ] Mobile has no horizontal overflow, clipped content, unreachable action,
      or browser-chrome height jump.
- [ ] Motion is purposeful and reduced-motion safe.
      - It does not distract from security or task completion.
- [ ] No card nesting, badge soup, fake data, fake product preview, decorative
      status noise, or generic AI copy was added.
- [ ] Focused Playwright UI-demo coverage shows the changed flow and state.
- [ ] `task format` and the UI demo contract will run before the parent-owned
      push.
- [ ] Repository-owned complete validation remains the product gate.

If any applicable item fails, the UI is not ready.
