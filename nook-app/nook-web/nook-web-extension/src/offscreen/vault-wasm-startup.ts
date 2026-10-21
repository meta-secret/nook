import initNookWasm, {
  configure_vault_application,
  VaultApplication,
} from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'

enum WasmStartupKind {
  NotStarted = 'not-started',
  Initializing = 'initializing',
}

type WasmStartup =
  | { kind: WasmStartupKind.NotStarted }
  | {
      kind: WasmStartupKind.Initializing
      operation: ReturnType<typeof initNookWasm>
    }

/** Starts the offscreen document's single vault WASM instance once. */
class VaultWasmStartup {
  private startup: WasmStartup = { kind: WasmStartupKind.NotStarted }

  ensure(): ReturnType<typeof initNookWasm> {
    switch (this.startup.kind) {
      case WasmStartupKind.Initializing:
        return this.startup.operation
      case WasmStartupKind.NotStarted:
        break
    }
    // The offscreen document shares the background's copy of the vault WASM;
    // one copy keeps the hosted extension ZIP under the Pages file limit.
    const initArgs: Parameters<typeof initNookWasm>[0] = {
      module_or_path: chrome.runtime.getURL('background/nook_wasm_bg.wasm'),
    }
    const operation = initNookWasm(initArgs).then((value) => {
      configure_vault_application(VaultApplication.Extension)
      return value
    })
    this.startup = { kind: WasmStartupKind.Initializing, operation }
    return operation
  }
}

export const vaultWasmStartup = new VaultWasmStartup()
