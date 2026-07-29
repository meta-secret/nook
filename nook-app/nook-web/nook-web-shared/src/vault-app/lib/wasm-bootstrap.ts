import initNookWasm, { configureVaultApplication } from "$app-wasm";
import { WASM_APPLICATION } from "$lib/wasm-application";

enum AppWasmStartupKind {
  NotStarted = "not-started",
  Initializing = "initializing",
}

type AppWasmStartup =
  | { kind: AppWasmStartupKind.NotStarted }
  | { kind: AppWasmStartupKind.Initializing; completion: Promise<void> };

let appWasmStartup: AppWasmStartup = { kind: AppWasmStartupKind.NotStarted };

/** Initialize the shared engine and bind it to this web app before app code loads. */
export function ensureAppWasm(): Promise<void> {
  if (appWasmStartup.kind === AppWasmStartupKind.Initializing) {
    return appWasmStartup.completion;
  }
  const promise = initNookWasm().then(() => {
    configureVaultApplication(WASM_APPLICATION);
  });
  appWasmStartup = {
    kind: AppWasmStartupKind.Initializing,
    completion: promise,
  };
  return promise;
}
