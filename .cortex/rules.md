# Nook Rules & Golden Principles

Keep these rules current when code, tooling, commands, or architecture changes.

---

## 1. Golden Principles for Agent Development
* **Strict Package Boundaries**: Never allow cycles or reverse dependencies. The flow must strictly follow: `nook-core` ➔ `nook-wasm` ➔ `nook-web`.
* **Validation at Boundaries**: Do not probe data "YOLO-style" across package/language boundaries. Parse data structures completely at the WASM/JS interface using strict typings and conversions.
* **Unified Tooling Interface**: Always use `Taskfile.yml` tasks (`task setup`, `task check`, `task build`) to interface with the code. Never invoke raw cargo, bun, prettier, or vite commands on the host directly.
* **Hermetic Environment**: All dependency installation, code compilation, and checks must run containerized in the Docker build image (`nook-build:local`) to prevent host-specific environment drift.

---

## 2. Hard Tooling Constraints
* **Pinned Dependency Versions**: Pin all dependencies strictly to exact versions. No semver ranges (`^`, `~`, `>=`, `*`, `"0.2"`, `"1"`). Use `=x.y.z` in `Cargo.toml` and bare `x.y.z` in `package.json`.
* **JS Tooling**: Use Bun only. Do not commit `package-lock.json` or `yarn.lock`.
* **Docker Builds**: Use Docker Buildx Bake (`docker-bake.hcl`). Do not add plain `docker build` scripts.
* **Binary Installation**: Prefer downloading official precompiled release archives with `curl` in Dockerfiles instead of compiling with `cargo install`.

---

## 3. Package Responsibilities
* **`nook-core`**: Reusable pure Rust business/crypto logic. No Web or Wasm-bindgen dependencies.
* **`nook-wasm`**: Wasm boundary layer. Performs conversion logic and registers exports. Keep logic to a minimum.
* **`nook-web`**: Svelte UI frontend, consuming the generated wasm pkg in `src/lib/nook-wasm/`.
