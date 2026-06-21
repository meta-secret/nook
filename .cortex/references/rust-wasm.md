# Reference: Rust + WebAssembly (wasm-bindgen)

## 1. Wasm Bindgen Setup
- Ensure `wasm-bindgen = "=0.2.125"` is used.
- To export a function to JS, decorate it with `#[wasm_bindgen]`:
  ```rust
  #[wasm_bindgen]
  pub fn my_function() -> String {
      "hello".to_string()
  }
  ```

## 2. Compiling with Wasm-pack
- Compile using:
  `wasm-pack build nook-wasm --target web --out-dir ../nook-web/src/lib/nook-wasm --out-name nook_wasm`
- `wasm-opt` (Binaryen) must be version 122+ to correctly compile modern Rust WebAssembly modules with `externref`/`table.grow` support.
