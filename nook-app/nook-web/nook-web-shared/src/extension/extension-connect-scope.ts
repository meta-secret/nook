export const ExtensionConnectScope = {
  VaultAccess: "vault-access",
  PasswordFilling: "password-filling",
  PasskeyManagement: "passkey-management",
  SyncProviderCredentials: "sync-provider-credentials",
} as const;

export type ExtensionConnectScope =
  (typeof ExtensionConnectScope)[keyof typeof ExtensionConnectScope];

export function isExtensionConnectScope(
  value: unknown,
): value is ExtensionConnectScope {
  if (typeof value !== "string") return false;
  switch (value) {
    case ExtensionConnectScope.VaultAccess:
    case ExtensionConnectScope.PasswordFilling:
    case ExtensionConnectScope.PasskeyManagement:
    case ExtensionConnectScope.SyncProviderCredentials:
      return true;
    default:
      return false;
  }
}
