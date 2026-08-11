import initNookWasm, {
  configure_vault_application,
  type VaultApplication,
} from "$app-wasm";

enum AppWasmStartupKind {
  NotStarted = "not-started",
  Initializing = "initializing",
}

type AppWasmStartup =
  | { kind: AppWasmStartupKind.NotStarted }
  | { kind: AppWasmStartupKind.Initializing; completion: Promise<void> };

let appWasmStartup: AppWasmStartup = { kind: AppWasmStartupKind.NotStarted };

/** Initialize the shared engine and bind it to this web app before app code loads. */
export function ensureAppWasm(application: VaultApplication): Promise<void> {
  if (appWasmStartup.kind === AppWasmStartupKind.Initializing) {
    return appWasmStartup.completion;
  }
  const promise = initNookWasm().then(() => {
    configure_vault_application(application);
  });
  appWasmStartup = {
    kind: AppWasmStartupKind.Initializing,
    completion: promise,
  };
  return promise;
}
