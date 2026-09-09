import initNookWasm, {
  configure_vault_application,
  NookVaultManager,
  type VaultApplication,
} from "$app-wasm";

enum AppWasmStartupKind {
  NotStarted = "not-started",
  Initializing = "initializing",
}
type AppWasmStartup =
  | { kind: AppWasmStartupKind.NotStarted }
  | {
      kind: AppWasmStartupKind.Initializing;
      completion: Promise<ReadyVaultApplication>;
    };

/** Manager construction belongs to the initialized, configured runtime. */
export class ReadyVaultApplication {
  private constructor() {}
  static async initialize(
    application: VaultApplication,
  ): Promise<ReadyVaultApplication> {
    await initNookWasm();
    configure_vault_application(application);
    return new ReadyVaultApplication();
  }
  createManager(): NookVaultManager {
    return new NookVaultManager();
  }
}
class VaultApplicationRuntime {
  private startup: AppWasmStartup = { kind: AppWasmStartupKind.NotStarted };
  ensureAppWasm(application: VaultApplication): Promise<ReadyVaultApplication> {
    if (this.startup.kind === AppWasmStartupKind.Initializing)
      return this.startup.completion;
    const completion = ReadyVaultApplication.initialize(application);
    this.startup = { kind: AppWasmStartupKind.Initializing, completion };
    return completion;
  }
}
export const vaultApplicationRuntime = new VaultApplicationRuntime();
