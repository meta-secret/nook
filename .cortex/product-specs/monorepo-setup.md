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
- **Task**: `3.42.1` ([official install script](https://taskfile.dev/docs/installation) → `/usr/local/bin`).
- **Wasm Pack**: `0.15.0` ([official init script](https://wasm-bindgen.github.io/wasm-pack/installer/); pinned with `VERSION`, not `cargo install`). Installs matching `wasm-bindgen-cli` automatically during `wasm-pack build`.
- **wasm-bindgen** (crate + CLI): `0.2.125` in `nook-wasm/Cargo.toml`; CLI version is resolved by wasm-pack from the lockfile — no separate Docker install.

## 4. Docker & CI caching

- **Repo bind mount + per-container `node_modules`.** `docker run` bind-mounts the repo at `/workspace` and overlays an anonymous volume at `nook-web/node_modules` so parallel containers each run `bun install` independently (packages link from `/opt/nook/bun-install-cache` in the image).
- **Single remote toolchain image.** `ghcr.io/<owner>/<repo>/toolchain:latest` (linux/amd64). **`NOOK_ENV=dev`** (default): skip setup when local image exists. **`NOOK_ENV=ci`**: always build with GHCR cache. Mac uses `--platform linux/amd64`.
- **Dependency cache lives in the image.** `builder-deps` runs `cargo chef cook` (native + wasm32) and `cargo fetch` once. **`builder-debug`** (nextest `--no-run` first so clippy **Checks** chef-cooked deps, then clippy, then **llvm-cov `show-env` + nextest `--no-run`** into `target/llvm-cov-target`) and **`builder-wasm`** (wasm clippy, release build, wasm-pack) fork from deps and BuildKit/bake can run them **in parallel**. The final **`toolchain`** stage copies the crates.io registry from deps, native `target/` from debug, wasm32 + pkg from wasm — no serial debug→wasm chain.
- **Entrypoint seeding.** Only wasm pkg and `Cargo.lock` when missing; Rust `target/` stays at `/opt/nook/target` in the image.
- **Web deps in the image.** `bun install --frozen-lockfile` runs during `docker build` (layer cached while `package.json` / `bun.lock` are unchanged). Rebuild after web dependency changes.
- **Playwright in the image.** Chromium + system deps installed at build time (`PLAYWRIGHT_BROWSERS_PATH=/opt/nook/ms-playwright`).
- **CI runners:** GitHub-hosted `ubuntu-latest` only. Do not use Blacksmith or other third-party runner labels in workflows.
- **PR workflow cancellation:** `concurrency` with `cancel-in-progress: true` on `pr-<number>` — no custom cancel scripts. A new push or PR `closed` event queues a run in the same group and GitHub cancels the in-flight one.
- **PR CI.** `pr.yml` runs **`task ci:pr`** — one container for format, wasm, verify ‖ build, e2e-pr (~5 min). Toolchain push is **main only** (`ci:main:publish`). **`main.yml`** runs **`task ci:main:publish`** with full stub e2e. **Nightly** runs sync-live (real provider APIs).
- **Within a CI job**, wasm and web `dist/` persist on the runner via the bind mount. Rust `target/` lives at `/opt/nook/target` inside the container and is reused for all rustc steps in that one `docker run`.
