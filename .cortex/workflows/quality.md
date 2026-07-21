# Quality and Release

Use this workflow for quality, CI, and deployment changes.

1. Keep Taskfile as the source of truth for build, lint, test, and check commands. App commands live in `nook-app/Taskfile.yml`; cross-package app tasks live in `nook-app/.task/`, Docker tasks in `nook-app/docker/Taskfile.yml`, and web-family tasks in `nook-app/nook-web/Taskfile.yml` plus `nook-app/nook-web/.task/`. Repository-wide invariant tests live in the standalone root Rust crate `preflight/` and run through `task preflight`. The root `Taskfile.yml` is the repo entrypoint and may also own repo-level non-app tooling.
2. Public Taskfile commands must run project builds/checks inside Docker. CI may install host orchestration tools such as Task, but should call Taskfile tasks for repo behavior.
3. Build Docker images with Docker Buildx Bake through `nook-app/docker-bake.hcl`. Do **not** use Docker named volumes for `target/`, Cargo registries, `node_modules`, or other build outputs; the Rust dep cache and warm `target/` are baked into normal image layers, and workspace source is copied into the nook-web image (sealed image, no runtime mount). The one allowed cache-service volume is `nook-sccache-redis`, which is an optional compiler-output fallback below Docker/cargo-chef and never a correctness input. See [ARCHITECTURE.md §7](../ARCHITECTURE.md#7-the-engineering-harness).
4. Use Bun for web tooling. Do not introduce npm commands or Node-only command flows.
5. Prefer official prebuilt release archives downloaded with `curl` for standalone Docker image tools. Avoid `cargo install` when a release archive is available.
6. Preserve these gates unless the task explicitly changes them:
   - `cd nook-app && cargo fmt --all -- --check`
   - `cd nook-app && cargo clippy -p nook-core -p nook-auth2 --all-targets` and `cd nook-app && cargo clippy --release --target wasm32-unknown-unknown -p nook-wasm` (`-D warnings`)
   - `task rust:coverage:check` — `cd nook-app && cargo llvm-cov nextest -p nook-core -p nook-auth2 --profile ci` vs **90%** line floor (`nook-app/nook-core/coverage-floor.json`)
   - `svelte-check`
   - `eslint`
   - `knip` (`bun run unused`) — unused/unreachable files, exports, and
     dependencies in `nook-web-app` / `nook-web-research` (and any package that
     runs Knip in its check/lint path)
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
10. **CI policy:** `.github/workflows/pr.yml`, `.github/workflows/main.yml`, and `.github/workflows/release.yml` run on GitHub-hosted `ubuntu-latest`. Delivery Bake restores and exports separate GHA v2 scopes for the Rust toolchain, stable Rust dependencies, web dependencies, browser-free web, and e2e web; main seeds the default-branch cache visible to new PRs, while manual PR-head e2e restores those scopes read-only so it cannot replace main's cache with arbitrary PR source. PR runs native Rust on one hosted runner while `PR / Verify and preview` keeps WASM, web verification, and preview deployment on a second runner. The generated WASM package remains local to that runner instead of crossing a third VM; native coverage uses a run-stable artifact name, and the consumer queries the current run attempt and proves its native job completed successfully before accepting the artifact, so cold runs and both failed-job and all-job reruns remain correct. The same-runner web solve retries once after the known immediate BuildKit Dockerfile-load flake; repeated failures still fail the gate. Delivery routes all Task/Bake callers through the hosted `docker-container` builder, does not depend on the daemon's default image store, and never restarts Docker. Release initializes that safe builder from the workflow ref before checking out a requested historical source. Main runs full local-provider and extension e2e and deploys `dev.nokey.sh`, `simple.dev.nokey.sh`, and `sentinel.dev.nokey.sh`; release performs immutable tag validation, main-equivalent verify/e2e, stable production deployment, and GitHub Release publication. Registry BuildKit caches remain forbidden. Nightly: `ci:nightly:e2e` (sync-live), with `ci-fix` on failure. Weekly: `rust-dependency-updates.yml` audits every direct dependency in `nook-app/` and `preflight/`; a finding starts an isolated AI agent, which updates all outdated Rust dependencies and must run `WASM_BUILD_MODE=prod task ci:pr:e2e VITE_BASE=/ VITE_VAULT_SYNC_INTERVAL_MS=1000` before its PR can be merged. `.github/workflows/runner-cleanup.yml` remains on `nook` for registered-host maintenance. E2e uses `127.0.0.1:5173` inside each container — no host `-p 5173`. Agents: follow [pull-requests.md § Agent pipeline](pull-requests.md#agent-pipeline).
11. **GitHub Actions-only product gates:** When functionality for the current iteration is coherent and checkable, agents run `task format` (and the UI demo contract when UI paths change), then commit and push/open/update the PR. Every product check runs on GitHub Actions. Do **not** require `task check`, `task ci:pr`, full suites, builds, or e2e locally for merge or handoff. Optional local Task commands remain available for focused debugging only and must not delay the push. Local `task ci:pr` still mirrors the PR gate with a dedicated persistent BuildKit daemon for humans/deep debug. See [coding-bro.md](coding-bro.md), [pull-requests.md § Validation](pull-requests.md#5-validation-github-actions-only), [ci-pipeline.md § Local vs remote CI](ci-pipeline.md#local-vs-remote-ci), and [github-actions-only-validation.md](../dynamic-skills/github-actions-only-validation.md).
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
19. **Coverage reporting:** `task rust:coverage:export` exports baked `nook-core + nook-auth2` coverage artifacts locally (`summary.txt`, `summary.json`, `lcov.info`, and `coverage-floor.json`). PR CI uploads those files directly from the native Rust runner; the combined WASM/web runner downloads them after its web build, builds the base branch coverage target only when comparison fallback is required, uploads both reports as `nook-core-coverage`, and posts a sticky PR comment. The Docker build remains the enforcement point for the 90% floor and the only place PR/base coverage tests run.
20. **Coverage cache preservation:** Warm the `nook-auth2 + nook-core` coverage dependency graph with one `cargo llvm-cov nextest --no-report` Docker invocation. Both subsequent source-level coverage commands must use `--no-clean` so they reuse and extend that instrumented target. Since llvm-cov forbids `--no-clean` with `--no-report`, the first source-level command emits an interim auth report before the combined core report and floor enforcement.

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
