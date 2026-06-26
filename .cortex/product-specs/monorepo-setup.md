# Product Spec: Monorepo & Toolchain Setup

## 1. Goal & Context
Nook is a development environment for crypto tools combining Rust logic with WebAssembly and a frontend web UI.
To ensure high developer velocity and agent autonomy, the repository must be self-contained, easy to build, and require minimal host-side environment setup.

## 2. Core Requirements
- **Unified Command Interface**: All developer workflows (install, lint, format, check, test, build, dev) must run via `Taskfile.yml`.
- **Zero-Config Host**: No local installations of Rust toolchains, Bun, or wasm-pack should be required on the host system for builds.
- **Docker-Safe Dev Server**: Vite dev server must run in a container and bind ports correctly to be accessible at `http://localhost:5173`.
- **Pinned Dependencies**: All packages (Cargo, package.json) must use exact version pinning to guarantee reproducibility.

## 3. Toolchain & Runtime Specs
- **Rust Version**: `1.96` (using bookworm Debian base).
- **Bun Version**: `1.3.14`.
- **Wasm Pack**: `0.15.0` (prebuilt release archive via `curl`, not `cargo install`).
- **wasm-bindgen CLI**: `0.2.125` (prebuilt; pinned to match `nook-wasm` so wasm-pack skips downloading it at build time).
- **Binaryen (wasm-opt)**: `122` (precompiled linux binaries to support reference types and externrefs).

## 4. Docker & CI caching

- **No Docker named volumes.** GitHub Actions runners do not retain volumes across jobs. `task` bind-mounts the repository only (`-v $ROOT:/workspace`).
- **Dependency cache lives in the image.** `cargo-chef` pre-compiles Rust deps during `docker build`; CI pushes/pulls `builder-debug:cache` and `builder-wasm:cache` from GHCR.
- **Entrypoint seeding.** The bind mount hides image-baked `target/` and `nook-web/node_modules`. The entrypoint copies from `/opt/nook/target` and `/opt/nook/nook-web-node_modules` when the workspace copies are empty.
- **Web deps in the image.** `bun install --frozen-lockfile` runs during `docker build` (layer cached while `package.json` / `bun.lock` are unchanged). Rebuild after web dependency changes.
- **Playwright in the image.** Chromium + system deps installed at build time (`PLAYWRIGHT_BROWSERS_PATH=/opt/nook/ms-playwright`).
- **One Docker build per workflow.** `pr.yml` and `main.yml` each use a single job so `task setup` runs once; `task docker:pull` loads the last GHCR image before `docker:build`.
- **Within a CI job**, incremental `target/` and `node_modules` artifacts persist on the runner filesystem through the bind mount until the job ends.
