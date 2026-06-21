# Nook Coding Rules & Golden Principles

This document defines the strict development standards, architectural boundaries, and validation requirements for the Nook monorepo. All changes must comply with these guidelines.

---

## 1. Monorepo Architecture & Package Boundaries

- **Strict Uni-directional Flow:** The dependency path is strictly `nook-core` ➔ `nook-wasm` ➔ `nook-web`. Circular dependencies or reverse imports (e.g. importing a WASM type inside `nook-core`) are strictly forbidden.
- **`nook-core` Isolation:**
  - Must remain 100% pure Rust.
  - Must not depend on `wasm-bindgen`, `js-sys`, `web-sys`, or any browser Web APIs.
  - Must be fully compilable and testable on native desktop/server targets.
- **`nook-wasm` Bridge Responsibilities:**
  - Exposes Rust structs to JS via `#[wasm_bindgen]`.
  - Performs network/database input/output operations (e.g., IndexedDB, GitHub API).
  - All complex business logic and calculations must be delegated to `nook-core`.

---

## 2. Rust-Wasm Boundary Standards

- **Error Propagation:**
  - All fallible exported `#[wasm_bindgen]` functions must return `Result<T, wasm_bindgen::JsError>`.
  - Do not return string-based errors (e.g., `Result<T, JsValue>`). This allows the JS runtime to catch actual JavaScript `Error` objects with full stack traces.
- **Minimal raw JS Type Exposure:**
  - Avoid raw `JsValue` types unless required by external APIs (like `js_sys::Array::push`).
  - Use strongly-typed structures or system-supported types where possible.
- **Asynchronous Execution:**
  - Use native Rust `async/await` syntax for all asynchronous operations inside WASM.
  - Do not use `JsFuture` or raw JavaScript promises inside Rust.

---

## 3. Svelte 5 & TypeScript UI Standards

- **Reactive State Encapsulation:**
  - Keep components thin and stateless where possible.
  - Store application-wide reactive state and side-effect handlers (e.g. configuration loads, storage fetches, updates) in Svelte 5 state classes defined in `.svelte.ts` files.
  - Use `$state` and `$derived` runes for reactive fields.
- **Subcomponent Bindings:**
  - Bind state class instance fields directly in subcomponents using `bind:property={state.field}`.
- **Separation of Concerns:**
  - Svelte components should only bind data, render layouts, and trigger event calls on the state controller. They must not contain data serialization or direct WebAssembly configuration logic.

---

## 4. Pinned Dependencies & Tooling Constraints

- **Cargo Version Constraints:**
  - Pinned versions must be standard version strings (e.g., `age = "0.11.3"`, `hex = "0.4.3"`).
  - Do not prefix versions with `=` (e.g., `age = "=0.11.3"` is invalid).
  - Do not use semver ranges (`^`, `~`, `>=`, `*`) in dependencies.
- **Bun for Node/JS Tooling:**
  - Svelte project dependencies must be managed using Bun.
  - Do not commit `package-lock.json` or `yarn.lock`. Only `bun.lock` (in gitignore) and `package.json` are permitted.
- **Harness Verification:**
  - All linting, formatting, testing, and production building must run inside the Docker builder image using Taskfile targets.
  - Before committing, developers must run:
    1. `task format` - Automatically formats all Rust and JS/TS/Svelte files.
    2. `task check` - Runs formatting checks, Rust Clippy warnings checks, vitest unit tests, Svelte type checks, and production builds.
