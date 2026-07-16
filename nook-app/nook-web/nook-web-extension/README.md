# Nook Browser Extension

`nook-web-extension` is Nook's browser-integration package. Before pairing, the
toolbar popup shows the standard device-protection widget and creates or
unlocks the extension's separately revocable identity. It then sends the public
device request directly to the configured Simple Vault deployment, which owns
the complete vault interface. The extension contains browser-only behavior:
device protection, the in-page Nook widget, autofill DOM integration, and
background coordination.

After a passkey or PIN authorization, the extension keeps its decrypted device
identity only in an offscreen extension document for 15 minutes. Reopening the
toolbar popup during that window resumes pairing without another prompt. The
identity is never written to `chrome.storage`; the session is cleared when the
timer expires or the browser closes.

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

Chrome and Brave do not support silently installing an unsigned extension into
a normal browser profile. The launch tasks therefore use stable, isolated Nook
profiles. Brave and Chrome for Testing receive the verified directory through
`--load-extension`. Branded Google Chrome removed that switch in Chrome 137, so
the task opens `chrome://extensions`; click **Load unpacked** once and select the
printed `current` directory. Chrome remembers that unpacked extension in the
isolated profile for later launches. With no selector the tasks build for
trusted HTTPS localhost as before:

```bash
task extension:run:chrome
task extension:run:brave
```

Run `task web:dev` first for that local flow. To download and launch an exact
hosted deployment instead, select development, production, or a PR preview:

```bash
task extension:run:chrome CHANNEL=dev
task extension:run:brave CHANNEL=prod
task extension:run:chrome PR=410

# Verify and install without opening a browser:
task extension:install:hosted PR=410
```

The hosted installer follows redirects but fails on HTTP errors, validates the
selected deployment's `extension.json`, downloads its ZIP and checksum, verifies
SHA-256 before extraction, rejects unsafe archive paths, and atomically switches
the channel's stable `current` symlink only after validation succeeds. Hosted
installs live below
`~/Library/Application Support/Nook/browser-extensions/nook-web-extension/hosted/`;
profiles live below `~/Library/Application Support/Nook/browser-profiles/`.
Development, production, and every PR number use different install and profile
directories, so they cannot reuse extension state. Override the two roots with
`NOOK_EXTENSION_RELEASE_DIR` and `NOOK_EXTENSION_PROFILE_ROOT` when needed.

Extension WebAuthn ceremonies omit the RP ID and let Chromium bind the
credential to the stable extension origin; the website continues to use its
HTTPS hostname as the RP ID.
