# Nook UI and Localization

Meta-Cortex web design and TypeScript development supply generic UI, Svelte,
accessibility, and browser practices. This supplement owns Nook's visual system
and product-specific interaction requirements.

## Required actions

### Visual hierarchy

Decide what a screen is for before changing it. Step back from the requested
component and name the one action or fact the user most needs there. Build the
change around that element.

- Give the most important element the strongest treatment on the screen. Use
  the primary variant and the first place the eye lands.
- Let it lead by contrast, not size. Keep it at the screen's ordinary control
  size; an oversized card or slab overwhelms the screen instead.
- Keep secondary actions and facts visibly quieter. Use outline or dashed
  controls, muted text, and later positions.
- Show at most one leading action per panel. Never repeat an action in a second
  control to draw attention to it.
- Prefer a visual element over an explanatory sentence. Use an icon tile, a
  tag, a slot, or a state mark. Keep any remaining copy to one short line.
- Match the visual's weight to the screen. Standalone diagrams belong to setup
  and approval steps, not to settings panels. A panel shows how its parts
  relate by [connecting its own components](#relationships-between-components).
- Remove or demote what a new element competes with before adding it.
- Review the result before reporting it. Can a first-time user tell what to do
  next? Does the most important element dominate? Does anything look important
  without being important?

**Prohibited:** restyle a panel's blocking action as a muted dashed row to match
its neighbours. Then add an amber row below it that repeats the same action.

**Preferred:** make the blocking action the panel's single primary control.
Show what it unblocks as a quiet locked row that names the step first.

### Relationships between components

A Nook page can be a regular dashboard and a graph at once. Instead of a flat
set of components, it leads the user through a visual language. That language
shows what comes from what and how one part relates to another.

The [relationship dashboard reference](../assets/relationship-dashboard-reference.png)
shows the idea: one lead component, the units it splits into, the workers they
feed, and the result they return to. It is a UX reference for structure and
flow only.

- Do not copy its visual style. Its terminal frame, colours, monospace type,
  progress bars, and text are not a Nook design or UI reference. Build the page
  from Nook's [existing visual system](#existing-visual-system).
- Keep the page a working dashboard. Panels, rows, and actions stay where a
  user expects them; the relationships are drawn between them.
- Show a relationship only where one exists. When one component comes from,
  feeds, or depends on another, place them in reading order and join them with
  a quiet connector. A result can also sit nested under its source.
- Leave independent components unconnected. Arrows on every component make a
  mess and hide the relationships that matter.
- Let the connections lead the eye from a source to what it produces and on to
  the next action. Name a connection with one short verb only when the
  relationship is not obvious.
- Keep connectors quieter than the components they join. Motion is not
  required; use it only when it explains a change of state.

**Prohibited:** show a keyring, its vaults, its sync providers, and this
browser's settings as four equal, unconnected cards. Alternatively, draw an
arrow between every pair of them.

**Preferred:** lead from the keyring to the vaults it opens and to the sync
providers that carry it, with one quiet connector each. Leave this browser's
unrelated settings as an ordinary panel without connectors.

### Existing visual system

Inspect the shipping app.css and adjacent shared primitives before changing UI.
Use Svelte 5, Vite, Bun, Tailwind v4, and the existing shared Svelte components.
Use tailwind-variants, tailwind-merge, cn, and @lucide/svelte where already provided.
Preserve semantic color tokens, the radius scale rooted at 0.375rem, and the
existing light and .dark themes. Ordinary motion uses the existing CSS and
Svelte-native mechanisms. Impeccable remains opt-in by explicit user request.

**Prohibited:** add a second UI kit or theme mechanism for one settings panel.

**Preferred:** extend the adjacent shared primitive and reuse app.css tokens.

### Choices without native dropdowns

Never use a native `<select>` in Nook UI. It opens the operating system's menu,
which ignores the Nook visual system and hides the choices behind a click.
ESLint enforces this with `svelte/no-restricted-html-elements` in
`nook-app/nook-web/eslint.config.js`; only mock third-party pages are exempt.

- Show a short list of choices at once. Use the shared `ChoiceChips` component
  in `components/ui/choice-chips/`, or tiles when each choice needs an icon or
  a detail line.
- Use the styled `ui/select` popover only when the list is too long to show.
- Navigation is not a choice. Show it as links, such as the Help page's
  section row.
- Apply this to every new control, without waiting to be asked.

**Prohibited:** add a `<select>` for an S3 service, a log level, or a key,
including one restyled with `appearance-none`.

**Preferred:** render the services as `ChoiceChips`, with the picked one
outlined and arrow keys moving the pick.

### Product behavior

Preserve nook-auth2 -> nook-core -> nook-wasm -> nook-web ownership.
Keep the extension a thin Simple Vault companion and preserve Simple/Sentinel
separation. Passkey creation is explicit. Setup defaults to authentication with
an existing credential; cancellation does not establish credential absence.
Production extension calls to action target the Chrome Web Store. Manual ZIP
loading belongs to development or preview guidance.

**Prohibited:** offer enrollment automatically after a cancelled passkey prompt.

**Preferred:** preserve the authentication state and offer the product's explicit
creation action only where its owning flow allows it.

### Copy and localization

Put visible product strings and accessible names in the shared Rust-owned
translation catalogs. Render them through vault.t and preserve English/Russian
parity. Do not hide inline English in fallbacks, conditionals, or ARIA attributes.

**Prohibited:** add an English aria-label directly to a new reveal button.

**Preferred:** add its translation key to both catalogs and render that key.

### Evidence

Supply changed-state, light/dark, and phone/desktop evidence through the hosted
browser gates and screenshots. Inspect attached logs when a browser gate fails.
Formatting and Cortex audits follow Nook's authorized execution stage.

**Prohibited:** claim a changed unlock flow is verified from source inspection.

**Preferred:** distinguish authored changes from the hosted evidence still pending.
