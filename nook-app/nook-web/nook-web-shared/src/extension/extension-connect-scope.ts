import { Effect, Schema } from "effect";
import * as ParseResult from "effect/ParseResult";
import type { ExtensionConnectScope as RustExtensionConnectScope } from "./nook-companion-wasm/nook_companion_wasm.js";

export type ExtensionConnectScope = RustExtensionConnectScope;

export type ExtensionConnectScopeRuntime = {
  readonly extension_vault_access_scope: typeof import("./nook-companion-wasm/nook_companion_wasm.js").extension_vault_access_scope;
  readonly extension_password_filling_scope: typeof import("./nook-companion-wasm/nook_companion_wasm.js").extension_password_filling_scope;
  readonly extension_passkey_management_scope: typeof import("./nook-companion-wasm/nook_companion_wasm.js").extension_passkey_management_scope;
  readonly extension_sync_provider_credentials_scope: typeof import("./nook-companion-wasm/nook_companion_wasm.js").extension_sync_provider_credentials_scope;
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

export enum ExtensionConnectScopeDecodeFailureKind {
  RuntimeUnavailable = "runtime-unavailable",
  InvalidScope = "invalid-scope",
}

export type ExtensionConnectScopeDecodeFailure =
  | { readonly kind: ExtensionConnectScopeDecodeFailureKind.RuntimeUnavailable }
  | {
      readonly kind: ExtensionConnectScopeDecodeFailureKind.InvalidScope;
      readonly cause: ParseResult.ParseError;
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

  decode(
    value: unknown,
  ): Effect.Effect<ExtensionConnectScope, ExtensionConnectScopeDecodeFailure> {
    switch (this.scopeRuntimeState.kind) {
      case ExtensionConnectScopeRuntimeStateKind.Unconfigured: {
        const failure: ExtensionConnectScopeDecodeFailure = {
          kind: ExtensionConnectScopeDecodeFailureKind.RuntimeUnavailable,
        };
        return Effect.fail(failure);
      }
      case ExtensionConnectScopeRuntimeStateKind.Configured: {
        const runtime = this.scopeRuntimeState.runtime;
        const schema = Schema.Union(
          Schema.Literal(runtime.extension_vault_access_scope()),
          Schema.Literal(runtime.extension_password_filling_scope()),
          Schema.Literal(runtime.extension_passkey_management_scope()),
          Schema.Literal(runtime.extension_sync_provider_credentials_scope()),
        );
        return Schema.decodeUnknown(schema)(value).pipe(
          Effect.mapError((cause) => ({
            kind: ExtensionConnectScopeDecodeFailureKind.InvalidScope,
            cause,
          })),
        );
      }
    }
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
