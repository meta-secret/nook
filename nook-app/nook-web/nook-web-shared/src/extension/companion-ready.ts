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
  | { kind: CompanionWasmBytesKind.Present; bytes: Uint8Array };

function runningUnderNode(): boolean {
  const nodeProcess = (
    globalThis as { process?: { versions?: { node?: string } } }
  ).process;
  return Boolean(nodeProcess?.versions?.node);
}

function copyWasmBytes(source: ArrayLike<number>): Uint8Array {
  // Fresh ArrayBuffer-backed copy for BufferSource typing across TS DOM libs.
  const bytes = new Uint8Array(source.length);
  bytes.set(source);
  return bytes;
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
      bytes: copyWasmBytes(nodeFs.readFileSync(nodeUrl.fileURLToPath(url))),
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
      bytes: copyWasmBytes(new Uint8Array(await response.arrayBuffer())),
    };
  } catch {
    return { kind: CompanionWasmBytesKind.Absent };
  }
}

async function embeddedCompanionWasmBytes(): Promise<CompanionWasmBytes> {
  // Content-script Bun builds rewrite the .wasm import to inlined bytes so
  // Pilot does not depend on chrome-extension fetch / MIME streaming.
  try {
    // Bun content-script builds rewrite .wasm to inlined Uint8Array exports.
    // @ts-expect-error - no shared ambient *.wasm module type across web packages
    const embedded = await import("./nook-companion-wasm/nook_companion_wasm_bg.wasm");
    if (embedded.default instanceof Uint8Array) {
      return {
        kind: CompanionWasmBytesKind.Present,
        bytes: copyWasmBytes(embedded.default),
      };
    }
  } catch {
    // Node/Vitest resolve the source tree without the Bun wasm-bytes plugin.
  }
  return { kind: CompanionWasmBytesKind.Absent };
}

async function companionWasmModuleOrPath(): Promise<BufferSource | string | URL> {
  const embedded = await embeddedCompanionWasmBytes();
  if (embedded.kind === CompanionWasmBytesKind.Present) {
    return embedded.bytes.buffer as ArrayBuffer;
  }

  const chromeGlobal = (globalThis as { chrome?: ChromeRuntime }).chrome;
  if (chromeGlobal?.runtime?.getURL) {
    const packaged = await fetchCompanionWasmBytes(
      chromeGlobal.runtime.getURL("content/nook_companion_wasm_bg.wasm"),
    );
    if (packaged.kind === CompanionWasmBytesKind.Present) {
      return packaged.bytes.buffer as ArrayBuffer;
    }
    // Bun content bundles sit next to the copied wasm file.
    if (import.meta.url.startsWith("chrome-extension:")) {
      const sibling = await fetchCompanionWasmBytes(
        new URL("nook_companion_wasm_bg.wasm", import.meta.url),
      );
      if (sibling.kind === CompanionWasmBytesKind.Present) {
        return sibling.bytes.buffer as ArrayBuffer;
      }
    }
  }

  const moduleUrl = new URL(
    "./nook-companion-wasm/nook_companion_wasm_bg.wasm",
    import.meta.url,
  );
  const diskBytes = await readCompanionWasmFromDisk(moduleUrl);
  if (diskBytes.kind === CompanionWasmBytesKind.Present) {
    return diskBytes.bytes.buffer as ArrayBuffer;
  }
  const moduleBytes = await fetchCompanionWasmBytes(moduleUrl);
  if (moduleBytes.kind === CompanionWasmBytesKind.Present) {
    return moduleBytes.bytes.buffer as ArrayBuffer;
  }
  return moduleUrl;
}

await initCompanionWasm({
  module_or_path: await companionWasmModuleOrPath(),
});
