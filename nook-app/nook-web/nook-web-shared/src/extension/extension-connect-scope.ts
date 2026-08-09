import {
  extensionPasskeyManagementScope,
  extensionPasswordFillingScope,
  extensionSyncProviderCredentialsScope,
  extensionVaultAccessScope,
  isExtensionConnectScope as isRustExtensionConnectScope,
  type ExtensionConnectScope as RustExtensionConnectScope,
} from './nook-companion-wasm/nook_companion_wasm.js'

export type ExtensionConnectScope = RustExtensionConnectScope

export const ExtensionConnectScope = {
  get VaultAccess(): ExtensionConnectScope {
    return extensionVaultAccessScope() as ExtensionConnectScope
  },
  get PasswordFilling(): ExtensionConnectScope {
    return extensionPasswordFillingScope() as ExtensionConnectScope
  },
  get PasskeyManagement(): ExtensionConnectScope {
    return extensionPasskeyManagementScope() as ExtensionConnectScope
  },
  get SyncProviderCredentials(): ExtensionConnectScope {
    return extensionSyncProviderCredentialsScope() as ExtensionConnectScope
  },
}

export function isExtensionConnectScope(
  value: unknown,
): value is ExtensionConnectScope {
  return typeof value === 'string' && isRustExtensionConnectScope(value)
}
