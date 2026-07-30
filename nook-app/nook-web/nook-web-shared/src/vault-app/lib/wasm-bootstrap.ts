import initNookWasm, { configureVaultApplication } from "$app-wasm";
import { APP_KIND } from "$lib/app-kind";

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
    configureVaultApplication(APP_KIND);
  });
  appWasmStartup = {
    kind: AppWasmStartupKind.Initializing,
    completion: promise,
  };
  return promise;
}
