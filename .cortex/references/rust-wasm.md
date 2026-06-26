# Reference: Rust + WebAssembly (wasm-bindgen)

## 1. Wasm Bindgen Setup
- Use `wasm-bindgen = "0.2.125"` (see workspace `Cargo.toml`).
- Export functions with `#[wasm_bindgen]`. Domain logic stays in `nook-core`; WASM wraps I/O and session state.
- Examples: `connect`, `add_secret`, `filter_secrets`, `generate_password`.

## 2. Compiling for the web
- Build from the workspace root so chef-cached `target/` is reused (do not use `wasm-pack build` inside the crate — it recompiles deps):
  `task wasm:build`
- `wasm-bindgen` and `wasm-opt` (Binaryen 122+) run in the Docker toolchain image.

## 3. Session state (`NookVaultManager`)
- `decrypted_jsonl` — in-memory plaintext session (JSONL)
- `stored_armored` — per-key armored ciphertext cache (incremental saves)
- `crypto` — `nook_core::VaultCrypto` (derived once per connect)
- GitHub/IndexedDB I/O via `reqwest` / `rexie` — not in `nook-core`

## 4. Testing
- Test vault formats, crypto, validation, and passwords in `nook-core` (`cargo test -p nook-core`).
- Use Playwright e2e for UI flows; do not duplicate domain rules in TypeScript tests.

