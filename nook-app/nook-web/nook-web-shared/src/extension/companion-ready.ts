import initCompanionWasm from "./nook-companion-wasm/nook_companion_wasm.js";

type ChromeRuntime = {
  runtime?: { getURL?: (path: string) => string };
};

enum CompanionWasmSourceKind {
  ExtensionUrl = "extension-url",
  ModuleUrl = "module-url",
}

type CompanionWasmSource =
  | { kind: CompanionWasmSourceKind.ExtensionUrl; url: string }
  | { kind: CompanionWasmSourceKind.ModuleUrl; url: URL };

function companionWasmSource(): CompanionWasmSource {
  const chromeGlobal = (globalThis as { chrome?: ChromeRuntime }).chrome;
  const locationGlobal = (globalThis as { location?: Location }).location;
  if (
    chromeGlobal?.runtime?.getURL &&
    locationGlobal?.protocol === "chrome-extension:"
  ) {
    return {
      kind: CompanionWasmSourceKind.ExtensionUrl,
      url: chromeGlobal.runtime.getURL("content/nook_companion_wasm_bg.wasm"),
    };
  }
  return {
    kind: CompanionWasmSourceKind.ModuleUrl,
    url: new URL(
      "./nook-companion-wasm/nook_companion_wasm_bg.wasm",
      import.meta.url,
    ),
  };
}

function runningUnderNode(): boolean {
  const nodeProcess = (
    globalThis as { process?: { versions?: { node?: string } } }
  ).process;
  return Boolean(nodeProcess?.versions?.node);
}

type NodeFsReadFileSync = {
  readFileSync: (path: string) => Uint8Array;
};

type NodeUrlFileURLToPath = {
  fileURLToPath: (url: URL) => string;
};

async function companionWasmModuleOrPath(
  source: CompanionWasmSource,
): Promise<BufferSource | string | URL> {
  if (
    source.kind === CompanionWasmSourceKind.ModuleUrl &&
    runningUnderNode()
  ) {
    // Playwright/Bun load this module in Node, where file: fetch is unavailable.
    // Keep Node module names as runtime strings so browser svelte-check stays
    // free of @types/node.
    const nodeFsModule = "node:fs";
    const nodeUrlModule = "node:url";
    const [nodeFs, nodeUrl] = (await Promise.all([
      import(/* @vite-ignore */ nodeFsModule),
      import(/* @vite-ignore */ nodeUrlModule),
    ])) as [NodeFsReadFileSync, NodeUrlFileURLToPath];
    return nodeFs.readFileSync(nodeUrl.fileURLToPath(source.url));
  }
  if (source.kind === CompanionWasmSourceKind.ExtensionUrl) {
    return source.url;
  }
  return source.url;
}

await initCompanionWasm({
  module_or_path: await companionWasmModuleOrPath(companionWasmSource()),
});
