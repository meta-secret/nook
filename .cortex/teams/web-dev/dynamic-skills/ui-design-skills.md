# Nook UI and Localization

Meta-Cortex web design and TypeScript development supply generic UI, Svelte,
accessibility, and browser practices. This supplement owns Nook's visual system
and product-specific interaction requirements.

## Required actions

### Existing visual system

Inspect the shipping app.css and adjacent shared primitives before changing UI.
Use Svelte 5, Vite, Bun, Tailwind v4, and the existing shared Svelte components.
Use tailwind-variants, tailwind-merge, cn, and @lucide/svelte where already provided.
Preserve semantic color tokens, the radius scale rooted at 0.375rem, and the
existing light and .dark themes. Ordinary motion uses the existing CSS and
Svelte-native mechanisms. Impeccable remains opt-in by explicit user request.

**Prohibited:** add a second UI kit or theme mechanism for one settings panel.

**Preferred:** extend the adjacent shared primitive and reuse app.css tokens.

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

Supply changed-state, light/dark, and phone/desktop evidence through the existing
hosted UI demo and browser gates. Inspect attached logs when a browser gate fails.
Formatting, UI demos, and Cortex audits follow Nook's authorized execution stage.

**Prohibited:** claim a changed unlock flow is verified from source inspection.

**Preferred:** distinguish authored changes from the hosted evidence still pending.
