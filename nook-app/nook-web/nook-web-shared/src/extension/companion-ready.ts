import initCompanionWasm, {
  admit_extension_pairing_vault_type,
  decode_extension_event_log_record,
  extension_passkey_management_scope,
  extension_password_filling_scope,
  extension_sync_provider_credentials_scope,
  extension_vault_access_scope,
} from "./nook-companion-wasm/nook_companion_wasm.js";
import {
  ExtensionEventLogRecordAdmission,
  type ExtensionEventLogRecordRuntime,
} from "./lifecycle-runtime-messages";
import {
  ExtensionConnectScope,
  type ExtensionConnectScopeRuntime,
} from "./extension-connect-scope";
import {
  type ExtensionPairingVaultTypeRuntime,
  extensionPairingVaultType,
} from "./extension-pairing-vault-type";
import {
  COMPANION_WASM_HOST_RESOURCE_PATH,
  COMPANION_WASM_RESOURCE_PATH,
  CompanionWasmHostAdmissionKind,
  CompanionWasmHostMessageAdmission,
  CompanionWasmHostRequestKind,
  CompanionWasmStartup,
  type CompanionWasmHostRequest,
  type CompanionWasmHostResponseAdmissionRequest,
  type CompanionWasmHostTransportValue,
  type CompanionWasmStartupDiagnostic,
  type CompanionWasmStartupDiagnostics,
} from "./companion-wasm-startup";

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
declare const __NOOK_EXTENSION_DIAGNOSTICS_ENABLED__: boolean;

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

class CompanionWasmStartupDiagnosticSink implements CompanionWasmStartupDiagnostics {
  record(diagnostic: CompanionWasmStartupDiagnostic): void {
    if (!this.diagnosticsEnabled()) return;
    console.info("[Nook] companion WASM startup", diagnostic);
  }

  private diagnosticsEnabled(): boolean {
    try {
      return (
        typeof __NOOK_EXTENSION_DIAGNOSTICS_ENABLED__ === "boolean" &&
        __NOOK_EXTENSION_DIAGNOSTICS_ENABLED__
      );
    } catch {
      return false;
    }
  }
}

class ExtensionOriginCompanionWasmModuleLoader {
  private readonly messageAdmission = new CompanionWasmHostMessageAdmission();

  async load(): Promise<WebAssembly.Module> {
    const hostUrl = chromeRuntimeUrl(COMPANION_WASM_HOST_RESOURCE_PATH);
    if (!hostUrl) {
      throw new Error("extension-origin companion WASM host unavailable");
    }
    if (typeof document !== "object" || typeof window !== "object") {
      throw new Error(
        "extension-origin companion WASM host requires a document",
      );
    }
    const extensionOrigin = new URL(hostUrl).origin;
    const companionWasmUrl = chromeRuntimeUrl(COMPANION_WASM_RESOURCE_PATH);
    if (!companionWasmUrl) {
      throw new Error("packaged companion WASM resource unavailable");
    }
    const frame = document.createElement("iframe");
    frame.src = hostUrl;
    frame.hidden = true;
    frame.setAttribute("aria-hidden", "true");
    try {
      return await new Promise<WebAssembly.Module>(
        // eslint-disable-next-line max-params -- Promise executor owns its host callback shape.
        (resolve, reject) => {
          const request: CompanionWasmHostRequest = {
            kind: CompanionWasmHostRequestKind.CompileCompanionModule,
          };
          const timeout = window.setTimeout(() => {
            cleanup();
            reject(new Error("extension-origin companion WASM host timed out"));
          }, 5000);
          const cleanup = (): void => {
            window.clearTimeout(timeout);
            window.removeEventListener("message", handleMessage);
            frame.removeEventListener("load", handleFrameLoad);
          };
          const handleMessage = (
            event: MessageEvent<CompanionWasmHostTransportValue>,
          ): void => {
            const hostWindow = frame.contentWindow;
            if (!hostWindow) return;
            const admissionRequest: CompanionWasmHostResponseAdmissionRequest =
              {
                event,
                expectedSource: hostWindow,
                expectedOrigin: extensionOrigin,
                expectedResourceUrl: companionWasmUrl,
              };
            const admission =
              this.messageAdmission.admitResponse(admissionRequest);
            if (admission.kind === CompanionWasmHostAdmissionKind.Rejected) {
              return;
            }
            cleanup();
            if (admission.kind === CompanionWasmHostAdmissionKind.Accepted) {
              resolve(admission.module);
              return;
            }
            reject(
              new Error("extension-origin companion WASM compilation failed"),
            );
          };
          const handleFrameLoad = (): void => {
            const hostWindow = frame.contentWindow;
            if (!hostWindow) {
              cleanup();
              reject(new Error("extension-origin companion WASM host closed"));
              return;
            }
            hostWindow.postMessage(request, "*");
          };
          window.addEventListener("message", handleMessage);
          frame.addEventListener("load", handleFrameLoad);
          document.documentElement.append(frame);
        },
      );
    } finally {
      frame.remove();
    }
  }
}

async function startEmbeddedCompanionWasm(): Promise<void> {
  const resolved = await companionWasmModuleOrPath();
  if (resolved.kind === CompanionWasmModuleKind.Present) {
    const nookTypedArgs0_0: Parameters<typeof initCompanionWasm>[0] = {
      module_or_path: resolved.moduleOrPath,
    };
    await initCompanionWasm(nookTypedArgs0_0);
    return;
  }
  // Node/Bun last resort: wasm-bindgen resolves via import.meta.url. Extension
  // bun tests need on-disk bytes (or they hit Bun's file: fetch rejection).
  // Web-app vitest installs a fetch mock in setup-wasm for this path.
  await initCompanionWasm();
}

async function startCompanionWasm(): Promise<void> {
  const startup = new CompanionWasmStartup();
  const request: Parameters<typeof startup.initialize>[0] = {
    initializeEmbeddedCompanionWasm: startEmbeddedCompanionWasm,
    loadExtensionOriginCompanionWasmModule: () =>
      new ExtensionOriginCompanionWasmModuleLoader().load(),
    initializeExtensionOriginCompanionWasm: async (module) => {
      const nookTypedArgs0_0: Parameters<typeof initCompanionWasm>[0] = {
        module_or_path: module,
      };
      await initCompanionWasm(nookTypedArgs0_0);
    },
    diagnostics: new CompanionWasmStartupDiagnosticSink(),
  };
  await startup.initialize(request);
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
    };
    ExtensionConnectScope.configureExtensionConnectScopeRuntime(scopeRuntime);
    const eventLogRecordRuntime: ExtensionEventLogRecordRuntime = {
      decode_extension_event_log_record,
    };
    ExtensionEventLogRecordAdmission.configure(eventLogRecordRuntime);
    const vaultTypeRuntime: ExtensionPairingVaultTypeRuntime = {
      admit_extension_pairing_vault_type,
    };
    extensionPairingVaultType.configure(vaultTypeRuntime);
  },
);
