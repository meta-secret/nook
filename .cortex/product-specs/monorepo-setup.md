# Product Spec: Monorepo & Toolchain Setup

## 1. Goal & Context

Nook is a development environment for crypto tools combining Rust logic with WebAssembly and a frontend web UI.
To ensure high developer velocity and agent autonomy, the repository must be self-contained, easy to build, and require minimal host-side environment setup.

## 2. Core Requirements

- **Unified Command Interface**: The root `Taskfile.yml` is the repo entrypoint. App workflows are included from `nook-app/Taskfile.yml`; cross-package app tasks live in `nook-app/.task/`, Docker tasks in `nook-app/docker/Taskfile.yml`, and web-family tasks in `nook-app/nook-web/Taskfile.yml` plus `nook-app/nook-web/.task/`.
- **Zero-Config Host**: No local installations of Rust toolchains, Bun, or wasm-pack should be required on the host system for builds.
- **Docker-Safe Dev Server**: Vite dev server must run in a container and bind ports correctly to be accessible at `http://localhost:5173`.
- **Pinned Dependencies**: All packages (Cargo, package.json) must use exact version pinning to guarantee reproducibility.

## 3. Toolchain & Runtime Specs

- **Rust Version**: `1.96` (using trixie Debian base; `DEBIAN_RELEASE` arg in `nook-app/docker/base.Dockerfile`).
- **Bun Version**: `1.3.14`.
- **Task**: `3.42.1` ([official install script](https://taskfile.dev/docs/installation) → `/usr/local/bin`).
- **Wasm Pack**: `0.15.0` ([official init script](https://wasm-bindgen.github.io/wasm-pack/installer/); pinned with `VERSION`, not `cargo install`). Installs matching `wasm-bindgen-cli` automatically during `wasm-pack build`.
- **wasm-bindgen** (crate + CLI): `0.2.125` in the Rust crates that export web-facing types (`nook-wasm`, and `nook-core` for simple shared DTOs/enums). CLI version is resolved by wasm-pack from the lockfile — no separate Docker install.

## 4. Docker & CI caching

- **Source-in-image, no runtime bind mount on the common path.** The workspace source is `COPY`'d into the **nook-web image** (`nook-app/nook-web/Dockerfile`), as late as possible so a source edit never busts cached layers above it; normal `task` commands run that image directly. `nook-app/target/` lives at the default in-tree path `/meta-secret/nook/nook-app/target` (no `CARGO_TARGET_DIR` override, no `/opt`). The explicit mounted local-iteration tasks are `task web:dev` / `task web:dev:fast` (Vite hot-reload) and `task wasm:build:fast` (no-opt WASM regeneration).
- **Two image tiers.** **Toolchain base** `ghcr.io/<owner>/<repo>/toolchain` (linux/amd64): deps + warm `target/` + bun deps + Playwright, the shared GHCR cache. **nook-web image** `nook-web:local`: `FROM toolchain` + source + wasm pkg + built `dist`. `task setup` always rebuilds the nook-web image (buildx reuses the base + GHCR `:buildcache`, so only the source + dist layers rebuild).
- **Cache is pull-always, push-main-only.** `cache-from` is wired for every build (local dev included), so a cold checkout pulls CI's warm layers instead of recompiling everything. `cache-to` is gated on `TOOLCHAIN_PUSH` (main CI only): main pushes the verified base image + cache (`toolchain-push`). PR CI and local dev never push; a missed local pull just falls back to a cold build. The registry is cache, never a build dependency.
- **Dependency cache lives in the base image.** `builder-deps` runs `cargo chef cook` (native + wasm32) and `cargo fetch` once. **`builder-debug`** (nextest `--no-run`, clippy, llvm-cov `show-env` + nextest `--no-run`) and **`builder-wasm`** (wasm clippy, release build, wasm-pack into `nook-app/nook-web/src/lib/nook-wasm`) fork from deps and build **in parallel**. The **`toolchain`** stage copies the crates.io registry from deps and the warm `target/` from debug + wasm.
- **Web deps + Playwright in the base image.** `bun install --frozen-lockfile` runs in the `web-deps` bake target (own `cache-to`, parallel with the Rust chain); Playwright Chromium is pre-installed in `nook-base`. BuildKit cache mount at `/opt/nook/bun-install-cache` during install. `PLAYWRIGHT_BROWSERS_PATH=/opt/nook/ms-playwright`.
- **Web dist built at image time.** `nook-app/nook-web/Dockerfile` runs `bun run build` (with the `VITE_BASE` arg), so `nook-app/nook-web/dist` is present in every container. Cloudflare (PR) deploys it from inside the container; GitHub Pages (main) extracts it via `task docker:extract:dist`.
- **Write tasks emit diffs.** `task format` / `task rust:coverage:update` mutate the in-container source and print a `git diff` (sealed image — apply on host with `| git apply`).
- **CI runners:** GitHub-hosted `ubuntu-latest` only. Do not use Blacksmith or other third-party runner labels in workflows.
- **PR workflow cancellation:** `concurrency` with `cancel-in-progress: true` on `pr-<number>` — no custom cancel scripts. A new push or PR `closed` event queues a run in the same group and GitHub cancels the in-flight one.
- **PR CI.** `pr.yml` runs **`task ci:pr`** — one container for format, verify ‖ build, full local-provider e2e, then in-container Cloudflare preview deploy. Toolchain push is **main only** (`ci:main:publish`). **`main.yml`** runs **`task ci:main:publish`** with full local-provider e2e, then extracts `dist` for Pages. **Nightly** runs sync-live (real provider APIs).
