# Quality and Release

## Agent delivery applicability

Follow the [dev delivery contract](../../../gizmo/architecture/dev-delivery.md) for
feature compilation and the manually run dev manager's slow PR cycle.
Runtime workflow details below do not grant permission to run local tests or
lifecycle and must not be reactivated by this delivery change.

## Overview

Use this workflow for quality, CI, and deployment changes.

## Quality and release policy

    #### Workflows and runners
    - Trusted native Rust and Rust ecosystem PR jobs and Main build producers
      use ARC.
    - Main's portable WASM dependency writer/proof uses the selected
      node-local ARC BuildKit shard and verifies the exported Zot data.
    - General ARC exposes only a Buildx client connected to the persistent
      rootless BuildKit shard on its selected node.
    - Fork and Dependabot PRs retain secret-free hosted checks. Trusted release,
      browser, WASM, deployment, and agent jobs use ARC.
    - Taskfiles and Bake callers must never pass `--builder`.
    - Delivery does not depend on the daemon's default image store and never restarts Docker.
    - E2e uses `127.0.0.1:5173` inside each container — no host `-p 5173`.

    #### BuildKit cache
    - Every ARC build node owns one retained 128 GiB rootless BuildKit shard.
    - The node-local Service keeps runner traffic on the selected node.
    - Private Zot is the portable cache boundary for cross-node and hosted
      recovery.
    - The k0s Zot Pod reserves two CPUs and 4 GiB of memory.
    - It may burst to eight CPUs and 12 GiB during parallel cache transfers.
    - Raise that ceiling only after production telemetry proves Zot is the
      bottleneck.
    - Host-network Traefik reserves 2 GiB for the public registry edge.
    - A lower proxy ceiling can OOM-restart the edge during concurrent BuildKit
      transfers and interrupt every registry client.
    - GitHub Actions cache is forbidden.
    - Delivery Bake restores private Zot registry scopes for:
      - Rust toolchain
      - Rust ecosystem dylint leaf, fuzz leaf, policy-tools,
        deterministic, and Kani proof graph
      - preflight chef/test
      - stable Rust dependencies
      - source-sensitive native/WASM snapshots
      - web dependencies
      - browser-free web
      - e2e web
    - Product native deps scopes must not import rust-base at all.
    - Native source may import cooked native deps.
    - Native source must not import rust-base.
    - Ecosystem nightly/policy-tools and preflight scopes must not
      import rust-base at all.
    - Dylint/fuzz do not use a linked `rust-ecosystem-nightly` context.
    - Their own mode=max scopes embed the shared tool stage.
    - Dylint/fuzz leaf scopes must not import nightly (or rust-base).
    - WASM deps/source scopes must not import rust-base or native rust-deps.
    - Their mode=max exports already embed that parent chain.
    - WASM deps may import longer `nook-rust-wasm-source-v3` after own deps
      scopes miss.
    - That longer source index restores cook layers when the fingerprinted deps
      scope is still empty.
    - Preflight restores rust-base only via Bake `contexts` (`target:rust-base`).
    - Native deps and ecosystem leaves restore parents the same way.
    - Leaf `cache-from` stays own-scope only (no short-parent importers).
    - `mode=max` leaf exports already embed the parent chain.
    - Native deps/source use `nook-rust-deps-v4` and
      `nook-rust-native-source-v4` after leaving short-chain rust-base.
    - Empty `cache-from=` and `cache-to=` overrides are prohibited.
    - Clearing `cache-from` after a remote hit forces cold apt/toolchain rebuilds.
    - Clearing `cache-to` on a linked parent is banned.
    - Linked context parents declare no `cache-from` or `cache-to`.
    - Product source leaves use internal stages in `product.Dockerfile`.
    - `*-publish` targets write `mode=max` under `write_cache_repository` plus
      `GHA_CACHE_SCOPE_SUFFIX`.
    - Main uses `nook/buildcache` with stable unsuffixed names.
    - PR/Remote and ordinary local builds use `nook/remote-buildcache` with
      `-git-<40-char-sha>`.
    - PR jobs key that SHA by pull-request head, not the merge `GITHUB_SHA`.
    - Ordinary commit-scoped local publish is disabled on a dirty worktree.
    - The unavoidable local formatter writes only unique, source-free native
      and WASM dependency candidate tags.
    - Dirty local source never enters that fingerprinted dependency scope.
    - Dirty cache recipes disable formatter publication.
    - PR jobs never import a local candidate tag.
    - Main and release jobs never import the PR-visible formatter scope.
    - The Main-defined Remote workflow downloads every candidate blob.
    - It independently fingerprints the exact committed source SHA.
    - It uploads the graph to a hosted-normalized tag and downloads it again.
    - Only after both complete reads does it atomically assign the stable
      `fingerprint-<hash>` tag in the same OCI repository.
    - A failed or truncated candidate leaves the stable tag unchanged.
    - A fresh PR runner restores only that verified stable tag, even when its
      commit SHA differs.
    - Sealed web images use a commit revision barrier immediately before the
      workspace source copy so formatter diffs match the checked-out tree.
    - If a short parent index orphans a leaf RUN, redesign the Bake graph.
    - Do not wipe cache to paper over a short-chain import.
    - Prefer own-scope leaf `cache-from`, same-Dockerfile stage lineage, or a
      dedicated parent scope that is never thin.
    - BuildKit merges cache importers. List order is not fallback precedence.
    - Docker setup probes every full-graph exact scope separately.
    - A present exact scope is the only importer for that graph.
    - Hosted exact PR writers publish `mode=max`, so replay keeps the full leaf
      lineage.
    - ARC exact PR writers use isolated refs so concurrent jobs cannot overwrite
      another commit's graph.
    - Docker setup also probes trusted Main native and WASM source refs.
    - A present Main source graph is the only importer for that solve.
    - Shorter dependency indexes join only while that Main source ref is absent.
    - A missing exact and Main source scope falls back to source-free
      dependencies without cold `cargo install`.
      scale set.
      node.
      not already contain the needed graph.
      that handoff is small and has proven fast enough for retries.
    - Ecosystem jobs verify with cache-to off, then publish with leaf cache-from
      kept so remote hits re-export without cold apt/toolchain rebuilds.
    - Hosted and Main Native publishers stage
      `docker:ci:cache:publish:rust-base` before deps/source scopes so one Bake
      cannot rewrite apt while cooking chef.
    - ARC Native and ecosystem jobs do not export per-PR Rust target trees.
      Even `mode=min` can contain a result layer larger than 15 GiB.
    - ARC WASM publishers keep source state portable but never overwrite the
      portable dependency ref with worker-specific metadata.
    - The trusted Main ARC proof job is the sole writer of the portable WASM
      dependency ref.
    - Publishers keep configured `cache-from` on every Bake.
    - Main audits child manifest digest/size and every published blob's declared
      size and SHA-256 by streaming the blob completely.
    - One CI job writes each shared ecosystem registry ref.
    - The WASM cargo-chef dependency scope is fingerprinted from cook-affecting
      inputs only.
    - Those inputs are Cargo manifests/lockfiles, `.cargo`/`.config`,
      `clippy.toml`, `product.Dockerfile` (+ dockerignore), and sccache scripts.
    - Bake cache-from wiring and Taskfiles must not rotate that fingerprint.
    - Hosted builds never attach Redis credentials.
    - There is no dedicated cache-reconstruction build.
    - Failed validation publishes nothing.

    #### Preflight Bake cache proofs

    Static theorems live in
    `preflight/tests/vault_app_isolation/bake_cache_proofs.rs`.
    Extend that module when Bake cache graphs change.

    - `theorem_empty_cache_overrides_banned_repo_wide`
    - `theorem_short_parent_import_graph`
    - `theorem_exact_scope_excludes_main_then_cold_scope_falls_back`
    - `theorem_context_parents_never_write_publishers_mode_max`
    - `theorem_github_actions_zot_parameter_matrix`
    - `theorem_local_formatter_and_pr_share_input_cache`
    - `theorem_source_leaf_solves_do_not_duplicate_linked_dependency_targets`
    - `theorem_wasm_fingerprint_closed_allowlist`
    - `theorem_wasm_and_native_publish_staging`

    Runtime publication proof for WASM dependencies remains Main
    `verify-wasm-gha-cache.sh`. It publishes through the selected persistent
    ARC BuildKit shard, then reads every exported Zot manifest and blob to
    verify its size and SHA-256. Static preflight contracts require all three
    expensive dependency vertices in the published target. The separate
    Bake+Zot simulation owns clean-builder import proof.
    Runtime Bake+Zot parent/leaf proof is `task infra:bake-cache:prove`.
    That sim complements the static `bake_cache_proofs.rs` theorems.
    It reproduces the rejected three-linked-target nightly miss.
    It then proves one-Dockerfile tool and leaf stages on a fresh builder.
    It also proves Main vs parallel PR git-scope isolation on ephemeral Zot:
    PR writes stay under `nook/remote-buildcache/**-git-<sha>`, do not overlap,
    and do not replace Main `nook/buildcache/**`.
    Scenario P proves a hosted-verified local candidate and a fresh PR runner
    share the same source-free dependency graph without sharing a commit SHA.
    Scenario Q proves a generic standalone exact-scope verification restores
    Main, publishes only its isolated PR leaf, and replays that leaf on a fresh
    runner. General trusted ARC verification reuses its private local BuildKit
    separate exact-head registry contract.
    Scenario R proves exact-only selection replays the leaf across both a bare
    Bake-linked parent and the production internal-stage architecture on fresh
    builders.
    Scenario S applies the same cold-Main then exact-replay contract to the
    full-graph Kani model, where compiler-object sccache is unavailable.
    Scenario T proves an unverified local candidate is invisible to PR restore.
    Scenario V proves a changed PR source restores a cfg-specific dependency
    stage from Main and then replays its exact source leaf on a fresh builder.
    Scenario W proves the separate WASM Node consumer owns a non-overlapping
    full-graph scope. Main seeds it, a changed PR publishes only its exact-head
    scope after tests pass, and a fresh retry restores every stage as CACHED.
    Scenario X proves sequential crate COPY+RUN layers.
    Main seeds crate-a and crate-b in one Dockerfile leaf.
    A PR that edits only crate-b restores crate-a as CACHED.
    It compiles crate-b and the leaf, then replays the exact graph.
    Main publishes the manifest, vendor, fetch, test-dependency, and
    Clippy-dependency lineage to Zot.
    Two concurrent PR sources restore those source-free stages on independent
    ARC-shaped builders and publish separate exact-head v2 graphs.
    Fresh builders replay each PR graph without executing the cargo-fetch
    analogue, and neither PR can consume or overwrite the other's source graph.
    Scenario Z keeps one ARC-shaped BuildKit container and local state across a
    daemon restart. The exact parent and leaf steps remain CACHED afterward.

    `task infra:kubernetes-cache:prove` is the Kubernetes integration proof.
    It derives an ephemeral three-agent k3d cluster from the production Zot,
    BuildKit, and NetworkPolicy manifests.

    The proof requires these outcomes:

    - one rootless BuildKit shard runs on each distinct agent;
    - a labeled same-node client can reach its BuildKit shard before denial is
      tested;
    - after the policy controller sync window, an unlabeled same-node client
      cannot reach the node-local BuildKit Service;
    - the Remote registry identity cannot write a stable Main ref;
    - node-local cache remains CACHED after BuildKit Pod recreation;
    - Zot retains a stable ref after its Pod is recreated;
    - a cold shard restores the stable ref through Zot;
    - concurrent isolated refs remain separate; and
    - each isolated ref restores as CACHED on a different shard.

    Clients run on their selected shard's node and use the production node-local
    Service. The controller refuses to replace a pre-existing cluster with the
    proof name. Cleanup targets only the cluster that the invocation created.

    This runtime proof is local-only. Hosted CI checks its static contracts but
    does not create a k3d cluster.

    #### SeaweedFS sccache
    - Trusted Main Rust/WASM producers receive fixed-ID SeaweedFS secret mounts.
    - They read/write compiler objects in `nook-sccache` and publish shared verified Zot refs.
    - Explicit collaborator-dispatched Remote jobs use a separate SeaweedFS identity.
    - Remote identity can read but cannot write `nook-sccache`.
    - Remote jobs restore Main's Zot lineage and write only git-commit refs under `nook/remote-buildcache/**`.
    - Same-repository PR Rust producers and Rust ecosystem Docker jobs mount the Main SeaweedFS build identity.
    - Forks stay secret-free and cold-compile.
    - Hosted PR jobs export only git-commit refs under `nook/remote-buildcache/**` while restoring Main's trusted `nook/buildcache/**` lineage.
    - Trusted ARC PR jobs restore Main plus any existing exact scope, then build
      into the persistent BuildKit shard on the selected node.
    - Exact-SHA handoffs remain isolated by commit identity.
    - Release and browser-only jobs receive neither cache credential and cannot evict Main.

    #### Main workflow
    - Main serializes native → WASM → web publisher lanes.
    - ARC lanes verify first, then publish the lane's shared Zot refs.
    - Hosted fallback lanes use the same portable Zot contract.
    - Hosted WASM dependency export never reimports its destination, so a
      corrupted portable ref can heal on the next Main run. It may import only
      independent input-fingerprint and Main source refs as optional seeds, and
      it forces zstd compression.
    - Browser E2E validation remains read-only and receives no compiler-cache identity.
    - Headless UI-demo execution is temporarily disabled.
    - Its retained implementation does not publish the browser graph while
      disabled.
    - Main runs full local-provider and extension e2e.
    - Main deploys `dev.nokey.sh`, `simple.dev.nokey.sh`, and `sentinel.dev.nokey.sh`.

    #### PR workflow
    - Trusted same-repository PRs run native Rust on a fresh ARC Pod.
    - Fork and Dependabot checks remain GitHub-hosted and secret-free.
      Trusted verified WASM producers use ARC.
    - The WASM producer uploads one small run-stable package.
    - That package is consumed by `PR / Verify and preview`.
    - Main-fix PRs carrying `ci:full-e2e` feed two deterministic local-provider web shards plus an independent extension browser job.
    - A stable browser join requires both web shards without rebuilding a low-reuse exact-head browser cache afterward.
    - `Verify and preview` uses `always()`.
    - It fails explicitly when any required producer or consumer fails.
    - The established required check cannot be skipped by dependency failure.
    - `Verify and preview` also needs Native Rust verification.
    - A failed Native job must keep the merge-gate check from going green.
    - `Verify and preview` never waits for native coverage.
    - The preview web solve retries once after the known immediate BuildKit Dockerfile-load flake.
    - Repeated failures still fail the gate.
    - The Repository policy job owns preflight and Loom checks in one automatic
      PR run without base-SHA comparison or changed-path classification.
    - Its workflow is Actions-only setup and trust wiring; repository-owned
      operations run through `.task/ci-workflows.yml`.
    - Its `pr-preflight` cache covers `preflight/target` and the Cargo registry.
    - The source-architecture proof requires cache restore before the first
      preflight Cargo task.

    #### Coverage reporting
    - Native coverage uses a run-stable artifact name consumed by a separate `needs: rust` report job.
    - That job downloads the current attempt directly.
    - When changed covered sources require a base comparison, it accepts an unexpired exact-commit artifact from an authenticated Main push.
    - This works even while that workflow is still running or if a later unrelated Main job fails.
    - If no trusted base artifact exists, it preserves the absolute coverage floor without cold-building the base revision.
    - The trusted-handoff promoter inspects every run attempt.
    - It requires the current successful consumer.
    - It accepts an earlier successful producer only when the current attempt omitted that producer.
    - It validates the reused run-stable artifact before publication.

    #### Release workflow
    - Release checks out the requested source first.
    - It preserves the current workflow tooling in ignored `.nook/release-workflow`.
    - It initializes the safe builder from that side checkout so the cache fingerprint describes the exact release source without reviving historical setup logic.
    - Release performs immutable tag validation, main-equivalent verify/e2e, stable production deployment, and GitHub Release publication.

    - This includes `Web e2e` and `Extension e2e` failures.
    - Each rerun creates a fresh delivery generation with generation-specific publication records and no completed publication reuse.
    - A later failed rerun cancels and supersedes an active delivery before its new generation is enqueued.
    - The old generation remains `CANCELLING` until its worker durably acknowledges that Codex execution stopped or Kubernetes confirms deletion of the exact recorded worker Pod.
    - Cancelling exclusive blockers share that barrier, so stale and replacement workers never execute concurrently.
    - Successful reruns retire active incidents; current-generation reconciliation is idempotent.
    - A single isolated dispatcher enqueues actionable incidents.
    - Repair implementation follows the feature path into local dev.
    - The dev manager controls slow dev PR checks and fast-forward promotion.
    - Incident completion retains replacement Main verification.
    - The explicitly dispatched implementation worker does not claim it.
    - SeaweedFS S3 `sccache` supplies compiler objects.
    - Main ARC producers publish shared Zot refs after verification.
    - Hosted jobs restore the same verified Zot refs read-only.

11. **GitHub Actions agent execution:**
    - Feature teams author tests and return scoped commits.
    - Feature feedback requires remote build-only capability.
    - Missing capability is a blocker, not permission for slow feature checks.
    - The manually run dev manager owns the full slow dev-to-main PR cycle.
    - Local tests, Docker work, compilation, and broad pre-push are prohibited.
    - See [dev delivery](../../../gizmo/architecture/dev-delivery.md).
12. After a slow-stage failure, delegate repair through the normal feature path.
    Select a replacement snapshot only after the prior slow attempt finishes.
13. **Docker:** Killing the Docker daemon is **strictly prohibited** — only stop individual containers (`docker stop <id>`). Never `killall docker`, `pkill docker`, etc. See [docker-container-harness.md](../dynamic-skills/docker-container-harness.md).
14. **NEVER pipe a long-running command through `| grep`/`| tail`/`| head`/`| sed` (or any filter).** This is a hard rule, not a suggestion.
    - `grep`/`tail`/`head` **buffer their input until the upstream command exits**.
    - A multi-minute `task setup` / `task check` / `docker buildx bake` then shows **zero output** the entire time.
    - That looks indistinguishable from a hang. You lose all progress visibility and cannot tell "still compiling" from "stuck".
    - Filtering pipes are **never** a performance optimization. They only destroy live output.
    - **Correct:** run the command bare — `NOOK_ENV=dev task setup` — its full output streams live and is saved to the terminal file automatically; filter/inspect it _afterward_ by reading that file.
    - **Also correct:** allocate a unique log with
      `build_log="$(mktemp "${TMPDIR:-/tmp}/nook-build-log.XXXXXX")"`.
      Redirect the command with `... > "$build_log" 2>&1`.
      Read it after completion, or run `tail -f "$build_log"` separately.
    - **Forbidden while the command runs:** `task setup 2>&1 | grep -iE "DONE|error" | tail -40`, `gh run watch ... | tail`, `cargo ... | tail`, etc. If you catch yourself appending `| grep`/`| tail` to a build/test/CI command, STOP and run it bare instead.
15. **Local web dev:** `task web:dev` — do not start host `vite`/`npm` or free `:5173` with blind `kill`.
16. **Testing pyramid:**
    - `task rust:coverage:check` is the primary correctness gate for vault logic (llvm-cov + nextest, **90%** line floor).
    - Target **~99% functional coverage via Rust unit and integration tests** — not e2e.
    - Playwright (`task web:test:e2e:pr`) is a thin UI smoke layer.
    - New domain behavior requires new Rust tests in the same change.
    - **Below 90% line coverage, agents add tests before finishing.**
    - See [testing-pyramid-and-regression.md](../../../shared/dynamic-skills/testing-pyramid-and-regression.md).
17. **Cortex + README hygiene:**
    - After learning something durable from tests, CI, or PR review, update `.cortex` per [core-beliefs.md §10](../../ai/design-docs/core-beliefs.md#10-grow-cortex-dynamically).
    - When the change is architectural or alters the public developer/product surface, also update the root [`README.md`](../../../../README.md) in the same PR ([AGENTS.md — Keep the root README current](../../../../AGENTS.md#keep-the-root-readme-current)).
18. **Troubleshooting web/e2e/CI failures:** After test output and static analysis, **always check persisted app logs** — they are the most important source of truth for vault, sync, and WASM behavior. See [logging.md § Debugging, troubleshooting, and CI verification](../../../shared/references/logging.md#debugging-troubleshooting-and-ci-verification).
19. **Coverage reporting:**
    - `task rust:coverage:export` exports baked portable Rust coverage artifacts locally (`summary.txt`, `summary.json`, `lcov.info`, and `coverage-floor.json`).
    - PR CI uploads those files plus the stripped Linux `nook-preflight` reporter directly from the native Rust runner.
    - The Rust-dependent `Rust coverage report` job downloads them directly without occupying the independent preview runner.
    - It asks `nook-preflight` to classify changed coverage inputs.
    - It validates a trusted commit-keyed Main artifact when available.
    - It parses cargo-llvm-cov's structured JSON, writes typed GitHub outputs, and renders the Markdown summary.
    - A missing exact-base artifact reuses current coverage for the comparison while preserving the absolute floor.
    - PR CI must not cold-build the base revision a second time.
    - The workflow uploads both reports as `nook-core-coverage` and posts a sticky PR comment.
    - Human-readable coverage tables must not be scraped with shell.
    - `nook-app/nook-platform/nook-core/coverage-floor.json` exhaustively classifies every Cargo package.
    - The current registry raises authenticator-domain to 90%; every other enforced package requires its listed floor.
    - A required successor raises every testable first-party package to at least 90%. Only the explicit non-testable `nook-fuzz` harness and vendored `arrayref` exclusions remain.
20. **Coverage cache preservation:** Warm the full portable coverage graph with
    one `cargo llvm-cov nextest --no-report` Docker invocation. The graph
    includes `nook-app-common`, `nook-authenticator-domain`, `nook-auth2`,
    `nook-replication`, `nook-event-log`, `nook-companion-core`, and
    `nook-core`. Subsequent source-level coverage commands must use `--no-clean`
    so they reuse and extend that instrumented target.
21. **Ecosystem tools before bespoke preflight:** use a maintained Rust ecosystem tool when it directly expresses the invariant.
    - Dependency advisories, licenses, crate bans/duplicates, and sources belong in `deny.toml`.
    - Lockfile vulnerability auditing belongs to RustSec.
    - Randomized domain invariants belong in Proptest.
    - Stable structured renderings belong in Insta.
    - Concurrent state machines belong in Loom.
    - Hostile byte inputs belong in cargo-fuzz.
    - Bounded exhaustive properties belong in Kani.
    - Reusable AST/type-aware Rust source rules belong in Clippy or Dylint.
    - Panic shortcuts (`.expect` / `.unwrap`, including tests) belong to Clippy workspace lints plus `clippy.toml`; do not re-implement them in preflight.
    - Keep `preflight` for Nook-specific cross-language architecture, repository topology, delivery, and security contracts that those tools cannot represent — including authored `JsValue` paths before wasm-bindgen expansion, repository-defined macros, and untyped JSON assertions in known-contract tests.
    - Do not duplicate an ecosystem tool in a custom scanner.
22. **Cost tiers:**
    - cargo-deny, RustSec, Proptest, and committed Insta snapshots are normal merge checks.
    - Loom models must remain bounded.
    - Cargo-fuzz uses a 20-second smoke per target for merge, scheduled, and manual runs.
    - Each shared Rust ecosystem job has a five-minute limit.
    - Kani proofs must declare practical unwind bounds.
    - Dylint libraries, versions, and their dated nightly (`nightly-2026-04-16` for Dylint `6.0.1`) are pinned so compiler-coupled lint behavior changes intentionally.

## Fix check findings — not silence them

Quality gates exist to force remediation. When **Knip**, **jscpd**, or **any
other** check in `task check` / `task ci:pr` / PR CI fails, agents **must fix the
reported problems in the same task** and leave the gate green.

### Required actions

- **Knip (`bun run unused`)**
  - **Typical findings:** unused files, exports, dependencies
  - **Correct fix:** delete dead code, wire it up, or export only what callers need
- **jscpd (`bun run duplicates`)**
  - **Typical findings:** copy/paste clones over threshold
  - **Correct fix:** extract a shared helper/module; do not duplicate again
- **fmt / prettier / eslint / svelte-check / clippy / tsc**
  - **Typical findings:** style, type, lint defects
  - **Correct fix:** correct the code
- **vitest / Rust tests / coverage / e2e / preflight**
  - **Typical findings:** failing or missing coverage
  - **Correct fix:** fix behavior and add the required tests

### Prohibited actions

Do not "resolve" a finding by:

- raising the jscpd `threshold` or Knip config to hide clones/unused code
- adding ignore/exclude paths for authored product sources that should stay in
  the graph (generated WASM output and true vendor trees are the exception)
- filing an issue or leaving a TODO and marking the PR ready while the check is
  red
- treating Knip/jscpd output as advisory when it fails the lint/`task check` path

Threshold or ignore edits belong only in an explicit gate-maintenance change,
with the rationale in the PR. Default agent behavior is: read the failure → fix
the code → re-run the same gate until green. See
[AGENTS.md — Fix every failing check finding](../../../../AGENTS.md#non-negotiable-fix-every-failing-check-finding)
and [mission delivery](../../../gizmo/workflows/mission-delivery.md).
