# Nook web research

Small, disposable UI experiments for Nook, built with Svelte 5, Vite,
Tailwind CSS, and shadcn-svelte components.

This app is intentionally isolated from the production Nook app. It has no
WASM, Docker, backend, or production-code imports.

## Run it

```bash
cd nook-app/nook-web/nook-web-research
bun install
bun run dev
```

## Add an experiment

1. Create `src/experiments/<category>/<experiment-name>/Experiment.svelte`.
2. Keep experiment-specific components and assets in that directory.
3. Add its metadata and component to `src/experiments/index.ts`.

A runtime `enum` a component reads must live in an adjacent `.ts` module and be
imported. Declaring it inside `<script lang="ts">` type-checks and builds, but
the script preprocessor inlines its member reads and drops the enum object, so
template references throw `ReferenceError` on first render.

The catalog at `/` discovers experiments through that registry. Each experiment
gets its own `/experiments/<experiment-name>` page and can freely explore a
different layout or visual direction.

## Categories

- **`nook-auth`** — presence-first Open Nook entry shortlist (What's there?,
  Landing handoff, Key later, One question). Toggle Empty / Vault exists.
- **`vault-auth-workflow`** — end-to-end auth → Sentinel. **Key later** and
  **Landing** both share: name vault → Simple or Sentinel → card stack
  (default) or vault terminal.
- **`vault`** — standalone Sentinel vault genesis UI directions.
- **`keys-management`** — Devices & access directions, successors to the chain
  shipped in [PR #904](https://github.com/meta-secret/nook/pull/904). They
  answer the question a person actually has in front of a locked vault: _which
  of my passkeys opens this, and can I use it from this browser?_ Every sketch
  reads `keys-management/_shared/key-graph.ts` — a graph of passkeys, device
  keys, and vaults, where a passkey reaches a vault only through a device in
  between — and supports the three graphs in its top-right switch: three
  passkeys, one passkey, new browser.
- **`inspiration`** — sketches frozen for an interaction or visual idea rather
  than as candidates. Borrow from them; do not iterate on them. They may read
  older fixtures, kept beside them.

Sketches in `keys-management` share two rules. Every node shows the short
identifier a person would compare against what 1Password or Bitwarden displays,
in a mono font. Selecting any node lights only the subgraph it truly reaches and
dims the rest — use `highlightFor` so this behaves identically everywhere.
