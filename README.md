# Nook

<p align="center">
  <img src="nook-app/nook-web/nook-web-app/public/nook-logo-dark-transparent.png" alt="Nook logo" width="240">
</p>

**Keys, not accounts.**

[Site](https://nokey.sh) · [Open app](https://nokey.sh/app/) · [GitHub](https://github.com/meta-secret/nook) · [MIT License](LICENSE)

Nook is an open-source, client-side password and secrets manager. Your vault is
encrypted before it leaves the browser, replicated only through storage you
choose, and opened only by identities you authorize.

There is no Nook account. There is no master password. Approved devices unlock
the vault.

Store website logins, API keys, BIP39 seed phrases, and Markdown secure notes.
Keep the vault local-first, then optionally sync encrypted events to GitHub
(more providers planned).

The public site at [nokey.sh](https://nokey.sh) is the sealed-capsule landing
page (English / Russian). The interactive vault lives at
[`/app/`](https://nokey.sh/app/).

> [!WARNING]
> Nook is early-stage software. Vault formats and workflows may still change. Do
> not use it as the only copy of important credentials or recovery phrases.

## Why Nook?

Most password managers give you one master password. You must remember it. It can be
phished. If you lose it, you may lose the vault.

Nook uses device keys instead:

- **Passwordless access.** Passkey / WebAuthn PRF (or PIN fallback) protects this
  browser's device identity.
- **No central keeper.** Vault keys are wrapped into per-device envelopes;
  enrollment and unlock stay on your devices.
- **Encrypted storage.** Providers transport ciphertext and event digests — not
  plaintext secrets.
- **Distributed authority.** You approve new devices; there is no account reset
  service that can recover the vault for you.
- **Open source.** Inspect the architecture on the site or in this repository.

GitHub sync is available today. Google Drive, Proton Drive, Cloudflare R2, and
other providers are planned.

One important trade-off: if you lose every approved device (and any recovery
path you configured), you lose the vault. Approve at least two devices.

## What you can store

| Type | Fields |
|---|---|
| Login | Website URL, username, password, optional notes |
| API key | Website URL, key, optional expiration date |
| BIP39 seed phrase | Account name, seed phrase |
| Secure note | Title, note (Markdown) |

Items are searchable. Secret values stay masked until revealed. Secure notes use
an Edit / Preview Markdown editor. Nook also includes a secure password generator.

Vault items are append-only in the UI: add, reveal, copy, delete. To change an
item, add a corrected copy and delete the old one.

## How it works

### Local-first vault

1. Protect this browser with a passkey (WebAuthn PRF) or PIN fallback.
2. Create a **Simple** vault on this device, or create / join a **Nexus** vault
   (quorum / SLIP-0039 recovery — see product specs).
3. Secrets are encrypted in Rust/WASM before anything is written to storage.
4. The browser keeps an encrypted local copy. Sync providers are optional
   **replicas** of the same vault, not separate databases.

### When you come back

- Authorize with the passkey so Nook can unwrap this browser's device identity.
- Unlock the local vault (or connect a sync provider to import one).
- Decrypted secrets exist only in the active browser session.
- **Lock vault** clears the plaintext session; encrypted data and providers stay.

### When you add another device

1. Open Nook in the new browser and request to join.
2. Approve the request on an enrolled device.
3. The new device receives vault keys sealed to its public key and can unlock
   independently.

### Four architecture layers

| Layer | What it does |
|---|---|
| Device identity | Each authorized device holds a protected X25519 identity. Plaintext identity material exists only in an unlocked session. |
| Key envelopes | Vault keys are wrapped per device so authorized identities unlock secrets without a central authority. |
| Sync transport | Optional providers move encrypted vault events; they see ciphertext and storage ops, not secrets. |
| Event log | Content-addressed, signed events form a causal DAG so replicas converge without a central sequencer. |

```text
local command
  → signed encrypted event
  → IndexedDB event store
  ↔ set union ↔ GitHub (nook-log/v1/events/…)
  → causal DAG + deterministic projection
  → plaintext session (unlocked only)
```

Cryptography and domain logic run in Rust compiled to WebAssembly. Secret
payloads are typed YAML encrypted with [age](https://age-encryption.org/).

## Architecture

App code lives under `nook-app/`. Dependencies flow one way:

```text
nook-web-app / nook-web-extension
        ↓
   nook-wasm          browser I/O + session bridge
        ↓
   nook-core          vault events, sync, secrets, projection
        ↓
   nook-auth2         device identity, envelopes, vault key access
```

| Package | Role |
|---|---|
| `nook-auth2` | Portable key access: device identities, age envelopes, recovery helpers |
| `nook-core` | Domain: event log, causal merge, projection, typed secrets, sync policy |
| `nook-wasm` | `wasm-bindgen` bridge, IndexedDB / GitHub I/O, session manager |
| `nook-web-app` | Svelte 5 web UI |
| `nook-web-extension` | Manifest V3 browser extension |
| `nook-web-shared` | Shared TypeScript / Svelte presentation glue |

Deeper documentation lives in [`.cortex/`](.cortex/):

- [Architecture](.cortex/ARCHITECTURE.md)
- [Vault event log](.cortex/design-docs/vault-event-log.md)
- [Unified vault / local-first](.cortex/design-docs/unified-vault.md)
- [Vault session and lock](.cortex/design-docs/vault-session-and-lock.md)
- [Password manager](.cortex/product-specs/password-manager.md)
- [Decentralized multi-device auth](.cortex/product-specs/decentralized-auth.md)
- [Engineering principles](.cortex/design-docs/core-beliefs.md)
- [Agent map](.cortex/AGENTS.md)

## Run locally

Prerequisites:

- Docker with Buildx
- [Task](https://taskfile.dev/)

The root `Taskfile.yml` is the repository entrypoint. All compile, test, and
package installs run inside the project container.

```sh
task web:dev
```

Open [http://localhost:5173](http://localhost:5173) for the landing page, or
[http://localhost:5173/app/](http://localhost:5173/app/) for the vault UI.

`setup` runs automatically before docker tasks and rebuilds the `nook-web:local`
image so it reflects current source. Buildx reuses the cached toolchain base and
GHCR `:buildcache`, so only the small source + dist layers rebuild.
Runtime containers receive an explicit 1,048,576 open-file limit; override it
with `DOCKER_NOFILE_LIMIT` when needed.

macOS has no inotify; Docker workloads use the inotify implementation in
Docker Desktop's Linux VM. The following command changes that VM's kernel-wide
limits for every container. Reapply it after Docker Desktop restarts:

```sh
docker run --rm --privileged --pid=host busybox:1.37.0 \
  sysctl -w \
  fs.inotify.max_user_instances=2500 \
  fs.inotify.max_user_watches=10485760
```

On Linux development hosts, raise and persist the same kernel-wide limits
directly (inotify sysctls cannot be configured per container):

```sh
sudo sysctl -w fs.inotify.max_user_instances=2500
sudo sysctl -w fs.inotify.max_user_watches=10485760
printf '%s\n' \
  'fs.inotify.max_user_instances=2500' \
  'fs.inotify.max_user_watches=10485760' \
  | sudo tee /etc/sysctl.d/99-nook-docker.conf
sudo sysctl --system
```

Secondarily, to raise this host's macOS file-descriptor ceilings by 10×, run:

```sh
sudo sysctl -w kern.maxfiles=2764800
sudo sysctl -w kern.maxfilesperproc=1382400
sudo launchctl limit maxfiles 1382400 2764800
```

The launchd limit applies to newly launched processes, so reopen affected
terminals and applications.

To use GitHub sync, connect a personal access token in the UI. Nook stores the
encrypted event log under `nook-log/v1/events/` in a private repository.

## Development

```sh
task check                 # format, lint, tests, coverage floor, builds
task build                 # Rust, WASM, web, and extension production build
task web:dev               # local Vite development server
task web:test              # web unit tests
task web:test:e2e:pr       # fast Playwright subset (IndexedDB / local provider)
task web:test:e2e          # full local-provider Playwright suite (no PAT)
task web:test:e2e:sync-live  # live GitHub sync e2e (requires NOOK_GITHUB_PAT)
task extension:build       # browser extension package
task ci:pr                 # local mirror of the PR CI gate
```

Live sync e2e reads `NOOK_GITHUB_PAT` from the environment or
`nook-app/nook-web/nook-web-app/.env.test.local`; see
`.env.test.example` next to that file.

Architecture changes belong in the lowest appropriate layer: key access in
`nook-auth2`, domain logic in `nook-core`, browser I/O in `nook-wasm`, UI in
`nook-web-*`. When package boundaries, sync model, or public Task commands
change, update this README in the same change (see [`.cortex/AGENTS.md`](.cortex/AGENTS.md)).

### Rust dependency cache

Docker builds use [cargo-chef](https://github.com/LukeMathWalker/cargo-chef) and a
shared **linux/amd64** toolchain base on GHCR. Workspace source is copied into the
`nook-web:local` image (sealed image; no runtime bind mount except `task web:dev`).

```text
ghcr.io/<owner>/<repo>/toolchain:<git-commit>  # deps + warm target/ base
ghcr.io/<owner>/<repo>/toolchain:buildcache    # buildx layer cache
nook-web:local                                 # base + your source (what task runs)
```

**The GHCR cache is pull-always, push-main-only.** Local builds pull `:buildcache`;
only main CI publishes it. Run `docker login ghcr.io` once so local pulls
authenticate. Details: [`.cortex/ARCHITECTURE.md`](.cortex/ARCHITECTURE.md) §7.

After changing Rust dependencies, commit the updated lockfile:

```sh
cd nook-app && cargo generate-lockfile
git add nook-app/Cargo.lock
```

## License

Nook is available under the [MIT License](LICENSE).
