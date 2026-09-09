import type { ExtensionConnectScope as RustExtensionConnectScope } from "./nook-companion-wasm/nook_companion_wasm.js";

export type ExtensionConnectScope = RustExtensionConnectScope;

export type ExtensionConnectScopeRuntime = Pick<
  typeof import("./nook-companion-wasm/nook_companion_wasm.js"),
  | "extension_vault_access_scope"
  | "extension_password_filling_scope"
  | "extension_passkey_management_scope"
  | "extension_sync_provider_credentials_scope"
  | "is_extension_connect_scope"
>;

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
    return this.requireScopeRuntime().extension_vault_access_scope();
  }
  get PasswordFilling(): ExtensionConnectScope {
    return this.requireScopeRuntime().extension_password_filling_scope();
  }
  get PasskeyManagement(): ExtensionConnectScope {
    return this.requireScopeRuntime().extension_passkey_management_scope();
  }
  get SyncProviderCredentials(): ExtensionConnectScope {
    return this.requireScopeRuntime().extension_sync_provider_credentials_scope();
  }
}

export const ExtensionConnectScope = new ExtensionConnectScopeCatalog();
