# Quality and Release

Use this workflow for quality, CI, and deployment changes.

1. Keep the Taskfile as the source of truth for build, lint, test, and check commands.
2. Public Taskfile commands must run project builds/checks inside Docker. CI may install host orchestration tools such as Task, but should call Taskfile tasks for repo behavior.
3. Build Docker images with Docker Buildx Bake through `docker-bake.hcl`. Do **not** use Docker named volumes in `docker run` — GH Actions does not persist them; the Rust dep cache and warm `target/` are baked into the image (cargo-chef), and workspace source is copied into the nook-web image (sealed image, no runtime mount). See [ARCHITECTURE.md §7](../ARCHITECTURE.md#7-the-engineering-harness).
4. Use Bun for web tooling. Do not introduce npm commands or Node-only command flows.
5. Prefer official prebuilt release archives downloaded with `curl` for standalone Docker image tools. Avoid `cargo install` when a release archive is available.
6. Preserve these gates unless the task explicitly changes them:
   - `cargo fmt --all -- --check`
   - `cargo clippy -p nook-core --all-targets` and `cargo clippy --release --target wasm32-unknown-unknown -p nook-wasm` (`-D warnings`)
   - `task rust:coverage:check` — `cargo llvm-cov nextest -p nook-core --profile ci` vs **90%** line floor (`nook-core/coverage-floor.json`)
   - `svelte-check`
   - `eslint`
   - `prettier --check`
   - `vitest run`
   - `vite build`
7. Build wasm before Svelte checks or web builds.
8. Use `VITE_BASE="/<repo>/"` for GitHub Pages builds.
9. Update `.cortex` docs when checks, tooling, CI, or deploy behavior changes.
10. **CI policy:** `.github/workflows/pr.yml` — `task ci:pr:publish` (prepare, verify ‖ web build, **e2e-pr**, buildx push `:latest`, Cloudflare preview). `.github/workflows/main.yml` — prepare, verify ‖ build, then **full stub e2e** in one container. Nightly: `ci:nightly:e2e` (sync-live). E2e uses `127.0.0.1:5173` inside each container — no host `-p 5173`. All jobs use GitHub-hosted `ubuntu-latest` runners (no Blacksmith). Agents: follow [pull-requests.md § Agent pipeline](pull-requests.md#agent-pipeline).
11. **Local CI strategy:** Agents run `task check` (minimum) before the first push; run `task ci:pr` locally until green after any remote CI failure before pushing again. Local `task ci:pr` (~3–4 min) mirrors PR gates and avoids repeated 5+ min remote runs. See [coding-bro.md](coding-bro.md), [pull-requests.md § Local checks](pull-requests.md#2-local-checks-before-every-push), and [ci-pipeline.md § Local vs remote CI](ci-pipeline.md#local-vs-remote-ci).
12. Verify locally with `task check` before opening a PR; escalate to `task ci:pr` after remote failure or for high-risk web changes.
13. **Docker:** Killing the Docker daemon is **strictly prohibited** — only stop individual containers (`docker stop <id>`). Never `killall docker`, `pkill docker`, etc. See [rules.md §5 — Docker daemon](rules.md#docker-daemon--never-kill-it).
14. **NEVER pipe a long-running command through `| grep`/`| tail`/`| head`/`| sed` (or any filter).** This is a hard rule, not a suggestion. `grep`/`tail`/`head` **buffer their input until the upstream command exits**, so a multi-minute `task setup` / `task check` / `docker buildx bake` shows **zero output** the entire time and is indistinguishable from a hang — you lose all progress visibility and cannot tell "still compiling" from "stuck". Filtering pipes are **never** a performance optimization; they only destroy live output.
    - **Correct:** run the command bare — `NOOK_ENV=dev task setup` — its full output streams live and is saved to the terminal file automatically; filter/inspect it *afterward* by reading that file.
    - **Also correct:** redirect to a log while it runs — `... > /tmp/build.log 2>&1` — then `grep`/read the file after it finishes (or `tail -f` the file from a *separate* shell).
    - **Forbidden while the command runs:** `task setup 2>&1 | grep -iE "DONE|error" | tail -40`, `gh run watch ... | tail`, `cargo ... | tail`, etc. If you catch yourself appending `| grep`/`| tail` to a build/test/CI command, STOP and run it bare instead.
15. **Local web dev:** `task web:dev` — do not start host `vite`/`npm` or free `:5173` with blind `kill`.
16. **Testing pyramid:** `task rust:coverage:check` is the primary correctness gate for vault logic (llvm-cov + nextest, **90%** line floor). Target **~99% functional coverage via Rust unit and integration tests** — not e2e. Playwright (`task web:test:e2e:pr`) is a thin UI smoke layer. New domain behavior requires new Rust tests in the same change. **Below 90% line coverage, agents add tests before finishing.** See [rules.md §4](../rules.md#4-testing-requirements).
17. **Cortex hygiene:** After learning something durable from tests, CI, or PR review, update `.cortex` per [core-beliefs.md §10](../design-docs/core-beliefs.md#10-grow-cortex-dynamically).
