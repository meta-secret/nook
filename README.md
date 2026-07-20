# Nook

<p align="center">
  <img src="nook-app/nook-web/nook-web-app/public/nook-logo-dark-transparent.png" alt="Nook logo" width="240">
</p>

**Keys, not accounts.**

[Site](https://nokey.sh) · [Simple Vault](https://simple.nokey.sh) · [Sentinel Vault](https://sentinel.nokey.sh) · [GitHub](https://github.com/meta-secret/nook) · [MIT License](LICENSE)

Nook is an open-source, client-side password and secrets manager. Your vault is
encrypted before it leaves the browser, replicated only through storage you
choose, and opened only by identities you authorize.

There is no Nook account. There is no master password. Approved devices unlock
the vault.

Store website logins, API keys, BIP39 seed phrases, Markdown secure notes,
Google Authenticator-compatible TOTP items with simple setup-key or URI entry,
and website passkeys. On recognized one-time-code fields, the Chromium
extension lets the user choose a saved authenticator and fills a freshly
derived TOTP code; when none is saved, it says so and opens the vault to add
one. The extension can also save and use passkeys from an
approved, unlocked Simple Vault while preserving an explicit browser/security
key fallback. Passkeys cannot be created from the generic item form; key
generation, RP validation, signing, and counter updates stay in Rust/WASM.
Existing Bitwarden logins and secure notes can be imported from a plaintext or
password-protected encrypted Bitwarden JSON export; account-restricted exports
are not portable. LastPass logins and secure notes can be imported from an
unencrypted generic CSV export. 1Password logins, password items, and secure
notes can be imported from an unencrypted 1PUX archive. Apple Passwords website
logins and TOTP verification codes can be imported from its unencrypted CSV
export. Website logins from Chrome, Chromium, Brave, and Edge can be imported
from their unencrypted password CSV exports. Proton Pass logins and secure notes
can be imported from an unencrypted ZIP export or a decrypted `data.json`;
PGP-encrypted exports must be decrypted first. Google Authenticator TOTP
accounts can also be imported by scanning every migration QR code in an account
export with the camera or by selecting QR-code images. Unsupported item types
and attachments are skipped. Overlapping records are reconciled with vault-keyed
item-identity and secret-version HMAC fingerprints. Matching secret versions
enrich the existing item with additional provider fields; differing passwords
remain as separate items instead of being overwritten.
Keep the vault local-first, then optionally sync encrypted events to GitHub
(more providers planned).

The public site lives at [nokey.sh](https://nokey.sh) (English / Russian).
Everyday Simple vaults live at
[simple.nokey.sh](https://simple.nokey.sh); quorum-protected Sentinel vaults
live at [sentinel.nokey.sh](https://sentinel.nokey.sh). They are independent
applications and browser origins, not modes in one production app. The browser
extension can pair only with Simple Vault. After choosing the product, its
first-device screen offers two separate intents: create a new vault, or connect
the sync provider for an existing compatible vault.

The Main channel mirrors that split at [dev.nokey.sh](https://dev.nokey.sh),
[simple.dev.nokey.sh](https://simple.dev.nokey.sh), and
[sentinel.dev.nokey.sh](https://sentinel.dev.nokey.sh). Pull requests use
Cloudflare's native `pr-<number>.<project>.pages.dev` branch aliases.
Each PR site publishes its matching browser-extension ZIP under `/downloads/`;
main does the same at `dev.nokey.sh`, and immutable production releases publish
the versioned ZIP at `nokey.sh` plus the GitHub Release. The public site's
browser-extension section reads the channel metadata: production sends users to
the Chrome Web Store listing for the stable extension identity, while
development and PR previews offer their unsigned ZIP with Developer-mode
installation instructions. Production keeps the ZIP as a verifiable release
artifact rather than the public installation path.

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

GitHub, Google Drive, iCloud, and local-folder sync are available today. Google
Drive can use either private app data or a folder shared across Google
accounts. iCloud can likewise use a private CloudKit database or a CloudKit
share across Apple accounts. Shared-provider enrollment transfers only the
stable folder/share target; each browser signs into its provider independently
and keeps its own OAuth or CloudKit web-auth token.
Proton Drive, Cloudflare R2, and other providers are planned.

One important trade-off: if you lose every approved device (and any recovery
path you configured), you lose the vault. Approve at least two devices.

## What you can store

| Type | Fields |
|---|---|
| Login | Website URL, username, password, optional notes |
| API key | Website URL, key, optional expiration date |
| BIP39 seed phrase | Account name, seed phrase |
| Secure note | Title, note (Markdown) |
| Passkey | Website/RP and account metadata; encrypted ES256 credential |
| Authenticator | Service, account, and TOTP setup key or `otpauth://` URI |

Items are searchable. Secret values stay masked until revealed. Secure notes use
an Edit / Preview Markdown editor. Authenticator items derive the current
one-time code locally in Rust/WASM and never persist generated codes. The
browser extension detects common OTP fields and releases a current code only
after the user explicitly chooses the authenticator. Nook also includes a
secure password generator.

Vault items are append-only in the UI: add, reveal, copy, delete. To change an
item, add a corrected copy and delete the old one.

## How it works

### Local-first vault

1. Open **Simple Vault** for everyday secrets or **Sentinel Vault** for a
   quorum safe. Sentinel member devices enter only through an owner-issued
   invitation.
2. Creating a **Simple** vault directly on the website protects this browser
   with a passkey (WebAuthn PRF) or PIN fallback. When creation starts from the
   unlocked Nook extension, the extension's protected device identity creates
   the vault instead, so the website does not create another passkey.
   **Sentinel** starts quorum / SLIP-0039 setup: the owner
   shares an invitation URL, each participant opens it and connects a protected
   device, then returns the signed response URL. After atomic creation, the
   owner sends each member their device-addressed encrypted share and completes
   the first quorum unlock. Sync providers remain optional and are added later
   from inside the vault.
   Member devices connect only through those owner-issued invitations.
3. Secrets are encrypted in Rust/WASM before anything is written to storage.
4. The browser keeps an encrypted local copy. Sync providers are optional
   **replicas** of the same vault, not separate databases.

### When you come back

- Unlock with this browser's passkey/PIN-protected device keys, or use a backup
  password to open the encrypted local vault directly. A vault created with the
  extension identity automatically prefers that approved identity whenever the
  extension is unlocked, including after a page refresh or explicit vault lock;
  the site receives a fresh encrypted, memory-only key handoff. If the paired
  extension is locked, choosing Unlock opens the extension-owned authorization
  window instead of requesting the website's separate passkey.
- A backup-password session leaves the protected device identity and saved sync
  provider credentials locked. Authorize with the passkey or PIN when you want
  remote synchronization to resume.
- You can also connect a sync provider to import an existing vault.
- Decrypted secrets exist only in the active browser session. List/search pages
  retain metadata only; reveal and secret copy decrypt one item on demand, then
  free it when the revealed/action state ends.
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
  → encrypted session + metadata pages
  → one-record plaintext exposure on reveal/copy (unlocked only)
```

Cryptography and domain logic run in Rust compiled to WebAssembly. Secret
payloads are typed YAML encrypted with [age](https://age-encryption.org/).

## Architecture

App code lives under `nook-app/`. Dependencies flow one way:

```text
nook-vault-simple / nook-vault-sentinel / nook-web-extension
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
| `nook-vault-simple` | Independent Svelte 5 Simple Vault application and artifact |
| `nook-vault-sentinel` | Independent Svelte 5 Sentinel Vault application and artifact |
| `nook-web-app` | Public site and unified local e2e harness |
| `nook-web-extension` | Simple-only Manifest V3 companion with Nook Pilot: a minimal, Rust-policy-backed authentication HUD for website login progress, explicit credential fill, and manual takeover |
| `nook-web-shared` | Presentation/browser glue safe to share between vault apps |

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

The first run builds a pinned `mkcert` utility container, writes ignored TLS
material under `.nook/https/`, and asks the host OS to trust that local CA for
the browser. Open
[https://localhost:5173](https://localhost:5173) for the landing page, or
[https://localhost:5173/app/](https://localhost:5173/app/) for the unified local
test harness. The production builds are `bun run build` inside
`nook-vault-simple` and `nook-vault-sentinel`; they never use a hostname flag to
select a vault type.

All web surfaces consume one audited `nook-wasm` package that is compiled and
optimized once. Each entrypoint configures its immutable Rust-owned application
identity before loading app modules, so Simple and Sentinel remain separate
projects and origins without recompiling the same Rust library per surface.

`setup` runs automatically before docker tasks and rebuilds the `nook-web:local`
image so it reflects current source. Buildx prepares the Rust/WASM and web
dependency branches in parallel, exports only the generated WASM and coverage
files through a commit-scoped host directory with an isolated subdirectory per
invocation, then builds a web-only image. Concurrent builds cannot consume each
other's handoff, and Rust `target/` and the compiler toolchain never enter
`nook-web:local`.
Before Rust compilation, Task also idempotently starts a Docker-host-only
`nook-sccache-redis` container. All short-lived Docker/BuildKit Rust compilers
share that persistent Redis-backed `sccache`, so a dependency change that
invalidates cargo-chef or Docker layers can still reuse compatible compiled
crate artifacts. Override its defaults with `SCCACHE_REDIS_PORT`,
`SCCACHE_REDIS_MAXMEMORY`, or `SCCACHE_REDIS_IMAGE`.
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
task preflight             # fast Rust checks for whole-repository invariants
task build                 # Rust, WASM, web, and extension production build
task web:dev               # trusted-HTTPS local Vite development server
task web:test              # web unit tests
task web:test:e2e:pr       # fast Playwright subset (IndexedDB / local provider)
task web:test:e2e:isolation # Simple/Sentinel project and origin boundary suite
task web:test:e2e          # full local-provider Playwright suite (no PAT)
task web:test:e2e:sync-live  # live GitHub sync e2e (requires NOOK_GITHUB_PAT)
task extension:build       # browser extension package
task extension:check:fast  # host-cached extension format/unit/manifest/security gate
task extension:build:localhost # local-only identity targeting trusted HTTPS localhost
task extension:install:hosted PR=410 # verify and install an isolated hosted PR build
task extension:run:chrome CHANNEL=dev # Chrome for Testing auto-loads; branded Chrome opens one-time setup
task extension:run:brave CHANNEL=prod # launch a hosted build in an isolated Brave profile
task ci:pr                 # health-checked BuildKit mirror of the PR CI gate (no browser e2e)
task ci:pr:e2e             # explicit full web + extension e2e validation
task pr:preflight PR=410   # JSON audit: base, policy, exact-head runs/deployments, feedback
task pr:review PR=410      # optional idempotent exact-head Codex review request
task pr:ready PR=410       # read-only exact-head readiness assertion; never merges
task docker:coverage:export  # coverage-only CI fallback (no app image export)
task sccache:stats          # shared compiler-cache keys, memory, hits, and misses
```

Live sync e2e reads `NOOK_GITHUB_PAT` from the environment or
`nook-app/nook-web/nook-web-app/.env.test.local`; see
`.env.test.example` next to that file.

Architecture changes belong in the lowest appropriate layer: key access in
`nook-auth2`, domain logic in `nook-core`, browser I/O in `nook-wasm`, UI in
`nook-web-*`. When package boundaries, sync model, or public Task commands
change, update this README in the same change (see [`.cortex/AGENTS.md`](.cortex/AGENTS.md)).

### Docker dependency caches

Docker builds use [cargo-chef](https://github.com/LukeMathWalker/cargo-chef) and
independent **linux/amd64** Rust, web dependency, and browser lineages. GitHub
Actions runs PR, main, and release validation on `ubuntu-latest`; each fresh VM
restores distinct BuildKit v2 cache scopes for Rust/WASM, web dependencies, the
browser-free web image, and the e2e image. Main refreshes the default-branch
cache that new PRs may restore, while PR reruns reuse their branch cache.
Workspace source is copied into
the slim `nook-web:local` image (sealed image; no runtime bind mount except
`task web:dev`). Explicit `task rust:*` and `task wasm:*` commands load a separate
source-sealed Rust image on demand.

Rust compilation has a second cache boundary below Docker layers: pinned
`sccache` clients use one persistent, Docker-host-only Redis service per Docker
host. On macOS the service binds to host loopback; on Linux it binds only to
Docker's bridge-gateway interface. Build and runtime containers resolve the
same `host.docker.internal` endpoint. A shared resolver supplies a concrete
Docker-host IPv4 address to Bake and every Rust-capable runtime container; the
magic Docker gateway token is not used.
The service stores up to 8 GiB by default with LRU eviction and AOF
persistence. It is an optimization only—Cargo, tests, and final linking remain
the correctness boundary—and it never transfers cache data between machines.

No BuildKit cache is imported from or exported to a registry. Local builds keep
using the selected builder's content store with no remote-cache traffic. The
Docker-host-only Redis `sccache` remains a secondary local compiler cache; on a
fresh hosted VM it starts empty, while restored Docker layers provide the
cross-run cache. Details:
[`.cortex/ARCHITECTURE.md`](.cortex/ARCHITECTURE.md) §7.

After changing Rust dependencies, commit the updated lockfile:

```sh
cd nook-app && cargo generate-lockfile
git add nook-app/Cargo.lock
```

## License

Nook is available under the [MIT License](LICENSE).
