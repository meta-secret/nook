import { err, ok, type Result } from "neverthrow";
import initNookWasm, {
  configure_vault_application,
  NookVaultManager,
  type VaultApplication,
} from "$app-wasm";

export enum VaultEngineFailure {
  Initialization = "initialization",
  ManagerCreation = "manager-creation",
  Timeout = "timeout",
}
type ApplicationStartup = Result<ReadyVaultApplication, VaultEngineFailure>;
enum AppWasmStartupKind {
  NotStarted = "not-started",
  Initializing = "initializing",
}
type AppWasmStartup =
  | { kind: AppWasmStartupKind.NotStarted }
  | {
      kind: AppWasmStartupKind.Initializing;
      completion: Promise<ApplicationStartup>;
    };

/** Construction is possible only after the browser module has initialized. */
export class ReadyVaultApplication {
  private constructor() {}
  static async initialize(
    application: VaultApplication,
  ): Promise<ApplicationStartup> {
    try {
      await initNookWasm();
      configure_vault_application(application);
      return ok(new ReadyVaultApplication());
    } catch {
      return err(VaultEngineFailure.Initialization);
    }
  }
  createManager(): Result<NookVaultManager, VaultEngineFailure> {
    try {
      return ok(new NookVaultManager());
    } catch {
      return err(VaultEngineFailure.ManagerCreation);
    }
  }
}
class VaultApplicationRuntime {
  private startup: AppWasmStartup = { kind: AppWasmStartupKind.NotStarted };
  ensureAppWasm(application: VaultApplication): Promise<ApplicationStartup> {
    if (this.startup.kind === AppWasmStartupKind.Initializing)
      return this.startup.completion;
    const completion = ReadyVaultApplication.initialize(application);
    this.startup = { kind: AppWasmStartupKind.Initializing, completion };
    return completion;
  }
}
export const vaultApplicationRuntime = new VaultApplicationRuntime();

enum StartupRequestState {
  Pending = "pending",
  Expired = "expired",
}

/** A timed-out request never creates a late manager or leaks its keys. */
export class VaultManagerStartup {
  private state = StartupRequestState.Pending;
  constructor(private readonly application: VaultApplication) {}
  async open(): Promise<Result<NookVaultManager, VaultEngineFailure>> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.state = StartupRequestState.Expired;
        resolve(err(VaultEngineFailure.Timeout));
      }, 15000);
      void this.create().then((result) => {
        clearTimeout(timer);
        if (this.state === StartupRequestState.Expired && result.isOk()) {
          result.value.free();
          return;
        }
        resolve(result);
      });
    });
  }

  private async create(): Promise<
    Result<NookVaultManager, VaultEngineFailure>
  > {
    const ready = await vaultApplicationRuntime.ensureAppWasm(this.application);
    if (ready.isErr()) return err(ready.error);
    if (this.state === StartupRequestState.Expired)
      return err(VaultEngineFailure.Timeout);
    return ready.value.createManager();
  }
}
