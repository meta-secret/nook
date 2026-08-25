# The Engineering Harness

## Overview

All development tasks in Nook run containerized via `Taskfile`. This document specifies the Taskfile hierarchy, sealed container image architecture, BuildKit Docker cache model, Zot OCI registry scopes, and SeaweedFS `sccache` compiler caching.

For the system overview and crate dependency flow, see [ARCHITECTURE.md](../ARCHITECTURE.md).

---

## 1. Taskfile Layout

- Root `Taskfile.yml` is the repo entrypoint.
- App commands live in `nook-app/Taskfile.yml` and are included into the root surface.
- CI tasks live in `nook-app/ci/Taskfile.yml`.
- Rust tasks live in `nook-app/nook-platform/Taskfile.yml`.
- Docker tasks live beside each package under `docker/Taskfile.yml`.
- Web tasks live in `nook-app/nook-web/Taskfile.yml`.
- Extension tasks live in `nook-web-extension/Taskfile.yml`.
- Wasm tasks live in `nook-platform/nook-wasm/Taskfile.yml`.
- Task namespaces match directories: `docker:*` under `docker/`, `ci:*` under `ci/`.
- `infra/Taskfile.yml` is the infrastructure composition root.
- It flattens domain-owned command modules under `infra/tasks/` into one public surface.
- Every infrastructure Taskfile must be reachable from that root.
- Operation shell bodies stay inside their owning domain Taskfile.
- Orphan Taskfiles and standalone shell scripts under `infra/` are prohibited.
- Preflight rejects orphan infrastructure Taskfiles.

---

## 2. Preflight and Sealed Images

- Repository-wide invariant tests run through `task preflight`.
- Preflight bakes through `preflight/docker-bake.hcl`.
- It reuses the shared `rust-base` toolchain target.
- It cooks dependency graphs with cargo-chef.
- It compiles with SeaweedFS sccache secret mounts.
- Workspace source is copied into the `nook-web` image at build time.
- Build definition: `nook-app/nook-web/nook-web-app/Dockerfile`.
- There is no runtime bind mount on the common path.
- The image is self-contained and reproducible.

### Local-iteration exceptions

- `task web:dev` and `task web:dev:fast` — Vite hot-reload over trusted `https://localhost:<port>`.
- TLS material lives under `~/.nook/https/` and is git-ignored.
- `task wasm:build:fast` — mounted no-opt WASM regeneration.

### HTTPS setup

- `task web:https:setup` builds and runs the pinned repository `mkcert` container.
- Only the final CA trust operation runs on the host.
- The browser consumes the host trust store.

Playwright and CI keep isolated loopback-HTTP transport when real passkey, OAuth, or provider ceremonies are not under test.

---

## 3. PR Delivery Helpers

PR delivery helpers live in `agentic-ai/ci-agent`.

### Commands

- `task pr:preflight`
- `task pr:review`
- `task pr:review-local`
- `task pr:ready`

### Review and audit behavior

- The local review command runs advisory Codex review against `origin/main`.
- The review command posts an idempotent SHA-bound Codex request.
- If Codex reports a usage limit, the same command posts a SHA-bound Cursor Bugbot request instead of retrying Codex.
- Complete validation immediately dispatches repository-owned checks.
- It then requests exact-head review without making it a gate.
- Review results are not required for readiness.
- Audit commands emit machine-readable exact-head state.
- Audit commands do not wait for an external reviewer.
- Audit commands never merge a PR.

### Merge policy

- Nook has no event-driven PR auto-merger.
- Workflows do not merge blindly from check events.
- The task-owning agent runs the readiness audit.
- The agent squash-merges immediately when the audit passes.

Local ci-agent Docker tags are worktree-scoped. Another checkout cannot replace the audit binary between build and readiness execution.

---

## 4. Remote Execution and Validation

- Extension iteration and other heavy agent feedback use the allowlisted GitHub Actions remote task catalog.
- Required product validation runs on GitHub Actions only.
- Validation starts after the coherent pushed iteration is explicitly selected with a validation label.
- Agents do not run local `task check` or `task ci:pr` gates.

### Focused dispatches (`rust:test`, `web:check`, `web:test`, `extension:check`)

- Use narrow source-sealed images.
- Native tests branch from the manifest-keyed Rust dependency image.
- Web checks consume only web dependencies plus the generated WASM package.
- They do not join unrelated coverage, WASM-test, browser, full verification, or production-build stages.

Trusted same-repository PR native Rust plus Rust ecosystem validation and Main
build producers execute in disposable ordinary Pods through ARC. Focused
`preflight`, `rust:ci`, and `arc:runtime` jobs may use the same scale set. The
Docker CLI connects only to the persistent rootless BuildKit shard on its node.
It is not a general container-runtime API. Fork PRs, Dependabot PRs, releases,
and non-Main runtime-dependent, browser, WASM, and deployment validation execute
on ephemeral GitHub-hosted runners. Main's portable WASM dependency-cache writer
and proof is the narrow hosted exception. One fresh hosted builder publishes the
portable Zot metadata. A registry audit verifies child manifest digest/size and
streams every complete blob to verify its declared size and SHA-256. Another cache-only builder then
requires every expensive dependency vertex to hit before deployment without
hydrating the complete dependency filesystem. The legacy registered `nook`
runner is not used.

---

## 5. Split Rust/WASM and Web Images

### Rust/WASM Lineage

- `rust-base` plus manifest-only chef cooking exposes a lightweight WASM dependency boundary.
- Native verification extends it with nextest, clippy, and coverage profiles.
- Trusted same-repository PR CI runs native coverage independently on ARC.
- Fork PR native coverage remains GitHub-hosted and secret-free.
- It verifies WASM once on a dedicated producer.
- Web verification and opt-in browser jobs download that producer's small run-stable artifact.
- They do not rebuild Rust/WASM locally.

### PR Consumer Behavior

- `Web verification` depends on the WASM build producer through `needs`.
- It downloads the clippy-clean WASM package with `actions/download-artifact`.
- `WASM Node tests` can finish in parallel with web verification.
- The conditional `Headless UI demo` job also starts from the WASM handoff.
- It overlaps web verification on UI-changing pull requests.
- It solves the browser image without writing cache state.
- Playwright must succeed before cache publication starts.
- A dedicated cache-only target publishes the isolated exact-head browser graph.
- `Verify and preview` waits for Native Rust, web verification, and WASM Node tests.
- It also waits for the UI demo job.
- It deploys from the exported host dist handoff.
- Rust coverage reporting is a separate native-dependent job.
- That job downloads the completed handoff directly.
- Preview waits for Native verification.
- Preview still does not wait for native coverage.
- Preview does not poll sibling jobs.
- The overall gate requires the required producer jobs.
- Producer failures are reported explicitly.

### Hosted CI Cache Persistence

- Persists the toolchain.
- Persists stable native/WASM dependency boundaries.
- Persists separate source-sensitive native/WASM snapshots as private Zot BuildKit refs.
- Every PR job restores Main's complete lineage plus any existing PR remote-buildcache scope.
- Hosted PR jobs and local Task Bake export only isolated remote-buildcache refs.
- Trusted ARC PR jobs reuse their full private node-local BuildKit state.
- They do not export general Rust target trees to Zot. Even minimal result
  layers can exceed 15 GiB and concurrent uploads overload the registry HDD.
- They restore Main's registry lineage and reuse compiler objects through
  SeaweedFS sccache.
- Hive retains a small minimal exact-SHA handoff for fast retries.
- Explicit Remote tasks may update only their deterministic branch refs with Main fallback.

### SeaweedFS Reuse

- Trusted Main and Remote compiler vertices reuse bucket-scoped SeaweedFS `sccache` objects.
- Reuse happens through stable BuildKit secret mounts.

### Local On-Demand Images

- Explicit `task rust:*` and `task wasm:*` commands load the source-sealed `nook-rust:local` image on demand.
- Browser-only WASM tests and mounted Vite development use `nook-rust-browser:local`.

### Web Lineage

- `web-base` contains Bun, Node, and Task.
- `web-deps` adds `node_modules`.
- PR unit/preview builds use this browser-free lineage.
- The CI-only web target runs format, lint, check, and tests as a sibling of the production web/extension build.
- It joins both successful branches into the same sealed image.
- Verification is not serialized after the build.
- `web-e2e-base` adds Playwright Chromium for Main, manual e2e, and changed PR demos.
- It uses a separate `:web-e2e-*` cache.
- Browser-free PR web solves never pull the browser layer.
- Neither lineage contains Cargo or `target/`.

### Common Task Image (`nook-web:local`)

- Starts from `web-base`.
- Adds `node_modules`, the generated WASM package, coverage artifacts, workspace source, and built web/extension output.
- This is the slim image used by normal Task and CI runtime checks.

---

## 6. `task setup` Solve Flow

`task setup` has two solves:

### First Solve

- Builds web dependencies alongside a Rust graph.
- The Rust graph fans out from cached dependencies into native verification and WASM.
- Exports the scratch `web-artifacts` join under `${TMPDIR}/nook-web-artifacts/<full-commit-sha>/<unique-invocation>/`.
- The commit namespace isolates different revisions.
- The invocation namespace prevents concurrent builds of the same revision from racing.
- That directory contains only generated WASM and coverage files.
- It is guarded at 256 MiB.

### Second Solve

- Supplies the artifact directory as a named host context to `nook-web`.
- It never passes either multi-GB Rust branch as a Docker context or parent.
- This small final web solve is retried once after the known immediate BuildKit frontend/Dockerfile-load flake.
- On ARC, the separate uncached S3 health-probe solve also retries once when its Dockerfile frontend vertex reports a transient authorization TLS timeout.
- The probe does not retry an application vertex or a genuine S3 health failure.
- The expensive preparation graph is never repeated.
- The final Dockerfile asserts that `/usr/local/cargo` and `nook-app/target` are absent.

---

## 7. Container Limits and Host Prerequisites

- **Container file descriptors:** Nook runtime containers set `nofile=1048576`. `DOCKER_NOFILE_LIMIT` can override that value.
- **Inotify ownership:** Inotify sysctls are kernel-wide. Docker rejects them as per-container `--sysctl` options.
- **Linux prerequisites:** Developers configure the documented host values:
  - At least `fs.inotify.max_user_instances=2500`.
  - At least `fs.inotify.max_user_watches=10485760`.
- **GitHub Actions:** The shared Docker setup raises those values when needed. It does not lower larger runner defaults.

### macOS Behavior

- Inotify sysctls live inside Docker Desktop's Linux VM.
- Apply them with the documented short-lived privileged container after Docker Desktop restarts.
- macOS `sudo sysctl` does not configure the VM.

### macOS Host-Wide Ceilings

- `kern.maxfiles`
- `kern.maxfilesperproc`
- launchd's `maxfiles` controls newly launched processes.

---

## 8. Build Export & Docker Driver

- **Split lineages:** Rust and web caches remain in independent BuildKit lineages.
  - Only the WASM package and coverage outputs cross from Rust to web.
  - They cross through the commit-scoped, invocation-isolated host directory.
  - The common runtime image contains no Rust toolchain or `target/`.
- **Local export:** The normal **`docker` driver** writes the web result directly to the containerd image store to avoid extra archive/import cycles.
- **Hosted export:** Delivery validation uses an ephemeral `docker-container` builder restoring from `registry.dev.nokey.sh`.

### Builder Selection

- Normal local `task setup` and optional local `task ci:*` callers use the active Docker-context daemon builder (`desktop-linux` or `default`).
- GitHub-hosted Actions creates an ephemeral job-scoped `docker-container`
  builder with `docker/setup-buildx-action`; the authenticated setup preloads
  its BuildKit image from Zot before builder creation instead of resolving
  Docker Hub.
- ARC Actions registers the node-local persistent BuildKit service as a remote
  Buildx builder.
- Zot refs carry cache state between nodes and hosted runners.
- `task infra:kubernetes-cache:prove` creates an isolated three-agent k3d
  cluster on a GitHub-hosted runner.
- The proof applies Kustomize patches to the production Zot, BuildKit, and
  NetworkPolicy resources. It does not maintain copied workload manifests.
- Each simulated node retains one rootless BuildKit shard on node-local
  storage. In-cluster Zot remains the portable cache boundary between shards.
- The proof first requires an authorized BuildKit Service connection.
- Cache assertions use exact StatefulSet headless endpoints so every local,
  restart, and cold-restore result belongs to a known shard.
- The hosted overlay uses cluster-wide Service routing because k3d does not
  reliably reproduce production's node-local `internalTrafficPolicy` path.
- Proof clients mount no host runtime socket. They receive no Kubernetes
  service-account token and do not run privileged.
- k3d proves portable Kubernetes workload behavior. It does not claim parity
  for k0s lifecycle, node-local Service routing, WireGuard routing, Kata
  isolation, ARC control-plane lifecycle, node capacity, or production
  performance.

### CI Parity (`.github/actions/nook-docker-setup`)

- Raises Linux watcher limits.
- Exports either the hosted `docker-container` builder or the ARC remote
  builder for Task callers.
- Logs into `registry.dev.nokey.sh` and enables Bake registry cache refs.
- Trusted Main and PR Rust producers receive SeaweedFS writer identity; Remote receives read-only identity.

### BuildKit Caching Through `registry.dev.nokey.sh`

- Local Task Bake restores and publishes shared layers when remote registry credentials exist under `~/.nook/`.
- Every qualified node owns one retained 64 GiB rootless BuildKit shard.
- The node-local Service routes each runner only to the shard on its own node.
- BuildKit requests 4 CPU and 8 GiB. It has no CPU limit and may use up to
  48 GiB during large parallel web and Rust builds.
- Concurrent jobs share BuildKit's content-addressed store on that node.
- Main and pull requests retain separate registry publication refs.
- Zot remains the cross-node bootstrap and recovery source.
- Trusted Hive Rust verification uses the dedicated `nook-k0s-hive` scale set.
  Its Neo4j dependency and Trixie test runtime are Kubernetes native sidecars,
  so ARC remains daemon-free and the helpers stop with the runner. Hive keeps
  its independent Zot cache publication because its workflow may overlap Main.
- Registry transfer time and local snapshot materialization time are separate
  performance dimensions.
- A manifest lookup proves index availability. It does not prove that a fresh
  builder has hydrated content or extracted snapshots.
- Local writes use git-commit refs (`-git-<sha>`) under `nook/remote-buildcache/**`.
- Delivery CI persists the toolchain in `nook-rust-base-v1` and native/WASM dependencies in `nook-rust-deps-v3`.
- Source-sensitive coverage and WASM use `nook-rust-native-source-v3` and `nook-rust-wasm-source-v2`.
- Zot is reached only through Traefik HTTPS at `registry.dev.nokey.sh` with htpasswd auth.
- Traefik allows 15 minutes to read an incoming registry request so one large
  BuildKit layer upload is not cut off by Traefik's 60-second default.

### Rust Compiler Cache (`sccache`)

- Wrapped by pinned `sccache` backed by SeaweedFS S3 at `https://sccache.dev.nokey.sh`.
- Local builds, Hive, and Main write compiler objects.
- Explicit Remote tasks use read-only credentials.
- Fork and untrusted jobs receive no S3 credentials and fall back to clean compilation.

### Main Cache Visibility

- Main alone refreshes shared refs under `nook/buildcache/**`.
- Hosted PR jobs and Remote write only to isolated refs under `nook/remote-buildcache/**`.
- Trusted ARC PR jobs read Main and exact-SHA refs.
- General trusted ARC PR jobs do not write registry cache refs.
- Trusted Hive ARC jobs may write only their minimal exact-SHA ref under
  `nook/remote-buildcache/**`.
- Their runner Pods reuse the persistent BuildKit shard on the selected node.
- Inactive Remote refs expire after seven days; Zot deduplicates identical content-addressed layer blobs across both paths.

### Docker Bake Orchestration

- `nook-app/Taskfile.yml` passes `nook-app/docker-bake.hcl` plus package-local bake files to `docker buildx bake`.
- Loadable runtime tags live next to their package commons: `nook-web*` under `nook-web-app`, `nook-rust*` under platform.
- Source target contexts resolve against repo root for local/CI consistency.

---

## 9. Docker Cache Model

| Artifact                | Cache Strategy                                     | Location                            |
| ----------------------- | -------------------------------------------------- | ----------------------------------- |
| Rust/web/browser layers | Local builder store; hosted BuildKit registry refs | `registry.dev.nokey.sh`             |
| Rust crate dependencies | cargo-chef + Zot refs                              | `nook-rust-deps-v3`                 |
| Rust compiler cache     | SeaweedFS S3 `sccache`                             | `sccache.dev.nokey.sh`              |
| OCI registry            | Zot in k0s                                         | `10.96.90.10:5000` via Traefik      |
| `nook-app/target/`      | Rust lineage only                                  | `/meta-secret/nook/nook-app/target` |
| `node_modules`          | `web-deps` Dockerfile layer                        | Immutable image layer               |
| Web wasm pkg + coverage | Host artifact handoff                              | `${TMPDIR}/nook-web-artifacts/...`  |
| Web dist                | Image build time (`bun run build`)                 | Built into `nook-web` image         |
| Playwright Chromium     | `web-e2e-base` only                                | Isolated browser image              |

---

## 10. Execution Consequences

- **Diff emission:** Source-sealed images emit `git diff` outputs instead of directly mutating host files.
- **`task format` host application:** The agent/developer entrypoint runs one
  content-addressed, tool-only Docker image shared by all worktrees. The image
  formats the mounted working tree but must never contain project source,
  compile products, run tests, or use registry-cache paths.
- **`dist` hand-off:** CI deploys isolated `dist/site`, Simple, and Sentinel artifacts to respective Cloudflare Pages branch aliases.

---

## 11. Build & Verify

- **Native linking:** Uses `mold` linker for `x86_64-unknown-linux-gnu` in `rust-base`.
- **Wasm compilation:** `builder-wasm` compiles `nook-wasm` and `nook-companion-wasm` via `wasm-pack`. `WASM_BUILD_MODE=dev` is default; `prod` runs for release.
- **Verification execution:** Product verification (clippy, nextest, coverage, svelte-check, eslint, vitest, e2e) runs on GitHub Actions ephemeral runners.
