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
  let base64 = "";
  try {
    // Bun content builds define this identifier. In plain ESM unit tests the
    // binding is absent, and `typeof` still throws ReferenceError in modules.
    base64 =
      typeof __NOOK_COMPANION_WASM_BYTES__ === "string"
        ? __NOOK_COMPANION_WASM_BYTES__
        : "";
  } catch {
    base64 = "";
  }
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

enum CompanionWasmModuleKind {
  Absent = "absent",
  Present = "present",
}

type CompanionWasmModule =
  | { kind: CompanionWasmModuleKind.Absent }
  | {
      kind: CompanionWasmModuleKind.Present;
      moduleOrPath: BufferSource | string;
    };

async function companionWasmModuleOrPath(): Promise<CompanionWasmModule> {
  const embedded = embeddedCompanionWasmBytes();
  if (embedded.kind === CompanionWasmBytesKind.Present) {
    return {
      kind: CompanionWasmModuleKind.Present,
      moduleOrPath: embedded.bytes,
    };
  }

  const chromeGlobal = (globalThis as { chrome?: ChromeRuntime }).chrome;
  if (chromeGlobal?.runtime?.getURL) {
    const packaged = chromeGlobal.runtime.getURL(
      "content/nook_companion_wasm_bg.wasm",
    );
    const packagedBytes = await fetchCompanionWasmBytes(packaged);
    if (packagedBytes.kind === CompanionWasmBytesKind.Present) {
      return {
        kind: CompanionWasmModuleKind.Present,
        moduleOrPath: packagedBytes.bytes,
      };
    }
    return { kind: CompanionWasmModuleKind.Present, moduleOrPath: packaged };
  }

  const diskBytes = await readCompanionWasmFromDisk();
  if (diskBytes.kind === CompanionWasmBytesKind.Present) {
    return {
      kind: CompanionWasmModuleKind.Present,
      moduleOrPath: diskBytes.bytes,
    };
  }

  // Node/Vite unit tests: let wasm-bindgen resolve via import.meta.url next to
  // the generated glue. Content bundles strip that fallback at build time.
  return { kind: CompanionWasmModuleKind.Absent };
}

async function startCompanionWasm(): Promise<unknown> {
  const resolved = await companionWasmModuleOrPath();
  if (resolved.kind === CompanionWasmModuleKind.Present) {
    return initCompanionWasm({ module_or_path: resolved.moduleOrPath });
  }
  return initCompanionWasm();
}

/**
 * Shared companion WASM startup promise.
 *
 * Avoid top-level await and `import.meta` so Chrome classic content scripts can
 * parse the autofill bundle after companion WASM extraction.
 */
export const companionWasmReady: Promise<unknown> = startCompanionWasm();
