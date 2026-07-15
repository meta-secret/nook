# Nook Browser Extension

`nook-web-extension` is Nook's browser-integration package. The toolbar opens
`https://simple.nokey.sh`, which owns the complete vault interface. The
extension contains browser-only behavior: the in-page Nook widget, autofill DOM
integration, background coordination, and a one-time extension-origin passkey
window for protecting its separately revocable device identity.

The extension first-run model is specified in
[`.cortex/product-specs/browser-extension.md`](../../../.cortex/product-specs/browser-extension.md).
The extension becomes its own passkey-protected Nook device and pairs only
through website-driven consent at `https://simple.nokey.sh/extension-connect`;
it does not borrow or scrape the Simple web app device key. It intentionally has
no miniature vault popup. Sentinel Vault is excluded by the manifest, runtime
guard, pairing validation, and Rust/WASM capability checks.

Build it through Docker-backed Taskfile commands from the repo root or `nook-app/`:

```bash
task extension:build
```

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
