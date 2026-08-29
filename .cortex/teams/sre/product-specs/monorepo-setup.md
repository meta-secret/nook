# Product Spec: Monorepo & Toolchain Setup

## 1. Goal & Context

Nook is a development environment for crypto tools combining Rust logic with WebAssembly and a frontend web UI.
To ensure high developer velocity and agent autonomy, the repository must be self-contained, easy to build, and require minimal host-side environment setup.

## 2. Core Requirements

- **Unified Command Interface**: The root `Taskfile.yml` is the repo entrypoint. App workflows are included from `nook-app/Taskfile.yml`; cross-package app tasks live in `nook-app/ci/Taskfile.yml`, Docker tasks in `nook-app/nook-platform/docker/Taskfile.yml`, and web-family tasks in `nook-app/nook-web/Taskfile.yml` and package Taskfiles under `nook-web-extension/` / `nook-platform/`.
- **Zero-Config Host**: No local installations of Rust toolchains, Bun, or wasm-pack should be required on the host system for builds.
- **Remote-only Rust/WASM**: Agent hosts must not compile product Rust/WASM,
  including through app, web, preflight, ecosystem, export, or cache-producer
  Task paths. GitHub Actions is the normal execution surface. A human may use
  `NOOK_ALLOW_LOCAL_RUST_DIAGNOSTIC=1` for one intentional diagnostic.
- **Docker-Safe Dev Server**: Vite dev server must run in a container, bind ports correctly, and use the ignored locally trusted certificate to be accessible at `https://localhost:5173`.
- **Reproducible dependencies:** Commit lockfiles for Cargo and JavaScript
  workspaces. Use exact manifest pins when the owning ecosystem and update
  policy require them. Do not describe compatible Cargo requirements as exact.

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
  - Mounted `task web:dev` / `task web:dev:fast` and `task wasm:build:fast`
    are human diagnostic paths because they regenerate WASM; they require the
    explicit local diagnostic override.
- **Two independent image lineages.**
  - Rust/WASM owns Cargo, `target/`, coverage, and wasm-bindgen tests.
  - Web owns Bun, `node_modules`, and Playwright.
  - No Docker stage merges them.
  - The common `nook-web:local` image contains web tooling plus generated WASM/coverage and source.
  - It does not contain a Rust toolchain or `target/`.
  - Explicit Rust/WASM commands load `nook-rust:local` on demand.
- **Artifact handoff.**
  - On GitHub Actions, `task setup` builds Rust/WASM and web dependencies in parallel.
  - It exports only generated WASM and coverage from a scratch target under `${TMPDIR}/nook-web-artifacts/<full-commit-sha>/<unique-invocation>/`.
  - It then passes that directory as the web solve's named context.
  - Commit and invocation scoping prevent concurrent builds from consuming each other's artifacts.
  - `builder-wasm` is never a parent or context of `nook-web`.
- **Delivery BuildKit uses persistent node-local shards and portable Zot refs.**
  - Trusted same-repository PR Rust jobs and Main build producers use disposable
    ordinary ARC Pods.
  - Hive Rust verification uses a dedicated scale-to-zero ARC set with ten-job
    concurrency.
  - Hive's pinned Neo4j and Rust test-runtime sidecars stop with the runner.
  - The Docker CLI connects only to the rootless BuildKit shard on its node.
  - ARC runners receive no Docker daemon, Podman API, DinD process, host runtime
    socket, host path, or Kata runtime.
  - Every qualified node owns one retained 64 GiB BuildKit volume.
  - The node-local Service never sends a runner to another node's shard.
  - Rust/WASM, web dependencies, browser-free web, and e2e web use separate
    versioned refs.
  - Main publishes shared refs under `nook/buildcache/**`.
  - Pull requests use exact-commit refs under `nook/remote-buildcache/**`.
  - BuildKit owns concurrent content-addressed deduplication on each node.
  - Zot carries cache state between nodes and hosted runners.
  - A local miss imports from Zot once and remains warm on that node.
  - Docker setup probes each exact ref before selecting restore inputs.
  - A present exact ref is imported alone.
  - Other missing exact refs use source-free fingerprints and trusted Main.
  - Local Bake restores commit refs when Remote credentials exist.
  - Opt out with `NOOK_REGISTRY_CACHE=0`.
- **Main owns the shared trusted registry lineage.**
  - Main publishes shared cache refs only after its producer check succeeds.
  - Every PR restores its exact SHA alone when that scope exists.
  - A new source scope restores Main source when that ref exists.
  - Other new exact scopes restore source-free dependencies and trusted Main.
  - PR jobs publish only isolated exact-SHA generations under
    `nook/remote-buildcache`.
  - BuildKit's persistent local shard is an acceleration layer.
  - Zot is the portable authority for cross-node and hosted recovery.
  - `web-deps` runs `bun install --frozen-lockfile` in its Dockerfile layer.
  - Debian's single `chromium` package exists only in `web-e2e-base`.
  - Never install Playwright's duplicate Chromium payload.
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
  - A repository-owned non-Rust contract test denies direct and indirect local
    Rust/WASM selectors and proves formatter isolation with fixtures.
  - Run it unconditionally before every push. Product validation remains remote.
  - `task rust:coverage:update` still prints a host-applicable diff.
- **CI runners:**
  - Trusted same-repository PR Rust jobs and Main build producers use ARC.
  - Main's portable WASM dependency writer/proof uses the persistent ARC
    BuildKit service. Zot proves child manifest digests and sizes plus every
    blob's declared size and SHA-256 before deployment proceeds.
  - Focused `preflight`, `rust:ci`, and `arc:runtime` jobs may use general ARC.
  - Focused `hive:verify` jobs use the dedicated Hive ARC scale set.
  - Every ARC job receives a fresh ordinary Pod.
  - The job reuses the persistent BuildKit shard on its selected node.
  - Fork and Dependabot PRs use GitHub-hosted `ubuntu-latest`.
  - Trusted release and agent workflows use ARC and must not mount a host
    container-runtime socket.
  - Delivery jobs restore portable cache layers through private Zot.
  - The legacy registered `nook` runner is not used.
  - Do not use Blacksmith or other third-party runner labels.
- **PR workflow cancellation:**
  - `concurrency` with `cancel-in-progress: true` on `pr-<number>` lets a newly requested validation or PR close cancel an older labeled run.
  - Ordinary pushes do not start or cancel complete validation.
  - Agents avoid pushing while it runs.
  - Agents explicitly cancel an obsolete run.
- **Remote task and PR CI.**
  - `remote.yml` executes up to eight allowlisted Task commands per manual dispatch.
  - `preflight`, `rust:ci`, and `arc:runtime` may run on a fresh general ARC Pod.
  - `hive:verify` may run on a fresh dedicated Hive ARC Pod.
  - Other non-browser selections run on general ARC.
  - Browser selections build their immutable image on general ARC and execute
    it in an ordinary `nook-k0s-container` job Pod.
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
  - Main-fix web e2e runs as two deterministic Playwright shards, while extension e2e remains an independent artifact consumer.
  - Each Main-fix browser consumer builds only the browser image.
  - A stable `Full browser e2e (main fix)` join requires both web shards and remains free of a low-reuse post-test cache rebuild.
  - Main-fix consumers do not repeat Rust/WASM or web verification.
  - **`main.yml`** serializes the cache-writing native → WASM → web → UI-demo lanes.
  - Main build producers select the general scale set through `NOOK_RUNS_ON`.
  - The portable WASM cache writer/proof selects the general ARC scale set.
  - `ubuntu-latest` remains the configuration fallback.
  - Each producer publishes its already-solved registry graph only after its
    lane-specific check succeeds.
  - The ARC WASM dependency repair export never imports its destination.
    It may use independent input-fingerprint and Main source refs as optional
    seeds, so a corrupted portable ref heals without manual deletion, and it
    keeps forced-zstd behavior.
  - Later browser/UI consumers remain read-only.
  - Development deploy waits on web verify, web e2e, and the portable WASM
    cache publication proof.
  - Every actionable unsuccessful Main run creates or refreshes a Hive repair incident.
  - That includes browser E2E and UI-demo failures.
  - Real-provider sync-live checks run only through explicit manual validation.
