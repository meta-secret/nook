# Nook Architecture

Nook is organized as a monorepo with a one-way dependency flow:

```text
nook-core -> nook-wasm -> nook-web
```

## Packages

`nook-core` owns portable Rust logic and should not depend on wasm or web APIs.

`nook-wasm` is a narrow binding layer. It translates `nook-core` outputs into JavaScript-friendly
functions using `wasm-bindgen`.

`nook-web` is the Bun/Svelte app. It imports the generated wasm package from
`src/lib/nook-wasm`, which is produced by `task wasm:build`. UI primitives follow the
shadcn-svelte default style and live under `src/lib/components/ui`.

## Command Surface

Use [Taskfile.yml](/Users/bynull/coding/crypto/nook/Taskfile.yml) for routine work. Public tasks
run inside the Docker build image defined by `.docker/build.Dockerfile`, and that image is built
through Docker Buildx Bake using `docker-bake.hcl`. Add new commands to Taskfile before wiring
them into CI.

Important tasks:

- `task setup`: build the Docker toolchain image with Buildx Bake and install web dependencies
  with Bun inside Docker.
- `task check`: format checks, lint, tests, and builds.
- `task build`: Rust workspace, wasm package, and web app.
- `task web:dev`: local web development.

## Quality Gates

Rust quality gates are `cargo fmt`, `cargo clippy`, and `cargo test`.

Web quality gates are `svelte-check`, TypeScript, ESLint, Prettier, Vitest, and Vite build. Use
Bun for these commands.

GitHub Pages deploys the `nook-web/dist` artifact from pushes to `main`. CI should install only
host orchestration tools, then call Taskfile tasks so Rust, Bun, and wasm builds happen in Docker.

Standalone binaries in the Docker image should come from official prebuilt release archives via
`curl` when available. Avoid `cargo install` for tool binaries because it compiles dependency
trees in the image build.

When architecture, command surfaces, or quality gates change, update `.cortex` docs, rules,
skills, and subagents in the same change.
