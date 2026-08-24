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

- **Rust Version**: `1.97` (using the digest-pinned Zot mirror of `rust:1.97-trixie` in `nook-app/nook-platform/docker/rust/product.Dockerfile`; web uses `DEBIAN_RELEASE` in `nook-app/nook-web/docker/web.Dockerfile`).
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
- **Delivery BuildKit is remote-cached across isolated runners.**
  - Trusted same-repository PR native Rust plus Rust ecosystem jobs and every
    explicit Main job use fresh ARC Kata microVMs.
  - Hive Rust verification uses a dedicated scale-to-zero ARC set with ten-job
    concurrency and a private Neo4j native sidecar.
  - Hive test binaries execute through a pinned Trixie native sidecar inside
    the Kata guest, without Docker run. Both helpers stop with the runner.
  - The general ARC set exposes a job-scoped Podman Docker-compatible API only
    inside each disposable Kata guest for Main runtime and browser jobs.
  - Fork PRs, Dependabot PRs, release jobs, and non-Main runtime-dependent,
    browser, WASM, and deployment jobs use ephemeral GitHub-hosted VMs.
  - They use authenticated private Zot `type=registry` cache refs.
  - Each fresh ARC guest starts from a private reflink clone of a trusted
    32 GiB BuildKit seed.
  - A 768 GiB sparse Btrfs pool covers twenty fully allocated 32 GiB job
    images, the reusable seed, and metadata. The 24 GB BuildKit
    garbage-collection target normally keeps physical use lower.
  - Each job clone is a Btrfs subvolume with a 32 GiB exclusive quota.
  - The reflink shares unchanged blocks without sharing a writable daemon or
    writable filesystem.
  - Rust/WASM, web dependencies, browser-free web, and e2e web use separate versioned refs.
  - Parallel targets cannot overwrite one another.
  - Main seeds the default-branch cache visible to new PRs.
  - Remote writes git-commit refs (`-git-<sha>`).
  - Docker setup probes each exact ref before selecting its restore inputs.
  - A present exact ref is imported alone.
  - Native and WASM source restores import a present Main source graph alone.
  - Shorter dependency indexes join that solve only while Main source is absent.
  - Other missing exact refs use the source-free fingerprint and trusted Main as seeds.
  - A known-absent exact preflight ref is not passed to BuildKit before its
    trusted Main fallback.
  - Local Bake restores those git-commit refs when Remote credentials exist.
  - Commit-scoped local publish requires a clean worktree.
  - Local formatting may publish source-free dependency stages by content
    fingerprint when cache recipes are clean.
  - Opt out with `NOOK_REGISTRY_CACHE=0`.
- **Main owns the shared trusted BuildKit lineage.**
  - Cache-primary ARC Main lanes promote their already-solved private BuildKit
    state into the node-local copy-on-write seed after verification succeeds.
  - ARC promotion does not export the full Rust, WASM, web, or e2e builder
    graphs to Zot.
  - GitHub-hosted fallback Main lanes export those builder graphs to Zot.
  - Every PR job restores its exact SHA alone when that scope exists.
  - A new native or WASM source scope restores Main source alone when that ref exists.
  - Other new exact scopes restore source-free dependencies and trusted Main.
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
- **`task format` uses one shared tool-only image.**
  - The content-addressed image contains repository-pinned Rustfmt, Prettier, and
    Svelte formatting support. Every worktree reuses the same local image.
  - Rustfmt covers the three Rust workspaces. Prettier touches only files changed
    from the branch merge base or the current working tree.
  - The image build context contains only formatter files, never project source.
  - A warm format never builds an image or installs per-worktree dependencies.
  - Formatting never compiles products, runs tests, or reads or publishes
    registry caches.
  - Run it unconditionally before every push. Product validation remains remote.
  - `task rust:coverage:update` still prints a host-applicable diff.
- **CI runners:**
  - Trusted same-repository PR native Rust plus Rust ecosystem jobs and every explicit Main job use the configured ARC scale set.
  - Focused `preflight`, `rust:ci`, and `arc:runtime` jobs may use the configured ARC scale set.
  - Focused `hive:verify` jobs use the dedicated Hive ARC scale set with its native service runtime.
  - Every ARC job receives a fresh Kata microVM and private BuildKit worker.
  - Both ARC scale sets use the approved QEMU fallback.
  - The private worker mounts only its Pod UID reflink state.
  - Fork PRs, Dependabot PRs, release jobs, and non-Main runtime-dependent,
    browser, WASM, deployment, long-running AI, and scheduled/manual validation
    use GitHub-hosted `ubuntu-latest`.
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
  - `preflight`, `rust:ci`, and `arc:runtime` may run on a fresh general ARC Kata microVM.
  - `hive:verify` may run on a fresh dedicated Hive ARC Kata microVM.
  - Other selections run on an ephemeral GitHub-hosted runner.
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
  - **`main.yml`** serializes the cache-writing native → WASM → web → UI-demo lanes.
  - Those trusted Main producers select the cache-primary scale set through
    `NOOK_CACHE_RUNS_ON`.
  - Other explicit Main jobs select the general scale set through
    `NOOK_RUNS_ON`.
  - Both routes use `ubuntu-latest` only as their configuration fallback.
  - Each cache-primary ARC lane verifies, then promotes its already-solved
    local BuildKit state into the node-local seed.
  - Hosted fallback lanes export only their already-solved builder graphs.
  - Promotion or hosted export happens only after every lane-specific check succeeds.
  - The hosted fallback WASM dependency export keeps its no-import,
    forced-zstd behavior.
  - Later browser/UI consumers remain read-only.
  - Development deploy waits on web verify + web e2e.
  - Every actionable unsuccessful Main run creates or refreshes a Hive repair incident.
  - That includes browser E2E and UI-demo failures.
  - Real-provider sync-live checks run only through explicit manual validation.
