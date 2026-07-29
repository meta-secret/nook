export enum ExtensionConnectScope {
  VaultAccess = 'vault-access',
  PasswordFilling = 'password-filling',
  PasskeyManagement = 'passkey-management',
  SyncProviderCredentials = 'sync-provider-credentials',
}

const extensionConnectScopes = new Set<string>(
  Object.values(ExtensionConnectScope),
)

export function isExtensionConnectScope(
  value: unknown,
): value is ExtensionConnectScope {
  return typeof value === 'string' && extensionConnectScopes.has(value)
}
