# Nook

Nook is a monorepo for Rust-first crypto tooling with a web surface.

## Projects

- `nook-core`: Rust crate for core logic shared by every runtime.
- `nook-wasm`: Rust and `wasm-bindgen` wrapper that exposes `nook-core` to JavaScript.
- `nook-web`: Bun, Vite, Svelte, shadcn-svelte, and TypeScript app that consumes the
  generated wasm package.

## Commands

All routine commands live in [Taskfile.yml](/Users/bynull/coding/crypto/nook/Taskfile.yml).
Builds and checks run inside Docker, so the host does not need Rust, Bun, wasm-pack, npm, or
Node commands. The Docker toolchain image is built with Docker Buildx Bake.

```sh
task setup
task check
task build
task web:dev
task web:test:e2e          # full Playwright suite (Docker)
task web:test:e2e:local    # connect + local vault only
```

`task setup` builds the local Docker toolchain image with `docker buildx bake` and installs web
dependencies with Bun inside Docker.

GitHub e2e tests read `NOOK_GITHUB_PAT` from the environment or from
`nook-web/.env.test.local` (see `nook-web/.env.test.example`). Cleanup runs automatically via
Task defer after `web:test:e2e`.

When adding tools to the Docker image, prefer official release archives downloaded with `curl`
over `cargo install` for standalone binaries.

## CI/CD

GitHub Actions sets up Docker Buildx, runs formatting, linting, tests, and builds through
Taskfile tasks. Pushes to `main` deploy `nook-web` to GitHub Pages.
