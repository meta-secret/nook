import initCompanionWasm from "./nook-companion-wasm/nook_companion_wasm.js";

type ChromeRuntime = {
  runtime?: { getURL?: (path: string) => string };
};

type NodeFsReadFileSync = {
  readFileSync: (path: string) => ArrayLike<number>;
};

type NodeUrlFileURLToPath = {
  fileURLToPath: (url: URL) => string;
};

enum CompanionWasmBytesKind {
  Absent = "absent",
  Present = "present",
}

type CompanionWasmBytes =
  | { kind: CompanionWasmBytesKind.Absent }
  | { kind: CompanionWasmBytesKind.Present; bytes: ArrayBuffer };

function runningUnderNode(): boolean {
  const nodeProcess = (
    globalThis as { process?: { versions?: { node?: string } } }
  ).process;
  return Boolean(nodeProcess?.versions?.node);
}

function toArrayBuffer(source: ArrayLike<number>): ArrayBuffer {
  const bytes = new Uint8Array(source.length);
  bytes.set(source);
  return bytes.buffer;
}

async function readCompanionWasmFromDisk(url: URL): Promise<CompanionWasmBytes> {
  if (!runningUnderNode() || url.protocol !== "file:") {
    return { kind: CompanionWasmBytesKind.Absent };
  }
  // Playwright loads this module in Node with a file: WASM URL, where fetch
  // is unavailable. Keep Node module names as runtime strings so browser
  // svelte-check stays free of @types/node.
  const nodeFsModule = "node:fs";
  const nodeUrlModule = "node:url";
  try {
    const [nodeFs, nodeUrl] = (await Promise.all([
      import(/* @vite-ignore */ nodeFsModule),
      import(/* @vite-ignore */ nodeUrlModule),
    ])) as [NodeFsReadFileSync, NodeUrlFileURLToPath];
    return {
      kind: CompanionWasmBytesKind.Present,
      bytes: toArrayBuffer(
        nodeFs.readFileSync(nodeUrl.fileURLToPath(url)),
      ),
    };
  } catch {
    return { kind: CompanionWasmBytesKind.Absent };
  }
}

async function fetchCompanionWasmBytes(
  url: string | URL,
): Promise<CompanionWasmBytes> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { kind: CompanionWasmBytesKind.Absent };
    }
    return {
      kind: CompanionWasmBytesKind.Present,
      bytes: toArrayBuffer(new Uint8Array(await response.arrayBuffer())),
    };
  } catch {
    return { kind: CompanionWasmBytesKind.Absent };
  }
}

async function companionWasmModuleOrPath(): Promise<BufferSource | string | URL> {
  const chromeGlobal = (globalThis as { chrome?: ChromeRuntime }).chrome;
  if (chromeGlobal?.runtime?.getURL) {
    // Packaged content bundles copy wasm beside the script.
    if (import.meta.url.startsWith("chrome-extension:")) {
      const sibling = await fetchCompanionWasmBytes(
        new URL("nook_companion_wasm_bg.wasm", import.meta.url),
      );
      if (sibling.kind === CompanionWasmBytesKind.Present) {
        return sibling.bytes;
      }
    }
    const packaged = chromeGlobal.runtime.getURL(
      "content/nook_companion_wasm_bg.wasm",
    );
    const packagedBytes = await fetchCompanionWasmBytes(packaged);
    if (packagedBytes.kind === CompanionWasmBytesKind.Present) {
      return packagedBytes.bytes;
    }
    return packaged;
  }

  const moduleUrl = new URL(
    "./nook-companion-wasm/nook_companion_wasm_bg.wasm",
    import.meta.url,
  );
  const diskBytes = await readCompanionWasmFromDisk(moduleUrl);
  if (diskBytes.kind === CompanionWasmBytesKind.Present) {
    return diskBytes.bytes;
  }
  const moduleBytes = await fetchCompanionWasmBytes(moduleUrl);
  if (moduleBytes.kind === CompanionWasmBytesKind.Present) {
    return moduleBytes.bytes;
  }
  return moduleUrl;
}

/**
 * Shared companion WASM startup promise.
 *
 * Intentionally not top-level await: Chrome classic content scripts reject TLA
 * at parse time, which left Pilot completely unmounted after companion WASM
 * extraction.
 */
export const companionWasmReady: Promise<unknown> = initCompanionWasm({
  module_or_path: companionWasmModuleOrPath(),
});
