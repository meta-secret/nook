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
  - Holds WASM session state (`decrypted_jsonl`, `stored_armored`, `VaultCrypto`).
  - All complex business logic (crypto, formats, validation, password generation, search) must live in `nook-core` and be tested there.

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
  - Svelte components should only bind data, render layouts, and trigger event calls on the state controller.
  - They must not contain vault serialization, encryption, validation, password generation, or secret filtering logic — those belong in `nook-core` with Rust tests.

---

## 4. Testing Requirements

- **Vault domain logic:** Add or update tests in `nook-core` (`cargo test -p nook-core`). Prefer module unit tests; use `tests/vault_workflow.rs` for end-to-end vault save paths.
- **UI / integration:** Playwright e2e in `nook-web/e2e/` — run via `task web:test:e2e:local`; do not invoke Playwright directly on the host.
- **Do not** re-implement vault rules in TypeScript for testing — if TS needs behavior, expose it from WASM/core first.

---

## 5. Pinned Dependencies & Tooling Constraints

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

---

## 6. Git & Pull Request Workflow

- **Never push directly to `main`.** All changes land on `main` only through merged pull requests.
- **Always use a feature branch.** Branch from `main`, commit there, and push the branch — not `main`.
- **Always open a pull request.** After pushing a branch, create a PR with a summary and test plan; do not merge or push to `main` yourself unless the user explicitly asks.
- **Verify before requesting review.** Run `task format` and `task check` on the branch before opening or updating the PR.
