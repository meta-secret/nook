# Nook

<p align="center">
  <img src="nook-web/public/nook-logo-dark-transparent.png" alt="Nook logo" width="240">
</p>

[GitHub repository](https://github.com/meta-secret/nook) · [MIT License](LICENSE)

Nook is a passwordless vault for:

- Website logins
- API keys
- Wallet seed phrases
- Secure notes (Markdown)

Your secrets are stored in an encrypted database. Keep it in this browser or sync it
to your private GitHub repository.

There is no Nook account. There is no master password. Your approved devices unlock
the vault.

> [!WARNING]
> Nook is early-stage software. Vault formats and workflows may still change. Do
> not use it as the only copy of important credentials or recovery phrases.

## Why Nook?

**Your device is the key.** No master password. Your devices unlock the vault.

Most password managers give you one master password. You must remember it. It can be
phished. If you lose it, you may lose the vault.

Nook uses your devices instead:

- **Passwordless access to your secrets.** Approved devices unlock the vault.
- **Your secrets. Your storage. Your keys.** Keep the encrypted vault locally or in
  storage you control.
- **A decentralized vault for your secrets.** There is no Nook account or central
  account server.
- **No master password.** Nothing to remember, type, or reset.
- **You approve new devices.** Use a device that already has access.
- **You choose the storage.** Keep the vault local or use your own provider.
- **The code is open source.** You can inspect how Nook works.

GitHub storage is available today. Google Drive, Proton Drive, Cloudflare R2, and
other providers are planned.

Provider credentials can only read and write the encrypted vault. They cannot
decrypt your secrets.

There is one important trade-off: Nook cannot reset access for you. If you lose every
approved device, you lose the vault. Approve at least two devices.

## What you can store

Nook supports four typed item kinds:

| Type | Fields |
|---|---|
| Login | Website URL, username, password, optional notes |
| API key | Website URL, key, optional expiration date |
| BIP39 seed phrase | Account name, seed phrase |
| Secure note | Title, note (Markdown) |

Items are grouped in the vault and searchable. Secret values stay masked until
revealed. Secure notes use a GitHub-style **Edit / Preview** editor; preview and
display render Markdown in the browser (`markdown-it` + GitHub markdown CSS). Nook also includes
a secure password generator.

## How it works

### On your first device

1. Choose **This device** if the vault should stay in this browser, or **GitHub** if
   you want the encrypted file in a private repository.
2. Add your credentials. Nook encrypts each item before saving anything to the
   selected storage.
3. The browser keeps a device key locally. That key is what allows this browser to
   open the vault later.

### When you come back

- Nook remembers your storage provider.
- This browser uses its device key to unlock the vault (or an optional labelled
  backup password if you configured one).
- Decrypted secrets exist only in the active browser session.
- If you saved several providers, Nook asks which vault to open.

### When you add another browser

1. Open Nook in the new browser.
2. Send a join request.
3. Open Nook on an approved device.
4. Review and approve the request.
5. The new browser can now unlock the vault.

### Technical details

- Each browser creates its own public/private keypair.
- The private key never leaves that browser.
- The public key lets an approved device grant access to the new browser.
- Vault keys are encrypted separately for every approved device.
- Private keys and login credentials are never shared between devices.
- Cryptography runs in Rust compiled to WebAssembly.
- Each secret is typed YAML encrypted with [age](https://age-encryption.org/).
- Only encrypted data is written to IndexedDB or GitHub.

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

A `secure-note` decrypts to title + Markdown body:

```yaml
title: Recovery instructions
note: |
  ## Steps

  Call support with reference **ABC-123**.
```

The plaintext `type` tells Rust which exact structure to deserialize (`login`,
`api-key`, `seed-phrase`, or `secure-note`). Missing type metadata or data that
does not match its declared type is rejected.

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
  device enrollment, validation, search, and password generation. It has no
  browser dependencies and is tested natively.
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
- [Secure notes](.cortex/product-specs/secure-notes.md)
- [Decentralized multi-device authentication](.cortex/product-specs/decentralized-auth.md)
- [Optional backup password & enrollment QR](.cortex/product-specs/password-envelope.md)
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
task web:test:e2e:local    # local Playwright suite (vault CRUD, connect, login unlock, password envelope)
task web:test:e2e          # complete Playwright suite; GitHub PAT required
```

GitHub end-to-end tests read `NOOK_GITHUB_PAT` from the environment or
`nook-web/.env.test.local`; see `nook-web/.env.test.example`. Test repositories are
cleaned up automatically.

Architecture changes should begin in the lowest appropriate layer. Portable domain
logic belongs in `nook-core`, browser I/O in `nook-wasm`, and presentation behavior
in `nook-web`. CI enforces formatting, Clippy warnings, Rust tests, Svelte and
TypeScript diagnostics, ESLint, Prettier, Vitest, and production builds.

### Rust dependency cache

Docker builds use [cargo-chef](https://github.com/LukeMathWalker/cargo-chef) to pre-compile
crate dependencies into cacheable image layers (`builder-debug:cache` and
`builder-wasm:cache` on GHCR). The toolchain image bakes `target/` at `/opt/nook/target`;
the container entrypoint copies it into the bind-mounted workspace when `target/` is empty
(fresh CI checkout). **Do not use Docker named volumes** — GitHub Actions does not persist
them between jobs. See [`.cortex/ARCHITECTURE.md`](.cortex/ARCHITECTURE.md) §7.

After changing Rust dependencies in any `Cargo.toml`, regenerate and commit the chef
recipe and lockfile:

```sh
task docker:generate-recipe
git add recipe.json Cargo.lock
```

## License

Nook is available under the [MIT License](LICENSE).
