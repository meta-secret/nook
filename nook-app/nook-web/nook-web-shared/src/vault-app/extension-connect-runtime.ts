import {
  extension_passkey_management_scope,
  extension_password_filling_scope,
  extension_sync_provider_credentials_scope,
  extension_vault_access_scope,
  is_extension_connect_scope,
} from "$app-wasm";
import {
  configureExtensionConnectScopeRuntime,
  type ExtensionConnectScopeRuntime,
} from "$web-shared/extension/extension-connect-scope";

/** Connect extension protocol scopes only in vault applications that support them. */
export function configureVaultExtensionConnectScopeRuntime(): void {
  const scopeRuntime: ExtensionConnectScopeRuntime = {
    extension_vault_access_scope,
    extension_password_filling_scope,
    extension_passkey_management_scope,
    extension_sync_provider_credentials_scope,
    is_extension_connect_scope,
  };
  configureExtensionConnectScopeRuntime(scopeRuntime);
}
