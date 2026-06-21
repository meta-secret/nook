# Nook Architecture

Nook is organized as a monorepo with a one-way dependency flow:
```text
nook-core -> nook-wasm -> nook-web
```

## Architectural Domains

### 1. nook-core (Crate)
- **Role**: Domain Logic & Pure Rust.
- **Layering**: Types ➔ Engine ➔ Core.
- **Constraints**: No Wasm-bindgen or Web API dependencies. Completely portable and pure Rust.

### 2. nook-wasm (Crate)
- **Role**: JavaScript / Wasm Boundary Layer.
- **Layering**: Bindings ➔ Conversions ➔ Wasm Exports.
- **Constraints**: Thin translation layer. All domain logic remains in `nook-core`. Data passed across the boundary must be parsed and verified.

### 3. nook-web (Svelte/Vite App)
- **Role**: User Interface.
- **Layering**: Primitives (shadcn-svelte) ➔ Components ➔ App Shell ➔ UI Logic.
- **Constraints**: Consumes the generated wasm package in `src/lib/nook-wasm/`. Direct imports of Rust structures must go through bindgen.

---

## Command Surface & Tooling

All developer environment commands run through [Taskfile.yml](/Users/bynull/coding/crypto/nook/Taskfile.yml) inside the containerized Docker environment.
- Build image: Docker Buildx Bake (`docker-bake.hcl`).
- Runner: Bun (`eslint`, `prettier`, `svelte-check`, `vitest`, `vite`).
- Rust Toolchain: `1.96-bookworm`.
- wasm-opt: Version 122+ to support WebAssembly reference types and avoid `table.grow` runtime issues.
