import type {
  ExtensionConnectScope as RustExtensionConnectScope,
} from './nook-companion-wasm/nook_companion_wasm.js'

export type ExtensionConnectScope = RustExtensionConnectScope

export type ExtensionConnectScopeRuntime = {
  extension_vault_access_scope(): ExtensionConnectScope
  extension_password_filling_scope(): ExtensionConnectScope
  extension_passkey_management_scope(): ExtensionConnectScope
  extension_sync_provider_credentials_scope(): ExtensionConnectScope
  is_extension_connect_scope(value: string): boolean
}

enum ExtensionConnectScopeRuntimeStateKind {
  Unconfigured = 'unconfigured',
  Configured = 'configured',
}

type ExtensionConnectScopeRuntimeState =
  | { readonly kind: ExtensionConnectScopeRuntimeStateKind.Unconfigured }
  | {
      readonly kind: ExtensionConnectScopeRuntimeStateKind.Configured
      readonly runtime: ExtensionConnectScopeRuntime
    }

let scopeRuntimeState: ExtensionConnectScopeRuntimeState = {
  kind: ExtensionConnectScopeRuntimeStateKind.Unconfigured,
}

export function configureExtensionConnectScopeRuntime(
  runtime: ExtensionConnectScopeRuntime,
): void {
  scopeRuntimeState = {
    kind: ExtensionConnectScopeRuntimeStateKind.Configured,
    runtime,
  }
}

function requireScopeRuntime(): ExtensionConnectScopeRuntime {
  if (
    scopeRuntimeState.kind === ExtensionConnectScopeRuntimeStateKind.Unconfigured
  ) {
    throw new Error('Extension connect scope runtime is not configured.')
  }
  return scopeRuntimeState.runtime
}

export const ExtensionConnectScope = {
  get VaultAccess(): ExtensionConnectScope {
    return requireScopeRuntime().extension_vault_access_scope()
  },
  get PasswordFilling(): ExtensionConnectScope {
    return requireScopeRuntime().extension_password_filling_scope()
  },
  get PasskeyManagement(): ExtensionConnectScope {
    return requireScopeRuntime().extension_passkey_management_scope()
  },
  get SyncProviderCredentials(): ExtensionConnectScope {
    return requireScopeRuntime().extension_sync_provider_credentials_scope()
  },
}

export function isExtensionConnectScopeValue(
  value: unknown,
): value is ExtensionConnectScope {
  return (
    typeof value === 'string' &&
    requireScopeRuntime().is_extension_connect_scope(value)
  )
}
