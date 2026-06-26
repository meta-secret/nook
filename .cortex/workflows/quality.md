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
   - `cargo test -p nook-core`
   - `svelte-check`
   - `eslint`
   - `prettier --check`
   - `vitest run`
   - `vite build`
7. Build wasm before Svelte checks or web builds.
8. Use `VITE_BASE="/<repo>/"` for GitHub Pages builds.
9. Update `.cortex` docs when checks, tooling, CI, or deploy behavior changes.
10. **CI policy:** PR workflows run `task check` and deploy Cloudflare previews. Playwright e2e runs on push to `main`; GitHub Pages deploy requires the main web build and e2e to pass.
11. Verify locally with `task check`.
12. **Docker:** Never kill the Docker daemon (`killall docker`, `pkill docker`, etc.). Stop only specific containers (`docker stop <id>`). See [rules.md §5 — Docker daemon](rules.md#docker-daemon--never-kill-it).
13. **Local web dev:** `task web:install` then `task web:dev` — do not start host `vite`/`npm` or free `:5173` with blind `kill`.
