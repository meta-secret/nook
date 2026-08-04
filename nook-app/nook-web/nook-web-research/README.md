# Nook web research

Small, disposable UI experiments for Nook, built with Svelte 5, Vite,
Tailwind CSS, and shadcn-svelte components.

This app is intentionally isolated from the production Nook app. It has no
WASM, Docker, backend, or production-code imports.

Experiment copy is intentionally colocated with each disposable sketch and may
remain English-only while the interaction and information architecture are
being explored. The research catalog is not a shipped product surface. Any
direction ported into a production Nook app must move visible copy into the
shared translation catalogs before it can ship.

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
  Landing handoff, Key later). Toggle Empty / Vault exists.
- **`vault-auth-workflow`** — end-to-end auth → Sentinel. **Key later** and
  **Landing** both share: name vault → Simple or Sentinel → card stack
  (default) or vault terminal.
- **`vault`** — standalone Sentinel vault genesis UI directions.
- **`keys-management`** — Frozen-era Devices & access studies of passkeys,
  device keys, and vaults. These sketches remain useful for possession and
  evidence interactions, but they do not define the virtual-identity model.
- **`identity-management`** — the current research direction: virtual
  identities keep installation keys and receive independent vault grants.
- **`inspiration`** — sketches frozen for an interaction or visual idea rather
  than as candidates. Borrow from them; do not iterate on them. They may read
  older fixtures, kept beside them.

Sketches in `keys-management` share three rules. Every node shows the short
identifier a person would compare against what 1Password or Bitwarden displays,
in a mono font. Selecting any node lights only the subgraph it truly reaches and
dims the rest — use `highlightFor` so this behaves identically everywhere. And
the device key of the browser you are sitting in is drawn as a different class of
object from every other device key — a vault has many devices, so `isHere` must
be visible at a glance, not read off a label.

Drawing every relation at once produced a net nobody could read. Prefer showing
one vault, or one route, at a time.

The retired passkey-as-identity direction is no longer an active catalog
candidate. Its useful handoff interaction remains frozen under Inspiration;
the current identity-management sketches keep passkeys, device keys, virtual
identities, and vault grants as distinct objects.
