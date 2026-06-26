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
- **wasm-bindgen CLI**: `0.2.125` (pinned; matches `nook-wasm` crate dependency).
- **Binaryen (wasm-opt)**: `122` (precompiled linux binaries to support reference types and externrefs).

## 4. Docker & CI caching

- **No Docker named volumes.** GitHub Actions runners do not retain volumes across jobs. `task` bind-mounts the repository only (`-v $ROOT:/workspace`).
- **Dependency cache lives in the image.** `cargo-chef` pre-compiles Rust deps during `docker build`; CI pushes/pulls `builder-debug:cache` and `builder-wasm:cache` from GHCR.
- **Entrypoint seeding.** Because the bind mount replaces `/workspace/target`, the toolchain entrypoint copies baked deps from `/opt/nook/target` when the workspace `target/` is empty.
- **Within a CI job**, incremental `target/` artifacts persist on the runner filesystem through the bind mount until the job ends.
