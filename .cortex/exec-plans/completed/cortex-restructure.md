# Completed Plan: Cortex Restructure & Docker Toolchain Upgrades

## What Changed

### 1. Cortex Directory Restructure
Restructured `.cortex` from an overengineered skill/subagent hierarchy into a flat, harness-engineering-style layout.
- **Entry point (`AGENTS.md`)**: Replaced `README.md` with a compact orientation table of contents.
- **Rules & Architecture**: Kept rules/architecture files clean and concise.
- **Flat Workflows**: Moved old SKILL.md content to `.cortex/workflows/monorepo.md` and `.cortex/workflows/quality.md`, removing YAML frontmatter.
- **Integration**: Added `CODEX.md` and `.cursor/rules.md` at root pointing to `.cortex/AGENTS.md`.

### 2. Pinned Precise Versions
- Pinned all dependencies to exact versions (removed `^`, `~`, etc.) across:
  - `nook-app/nook-core/Cargo.toml` (`serde = "=1.0.228"`)
  - `nook-app/nook-wasm/Cargo.toml` (`serde_json = "=1.0.150"`, `wasm-bindgen = "=0.2.125"`)
  - `nook-app/nook-web/package.json` (all 22 dependencies pinned to exact versions)
- Added strict rules to `.cortex/rules.md` to prevent any future semver ranges.

### 3. Upgraded Outdated JS Packages
- Upgraded the 4 requested packages to their latest major versions inside `nook-app/nook-web/package.json`:
  - `@lucide/svelte`: `0.561.0` ➔ `1.21.0`
  - `eslint`: `9.39.4` ➔ `10.5.0`
  - `globals`: `16.5.0` ➔ `17.6.0`
  - `prettier-plugin-svelte`: `3.5.2` ➔ `4.1.1`

### 4. Relocated & Modernized Dockerfile
- Moved Dockerfile from `.docker/build.Dockerfile` to `Dockerfile` at the project root (removing pointless nesting in `.docker/`).
- Updated `nook-app/docker-bake.hcl` to point to the new app root path.
- Upgraded the Rust base image from `1.94-bookworm` to `1.96-bookworm` to match the host system.
- Structured layers for system package installations, Bun installation, Task installation, Rust toolchain setup, and binary installations to optimize Docker caching.

### 5. Fixed `table.grow` WebAssembly Runtime Error
- **The Issue**: The system-installed version of `binaryen` in Debian bookworm is version 108, which is outdated and corrupts/strips WebAssembly `externref` table structures during `wasm-opt` optimization.
- **The Fix**: Modified the Dockerfile to download the precompiled official release of **Binaryen version 122** directly. `wasm-pack` now automatically uses this modern `wasm-opt`, resolving the `WebAssembly.Table.grow()` crash.
