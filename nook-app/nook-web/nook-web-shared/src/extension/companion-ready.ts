import initCompanionWasm from "./nook-companion-wasm/nook_companion_wasm.js";

function companionWasmUrl(): string | URL {
  if (
    typeof chrome !== "undefined" &&
    chrome.runtime?.getURL &&
    typeof location !== "undefined" &&
    location.protocol === "chrome-extension:"
  ) {
    return chrome.runtime.getURL("content/nook_companion_wasm_bg.wasm");
  }
  return new URL(
    "./nook-companion-wasm/nook_companion_wasm_bg.wasm",
    import.meta.url,
  );
}

await initCompanionWasm({
  module_or_path: companionWasmUrl(),
});
