import {
  extension_passkey_management_scope,
  extension_password_filling_scope,
  extension_sync_provider_credentials_scope,
  extension_vault_access_scope,
  is_extension_connect_scope,
  type ExtensionConnectScope as RustExtensionConnectScope,
} from './nook-companion-wasm/nook_companion_wasm.js'

export type ExtensionConnectScope = RustExtensionConnectScope

export const ExtensionConnectScope = {
  get VaultAccess(): ExtensionConnectScope {
    return extension_vault_access_scope() as ExtensionConnectScope
  },
  get PasswordFilling(): ExtensionConnectScope {
    return extension_password_filling_scope() as ExtensionConnectScope
  },
  get PasskeyManagement(): ExtensionConnectScope {
    return extension_passkey_management_scope() as ExtensionConnectScope
  },
  get SyncProviderCredentials(): ExtensionConnectScope {
    return extension_sync_provider_credentials_scope() as ExtensionConnectScope
  },
}

export function isExtensionConnectScope(
  value: unknown,
): value is ExtensionConnectScope {
  return typeof value === 'string' && is_extension_connect_scope(value)
}
