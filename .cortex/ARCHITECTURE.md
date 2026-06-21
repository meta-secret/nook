# Nook System Architecture Specification

This document provides a comprehensive guide to Nook's architecture, package boundaries, data flows, and development environments. It serves as the primary technical context map for both human developers and autonomous AI coding agents.

---

## 1. Monorepo Structure & Dependency flow

Nook is built as a modular monorepo using a strict, uni-directional dependency flow. This prevents architectural drift, guarantees separation of concerns, and isolates WebAssembly bindings from core domain code.

```
+-------------------------------------------------------------+
|                         nook-web                            |
|             (Vite + Svelte 5 + TypeScript UI)               |
+-------------------------------------------------------------+
                               |
                               v (consumes generated bindings)
+-------------------------------------------------------------+
|                         nook-wasm                           |
|       (Rust-Wasm Bridge Layer using wasm-bindgen)            |
+-------------------------------------------------------------+
                               |
                               v (core domain dependencies)
+-------------------------------------------------------------+
|                         nook-core                           |
|           (Pure, Portable, Platform-Agnostic Rust)          |
+-------------------------------------------------------------+
```

### Dependency Enforcements
1. **No Circular Dependencies:** Under no circumstances should `nook-core` depend on `nook-wasm` or `nook-web`. Similarly, `nook-wasm` must not depend on `nook-web`.
2. **Platform Portability:** `nook-core` must remain platform-agnostic and compile on native targets (e.g. desktop/server) as well as `wasm32-unknown-unknown`. It must never import Web API symbols (like `window`, `document`, or crate dependencies that require JS environments).

---

## 2. Package Responsibilities & Layers

### A. `nook-core` (The Domain Core)
- **Crypto Engine:** Encryption and decryption utilizing the `age` format (via standard Rust crates).
- **Log Database:** Implements `Database` representing a JSONL (JSON Lines) log. The database reads and writes sorted KV records.
- **Portability:** Restricts imports to standard library features and pure cryptographic crates.

### B. `nook-wasm` (The Translation Layer)
- **Boundary Operations:** Acts as the stateless boundary controller. Extends Rust structs with `#[wasm_bindgen]` wrappers to expose interfaces to JavaScript.
- **Wasm Futures:** Implements asynchronous Rust functions utilizing `async/await` syntax, which wasm-bindgen automatically maps to JavaScript `Promise` targets.
- **Asynchronous Storage Adaptors:**
  - **IndexedDB:** Connects to browser database layers using the `rexie` crate.
  - **GitHub API:** Fetches and commits encrypted log files using `gloo-net` request builders.

### C. `nook-web` (The Presentation Layer)
- **UI Views:** Clean Svelte 5 components using Tailwind CSS for visuals.
- **Reactive Controller:** Utilizes the Svelte 5 class state manager `VaultState` (defined in `src/lib/vault.svelte.ts`) to drive interactions, keep loading markers, and coordinate configuration caches.
- **Wasm Package Integration:** Dynamically imports the compiled WASM package from `src/lib/nook-wasm/`.

---

## 3. Detailed Data Flow & Execution Model

The diagram below outlines how user actions in the Svelte UI trace down to the encrypted storage backend:

```
[Svelte Component] 
       | (clicks "Add Secret")
       v
[VaultState Class] (src/lib/vault.svelte.ts)
       | (calls manager.add_secret(key, value))
       v
[nook-wasm Bridge] (nook-wasm/src/lib.rs)
       | 1. Deserializes JSONL in memory
       | 2. Inserts key-value pair
       | 3. Serializes database back to sorted JSONL
       v
[nook-core Engine] (nook-core/src/lib.rs)
       | (runs encrypt(jsonl, passphrase) via age format)
       v
[nook-wasm Bridge]
       | (saves encrypted hex representation)
       +-----------------------+-----------------------+
                               |                       |
                  (if storage_mode == "local")   (if storage_mode == "github")
                               |                       |
                               v                       v
                         [IndexedDB]             [GitHub API]
                     (via rexie store)       (via gloo-net PUT request)
```

### Memory & State Lifetimes
1. **Passphrase Handling:** The encryption passphrase exists only in browser memory or Svelte state during active vault sessions. If user allows localStorage persistence, it is cached there, but the core design relies on in-memory wasm state.
2. **Database Cache:** The decrypted database payload (JSONL format) is cached in-memory inside the Rust `NookVaultManager` struct instance. No plaintext is ever written to IndexedDB or GitHub.

---

## 4. Cryptographic Envelope & Storage Specs

- **Encryption Format:** Age format (RFC-compliant) using scrypt-based key derivation.
- **Storage Encodings:**
  - Plaintxt (JSONL database) is encrypted inside `nook-core` using a user passphrase.
  - The resulting binary payload is encoded as a hexadecimal string (`hex::encode`).
  - For local storage, the hex string is saved under the key `encrypted_db` in the IndexedDB `vault` store.
  - For remote storage, the hex string is decoded back to binary bytes, base64-encoded, and sent via the GitHub PUT API to the specified repository file path.

---

## 5. Boundary Error Propagation Model

To maintain maximum safety and clear diagnostic tracing, the bridge layer does not use raw JS values (`JsValue`) for exceptions.
- **Rust to JS Errors:** All fallible WASM methods return `Result<T, wasm_bindgen::JsError>`.
- **Automatic Conversion:** Standard Rust error types (implementing `Display` or `std::error::Error`) are mapped to `JsError` instances using `JsError::new(...)` or using the `?` operator.
- **Front-end Catching:** In Svelte/TypeScript, this is captured in standard `try/catch` blocks. The caught object is a native JavaScript `Error` with a message and stack trace.

---

## 6. The Engineering Harness

All development tasks must be executed containerized inside the Docker environment using the `Taskfile` to ensure reproducibility:

- **Build Target:** `wasm32-unknown-unknown` compiled via `wasm-pack`.
- **Target Web Config:** Target output is compiled to the `web` target, outputting ES modules loaded dynamically.
- **Optimization Pipeline:** Production builds use `wasm-opt` (v122+) to minimize size and optimize table layouts.
