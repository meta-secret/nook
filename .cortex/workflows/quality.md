# Quality and Release

Use this workflow for quality, CI, and deployment changes.

1. Keep the Taskfile as the source of truth for build, lint, test, and check commands.
2. Public Taskfile commands must run project builds/checks inside Docker. CI may install host orchestration tools such as Task, but should call Taskfile tasks for repo behavior.
3. Build Docker images with Docker Buildx Bake through `docker-bake.hcl`.
4. Use Bun for web tooling. Do not introduce npm commands or Node-only command flows.
5. Prefer official prebuilt release archives downloaded with `curl` for standalone Docker image tools. Avoid `cargo install` when a release archive is available.
6. Preserve these gates unless the task explicitly changes them:
   - `cargo fmt --all -- --check`
   - `cargo clippy --workspace --all-targets -- -D warnings`
   - `cargo test --workspace`
   - `svelte-check`
   - `eslint`
   - `prettier --check`
   - `vitest run`
   - `vite build`
7. Build wasm before Svelte checks or web builds.
8. Use `VITE_BASE="/<repo>/"` for GitHub Pages builds.
9. Update `.cortex` docs when checks, tooling, CI, or deploy behavior changes.
10. **CI policy:** PR workflows deploy Cloudflare previews only. `task check` and Playwright e2e run on push to `main`; GitHub Pages deploy requires both to pass.
11. Verify locally with `task check`.
12. **Docker:** Never kill the Docker daemon (`killall docker`, `pkill docker`, etc.). Stop only specific containers (`docker stop <id>`). See [rules.md §5 — Docker daemon](rules.md#docker-daemon--never-kill-it).
13. **Local web dev:** `task web:install` then `task web:dev` — do not start host `vite`/`npm` or free `:5173` with blind `kill`.
