import type { ExtensionConnectScope } from "./nook-companion-wasm/nook_companion_wasm.js";

export type { ExtensionConnectScope };

export type ExtensionConnectScopeRuntime = {
  readonly vaultAccess: typeof import("./nook-companion-wasm/nook_companion_wasm.js").extension_vault_access_scope;
  readonly passwordFilling: typeof import("./nook-companion-wasm/nook_companion_wasm.js").extension_password_filling_scope;
  readonly passkeyManagement: typeof import("./nook-companion-wasm/nook_companion_wasm.js").extension_passkey_management_scope;
  readonly syncProviderCredentials: typeof import("./nook-companion-wasm/nook_companion_wasm.js").extension_sync_provider_credentials_scope;
  readonly is_extension_connect_scope: typeof import("./nook-companion-wasm/nook_companion_wasm.js").is_extension_connect_scope;
};

enum ExtensionConnectScopeRuntimeStateKind {
  Unconfigured = "unconfigured",
  Configured = "configured",
}

type ExtensionConnectScopeRuntimeState =
  | { readonly kind: ExtensionConnectScopeRuntimeStateKind.Unconfigured }
  | {
      readonly kind: ExtensionConnectScopeRuntimeStateKind.Configured;
      readonly runtime: ExtensionConnectScopeRuntime;
    };

/** Owns the browser runtime resources shared by these interactions. */
class ExtensionConnectScopeCatalog {
  private scopeRuntimeState: ExtensionConnectScopeRuntimeState = {
    kind: ExtensionConnectScopeRuntimeStateKind.Unconfigured,
  };
  configureExtensionConnectScopeRuntime(
    runtime: ExtensionConnectScopeRuntime,
  ): void {
    this.scopeRuntimeState = {
      kind: ExtensionConnectScopeRuntimeStateKind.Configured,
      runtime,
    };
  }

  private requireScopeRuntime(): ExtensionConnectScopeRuntime {
    if (
      this.scopeRuntimeState.kind ===
      ExtensionConnectScopeRuntimeStateKind.Unconfigured
    ) {
      throw new Error("Extension connect scope runtime is not configured.");
    }
    return this.scopeRuntimeState.runtime;
  }

  isExtensionConnectScopeValue(value: unknown): value is ExtensionConnectScope {
    return (
      typeof value === "string" &&
      this.requireScopeRuntime().is_extension_connect_scope(value)
    );
  }
  get VaultAccess(): ExtensionConnectScope {
    return this.requireScopeRuntime().vaultAccess();
  }
  get PasswordFilling(): ExtensionConnectScope {
    return this.requireScopeRuntime().passwordFilling();
  }
  get PasskeyManagement(): ExtensionConnectScope {
    return this.requireScopeRuntime().passkeyManagement();
  }
  get SyncProviderCredentials(): ExtensionConnectScope {
    return this.requireScopeRuntime().syncProviderCredentials();
  }
}

export const ExtensionConnectScope = new ExtensionConnectScopeCatalog();
