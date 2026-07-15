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

The target and extension identity default to production. CI selects the
matching target and deterministic identity for PR and development deployments.
Override both values for an ad hoc PR build, or use the local task:

```bash
NOOK_SIMPLE_VAULT_URL=https://pr-408.nokey-simple.pages.dev/ \
  NOOK_EXTENSION_CHANNEL=pr-408 task extension:build
task extension:build:localhost
```

PR CI publishes the ZIP at
`https://pr-<number>.nokey-sh.pages.dev/downloads/nook-passwords-pr-<number>.zip`.
Main publishes the development ZIP at
`https://dev.nokey.sh/downloads/nook-passwords-dev.zip`, paired only with
`https://simple.dev.nokey.sh/`. Production releases publish a versioned ZIP at
`https://nokey.sh/downloads/` and attach the same bytes to the GitHub Release.
Every channel also exposes `/downloads/extension.json` and the archive's
`.sha256` file.

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
or for a downloaded PR/development ZIP, unzip it and select the directory with
**Load unpacked** in `chrome://extensions` or `brave://extensions`. The local
install task maintains a stable `current` directory, and the launch tasks can
open an isolated developer profile automatically:

```bash
task extension:run:chrome
task extension:run:brave
```

The browser launch tasks build the extension for
`https://localhost:5173/`. Run `task web:dev` first so the trusted local
certificate exists and the vault is available. Extension WebAuthn ceremonies
omit the RP ID and let Chromium bind the credential to the extension origin;
the website continues to use its HTTPS hostname as the RP ID.
