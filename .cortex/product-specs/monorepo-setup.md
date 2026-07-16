# Product Spec: Monorepo & Toolchain Setup

## 1. Goal & Context

Nook is a development environment for crypto tools combining Rust logic with WebAssembly and a frontend web UI.
To ensure high developer velocity and agent autonomy, the repository must be self-contained, easy to build, and require minimal host-side environment setup.

## 2. Core Requirements

- **Unified Command Interface**: The root `Taskfile.yml` is the repo entrypoint. App workflows are included from `nook-app/Taskfile.yml`; cross-package app tasks live in `nook-app/.task/`, Docker tasks in `nook-app/docker/Taskfile.yml`, and web-family tasks in `nook-app/nook-web/Taskfile.yml` plus `nook-app/nook-web/.task/`.
- **Zero-Config Host**: No local installations of Rust toolchains, Bun, or wasm-pack should be required on the host system for builds.
- **Docker-Safe Dev Server**: Vite dev server must run in a container, bind ports correctly, and use the ignored locally trusted certificate to be accessible at `https://localhost:5173`.
- **Pinned Dependencies**: All packages (Cargo, package.json) must use exact version pinning to guarantee reproducibility.

## 3. Toolchain & Runtime Specs

- **Rust Version**: `1.96` (using trixie Debian base; `DEBIAN_RELEASE` arg in `nook-app/docker/base.Dockerfile`).
- **Bun Version**: `1.3.14`.
- **Task**: `3.42.1` ([official install script](https://taskfile.dev/docs/installation) → `/usr/local/bin`).
- **Wasm Pack**: `0.15.0` ([official init script](https://wasm-bindgen.github.io/wasm-pack/installer/); pinned with `VERSION`, not `cargo install`). Installs matching `wasm-bindgen-cli` automatically during `wasm-pack build`.
- **wasm-bindgen** (crate + CLI): `0.2.125` in the Rust crates that export web-facing types (`nook-wasm`, and `nook-core` for simple shared DTOs/enums). CLI version is resolved by wasm-pack from the lockfile — no separate Docker install.

## 4. Docker & CI caching

- **Source-in-image, no runtime bind mount on the common path.** The workspace source is `COPY`'d into the **nook-web image** (`nook-app/nook-web/Dockerfile`), as late as possible so a source edit never busts cached layers above it; normal `task` commands run that image directly. `nook-app/target/` lives at the default in-tree path `/meta-secret/nook/nook-app/target` (no `CARGO_TARGET_DIR` override, no `/opt`). The explicit mounted local-iteration tasks are `task web:dev` / `task web:dev:fast` (Vite hot-reload) and `task wasm:build:fast` (no-opt WASM regeneration).
- **Two independent image lineages.** Rust/WASM owns Cargo, `target/`, coverage, and wasm-bindgen tests; web owns Bun, `node_modules`, and Playwright. No Docker stage merges them. The common `nook-web:local` image contains web tooling plus generated WASM/coverage and source, but no Rust toolchain or `target/`. Explicit Rust/WASM commands load `nook-rust:local` on demand.
- **Host artifact handoff.** `task setup` builds Rust/WASM and web dependencies in parallel, exports only generated WASM and coverage from a scratch target under `${TMPDIR}/nook-web-artifacts/<full-commit-sha>/<unique-invocation>/`, then passes that directory as the web solve's named context. Commit and invocation scoping prevent concurrent builds from consuming each other's artifacts. `builder-wasm` is never a parent or context of `nook-web`.
- **Delivery BuildKit is persistent but health-bounded.** Self-hosted `task ci:pr` and `task ci:main` (including release) reuse one dedicated `docker-container` BuildKit daemon on each Docker host. Before building, a hard 60-second functional probe must either confirm the daemon or terminate the stuck probe process group, remove its container/state, and bootstrap a replacement. Never import or export these lineages through registry cache manifests. The Docker-host-only Redis `sccache` service remains the compiler-object fallback below persistent local BuildKit layers.
- **Dependency caches remain branch-local.** `builder-deps` runs cargo-chef and native/wasm warm-ups in the Rust lineage. `web-deps` runs `bun install --frozen-lockfile` directly in its Dockerfile layer, with no host/daemon cache mount. Debian's single `chromium` package is installed only in the main/nightly `web-e2e-base` and selected through `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; never install Playwright's duplicate bundled Chromium + headless-shell payload or put a browser in the PR `web-base`.
- **One featureless WASM package, not consumer rebuilds.** `nook-wasm` compiles and runs wasm-pack exactly once. Unified, Simple, Sentinel, and extension consumers share that generated package; immutable Rust-owned application configuration and manager capability checks enforce the active realm. Do not reintroduce per-consumer wrapper crates, mutually exclusive app features, or duplicate generated artifacts.
- **Web dist built at image time.** `nook-app/nook-web/nook-web-app/Dockerfile` runs `bun run build` with channel-specific site/Simple/Sentinel URLs, so the combined test harness and isolated artifacts are present in every container. PR CI deploys native `pr-<number>` aliases for all three isolated projects; Main deploys `dev.nokey.sh`, `simple.dev.nokey.sh`, and `sentinel.dev.nokey.sh`; release extracts production artifacts via `task docker:extract:dist`.
- **Write tasks emit diffs.** `task format` / `task rust:coverage:update` mutate the in-container source and print a `git diff` (sealed image — apply on host with `| git apply`).
- **CI runners:** latency-critical `pr.yml`, main delivery, and production release use the persistent self-hosted `nook` runner and the same dedicated health-checked BuildKit builder. All delivery paths can also reuse compatible compiler objects through the host-only Redis `sccache`. Long-running AI agents and other background/scheduled CI use GitHub-hosted `ubuntu-latest` and compile Rust cold when necessary; they must not download a serialized remote target snapshot. Do not use Blacksmith or other third-party runner labels.
- **PR workflow cancellation:** `concurrency` with `cancel-in-progress: true` on `pr-<number>` — no custom cancel scripts. A new push or PR `closed` event queues a run in the same group and GitHub cancels the in-flight one.
- **PR CI.** `pr.yml` runs **`task ci:pr`** — one container for format and verify ‖ build, without browser e2e, then deploys the internal harness and isolated native Pages aliases. **`main.yml`** runs **`task ci:main`** with full local-provider and extension e2e, then deploys the three stable development origins. Failures remain visible for manual handling and never start an AI agent automatically. **Nightly** runs sync-live (real provider APIs) and invokes `ci-fix` on failure.
