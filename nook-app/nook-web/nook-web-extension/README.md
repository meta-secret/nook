# Nook Browser Extension

`nook-web-extension` is the browser-extension package for Nook. It is intentionally
separate from `nook-web` so the extension can grow extension-specific surfaces
such as content scripts, autofill, and background coordination without coupling
those concerns to the web app shell.

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
