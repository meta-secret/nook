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

function runningUnderNode(): boolean {
  const nodeProcess = (
    globalThis as { process?: { versions?: { node?: string } } }
  ).process;
  return Boolean(nodeProcess?.versions?.node);
}

async function readCompanionWasmFromDisk(url: URL): Promise<Uint8Array | null> {
  if (!runningUnderNode() || url.protocol !== "file:") {
    return null;
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
    return new Uint8Array(
      nodeFs.readFileSync(nodeUrl.fileURLToPath(url)),
    );
  } catch {
    return null;
  }
}

async function fetchCompanionWasmBytes(
  url: string | URL,
): Promise<Uint8Array | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

async function embeddedCompanionWasmBytes(): Promise<Uint8Array | null> {
  // Content-script Bun builds rewrite the .wasm import to inlined bytes so
  // Pilot does not depend on chrome-extension fetch / MIME streaming.
  try {
    const embedded = (await import("./nook-companion-wasm/nook_companion_wasm_bg.wasm")) as {
      default?: unknown;
    };
    if (embedded.default instanceof Uint8Array) {
      return embedded.default;
    }
  } catch {
    // Node/Vitest resolve the source tree without the Bun wasm-bytes plugin.
  }
  return null;
}

async function companionWasmModuleOrPath(): Promise<BufferSource | string | URL> {
  const embedded = await embeddedCompanionWasmBytes();
  if (embedded) {
    return embedded;
  }

  const chromeGlobal = (globalThis as { chrome?: ChromeRuntime }).chrome;
  if (chromeGlobal?.runtime?.getURL) {
    const packaged = chromeGlobal.runtime.getURL(
      "content/nook_companion_wasm_bg.wasm",
    );
    const packagedBytes = await fetchCompanionWasmBytes(packaged);
    if (packagedBytes) {
      return packagedBytes;
    }
    // Bun content bundles sit next to the copied wasm file.
    if (import.meta.url.startsWith("chrome-extension:")) {
      const sibling = new URL("nook_companion_wasm_bg.wasm", import.meta.url);
      const siblingBytes = await fetchCompanionWasmBytes(sibling);
      if (siblingBytes) {
        return siblingBytes;
      }
    }
  }

  const moduleUrl = new URL(
    "./nook-companion-wasm/nook_companion_wasm_bg.wasm",
    import.meta.url,
  );
  const diskBytes = await readCompanionWasmFromDisk(moduleUrl);
  if (diskBytes) {
    return diskBytes;
  }
  const moduleBytes = await fetchCompanionWasmBytes(moduleUrl);
  if (moduleBytes) {
    return moduleBytes;
  }
  return moduleUrl;
}

await initCompanionWasm({
  module_or_path: await companionWasmModuleOrPath(),
});
