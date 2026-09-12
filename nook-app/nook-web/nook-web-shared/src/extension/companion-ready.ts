import initCompanionWasm, {
  extension_passkey_management_scope,
  extension_password_filling_scope,
  extension_sync_provider_credentials_scope,
  extension_vault_access_scope,
  is_extension_connect_scope,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import {
  type ExtensionConnectScopeRuntime,
  ExtensionConnectScope,
} from "./extension-connect-scope";

type BunFileApi = {
  file: (path: string) => {
    exists: () => boolean | Promise<boolean>;
    arrayBuffer: () => Promise<ArrayBuffer>;
  };
};

type CompanionWasmPathSegments = string[];

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
declare const Bun: BunFileApi;
declare const process: {
  cwd?: () => string;
  env?: Record<string, string>;
};

const SEALED_COMPANION_WASM_PATH =
  "/meta-secret/nook/nook-app/nook-web/nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm_bg.wasm";

function chromeRuntimeUrl(path: string): string | false {
  if (
    typeof chrome !== "object" ||
    typeof chrome.runtime?.getURL !== "function"
  ) {
    return false;
  }
  return chrome.runtime.getURL(path);
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

async function companionWasmDiskCandidates(): Promise<string[]> {
  const fromEnv = ((v) => (v ? v : ""))(
    process.env?.NOOK_COMPANION_WASM_PATH?.trim(),
  );
  const cwd = ((v) => (v ? v : ""))(process.cwd?.());
  const join = (...parts: CompanionWasmPathSegments) => parts.join("/");
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
  if (typeof Bun !== "object") {
    return { kind: CompanionWasmBytesKind.Absent };
  }
  const candidates = await companionWasmDiskCandidates();
  for (const candidate of candidates) {
    try {
      const file = Bun.file(candidate);
      if (await file.exists()) {
        return {
          kind: CompanionWasmBytesKind.Present,
          bytes: await file.arrayBuffer(),
        };
      }
    } catch {
      // Try the next Bun file candidate.
    }
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

  const packaged = chromeRuntimeUrl("content/nook_companion_wasm_bg.wasm");
  if (packaged) {
    const packagedBytes = await fetchCompanionWasmBytes(packaged);
    if (packagedBytes.kind === CompanionWasmBytesKind.Present) {
      return {
        kind: CompanionWasmModuleKind.Present,
        moduleOrPath: packagedBytes.bytes,
      };
    }
    throw new Error("packaged companion WASM bytes unavailable");
  }

  // Test hosts without embedded, Bun, or Chrome sources use wasm-bindgen's
  // canonical import.meta.url resolution next to the generated glue.
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
    ExtensionConnectScope.configureExtensionConnectScopeRuntime(scopeRuntime);
  },
);
