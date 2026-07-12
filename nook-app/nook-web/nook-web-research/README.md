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

The catalog at `/` discovers experiments through that registry. Each experiment
gets its own `/experiments/<experiment-name>` page and can freely explore a
different layout or visual direction.

## Categories

- **`nook-auth`** — presence-first Open Nook entry (empty vs unlock, Simple vs
  Sentinel, deferred passkey). Toggle Empty / Vault exists in each sketch.
- **`vault`** — Sentinel vault genesis UI directions (formerly Nexus).
