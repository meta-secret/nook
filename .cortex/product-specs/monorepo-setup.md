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
- **Single remote toolchain image.** `ghcr.io/<owner>/<repo>/toolchain:latest` (linux/amd64). `task setup` pulls it; build reuses registry layers; CI pushes after green verify. Mac uses `--platform linux/amd64`.
- **Dependency cache lives in the image.** `cargo-chef` pre-compiles Rust deps; clippy/test/build warm-up runs during `docker build`.
- **Entrypoint seeding.** Only wasm pkg and `Cargo.lock` when missing; Rust `target/` stays at `/opt/nook/target` in the image.
- **Web deps in the image.** `bun install --frozen-lockfile` runs during `docker build` (layer cached while `package.json` / `bun.lock` are unchanged). Rebuild after web dependency changes.
- **Playwright in the image.** Chromium + system deps installed at build time (`PLAYWRIGHT_BROWSERS_PATH=/opt/nook/ms-playwright`).
- **PR CI parallelism.** `pr.yml` builds the toolchain once (`cargo chef cook`, clippy, `cargo test --no-run`, wasm warm-up in the Dockerfile), then `ci:pr` runs format + wasm in one container and web lint/test/build in parallel — **no second Rust compile in `docker run`**. `task check` on main still runs full Rust lint/test in-container.
- **Within a CI job**, wasm build output under `nook-web/src/lib/nook-wasm` persists on the runner via the bind mount; Rust artifacts stay in each container's `/opt/nook/target` from the image.
