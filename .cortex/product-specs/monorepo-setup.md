# Product Spec: Monorepo & Toolchain Setup

## 1. Goal & Context

Nook is a development environment for crypto tools combining Rust logic with WebAssembly and a frontend web UI.
To ensure high developer velocity and agent autonomy, the repository must be self-contained, easy to build, and require minimal host-side environment setup.

## 2. Core Requirements

- **Unified Command Interface**: The root `Taskfile.yml` is the repo entrypoint. App workflows are included from `nook-app/Taskfile.yml`; cross-package app tasks live in `nook-app/ci/Taskfile.yml`, Docker tasks in `nook-app/nook-platform/docker/Taskfile.yml`, and web-family tasks in `nook-app/nook-web/Taskfile.yml` and package Taskfiles under `nook-web-extension/` / `nook-platform/`.
- **Zero-Config Host**: No local installations of Rust toolchains, Bun, or wasm-pack should be required on the host system for builds.
- **Docker-Safe Dev Server**: Vite dev server must run in a container, bind ports correctly, and use the ignored locally trusted certificate to be accessible at `https://localhost:5173`.
- **Pinned Dependencies**: All packages (Cargo, package.json) must use exact version pinning to guarantee reproducibility.

## 3. Toolchain & Runtime Specs

- **Rust Version**: `1.97` (using digest-pinned `rust:1.97-trixie` in `nook-app/nook-platform/docker/rust/product.Dockerfile`; web uses `DEBIAN_RELEASE` in `nook-app/nook-web/docker/web.Dockerfile`).
- **Bun Version**: `1.3.14`.
- **Task**: `3.52.0` ([official install script](https://taskfile.dev/docs/installation) → `/usr/local/bin`).
  GitHub Actions `go-task/setup-task` steps must pin this exact version.
  Do not resolve `3.x` at workflow runtime.
- **Wasm Pack**: `0.15.0` ([official init script](https://wasm-bindgen.github.io/wasm-pack/installer/); pinned with `VERSION`, not `cargo install`). Installs matching `wasm-bindgen-cli` automatically during `wasm-pack build`.
- **wasm-bindgen** (crate + CLI): `0.2.127` in the Rust crates that export web-facing types (`nook-wasm`, and `nook-core` for simple shared DTOs/enums). CLI version is resolved by wasm-pack from the lockfile — no separate Docker install.

## 4. Docker & CI caching

- **Source-in-image, no runtime bind mount on the common path.**
  - The workspace source is `COPY`'d into the **nook-web image** (`nook-app/nook-web/Dockerfile`).
  - Copy it as late as possible so a source edit never busts cached layers above it.
  - Normal `task` commands run that image directly.
  - `nook-app/target/` lives at the default in-tree path `/meta-secret/nook/nook-app/target`.
  - There is no `CARGO_TARGET_DIR` override and no `/opt`.
  - The explicit mounted local-iteration tasks are `task web:dev` / `task web:dev:fast` (Vite hot-reload) and `task wasm:build:fast` (no-opt WASM regeneration).
- **Two independent image lineages.**
  - Rust/WASM owns Cargo, `target/`, coverage, and wasm-bindgen tests.
  - Web owns Bun, `node_modules`, and Playwright.
  - No Docker stage merges them.
  - The common `nook-web:local` image contains web tooling plus generated WASM/coverage and source.
  - It does not contain a Rust toolchain or `target/`.
  - Explicit Rust/WASM commands load `nook-rust:local` on demand.
- **Host artifact handoff.**
  - `task setup` builds Rust/WASM and web dependencies in parallel.
  - It exports only generated WASM and coverage from a scratch target under `${TMPDIR}/nook-web-artifacts/<full-commit-sha>/<unique-invocation>/`.
  - It then passes that directory as the web solve's named context.
  - Commit and invocation scoping prevent concurrent builds from consuming each other's artifacts.
  - `builder-wasm` is never a parent or context of `nook-web`.
- **Delivery BuildKit is remote-cached on hosted runners.**
  - PR, main, and release use ephemeral `ubuntu-latest` VMs.
  - They use authenticated private Zot `type=registry` cache refs.
  - Rust/WASM, web dependencies, browser-free web, and e2e web use separate versioned refs.
  - Parallel targets cannot overwrite one another.
  - Main seeds the default-branch cache visible to new PRs.
  - Remote writes git-commit refs (`-git-<sha>`).
  - Hosted setup probes each exact ref before selecting its restore inputs.
  - A present exact ref is imported alone. A missing exact ref uses the
    source-free fingerprint and trusted Main as seeds.
  - Local Bake restores those git-commit refs when Remote credentials exist.
  - Commit-scoped local publish requires a clean worktree.
  - Local formatting may publish source-free dependency stages by content
    fingerprint when cache recipes are clean.
  - Opt out with `NOOK_REGISTRY_CACHE=0`.
- **Main owns the shared hosted BuildKit lineage.**
  - Main exports the Rust, WASM, web, and e2e caches.
  - Every PR job restores its exact SHA alone when that scope exists.
  - A new exact scope restores source-free dependencies and trusted Main.
  - PR jobs publish only isolated exact-SHA generations under
    `nook/remote-buildcache`.
  - `web-deps` runs `bun install --frozen-lockfile` directly in its Dockerfile layer.
  - There is no host/daemon cache mount for `web-deps`.
  - Debian's single `chromium` package is installed only in the main/manual `web-e2e-base`.
  - E2e selects it through `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.
  - Never install Playwright's duplicate bundled Chromium + headless-shell payload.
  - Never put a browser in the PR `web-base`.
- **Two WASM packages, not per-app rebuilds.**
  - `nook-wasm` is the featureless vault bridge shared by Unified, Simple, Sentinel, and extension background/popup consumers.
  - `nook-companion-wasm` is the tiny content-script package for heuristics and host policy.
  - It must stay small enough to inject.
  - Do not reintroduce per-consumer vault wrapper crates, mutually exclusive app features, or duplicate vault packages.
- **Web dist built at image time.**
  - `nook-app/nook-web/nook-web-app/Dockerfile` runs `bun run build` with channel-specific site/Simple/Sentinel URLs.
  - The combined test harness and isolated artifacts are present in every container.
  - PR CI deploys native `pr-<number>` aliases for all three isolated projects.
  - Main deploys `dev.nokey.sh`, `simple.dev.nokey.sh`, and `sentinel.dev.nokey.sh`.
  - Release extracts production artifacts via `task docker:extract:dist`.
- **Write tasks emit diffs; `task format` host-applies them.**
  - Sealed-image format mutates in-container source and prints a `git diff`.
  - The `task format` entrypoint applies that diff to the host working tree.
  - Run it unconditionally before every push.
  - Use `task format:diff` only when you need the raw patch.
  - `task rust:coverage:update` still prints a host-applicable diff.
- **CI runners:**
  - PR, main delivery, production release, long-running AI agents, and scheduled/manual validation use GitHub-hosted `ubuntu-latest`.
  - Delivery jobs restore scoped BuildKit layers through private Zot.
  - The self-hosted `nook` label remains only for maintenance cleanup.
  - Do not use Blacksmith or other third-party runner labels.
- **PR workflow cancellation:**
  - `concurrency` with `cancel-in-progress: true` on `pr-<number>` lets a newly requested validation or PR close cancel an older labeled run.
  - Ordinary pushes do not start or cancel complete validation.
  - Agents avoid pushing while it runs.
  - Agents explicitly cancel an obsolete run.
- **Remote task and PR CI.**
  - `remote.yml` executes up to eight allowlisted Task commands per manual dispatch.
  - It runs on an ephemeral GitHub-hosted runner.
  - A batch shares one checkout, Docker setup, and cache connection.
  - Selected tasks run sequentially.
  - Each task retains its bounded timeout.
  - The batch reports every task result before returning its final status.
  - Its frequent Rust test and web/extension check routes use narrow source-sealed images.
  - Those images stop before unrelated coverage, WASM-test, browser, full-verification, and production-build stages.
  - Remote restores a present git-commit Zot ref alone.
  - A missing git-commit ref falls back to source-free dependencies and Main.
  - Remote exports only those Remote refs.
  - Remote reads trusted compiler objects through the read-only SeaweedFS identity.
  - New commit dependency results persist in Zot.
  - Trusted Main/local/Hive writers populate SeaweedFS.
  - `pr.yml` mounts SeaweedFS sccache for same-repository jobs.
  - `pr.yml` exports only git-commit `nook/remote-buildcache/**` refs.
  - Main restore stays available.
  - `pr.yml` starts only for `ci:validate` or `ci:full-e2e` label events.
  - It then runs native Rust, shared Rust ecosystem gates, and one verified-WASM producer independently.
  - Its small generated artifact feeds parallel preview and optional Main-fix consumers.
  - Main-fix web and extension e2e run as independent artifact consumers on separate hosted runners.
  - Each Main-fix consumer builds only the browser image.
  - Main-fix consumers do not repeat Rust/WASM or web verification.
  - **`main.yml`** serializes the cache-writing native → WASM → web lanes.
  - Each lane verifies, then exports only its already-solved local builder graph.
  - Export happens only after every lane-specific check succeeds.
  - The WASM dependency scope keeps its no-import, forced-zstd export.
  - Later browser/UI consumers remain read-only.
  - Development deploy waits on web verify + web e2e.
  - Every actionable unsuccessful Main run creates or refreshes a Hive repair incident.
  - That includes browser E2E and UI-demo failures.
  - Real-provider sync-live checks run only through explicit manual validation.

