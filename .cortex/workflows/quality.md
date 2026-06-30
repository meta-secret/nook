# Quality and Release

Use this workflow for quality, CI, and deployment changes.

1. Keep the Taskfile as the source of truth for build, lint, test, and check commands.
2. Public Taskfile commands must run project builds/checks inside Docker. CI may install host orchestration tools such as Task, but should call Taskfile tasks for repo behavior.
3. Build Docker images with Docker Buildx Bake through `docker-bake.hcl`. Do **not** use Docker named volumes in `docker run` — GH Actions does not persist them; Rust dep cache is image-baked (cargo-chef + entrypoint seeding). See [ARCHITECTURE.md §7](../ARCHITECTURE.md#7-the-engineering-harness).
4. Use Bun for web tooling. Do not introduce npm commands or Node-only command flows.
5. Prefer official prebuilt release archives downloaded with `curl` for standalone Docker image tools. Avoid `cargo install` when a release archive is available.
6. Preserve these gates unless the task explicitly changes them:
   - `cargo fmt --all -- --check`
   - `cargo clippy -p nook-core --all-targets` and `cargo clippy --release --target wasm32-unknown-unknown -p nook-wasm` (`-D warnings`)
   - `task rust:coverage:check` — `cargo llvm-cov nextest -p nook-core --profile ci` vs `nook-core/coverage-floor.json` (**line coverage must not decrease**)
   - `svelte-check`
   - `eslint`
   - `prettier --check`
   - `vitest run`
   - `vite build`
7. Build wasm before Svelte checks or web builds.
8. Use `VITE_BASE="/<repo>/"` for GitHub Pages builds.
9. Update `.cortex` docs when checks, tooling, CI, or deploy behavior changes.
10. **CI policy:** `.github/workflows/pr.yml` — `task ci:pr:publish` (prepare, verify ‖ web build, **e2e-pr**, buildx push `:latest`, Cloudflare preview). `.github/workflows/main.yml` — prepare, verify ‖ build, then **full stub e2e** in one container. Nightly: `ci:nightly:e2e` (sync-live). E2e uses `127.0.0.1:5173` inside each container — no host `-p 5173`. All jobs use GitHub-hosted `ubuntu-latest` runners (no Blacksmith). Agents: follow [pull-requests.md § Agent pipeline](pull-requests.md#agent-pipeline).
11. **Local CI before push:** Agents run `task check` (minimum) before every push; run `task ci:pr` before opening a PR and after any remote CI failure. Local `task ci:pr` (~3–4 min) mirrors PR gates and avoids repeated 5+ min remote runs for fmt/lint/trivial failures. See [pull-requests.md § Local checks](pull-requests.md#2-local-checks-before-every-push) and [ci-pipeline.md § Local vs remote CI](ci-pipeline.md#local-vs-remote-ci).
12. Verify locally with `task check`; use `task ci:pr` when validating merge readiness.
13. **Docker:** Killing the Docker daemon is **strictly prohibited** — only stop individual containers (`docker stop <id>`). Never `killall docker`, `pkill docker`, etc. See [rules.md §5 — Docker daemon](rules.md#docker-daemon--never-kill-it).
14. **Local web dev:** `task web:dev` — do not start host `vite`/`npm` or free `:5173` with blind `kill`.
15. **Testing pyramid:** `task rust:coverage:check` is the primary correctness gate for vault logic (llvm-cov + nextest, floor in `nook-core/coverage-floor.json`). Target **~99% functional coverage via Rust unit and integration tests** — not e2e. Playwright (`task web:test:e2e:pr`) is a thin UI smoke layer. New domain behavior requires new Rust tests in the same change. **Agents must not decrease line coverage.** See [rules.md §4](../rules.md#4-testing-requirements).
16. **Cortex hygiene:** After learning something durable from tests, CI, or PR review, update `.cortex` per [core-beliefs.md §9](../design-docs/core-beliefs.md#9-grow-cortex-dynamically).
