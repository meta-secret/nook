import initCompanionWasm from "./nook-companion-wasm/nook_companion_wasm.js";

type ChromeRuntime = {
  runtime?: { getURL?: (path: string) => string };
};

function companionWasmUrl(): string | URL {
  const chromeGlobal = (globalThis as { chrome?: ChromeRuntime }).chrome;
  if (
    chromeGlobal?.runtime?.getURL &&
    typeof location !== "undefined" &&
    location.protocol === "chrome-extension:"
  ) {
    return chromeGlobal.runtime.getURL("content/nook_companion_wasm_bg.wasm");
  }
  return new URL(
    "./nook-companion-wasm/nook_companion_wasm_bg.wasm",
    import.meta.url,
  );
}

await initCompanionWasm({
  module_or_path: companionWasmUrl(),
});
