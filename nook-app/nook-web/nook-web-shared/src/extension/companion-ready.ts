import initCompanionWasm, {
  extension_passkey_management_scope,
  extension_password_filling_scope,
  extension_sync_provider_credentials_scope,
  extension_vault_access_scope,
  is_extension_connect_scope,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import {
  configureExtensionConnectScopeRuntime,
  type ExtensionConnectScopeRuntime,
} from "./extension-connect-scope";

type ChromeRuntime = {
  runtime?: { getURL?: (path: string) => string };
};

type NodeFsReadFileSync = {
  readFileSync: (path: string) => ArrayLike<number>;
  existsSync: (path: string) => boolean;
};

type NodePathSegments = string[];

type NodePathJoin = {
  join: (...parts: NodePathSegments) => string;
};

type BunFileApi = {
  file: (path: string) => {
    exists: () => boolean | Promise<boolean>;
    arrayBuffer: () => Promise<ArrayBuffer>;
  };
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

const SEALED_COMPANION_WASM_PATH =
  "/meta-secret/nook/nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm_bg.wasm";

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
  let base64: string;
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
  try {
    const loader = new Function("specifier", "return import(specifier);") as (
      specifier: string,
    ) => Promise<TModule>;
    return await loader(specifier);
  } catch {
    // vitest/vite-node can block Function-constructed import(); eval keeps the
    // static source free of `import()` while still loading Node builtins.
    return (await (0, eval)(
      `import(${JSON.stringify(specifier)})`,
    )) as Promise<TModule>;
  }
}

async function companionWasmDiskCandidates(): Promise<string[]> {
  const nodeProcess = (
    globalThis as {
      process?: { cwd?: () => string; env?: Record<string, string> };
    }
  ).process;
  const fromEnv = ((v) => (v ? v : ""))(nodeProcess?.env?.NOOK_COMPANION_WASM_PATH?.trim());
  const cwd = ((v) => (v ? v : ""))(nodeProcess?.cwd?.());
  let join: NodePathJoin["join"] = (...parts: NodePathSegments) =>
    parts.join("/");
  try {
    const nodePath = await importNodeModule<NodePathJoin>("node:path");
    join = nodePath.join.bind(nodePath);
  } catch {
    // Path joins below still work with the POSIX fallback.
  }
  return [
    fromEnv,
    SEALED_COMPANION_WASM_PATH,
    join(
      cwd,
      "nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm_bg.wasm",
    ),
    join(cwd, "src/extension/nook-companion-wasm/nook_companion_wasm_bg.wasm"),
    join(
      cwd,
      "../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm_bg.wasm",
    ),
  ].filter((candidate) => candidate.length > 0);
}

async function readCompanionWasmFromDisk(): Promise<CompanionWasmBytes> {
  if (!runningUnderNode()) {
    return { kind: CompanionWasmBytesKind.Absent };
  }
  const candidates = await companionWasmDiskCandidates();
  const bun = (globalThis as { Bun?: BunFileApi }).Bun;
  if (bun) {
    for (const candidate of candidates) {
      try {
        const file = bun.file(candidate);
        if (await file.exists()) {
          return {
            kind: CompanionWasmBytesKind.Present,
            bytes: await file.arrayBuffer(),
          };
        }
      } catch {
        // Try the next candidate / Node fs fallback.
      }
    }
  }
  try {
    const nodeFs = await importNodeModule<NodeFsReadFileSync>("node:fs");
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

  const diskBytes = await readCompanionWasmFromDisk();
  if (diskBytes.kind === CompanionWasmBytesKind.Present) {
    return {
      kind: CompanionWasmModuleKind.Present,
      moduleOrPath: diskBytes.bytes,
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
    // Node/Bun unit tests often stub chrome.runtime.getURL without a fetchable
    // packaged WASM. Do not hand wasm-bindgen a chrome-extension: URL there —
    // Bun's fetch only accepts http(s)/s3 and the stub would fail the suite.
    if (!runningUnderNode()) {
      return { kind: CompanionWasmModuleKind.Present, moduleOrPath: packaged };
    }
  }

  // Node/Vite unit tests: let wasm-bindgen resolve via import.meta.url next to
  // the generated glue. Content bundles strip that fallback at build time.
  return { kind: CompanionWasmModuleKind.Absent };
}

async function startCompanionWasm(): Promise<unknown> {
  const resolved = await companionWasmModuleOrPath();
  if (resolved.kind === CompanionWasmModuleKind.Present) {
    const nookTypedArgs0_0: Parameters<typeof initCompanionWasm>[0] = {
      module_or_path: resolved.moduleOrPath,
    };
    return initCompanionWasm(nookTypedArgs0_0);
  }
  // Node/Bun last resort: wasm-bindgen resolves via import.meta.url. Extension
  // bun tests need on-disk bytes (or they hit Bun's file: fetch rejection).
  // Web-app vitest installs a fetch mock in setup-wasm for this path.
  return initCompanionWasm();
}

/**
 * Shared companion WASM startup promise.
 *
 * Avoid top-level await and `import.meta` so Chrome classic content scripts can
 * parse the autofill bundle after companion WASM extraction.
 */
export const companionWasmReady: Promise<void> = startCompanionWasm().then(
  () => {
    const scopeRuntime: ExtensionConnectScopeRuntime = {
      extension_vault_access_scope,
      extension_password_filling_scope,
      extension_passkey_management_scope,
      extension_sync_provider_credentials_scope,
      is_extension_connect_scope,
    };
    configureExtensionConnectScopeRuntime(scopeRuntime);
  },
);
