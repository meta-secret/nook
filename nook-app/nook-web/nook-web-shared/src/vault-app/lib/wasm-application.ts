export type WasmApplication = "unified-development" | "simple" | "sentinel";

declare const __NOOK_WASM_APPLICATION__: WasmApplication;

/** Application capability configured once inside the shared Rust/WASM engine. */
export const WASM_APPLICATION: WasmApplication = __NOOK_WASM_APPLICATION__;
