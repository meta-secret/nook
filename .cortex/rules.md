# Nook Rules

Keep these rules current when code, tooling, commands, or architecture changes.

## AI Context

- Update `.cortex` docs, skills, subagents, and rules in the same change that modifies project
  architecture, workflows, command surfaces, or quality gates.
- Keep AI-facing docs operational and concise. They should describe how to work in this repo, not
  duplicate every implementation detail.

## Tooling

- Use Taskfile as the command surface.
- Run project builds, checks, tests, and web dependency installs inside Docker through Taskfile.
- Use Bun for JavaScript tooling. Do not add npm commands, npm lockfiles, or Node-only command
  flows.
- Build Docker images with Docker Buildx Bake. Do not add plain `docker build` workflows.
- Prefer official prebuilt release archives downloaded with `curl` for standalone binaries in
  Docker images. Avoid `cargo install` for tool binaries when a release archive is available.
- Pin all dependency versions to exact values. No semver ranges (`^`, `~`, `>=`, `*`, `"0.2"`,
  `"1"`). Use `=x.y.z` in Cargo.toml and bare `x.y.z` in package.json.

## Package Boundaries

- Preserve the one-way dependency flow: `nook-core -> nook-wasm -> nook-web`.
- Keep reusable Rust logic in `nook-core`.
- Keep wasm-specific conversion in `nook-wasm`.
- Keep Svelte and shadcn-svelte UI concerns in `nook-web`.
