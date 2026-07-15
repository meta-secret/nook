# Nook Browser Extension

`nook-web-extension` is Nook's browser-integration package. Before pairing, the
toolbar popup shows the standard device-protection widget and creates or
unlocks the extension's separately revocable identity. It then sends the public
device request directly to the configured Simple Vault deployment, which owns
the complete vault interface. The extension contains browser-only behavior:
device protection, the in-page Nook widget, autofill DOM integration, and
background coordination.

The extension first-run model is specified in
[`.cortex/product-specs/browser-extension.md`](../../../.cortex/product-specs/browser-extension.md).
The extension becomes its own passkey-protected Nook device and pairs only
through vault consent at the configured Simple Vault
`/extension-connect` route; it does not borrow or scrape the Simple web app
device key. There is no website-first enable screen or second extension window.
It intentionally has no miniature vault interface. Sentinel Vault
is excluded by the manifest, runtime guard, pairing validation, and Rust/WASM
capability checks.

Approval copies the canonical encrypted, signed event log into the extension's
own IndexedDB through a Rust/WASM-validated runtime message. The extension is
marked connected only when that graph contains a current approval and encrypted
key envelope for its passkey-protected device. Afterward, Simple Vault sends the
same encrypted projection after local changes and provider pulls, so local
website/extension updates do not require a sync provider. No decrypted secret or
event-log payload is stored in `chrome.storage.local`.

Build it through Docker-backed Taskfile commands from the repo root or `nook-app/`:

```bash
task extension:build
```

The target defaults to production. Override it for a PR or local development
build; path prefixes are preserved:

```bash
NOOK_SIMPLE_VAULT_URL=https://pr-391.nook-1n8.pages.dev/simple/ task extension:build
task extension:build:localhost
```

PR CI supplies its deterministic `pr-<number>` Simple artifact automatically.
The current `dev.nokey.sh` deployment is landing-only, so development extension
builds should target the local Simple Vault server rather than that hostname.

The build writes a Manifest V3 extension bundle to `nook-app/nook-web/nook-web-extension/dist` inside
the sealed Docker image. Use `task docker:extract:extension` to copy that bundle
to the host for manual browser loading.

For a distributable zip with `manifest.json` at the archive root:

```bash
task extension:package
```

For a local release copy, including both the unpacked extension and the zip:

```bash
task extension:install:local
```

That writes to:

- `~/Library/Application Support/Nook/browser-extensions/nook-web-extension/current`
- `~/Library/Application Support/Nook/browser-extensions/nook-web-extension/releases/nook-web-extension-<version>.zip`

Run the basic Chromium extension smoke with:

```bash
task extension:test:e2e
```

Chrome and Brave do not support installing an unsigned local extension by copying
files into their profile-managed extension directories. For local development,
load the `current` directory manually once from `chrome://extensions` or
`brave://extensions`, or launch an isolated dev browser profile with:

```bash
task extension:run:chrome
task extension:run:brave
```

The browser launch tasks build the extension for
`https://localhost:5173/`. Run `task web:dev` first so the trusted local
certificate exists and the vault is available. Extension WebAuthn ceremonies
omit the RP ID and let Chromium bind the credential to the extension origin;
the website continues to use its HTTPS hostname as the RP ID.
