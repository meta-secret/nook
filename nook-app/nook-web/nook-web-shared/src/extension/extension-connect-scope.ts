import { Effect, Schema } from "effect";
import * as ParseResult from "effect/ParseResult";
import type { ExtensionConnectScope as RustExtensionConnectScope } from "./nook-companion-wasm/nook_companion_wasm.js";

export type ExtensionConnectScope = RustExtensionConnectScope;

export type ExtensionConnectScopeRuntime = {
  readonly vaultAccess: typeof import("./nook-companion-wasm/nook_companion_wasm.js").extension_vault_access_scope;
  readonly passwordFilling: typeof import("./nook-companion-wasm/nook_companion_wasm.js").extension_password_filling_scope;
  readonly passkeyManagement: typeof import("./nook-companion-wasm/nook_companion_wasm.js").extension_passkey_management_scope;
  readonly syncProviderCredentials: typeof import("./nook-companion-wasm/nook_companion_wasm.js").extension_sync_provider_credentials_scope;
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
      case ExtensionConnectScopeRuntimeStateKind.Unconfigured:
        return Effect.fail({
          kind: ExtensionConnectScopeDecodeFailureKind.RuntimeUnavailable,
        });
      case ExtensionConnectScopeRuntimeStateKind.Configured: {
        const runtime = this.scopeRuntimeState.runtime;
        const schema = Schema.Union(
          Schema.Literal(runtime.vaultAccess()),
          Schema.Literal(runtime.passwordFilling()),
          Schema.Literal(runtime.passkeyManagement()),
          Schema.Literal(runtime.syncProviderCredentials()),
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
