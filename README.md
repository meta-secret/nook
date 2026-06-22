# Nook

[GitHub repository](https://github.com/meta-secret/nook) · [MIT License](LICENSE)

Nook is an open-source, browser-first password and secret manager. It encrypts
credentials on your device and stores the encrypted vault somewhere you control:
locally in the browser or in a private GitHub repository.

There is no Nook account and no central Nook server holding your vault. A browser
becomes an enrolled device with its own local identity; the shared encrypted vault
file is the source of truth.

> [!WARNING]
> Nook is early-stage software. Vault formats and workflows may still change. Do
> not use it as the only copy of important credentials or recovery phrases.

## Why Nook?

Passwords give access to your digital life, but using a password manager usually
means creating another account and trusting another service to store your vault,
keep its servers available, and decide how you recover access.

Nook is for people who want a useful password manager without handing over custody
of the vault.

You open Nook, save a login, API key, or wallet recovery phrase, and choose where the
encrypted vault lives. Keep it only in this browser, or put it in a private GitHub
repository you own. Nook does not create a hosted account for you, and there is no
Nook database that can be breached, suspended, or taken offline with your vault in
it.

That changes three important things:

- **You choose where the vault lives.** Local mode keeps it on this device. GitHub
  mode gives you an encrypted file in your own private repository.
- **You decide which devices can open it.** A new browser asks to join; a browser
  you already trust approves it. Nook is not the gatekeeper.
- **You can inspect the whole system.** The application, encryption flow, and vault
  format are open source. Your ability to understand your vault does not stop at a
  company's privacy policy.

For example: save a GitHub login on your laptop, sync the encrypted vault to your
repository, then open Nook on another computer. The second browser cannot read the
vault by merely finding the file—it must request access, and your enrolled laptop
must approve it. After approval, both browsers can open the same vault; their private
device keys remain separate and local.

## What you can store

Nook currently supports three intentionally small item types:

| Type | Fields |
|---|---|
| Login | Website URL, username, password, optional notes |
| API key | Website URL, key, optional expiration date |
| BIP39 seed phrase | Account name, seed phrase |

Items are grouped by type, searchable by their visible metadata, and masked until
explicitly revealed. The login form includes a cryptographically secure password
generator.

## How it works

### On your first device

1. Choose **This device** if the vault should stay in this browser, or **GitHub** if
   you want the encrypted file in a private repository.
2. Add your credentials. Nook encrypts each item before saving anything to the
   selected storage.
3. The browser keeps a device key locally. That key is what allows this browser to
   open the vault later.

### When you come back

The browser remembers the storage provider and uses its local device key to unlock
the vault. Decrypted secrets exist only in the active browser session. If you have
several saved vault providers, Nook asks which one you want to open.

### When you add another browser

The new browser creates its own device key and places a join request in the encrypted
vault. Open Nook on an already enrolled device, review the request, and approve it.
The new browser then receives access to the vault keys encrypted specifically for
that device.

Under the hood, the security-sensitive work runs in Rust compiled to WebAssembly.
Secret data is represented as typed YAML, encrypted independently with
[age](https://age-encryption.org/), and only then written to IndexedDB or GitHub. The
Svelte interface never implements its own cryptography.

## Vault and trust model

The default on-disk format is `nook-vault.yaml`. A user item has a plaintext envelope
and encrypted data:

```yaml
secrets:
  - id: 0d86db76-6f91-4eaf-88d8-4629d72198b8
    type: login
    data: |
      -----BEGIN AGE ENCRYPTED FILE-----
      ...
      -----END AGE ENCRYPTED FILE-----
```

Decrypting `data` produces type-specific YAML. Multiline fields remain natural to
read and edit in diagnostic tooling:

```yaml
websiteUrl: https://example.com
username: alice
password: correct horse battery staple
notes: |-
  Personal account.
  Recovery codes are stored offline.
```

The plaintext `type` tells Rust which exact structure to deserialize. Missing type
metadata or data that does not match its declared type is rejected.

The complete vault also contains:

| Section | Purpose |
|---|---|
| `secrets` | Typed user items; each `data` value is independently encrypted |
| `auth` | Per-device envelopes containing the shared `secrets_key` and `members_key` |
| `joins` | Temporary requests from browsers waiting to be enrolled |
| `members` | Encrypted catalog of enrolled device public keys |

Important boundaries:

- Secret data and vault keys are never sent to storage in plaintext.
- Device private keys stay in that browser's IndexedDB.
- GitHub receives the encrypted vault file. The GitHub personal access token is
  saved in browser IndexedDB for reconnect convenience and therefore should be
  treated as locally stored provider credentials.
- The item `id` and `type`, vault membership identifiers, and the existence and size
  of encrypted records are visible to the storage provider.
- Losing every enrolled device means losing the private identities needed to open
  the vault. Enrolling more than one device reduces that recovery risk.

## Multi-device access

Nook does not use a central identity service. To add a browser:

1. The new browser writes a join request to the shared vault.
2. An enrolled browser reviews and approves the request.
3. The approver encrypts the vault keys to the new device's public key.
4. The new browser can then unlock the same vault independently.

The private key remains local to each device. GitHub coordinates the encrypted file;
it does not become the authority that can decrypt it.

## Architecture

The monorepo has a strict one-way dependency flow:

```text
nook-web  →  nook-wasm  →  nook-core
 Svelte       browser       pure Rust
   UI        I/O bridge    domain logic
```

- **`nook-core`** — typed secret model, YAML/JSONL vault formats, age encryption,
  device enrollment, validation, search, and password generation. It has no browser
  dependencies and is tested natively.
- **`nook-wasm`** — `wasm-bindgen` bridge and session manager. It connects the core
  to IndexedDB and the GitHub REST API, caches encrypted records, and exposes small
  JavaScript-friendly operations.
- **`nook-web`** — Svelte 5 and TypeScript presentation layer. It owns forms,
  provider selection, reactive state, clipboard actions, and the vault UI.

The incremental save path encrypts only the changed item. Unchanged ciphertext is
kept in an armored cache and reused when the YAML vault is serialized again.

Deeper documentation lives in [`.cortex/`](.cortex/):

- [Architecture](.cortex/ARCHITECTURE.md)
- [Password manager specification](.cortex/product-specs/password-manager.md)
- [Decentralized multi-device authentication](.cortex/product-specs/decentralized-auth.md)
- [Storage providers and login UX](.cortex/design-docs/auth-providers.md)
- [Engineering principles](.cortex/design-docs/core-beliefs.md)

## Run locally

Prerequisites:

- Docker with Buildx
- [Task](https://taskfile.dev/)

The Taskfile is the command surface for the repository; Rust, Bun, wasm-pack, and
other build tools run inside the project container.

```sh
task setup
task web:dev
```

Open [http://localhost:5173](http://localhost:5173).

To use GitHub storage, connect a personal access token in the UI. Nook creates the
selected repository as private when it does not already exist and stores the
encrypted vault at `nook-vault.yaml`.

## Development

Common commands:

```sh
task check                 # format, lint, tests, diagnostics, and builds
task build                 # Rust, WASM, and production web build
task web:dev               # local Vite development server
task web:test              # web unit tests
task web:test:e2e:local    # local-vault Playwright suite
task web:test:e2e          # complete Playwright suite; GitHub PAT required
```

GitHub end-to-end tests read `NOOK_GITHUB_PAT` from the environment or
`nook-web/.env.test.local`; see `nook-web/.env.test.example`. Test repositories are
cleaned up automatically.

Architecture changes should begin in the lowest appropriate layer. Portable domain
logic belongs in `nook-core`, browser I/O in `nook-wasm`, and presentation behavior
in `nook-web`. CI enforces formatting, Clippy warnings, Rust tests, Svelte and
TypeScript diagnostics, ESLint, Prettier, Vitest, and production builds.

## License

Nook is available under the [MIT License](LICENSE).
