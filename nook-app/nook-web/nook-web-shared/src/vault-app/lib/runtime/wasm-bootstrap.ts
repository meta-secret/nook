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

/** Owns the browser runtime resources shared by these interactions. */
class VaultApplicationRuntime {
  private appWasmStartup: AppWasmStartup = {
    kind: AppWasmStartupKind.NotStarted,
  };
  ensureAppWasm(application: VaultApplication): Promise<void> {
    if (this.appWasmStartup.kind === AppWasmStartupKind.Initializing) {
      return this.appWasmStartup.completion;
    }
    const promise = initNookWasm().then(() => {
      configure_vault_application(application);
    });
    this.appWasmStartup = {
      kind: AppWasmStartupKind.Initializing,
      completion: promise,
    };
    return promise;
  }
}

export const vaultApplicationRuntime = new VaultApplicationRuntime();
