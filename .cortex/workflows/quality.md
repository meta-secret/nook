# Quality and Release

Use this workflow for quality, CI, and deployment changes.

1. Keep Taskfile as the source of truth for normal build, lint, test, and check commands.
   - App commands live in `nook-app/Taskfile.yml`.
   - App-wide tasks live in `nook-app/Taskfile.yml`; CI tasks in `nook-app/ci/Taskfile.yml`.
   - Docker tasks live in `nook-app/nook-platform/docker/Taskfile.yml` and `nook-app/nook-web/docker/Taskfile.yml`.
   - Web-family tasks live in `nook-app/nook-web/Taskfile.yml` and package Taskfiles under `nook-web-extension/` / `nook-platform/`.
   - Repository-wide invariant tests live in the standalone root Rust crate `preflight/` and run through `task preflight`.
   - `task preflight` Bakes `preflight-test` on the shared `rust-base` target with cargo-chef dependency cooks and SeaweedFS sccache.
   - Preflight uses the dedicated `nook-preflight-v1` Zot scope so chef cooks reuse across PR runs.
   - Restore `rust-base` only through Bake `contexts` (`target:rust-base`).
   - Do not also cache-from `rust-base` on the preflight target.
   - That shorter parent importer orphans chef cook layers.
   - Never clear `cache-from` or `cache-to` with an empty Bake override.
   - Empty cache overrides are an architectural failure, not cache hygiene.
   - Most context parents keep `cache-from` and declare no `cache-to`.
   - Context `rust-base` omits both.
   - `rust-base-restore` / `rust-base-publish` own its Zot scope.
   - Keep expensive tools in the same Dockerfile as source-sensitive leaves.
   - Put source COPY steps after the shared tool stage.
   - Importing short rust-base during a nested leaf bake orphans nightly RUNs.
   - Dedicated `*-publish` targets write scoped Main/PR Zot refs.
   - Redesign scopes or Dockerfile lineage instead of wiping cache.
   - The root `Taskfile.yml` is the repo entrypoint and may also own repo-level non-app tooling.
   - Reusable GitHub workflow shell lives in `.task/ci-workflows.yml` and `.github/scripts/`; workflows stay thin `task` wrappers around Actions-only glue.
   - Rust ecosystem gates (cargo-deny, cargo-audit, Proptest/Insta/Loom, cargo-fuzz, Dylint) live as sibling Dockerfiles under `nook-app/nook-platform/docker/rust/` (Bake images off `rust-base`, not inside product `lineage.Dockerfile`).
   - They run through `task docker:ecosystem:*`.
   - Precise stage tasks warm parents alone before leaves:
     - `task docker:rust-base` (read-only; never publishes Zot)
     - `task docker:ecosystem:policy-tools`
   - Composites call those stages in order so a leaf miss cannot cold-rebuild apt.
   - Labeled product PRs call the shared jobs from `pr.yml` via `rust-ecosystem-checks.yml`.
   - Thin `rust-ecosystem.yml` keeps schedule, main-path, manual, and labeled minds-only PR entry points.
   - Do not duplicate those commands in bespoke preflight scanners, call Bake helpers directly from the workflow, or compile their CLIs on the GitHub-hosted runner host.
   - Kani remains on its official action because it provisions a specialized model-checking toolchain.
2. Public Taskfile commands must run project builds/checks inside Docker.
   - CI may install host orchestration tools such as Task, but should call Taskfile tasks for normal repo behavior.
   - Prefer pinned release binaries on dedicated ecosystem stages (`rust-ecosystem-policy-tools`, `rust-ecosystem-nightly`) over `cargo install` on the runner.
   - Keep those tools out of `rust-base`.
   - Keep ecosystem Bake jobs exact-head merge gates and pin every compiler-coupled version.
3. Build Docker images with Docker Buildx Bake.
   - `nook-app/docker-bake.hcl` is a thin shared fragment:
     GHA/registry/sccache vars, `_sccache`, and cross-lineage prepare groups.
   - Platform Rust Zot scopes, ecosystem targets, and loadable `nook-rust*`
     images live under `nook-app/nook-platform/**/docker-bake.hcl`.
   - Web Zot scopes and loadable `nook-web*` images live under
     `nook-app/nook-web/**/docker-bake.hcl`.
   - Preflight Zot scopes live in `preflight/docker-bake.hcl`.
   - Do **not** use Docker named volumes for `target/`, Cargo registries, `node_modules`, or other build outputs.
   - The Rust dep cache and warm `target/` are baked into normal image layers.
   - Workspace source is copied into the nook-web image (sealed image, no runtime mount).
   - Authenticated SeaweedFS S3 `sccache` is a compiler-output optimization below Docker/cargo-chef and never a correctness input.
   - See [ARCHITECTURE.md §7](../ARCHITECTURE.md#7-the-engineering-harness).
4. Use Bun for web tooling. Do not introduce npm commands or Node-only command flows.
5. Prefer official prebuilt release archives downloaded with `curl` for standalone Docker image tools. Avoid `cargo install` when a release archive is available.
6. Preserve these gates unless the task explicitly changes them:
   - `cd nook-app/nook-platform && cargo fmt --all -- --check`
   - `clippy::all` and `clippy::pedantic` are enabled in every Rust project's
     manifest; `cd nook-app/nook-platform && cargo clippy -p nook-app-common -p nook-core -p nook-auth2 -p nook-replication -p nook-event-log --all-targets`,
     `cd nook-app/nook-platform && cargo clippy --release --target wasm32-unknown-unknown -p nook-wasm`,
     and the standalone `preflight` Clippy pass enforce them with `-D warnings`
   - `task rust:coverage:check` — combined `nook-app-common`, `nook-core`,
     `nook-auth2`, `nook-replication`, and `nook-event-log` coverage vs the **90%** line floor
     (`nook-app/nook-platform/nook-core/coverage-floor.json`)
   - `svelte-check`
   - `eslint` — the web-family lint command uses a dedicated project that
     includes every linted TypeScript and Svelte source, enables
     promise/exhaustiveness type-aware rules, and rejects unsanitized DOM HTML
     sinks outside test and e2e fixtures
   - `bun audit --prod --audit-level=high` — every independently installed web
     package runs the audit in its CI check path and rejects high-severity
     production dependency advisories
   - `knip` (`bun run unused`) — unused/unreachable files, exports, class
     members, and dependencies in `nook-web-app` / `nook-web-research` (and any
     package that runs Knip in its check/lint path)
   - `jscpd` (`bun run duplicates`) — copy/paste clone detection across authored
     `nook-app` and `preflight` sources; the checked-in threshold in
     [`.jscpd.json`](../../.jscpd.json) is a no-regression ceiling, not a budget
     agents may spend by raising it
   - `prettier --check`
   - `vitest run`
   - `vite build`
   - `task preflight` — repository-wide Rust invariant tests, before app setup
   - `PR / Rust ecosystem / Dependency policy and RustSec` —
     `task docker:ecosystem:dependency-policy` loads pinned `cargo-deny` +
     `cargo-audit` via `docker:ecosystem:policy-tools`, then runs each
     workspace task (`rust:dependency-policy`, `preflight:dependency-policy`,
     `fuzz:dependency-policy`, `minds:dependency-policy`) in that image.
     Never aggregate multiple workspaces into one Dockerfile RUN.
     Tools Bake must not list `rust-base` in its own cache-from.
     Never `cargo install` those tools on the runner host. Advisory exceptions
     must name the RustSec IDs, identify the exact pinned upstream graph, and
     state the dependency upgrade that removes them in both `deny.toml` and
     the affected workspace's `.cargo/audit.toml`.
     The current `agentic-ai/minds` exception is limited to RUSTSEC-2026-0118 and
     RUSTSEC-2026-0119 in the pinned `openai/codex` Rama/Hickory graph; remove it
     when upstream moves from `hickory-proto` 0.25.2 to 0.26.1 or later.
   - `PR / Rust ecosystem / Proptest, Insta, and Loom` —
     `task docker:ecosystem:deterministic` warms `docker:rust-base`, then Bakes
     `rust-ecosystem-deterministic` on `rust-platform` (platform sources over
     cooked `builder-core-deps`) so
     [`proptest`](https://proptest-rs.github.io/proptest/),
     [`insta`](https://insta.rs/), and [`loom`](https://github.com/tokio-rs/loom)
     reuse the sealed Rust dependency graph instead of a host toolchain.
     Lineage stays manifest-stable through `builder-*-deps`; `rust-platform` is
     the shared source overlay for bulk leaves that do not need per-crate layers
     (e.g. deterministic). Focused test/lint/coverage and `builder-debug` keep
     per-crate COPY+RUN layering so one crate edit reuses earlier compile layers.
   - `PR / Rust ecosystem / Cargo fuzz smoke` —
     `task docker:ecosystem:fuzz` warms `docker:rust-base`, then
     Bakes the `rust-fuzz-smoke` stage from the same Dockerfile as the
     toolchain-only `rust-ecosystem-nightly` stage with pinned
     [`cargo-fuzz`](https://rust-fuzz.github.io/book/cargo-fuzz.html).
     The leaf stage owns the platform source copy after the shared tool stage.
     Fuzz restores nightly read-only and writes `nook-rust-ecosystem-fuzz-v3`.
   - `PR / Rust ecosystem / Kani bounded proofs` —
     [`Kani`](https://model-checking.github.io/kani/) exhaustively verifies
     bounded proof harnesses via the official action (specialized toolchain).
   - `PR / Rust ecosystem / Dylint repository lints` —
     `task docker:ecosystem:dylint` warms `docker:rust-base`,
     Bakes `rust-dylint` from the same Dockerfile as `rust-ecosystem-nightly`,
     then publishes only the full-graph dylint leaf when writes are enabled.
     The leaf `mode=max` scope embeds the exact nightly tool lineage it consumes.
     There is no linked nightly Bake context whose identity can change.
     Pinned [`cargo-dylint`](https://trailofbits.github.io/dylint/) /
     `dylint-link` release binaries (no host `cargo install`).
     The dylint leaf scope is `nook-rust-ecosystem-dylint-v3`.
     Nightly stays toolchain-stable and source-free.
     Dylint and fuzz copy sources in sibling stages after it.
7. Build wasm before Svelte checks or web builds.
8. Use `VITE_BASE="/<repo>/"` for GitHub Pages builds.
9. Update `.cortex` docs when checks, tooling, CI, or deploy behavior changes.
10. **CI policy** — see subsections below. Agents: follow [pull-requests.md § Agent pipeline](pull-requests.md#agent-pipeline).

    #### Workflows and runners

    - `.github/workflows/pr.yml`, `.github/workflows/main.yml`, and `.github/workflows/release.yml` run on GitHub-hosted `ubuntu-latest`.
    - Delivery cache-only Bake may use a job-scoped `docker-container` Buildx
      instance selected with `docker buildx use` before Task runs.
    - Taskfiles and Bake callers must never pass `--builder`.
    - Delivery does not depend on the daemon's default image store and never restarts Docker.
    - E2e uses `127.0.0.1:5173` inside each container — no host `-p 5173`.

    #### BuildKit cache (Zot)

    - Private Zot is the authoritative BuildKit cache.
    - GitHub Actions cache is forbidden.
    - Delivery Bake restores private Zot registry scopes for:
      - Rust toolchain
      - Rust ecosystem dylint leaf, fuzz leaf, policy-tools, policy leaf, and deterministic
      - preflight chef/test
      - stable Rust dependencies
      - source-sensitive native/WASM snapshots
      - web dependencies
      - browser-free web
      - e2e web
    - Product native deps scopes must not import rust-base at all.
    - Native source may import cooked native deps.
    - Native source must not import rust-base.
    - Ecosystem nightly/policy-tools/policy and preflight scopes must not
      import rust-base at all.
    - Dylint/fuzz do not use a linked `rust-ecosystem-nightly` context.
    - Their own mode=max scopes embed the shared tool stage.
    - Dylint/fuzz leaf scopes must not import nightly (or rust-base).
    - WASM deps/source scopes must not import rust-base or native rust-deps.
    - Their mode=max exports already embed that parent chain.
    - WASM deps may import longer `nook-rust-wasm-source-v2` after own deps
      scopes miss.
    - That longer source index restores cook layers when the fingerprinted deps
      scope is still empty.
    - Preflight restores rust-base only via Bake `contexts` (`target:rust-base`).
    - Native deps and ecosystem leaves restore parents the same way.
    - Leaf `cache-from` stays own-scope only (no short-parent importers).
    - `mode=max` leaf exports already embed the parent chain.
    - Native deps/source use `nook-rust-deps-v3` and
      `nook-rust-native-source-v3` after leaving short-chain rust-base.
    - Empty `cache-from=` and `cache-to=` overrides are prohibited.
    - Clearing `cache-from` after a remote hit forces cold apt/toolchain rebuilds.
    - Clearing `cache-to` on a linked parent is banned.
    - Context parents declare no `cache-to`.
    - `*-publish` targets write `mode=max` under `write_cache_repository` plus
      `GHA_CACHE_SCOPE_SUFFIX`.
    - Main uses `nook/buildcache` with stable unsuffixed names.
    - PR/Remote/local use `nook/remote-buildcache` with `-git-<40-char-sha>`.
    - PR jobs key that SHA by pull-request head, not the merge `GITHUB_SHA`.
    - Local publish is disabled on a dirty worktree.
    - If a short parent index orphans a leaf RUN, redesign the Bake graph.
    - Do not wipe cache to paper over a short-chain import.
    - Prefer own-scope leaf `cache-from`, same-Dockerfile stage lineage, or a
      dedicated parent scope that is never thin.
    - Isolated FALLBACK restores fat Main indexes before git-scope.
    - Thin PR publishes must not orphan Main and cold `cargo install`.
    - That keeps PR verify from cold `cargo install` of ecosystem tools.
    - Ecosystem jobs verify with cache-to off, then publish with leaf cache-from
      kept so remote hits re-export without cold apt/toolchain rebuilds.
    - Native publishers stage `docker:ci:cache:publish:rust-base` before
      deps/source scopes so one Bake cannot rewrite apt while cooking chef.
    - WASM publishers stage deps-publish and source export before rust-base.
    - Staging rust-base first on WASM imports the shorter parent index and
      orphans local chef cook layers for the next bake.
    - Publishers keep configured `cache-from` on every Bake.
    - Main verifies published WASM fingerprints from a fresh builder.
    - One CI job writes each shared ecosystem registry ref.
    - The WASM cargo-chef dependency scope is fingerprinted from cook-affecting
      inputs only.
    - Those inputs are Cargo manifests/lockfiles, `.cargo`/`.config`,
      `clippy.toml`, `lineage.Dockerfile` (+ dockerignore), and sccache scripts.
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
    - `theorem_ecosystem_parent_fallback_restores_main`
    - `theorem_context_parents_never_write_publishers_mode_max`
    - `theorem_github_actions_zot_parameter_matrix`
    - `theorem_wasm_fingerprint_closed_allowlist`
    - `theorem_wasm_and_native_publish_staging`

    Runtime CACHED proof for published WASM deps remains Main
    `verify-wasm-gha-cache.sh` on a fresh builder.
    Runtime Bake+Zot parent/leaf proof is `task infra:bake-cache:prove`.
    That sim complements the static `bake_cache_proofs.rs` theorems.
    It reproduces the rejected three-linked-target nightly miss.
    It then proves one-Dockerfile tool and leaf stages on a fresh builder.
    It also proves Main vs parallel PR git-scope isolation on ephemeral Zot:
    PR writes stay under `nook/remote-buildcache/**-git-<sha>`, do not overlap,
    and do not replace Main `nook/buildcache/**`.

    #### SeaweedFS sccache

    - Trusted Main Rust/WASM producers receive fixed-ID SeaweedFS secret mounts.
    - They read/write compiler objects in `nook-sccache` and publish shared verified Zot refs.
    - Explicit collaborator-dispatched Remote jobs use a separate SeaweedFS identity.
    - Remote identity can read but cannot write `nook-sccache`.
    - Remote jobs restore Main's Zot lineage and write only git-commit refs under `nook/remote-buildcache/**`.
    - Same-repository PR and Rust ecosystem Docker jobs mount the Main SeaweedFS build identity.
    - Forks stay secret-free and cold-compile.
    - PR jobs export only git-commit refs under `nook/remote-buildcache/**` while restoring Main's trusted `nook/buildcache/**` lineage.
    - Release and browser-only jobs receive neither cache credential and cannot evict Main.

    #### Main workflow

    - Main serializes native → WASM → web publisher lanes.
    - Each lane verifies read-only first, then exports its already-solved graph from the same job-scoped builder.
    - WASM dependencies export alone with no hosted reimport and forced zstd compression.
    - Browser/UI consumers remain read-only.
    - Main runs full local-provider and extension e2e.
    - Main deploys `dev.nokey.sh`, `simple.dev.nokey.sh`, and `sentinel.dev.nokey.sh`.

    #### PR workflow

    - PR runs native Rust and verified WASM on independent hosted producer runners.
    - The WASM producer uploads one small run-stable package.
    - That package is consumed by `PR / Verify and preview`.
    - Main-fix PRs carrying `ci:full-e2e` also feed separate local-provider web and extension browser jobs.
    - `Verify and preview` uses `always()` and fails explicitly when the WASM producer fails.
    - The established required check cannot be skipped by dependency failure.
    - `Verify and preview` also needs Native Rust verification.
    - A failed Native job must keep the merge-gate check from going green.
    - `Verify and preview` never waits for native coverage.
    - The preview web solve retries once after the known immediate BuildKit Dockerfile-load flake.
    - Repeated failures still fail the gate.

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

    #### Manual and scheduled jobs

    - Credentialed `sync-live` validation is manual through `e2e-pr.yml`.
    - Weekly: `rust-dependency-updates.yml` audits every direct dependency in `nook-app/` and `preflight/`.
    - A finding starts an isolated AI agent.
    - The agent updates all outdated Rust dependencies.
    - It must run `WASM_BUILD_MODE=prod task ci:pr:e2e VITE_BASE=/ VITE_VAULT_SYNC_INTERVAL_MS=1000` before its PR can be merged.
    - `.github/workflows/runner-cleanup.yml` remains on `nook` for registered-host maintenance.

    #### Main failure incidents (Hive)

    - Every actionable unsuccessful Main run creates one `automation: hive` Workbench incident per failed SHA.
    - This includes `Web e2e`, `UI demos`, and `Extension e2e` failures.
    - Each rerun creates a fresh delivery generation with generation-specific publication records and no completed publication reuse.
    - A later failed rerun cancels and supersedes an active delivery before its new generation is enqueued.
    - The old generation remains `CANCELLING` until its worker durably acknowledges that Codex execution stopped or Kubernetes confirms deletion of the exact recorded worker Pod.
    - Cancelling exclusive blockers share that barrier, so stale and replacement workers never execute concurrently.
    - Successful reruns retire active incidents; current-generation reconciliation is idempotent.
    - A single isolated dispatcher enqueues actionable incidents.
    - One logical Hive task owns the normal PR, checks, review loop, squash merge, and replacement Main verification.
    - The scheduled implementation worker does not claim it.
    - Hive verification materializes its real-lock test and Clippy dependency graphs in independent BuildKit stages so they execute in parallel.
    - SeaweedFS S3 `sccache` supplies compiler objects.
    - Main publishes shared verified Zot BuildKit layers.
    - Pull requests restore them read-only.

11. **GitHub-hosted agent execution:**
    - When an iteration is coherent, agents run `task format` (and the UI demo contract when UI paths change), commit, and push the exact head.
    - Focused builds/tests use `task remote TASK_NAME=<name>`.
    - Complete PR checks run only after `task pr:validate PR=<number>`.
    - Do not run `task check`, `task ci:pr`, full suites, builds, or e2e on the agent machine.
    - Local mirrors remain available to humans.
    - See [remote-execution.md](remote-execution.md), [coding-bro.md](coding-bro.md), and [pull-requests.md § Validation](pull-requests.md#5-hosted-iteration-and-explicit-validation).
12. Prove the latest pushed head with explicitly triggered green repository-owned checks before merge or handoff. After a remote failure, fix, format, commit, push, use focused hosted proof as useful, and explicitly trigger complete validation again.
13. **Docker:** Killing the Docker daemon is **strictly prohibited** — only stop individual containers (`docker stop <id>`). Never `killall docker`, `pkill docker`, etc. See [rules.md §5 — Docker daemon](../rules.md#docker-daemon--never-kill-it).
14. **NEVER pipe a long-running command through `| grep`/`| tail`/`| head`/`| sed` (or any filter).** This is a hard rule, not a suggestion.
    - `grep`/`tail`/`head` **buffer their input until the upstream command exits**.
    - A multi-minute `task setup` / `task check` / `docker buildx bake` then shows **zero output** the entire time.
    - That looks indistinguishable from a hang. You lose all progress visibility and cannot tell "still compiling" from "stuck".
    - Filtering pipes are **never** a performance optimization. They only destroy live output.
    - **Correct:** run the command bare — `NOOK_ENV=dev task setup` — its full output streams live and is saved to the terminal file automatically; filter/inspect it _afterward_ by reading that file.
    - **Also correct:** redirect to a log while it runs — `... > /tmp/build.log 2>&1` — then `grep`/read the file after it finishes (or `tail -f` the file from a _separate_ shell).
    - **Forbidden while the command runs:** `task setup 2>&1 | grep -iE "DONE|error" | tail -40`, `gh run watch ... | tail`, `cargo ... | tail`, etc. If you catch yourself appending `| grep`/`| tail` to a build/test/CI command, STOP and run it bare instead.
15. **Local web dev:** `task web:dev` — do not start host `vite`/`npm` or free `:5173` with blind `kill`.
16. **Testing pyramid:**
    - `task rust:coverage:check` is the primary correctness gate for vault logic (llvm-cov + nextest, **90%** line floor).
    - Target **~99% functional coverage via Rust unit and integration tests** — not e2e.
    - Playwright (`task web:test:e2e:pr`) is a thin UI smoke layer.
    - New domain behavior requires new Rust tests in the same change.
    - **Below 90% line coverage, agents add tests before finishing.**
    - See [rules.md §4](../rules.md#4-testing-requirements).
17. **Cortex + README hygiene:**
    - After learning something durable from tests, CI, or PR review, update `.cortex` per [core-beliefs.md §10](../design-docs/core-beliefs.md#10-grow-cortex-dynamically).
    - When the change is architectural or alters the public developer/product surface, also update the root [`README.md`](../../README.md) in the same PR ([AGENTS.md — Keep the root README current](../AGENTS.md#keep-the-root-readme-current)).
18. **Troubleshooting web/e2e/CI failures:** After test output and static analysis, **always check persisted app logs** — they are the most important source of truth for vault, sync, and WASM behavior. See [logging.md § Debugging, troubleshooting, and CI verification](../references/logging.md#debugging-troubleshooting-and-ci-verification).
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
    - The native Docker build remains the enforcement point for the 90% floor and the only place PR coverage tests run.
20. **Coverage cache preservation:** Warm the `nook-auth2 + nook-replication + nook-event-log + nook-core` coverage dependency graph with one `cargo llvm-cov nextest --no-report` Docker invocation. Subsequent source-level coverage commands must use `--no-clean` so they reuse and extend that instrumented target.
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
    - Cargo-fuzz uses a short merge smoke and longer scheduled/manual campaigns.
    - Kani proofs must declare practical unwind bounds.
    - Dylint libraries, versions, and their dated nightly (`nightly-2026-04-16` for Dylint `6.0.1`) are pinned so compiler-coupled lint behavior changes intentionally.

## Fix check findings — not silence them

Quality gates exist to force remediation. When **Knip**, **jscpd**, or **any
other** check in `task check` / `task ci:pr` / PR CI fails, agents **must fix the
reported problems in the same task** and leave the gate green.

| Gate | Typical findings | Correct fix |
|------|------------------|-------------|
| Knip (`bun run unused`) | unused files, exports, dependencies | delete dead code, wire it up, or export only what callers need |
| jscpd (`bun run duplicates`) | copy/paste clones over threshold | extract a shared helper/module; do not duplicate again |
| fmt / prettier / eslint / svelte-check / clippy / tsc | style, type, lint defects | correct the code |
| vitest / Rust tests / coverage / e2e / preflight | failing or missing coverage | fix behavior and add the required tests |

**Do not** "resolve" a finding by:

- raising the jscpd `threshold` or Knip config to hide clones/unused code
- adding ignore/exclude paths for authored product sources that should stay in
  the graph (generated WASM output and true vendor trees are the exception)
- filing an issue or leaving a TODO and marking the PR ready while the check is
  red
- treating Knip/jscpd output as advisory when it fails the lint/`task check` path

Threshold or ignore edits belong only in an explicit gate-maintenance change,
with the rationale in the PR. Default agent behavior is: read the failure → fix
the code → re-run the same gate until green. See
[AGENTS.md — Fix every failing check finding](../AGENTS.md#non-negotiable-fix-every-failing-check-finding)
and [coding-bro.md](coding-bro.md).
