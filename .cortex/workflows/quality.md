# Quality and Release

Use this workflow for quality, CI, and deployment changes.

1. Keep Taskfile as the source of truth for build, lint, test, and check commands. App commands live in `nook-app/Taskfile.yml`; cross-package app tasks live in `nook-app/.task/`, Docker tasks in `nook-app/docker/Taskfile.yml`, and web-family tasks in `nook-app/nook-web/Taskfile.yml` plus `nook-app/nook-web/.task/`. Repository-wide invariant tests live in the standalone root Rust crate `preflight/` and run through `task preflight`. The root `Taskfile.yml` is the repo entrypoint and may also own repo-level non-app tooling.
2. Public Taskfile commands must run project builds/checks inside Docker. CI may install host orchestration tools such as Task, but should call Taskfile tasks for repo behavior.
3. Build Docker images with Docker Buildx Bake through `nook-app/docker-bake.hcl`. Do **not** use Docker named volumes for `target/`, Cargo registries, `node_modules`, or other build outputs; the Rust dep cache and warm `target/` are baked into normal image layers, and workspace source is copied into the nook-web image (sealed image, no runtime mount). The optional remote Redis sccache is a compiler-output optimization below Docker/cargo-chef and never a correctness input. See [ARCHITECTURE.md §7](../ARCHITECTURE.md#7-the-engineering-harness).
4. Use Bun for web tooling. Do not introduce npm commands or Node-only command flows.
5. Prefer official prebuilt release archives downloaded with `curl` for standalone Docker image tools. Avoid `cargo install` when a release archive is available.
6. Preserve these gates unless the task explicitly changes them:
   - `cd nook-app && cargo fmt --all -- --check`
   - `clippy::all` and `clippy::pedantic` are enabled in every Rust project's
     manifest; `cd nook-app && cargo clippy -p nook-core -p nook-auth2 -p nook-replication -p nook-event-log --all-targets`,
     `cd nook-app && cargo clippy --release --target wasm32-unknown-unknown -p nook-wasm`,
     and the standalone `preflight` Clippy pass enforce them with `-D warnings`
   - `task rust:coverage:check` — combined `nook-core`, `nook-auth2`, and
     `nook-replication` coverage vs the **90%** line floor
     (`nook-app/nook-core/coverage-floor.json`)
   - `svelte-check`
   - `eslint`
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
7. Build wasm before Svelte checks or web builds.
8. Use `VITE_BASE="/<repo>/"` for GitHub Pages builds.
9. Update `.cortex` docs when checks, tooling, CI, or deploy behavior changes.
10. **CI policy:** `.github/workflows/pr.yml`, `.github/workflows/main.yml`, and `.github/workflows/release.yml` run on GitHub-hosted `ubuntu-latest`. Delivery Bake restores and exports separate GHA v2 scopes for the Rust toolchain, stable Rust dependencies, source-sensitive native/WASM snapshots, web dependencies, browser-free web, and e2e web. The complete Rust/WASM cargo-chef dependency graph uses an immutable scope fingerprinted from manifests, lockfiles, compiler Dockerfiles, Task invocation inputs, and Bake definitions; hosted builds do not attach Redis credentials or secret mounts. Only a push to `main` writes those shared scopes: Main serializes native → WASM → web publisher lanes, verifies each lane read-only, then exports its already-solved graph from the same job-scoped builder. WASM dependencies export alone with no hosted reimport and forced zstd compression; browser/UI consumers remain read-only. There is no dedicated cache-reconstruction build, failed validation publishes nothing, and cache uploads do not compete for the shared GHA service limit. PR, release, agent, and manual jobs restore Main's lineage read-only and cannot evict it. PR runs native Rust and verified WASM on independent hosted producer runners. The WASM producer uploads one small run-stable package consumed by `PR / Verify and preview` and, for Main-fix PRs carrying `ci:full-e2e`, separate local-provider web and extension browser jobs. `Verify and preview` uses `always()` and fails explicitly when the WASM producer fails, so the established required check cannot be skipped by dependency failure. Native coverage also uses a run-stable artifact name. Both consumers prefer a current-attempt producer and wait for it to succeed; when a failed-job rerun omits an already-successful producer, they fall back to the existing exact-head artifact. The trusted-handoff promoter inspects every run attempt: it requires the current successful consumer and accepts an earlier successful producer only when the current attempt omitted that producer, then validates the reused run-stable artifact before publication. The preview web solve retries once after the known immediate BuildKit Dockerfile-load flake; repeated failures still fail the gate. Delivery routes all Task/Bake callers through the hosted `docker-container` builder, does not depend on the daemon's default image store, and never restarts Docker. Release checks out the requested source first, preserves the current workflow tooling in ignored `.nook/release-workflow`, and initializes the safe builder from that side checkout so the cache fingerprint describes the exact release source without reviving historical setup logic. Main runs full local-provider and extension e2e and deploys `dev.nokey.sh`, `simple.dev.nokey.sh`, and `sentinel.dev.nokey.sh`; release performs immutable tag validation, main-equivalent verify/e2e, stable production deployment, and GitHub Release publication. Registry BuildKit caches remain forbidden. Credentialed `sync-live` validation is manual through `e2e-pr.yml`. Weekly: `rust-dependency-updates.yml` audits every direct dependency in `nook-app/` and `preflight/`; a finding starts an isolated AI agent, which updates all outdated Rust dependencies and must run `WASM_BUILD_MODE=prod task ci:pr:e2e VITE_BASE=/ VITE_VAULT_SYNC_INTERVAL_MS=1000` before its PR can be merged. `.github/workflows/runner-cleanup.yml` remains on `nook` for registered-host maintenance. E2e uses `127.0.0.1:5173` inside each container — no host `-p 5173`. Agents: follow [pull-requests.md § Agent pipeline](pull-requests.md#agent-pipeline).
    Every actionable unsuccessful Main run creates one `automation: hive`
    Workbench incident per failed SHA, including `Web e2e`, `UI demos`, and
    `Extension e2e` failures. Each rerun creates a fresh delivery generation
    with generation-specific publication records and no completed publication
    reuse. A later failed rerun cancels and supersedes an active delivery before
    its new generation is enqueued. The dispatcher retries only after a poll
    interval longer than the worker heartbeat, so stale and replacement workers
    never execute concurrently; current-generation reconciliation is
    idempotent.
    A single isolated dispatcher enqueues actionable incidents, and one logical Hive
    task owns the normal PR, checks, review loop, squash merge, and replacement
    Main verification; the scheduled implementation worker does not claim it.
    Hive verification materializes its real-lock test and Clippy dependency
    graphs in independent BuildKit stages so they execute in parallel. Redis
    `sccache` supplies compiler objects, Main alone publishes both verified GHA
    BuildKit layers, and pull requests restore them read-only.
11. **GitHub Actions-only product gates:** When functionality for the current iteration is coherent and checkable, agents run `task format` (and the UI demo contract when UI paths change), then commit and push/open/update the PR. Every product check runs on GitHub Actions. Do **not** require `task check`, `task ci:pr`, full suites, builds, or e2e locally for merge or handoff. Optional local Task commands remain available for focused debugging only and must not delay the push. Local `task ci:pr` still mirrors the PR gate for humans/deep debug, using the Docker-context daemon BuildKit builder instead of a shared docker-container. See [coding-bro.md](coding-bro.md), [pull-requests.md § Validation](pull-requests.md#5-validation-github-actions-only), [ci-pipeline.md § Local vs remote CI](ci-pipeline.md#local-vs-remote-ci), and [github-actions-only-validation.md](../dynamic-skills/github-actions-only-validation.md).
12. Prove the latest pushed head with green applicable repository-owned GitHub Actions checks before merge or handoff. Do not escalate to a required local `task ci:pr` after a remote failure — fix, format, push, and wait for the refreshed Actions run.
13. **Docker:** Killing the Docker daemon is **strictly prohibited** — only stop individual containers (`docker stop <id>`). Never `killall docker`, `pkill docker`, etc. See [rules.md §5 — Docker daemon](rules.md#docker-daemon--never-kill-it).
14. **NEVER pipe a long-running command through `| grep`/`| tail`/`| head`/`| sed` (or any filter).** This is a hard rule, not a suggestion. `grep`/`tail`/`head` **buffer their input until the upstream command exits**, so a multi-minute `task setup` / `task check` / `docker buildx bake` shows **zero output** the entire time and is indistinguishable from a hang — you lose all progress visibility and cannot tell "still compiling" from "stuck". Filtering pipes are **never** a performance optimization; they only destroy live output.
    - **Correct:** run the command bare — `NOOK_ENV=dev task setup` — its full output streams live and is saved to the terminal file automatically; filter/inspect it _afterward_ by reading that file.
    - **Also correct:** redirect to a log while it runs — `... > /tmp/build.log 2>&1` — then `grep`/read the file after it finishes (or `tail -f` the file from a _separate_ shell).
    - **Forbidden while the command runs:** `task setup 2>&1 | grep -iE "DONE|error" | tail -40`, `gh run watch ... | tail`, `cargo ... | tail`, etc. If you catch yourself appending `| grep`/`| tail` to a build/test/CI command, STOP and run it bare instead.
15. **Local web dev:** `task web:dev` — do not start host `vite`/`npm` or free `:5173` with blind `kill`.
16. **Testing pyramid:** `task rust:coverage:check` is the primary correctness gate for vault logic (llvm-cov + nextest, **90%** line floor). Target **~99% functional coverage via Rust unit and integration tests** — not e2e. Playwright (`task web:test:e2e:pr`) is a thin UI smoke layer. New domain behavior requires new Rust tests in the same change. **Below 90% line coverage, agents add tests before finishing.** See [rules.md §4](../rules.md#4-testing-requirements).
17. **Cortex + README hygiene:** After learning something durable from tests, CI, or PR review, update `.cortex` per [core-beliefs.md §10](../design-docs/core-beliefs.md#10-grow-cortex-dynamically). When the change is architectural or alters the public developer/product surface, also update the root [`README.md`](../../README.md) in the same PR ([AGENTS.md — Keep the root README current](../AGENTS.md#keep-the-root-readme-current)).
18. **Troubleshooting web/e2e/CI failures:** After test output and static analysis, **always check persisted app logs** — they are the most important source of truth for vault, sync, and WASM behavior. See [logging.md § Debugging, troubleshooting, and CI verification](../references/logging.md#debugging-troubleshooting-and-ci-verification).
19. **Coverage reporting:** `task rust:coverage:export` exports baked portable
    Rust coverage artifacts locally (`summary.txt`, `summary.json`,
    `lcov.info`, and `coverage-floor.json`). PR CI uploads those files plus the
    stripped Linux `nook-preflight` reporter directly from the native Rust
    runner. `Verify and preview` downloads them after its artifact-backed web
    build, builds the base branch coverage target only when comparison fallback
    is required, and asks `nook-preflight` to classify changed coverage inputs,
    validate the commit-keyed base artifact, parse cargo-llvm-cov's structured
    JSON, write typed GitHub outputs, and render the Markdown summary. The
    workflow uploads both reports as `nook-core-coverage` and posts a sticky PR
    comment. Human-readable coverage tables must not be scraped with shell. The
    Docker build remains the enforcement point for the 90% floor and the only
    place PR/base coverage tests run.
20. **Coverage cache preservation:** Warm the `nook-auth2 +
    nook-replication + nook-event-log + nook-core` coverage dependency graph with one
    `cargo llvm-cov nextest --no-report` Docker invocation. Subsequent
    source-level coverage commands must use `--no-clean` so they reuse and
    extend that instrumented target.

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
