# Nook Svelte UI Taste

Ship deliberate, calm, trustworthy Nook interfaces without weakening product
truth or security boundaries. This is the canonical Nook UI design authority.

Every user-visible Nook UI task must load and apply this card when it:
- designs, implements, redesigns, polishes, or reviews vault, website,
  browser-extension, landing, help, settings, onboarding, or authentication; or
- changes responsive behavior, accessibility, motion, visual state, components, or styling.

## Evidence And Direction

Before editing:

1. Read the [Web development team contract](../AGENTS.md).
2. Select the most specific authority from the
   [Web development knowledge graph](../knowledge-graph.md).
3. Inspect the real target at runtime when possible.
4. Inspect an incumbent source of visual truth:
   - `nook-app/nook-web/nook-web-shared/src/vault-app/app.css`;
   - the nearest shared `lib/components/ui/` primitive;
   - a comparable shipping Svelte component; or
   - existing light and dark rendered states.
5. State the surface, user task, retained Nook pattern, visual direction, and
   interaction priority.

Use the surface mode that matches the task:

- **Operate:** vault, settings, authentication, recovery, sync, and extension
  UI prioritize scanning, explicit state, restrained motion, and trust.
- **Persuade:** landing and product explanation prioritize strong hierarchy,
  memorable composition, and real product evidence.
- **Read:** help, legal, logs, and documentation prioritize comprehension,
  navigation, readable measure, and quiet chrome.
- **Experience:** research and showcases use artifact-led composition only
  within explicit experimental scope.

Existing product rhythm and the brief win. Ask one focused aesthetic question
only when two materially different directions remain plausible.

## Fixed Stack

- Use Svelte 5 with `$props`, `$state`, `$derived`, and focused `$effect` runes.
- Use Vite and Bun through repository Taskfile workflows.
- Use Tailwind CSS v4 and semantic CSS variables from `app.css`.
- Reuse shared Svelte UI primitives from
  `nook-web-shared/src/vault-app/lib/components/ui/`.
- Use `tailwind-variants`, `tailwind-merge`, and `cn` for variants.
- Use `@lucide/svelte` as the single ordinary icon family.
- Use CSS, `tw-animate-css`, and Svelte-native behavior for normal motion.
- Do not add React, Next.js, JSX/TSX, React-only packages, shadcn React
  components, or a parallel component system.
- Do not add a design or animation dependency when the fixed stack suffices.
- Inspect the owning `package.json` and justify any new dependency.

## Svelte 5 Rules

- Keep markup readable and components thin.
- Use `undefined`; never author `null`.
- Use typed props and generated `$app-wasm` types directly.
- Key stable collections with their semantic identifier.
- Prefer semantic elements to ARIA patches.
- Follow the package's Svelte event conventions.
- Return cleanup from `$effect` for listeners, observers, timers, and external
  animation state.
- Keep continuous pointer and scroll values outside component-wide rune state.
  Prefer CSS, `IntersectionObserver`, or a narrow action.
- Keep application-wide state and effects in the existing `.svelte.ts`
  controller pattern. Do not create React-style stores.
- Svelte renders and coordinates; it does not own vault policy.

## Rust, WASM, And Security

Preserve `nook-auth2 -> nook-core -> nook-wasm -> nook-web`.

- Put validation, authorization, cryptography, vault decisions, data shaping,
  and durable behavior in typed Rust exposed through WASM.
- Limit Svelte to presentation state, browser ceremonies, lifecycle,
  accessibility, and explicit interaction.
- Do not mirror Rust enums or DTOs with TypeScript string unions.
- Never place secrets in URLs, logs, DOM attributes, test IDs, analytics, or
  hidden fallback markup.
- Never persist plaintext secrets in browser convenience state.
- Mask sensitive values until explicit reveal. Clear temporary revealed or
  generated state when hidden or dismissed.
- Keep passkey creation explicit. Default setup to authentication with an
  existing credential; never infer credential absence from cancellation.
- Keep the extension a thin Simple Vault companion.
- Preserve Simple and Sentinel product separation.

Any visual shortcut that weakens these boundaries is a failed design.

## Components, Tokens, And Themes

- Reuse `Button`, `Card`, `Select`, separators, and nearby shared components.
- Extend repeated primitive variants instead of duplicating utility strings.
- Use semantic tokens such as `bg-background`, `text-foreground`, `bg-card`,
  `text-muted-foreground`, `border-border`, `bg-primary`, and
  `text-destructive`.
- Preserve the radius scale rooted at `--radius: 0.375rem`.
- Use hard-coded color only for semantics or third-party identity that tokens
  cannot express.
- Support the existing light and `.dark` themes. Do not add another theme
  mechanism or flip theme per section.
- Create distinction with hierarchy, rhythm, typography, and state before new
  accent colors.

## Hierarchy, Forms, And States

- Give each surface one obvious primary task.
- Keep the primary action dominant and destructive actions separate.
- Prefer typography, spacing, alignment, and progressive disclosure to extra
  containers.
- Avoid nested cards, badge soup, and decorative status noise.
- Keep security and recovery consequences beside their action.
- Give every field a persistent label and meaningful browser attributes.
- Put helper text by its control and actionable error text by its field.
- Never use placeholder text as the only label.
- Disable controls only when unavailable and explain non-obvious disabled state.
- Prevent button-label wrapping at normal desktop and mobile widths.
- Preserve focus after inline changes and return focus when dialogs close.
- Design loading, empty, error, disabled, pending, success, offline, locked,
  stale, conflict, and recovery states without layout collapse.
- Design focus, hover, and active states for every interactive control.
- Never polish only the successful static state while leaving real failure or
  recovery paths unfinished.

## Responsive Behavior And Motion

- Inspect phone, compact desktop, and normal desktop sizes.
- Collapse multi-column product layouts deliberately below `768px`.
- Keep practical tap targets at least 44 by 44 CSS pixels.
- Keep dialogs, forms, and actions inside the visual viewport.
- Account for browser zoom, translation expansion, and long user-provided names.
- Prevent horizontal overflow; never hide broken layout with arbitrary clipping.
- Use `100svh` or `100dvh` intentionally; avoid mobile `100vh` or `h-screen`
  jumps.
- Use capability and state detection, not viewport heuristics, for browser and
  extension functionality.
- Add motion only for feedback, hierarchy, transition, or comprehension.
- Prefer existing CSS transitions and animate `transform` or `opacity`, not
  layout properties.
- Honor `prefers-reduced-motion`.
- Do not add perpetual motion to security, recovery, or dense Operate surfaces.
- Do not use custom cursors, scroll hijacking, magnetic buttons, or decorative
  parallax in the vault product.

## Anti-Slop Rules

- Do not default to purple-blue glow, centered gradient heroes, pervasive
  glass, or repeated identical feature cards.
- Do not fabricate product UI, metrics, testimonials, logos, security claims,
  compatibility claims, or user data.
- Use real product evidence or an approved asset instead of decorative mock UI.
- Do not use generic AI copy, fake terminal metadata, decorative status dots,
  weather strips, version stamps, or scroll instructions.
- Avoid repeated eyebrow labels and repeated section layouts.
- Keep heroes to one headline, concise support, and at most two actions.
- Point production extension calls to action to the Chrome Web Store.
  Manual ZIP loading belongs only to development or preview guidance.
- Generate bitmaps only when a surface genuinely needs one. Reuse code-native
  controls, icons, diagrams, and Nook brand assets.

## Copy And Accessibility

- Put every visible product string and accessible name in the shared Rust-owned
  translation catalogs and render it through `vault.t(...)`.
- Preserve English and Russian catalog parity.
- Do not hide inline English in fallbacks, conditionals, or ARIA attributes.
- Use field-specific labels and descriptions; accessibility outranks
  deduplication.
- Ensure keyboard navigation, visible focus, logical order, dialog focus
  management, and screen-reader names.
- Meet WCAG AA contrast for text, controls, placeholders, focus rings, and
  errors in light and dark themes.
- Never use color alone for lock, sync, success, error, or destructive state.
- Re-read copy for clarity, factual truth, and translation expansion.

## Validation

1. Inspect the real rendered flow before editing when possible.
2. Implement the smallest coherent visual and behavior change.
3. Inspect every changed state in light and dark themes.
4. Inspect representative phone and desktop widths.
5. Add or update focused Playwright UI-demo coverage.
6. Run `task format` before the parent-owned push.
7. Run the repository UI demo contract against current `origin/main`.
8. Use repository-hosted validation; do not substitute raw host Playwright,
   Vitest, Lighthouse, or generic framework commands.
9. Inspect attached app logs before changing code after Playwright or UI CI
   failure.
10. Leave complete product validation and shared delivery state to Gizmo.

For Cortex-only changes, run `task loom:cortex-audit` and `git diff --check`.
Any applicable failed directive means the UI is not ready.
