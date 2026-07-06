# Nook Browser Extension

`nook-web-extension` is the browser-extension package for Nook. It is intentionally
separate from `nook-web` so the extension can grow extension-specific surfaces
such as content scripts, autofill, and background coordination without coupling
those concerns to the web app shell.

Build it through Docker-backed Taskfile commands from the repo root or `nook-app/`:

```bash
task extension:build
```

The build writes a Manifest V3 extension bundle to `nook-app/nook-web-extension/dist` inside
the sealed Docker image. Use `task docker:extract:extension` to copy that bundle
to the host for manual browser loading.
