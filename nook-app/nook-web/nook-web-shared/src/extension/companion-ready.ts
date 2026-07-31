import initCompanionWasm from "./nook-companion-wasm/nook_companion_wasm.js";

type ChromeRuntime = {
  runtime?: { getURL?: (path: string) => string };
};

type NodeFsReadFileSync = {
  readFileSync: (path: string) => ArrayLike<number>;
  existsSync: (path: string) => boolean;
};

type NodePathJoin = {
  join: (...parts: string[]) => string;
};

enum CompanionWasmBytesKind {
  Absent = "absent",
  Present = "present",
}

type CompanionWasmBytes =
  | { kind: CompanionWasmBytesKind.Absent }
  | { kind: CompanionWasmBytesKind.Present; bytes: ArrayBuffer };

/**
 * Optional base64 payload injected by the extension content-script Bun define.
 * Must stay free of `import.meta` so classic content-script bundles can parse.
 */
declare const __NOOK_COMPANION_WASM_BYTES__: string;

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

function embeddedCompanionWasmBytes(): CompanionWasmBytes {
  const base64 =
    typeof __NOOK_COMPANION_WASM_BYTES__ === "string"
      ? __NOOK_COMPANION_WASM_BYTES__
      : "";
  if (base64.length === 0) {
    return { kind: CompanionWasmBytesKind.Absent };
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return { kind: CompanionWasmBytesKind.Present, bytes: bytes.buffer };
}

async function importNodeModule<TModule>(specifier: string): Promise<TModule> {
  // Keep `import()` out of the classic content-script parse tree; Chrome rejects
  // bare dynamic import syntax even when the Node branch never runs.
  const loader = new Function(
    "specifier",
    "return import(specifier);",
  ) as (specifier: string) => Promise<TModule>;
  return loader(specifier);
}

async function readCompanionWasmFromDisk(): Promise<CompanionWasmBytes> {
  if (!runningUnderNode()) {
    return { kind: CompanionWasmBytesKind.Absent };
  }
  try {
    const [nodeFs, nodePath] = await Promise.all([
      importNodeModule<NodeFsReadFileSync>("node:fs"),
      importNodeModule<NodePathJoin>("node:path"),
    ]);
    const nodeProcess = (
      globalThis as { process?: { cwd?: () => string; env?: Record<string, string> } }
    ).process;
    const fromEnv = nodeProcess?.env?.NOOK_COMPANION_WASM_PATH?.trim() ?? "";
    const candidates = [
      fromEnv,
      nodePath.join(
        nodeProcess?.cwd?.() ?? "",
        "nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm_bg.wasm",
      ),
      nodePath.join(
        nodeProcess?.cwd?.() ?? "",
        "src/extension/nook-companion-wasm/nook_companion_wasm_bg.wasm",
      ),
      nodePath.join(
        nodeProcess?.cwd?.() ?? "",
        "../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm_bg.wasm",
      ),
    ].filter((candidate) => candidate.length > 0);
    for (const candidate of candidates) {
      if (!nodeFs.existsSync(candidate)) {
        continue;
      }
      return {
        kind: CompanionWasmBytesKind.Present,
        bytes: toArrayBuffer(nodeFs.readFileSync(candidate)),
      };
    }
  } catch {
    return { kind: CompanionWasmBytesKind.Absent };
  }
  return { kind: CompanionWasmBytesKind.Absent };
}

async function fetchCompanionWasmBytes(
  url: string,
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

async function companionWasmModuleOrPath(): Promise<BufferSource | string> {
  const embedded = embeddedCompanionWasmBytes();
  if (embedded.kind === CompanionWasmBytesKind.Present) {
    return embedded.bytes;
  }

  const chromeGlobal = (globalThis as { chrome?: ChromeRuntime }).chrome;
  if (chromeGlobal?.runtime?.getURL) {
    const packaged = chromeGlobal.runtime.getURL(
      "content/nook_companion_wasm_bg.wasm",
    );
    const packagedBytes = await fetchCompanionWasmBytes(packaged);
    if (packagedBytes.kind === CompanionWasmBytesKind.Present) {
      return packagedBytes.bytes;
    }
    return packaged;
  }

  const diskBytes = await readCompanionWasmFromDisk();
  if (diskBytes.kind === CompanionWasmBytesKind.Present) {
    return diskBytes.bytes;
  }
  throw new Error("Companion WASM bytes are unavailable in this runtime.");
}

/**
 * Shared companion WASM startup promise.
 *
 * Avoid top-level await and `import.meta` so Chrome classic content scripts can
 * parse the autofill bundle after companion WASM extraction.
 */
export const companionWasmReady: Promise<unknown> = initCompanionWasm({
  module_or_path: companionWasmModuleOrPath(),
});
