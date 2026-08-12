import { I18N_KEYS } from "../../nook-web-shared/src/generated/i18n-keys";
export const EXTENSION_CONNECT_PATH = "/extension-connect";

import type { NookVaultManager } from "$app-wasm";
import type {
  ExtensionConnectRequestFor,
  PairedExtensionIdentityDiscoveryFor,
} from "$web-shared/extension/extension-connect-types";
import { ExtensionIdentityRequestSource } from "$web-shared/extension/extension-connect-types";
import { ExtensionPairedVaultIdentityStatusMessageStatus } from "$web-shared/extension/paired-vault-identity-status";

export { ExtensionIdentityRequestSource };

/**
 * Compile-time compatibility for shared presentation that is unreachable in
 * Sentinel. Values deliberately describe the disabled boundary and cannot be
 * mistaken for extension protocol capabilities.
 */
export enum ExtensionConnectScope {
  VaultAccess = "sentinel-extension-vault-access-disabled",
  PasswordFilling = "sentinel-extension-password-filling-disabled",
  PasskeyManagement = "sentinel-extension-passkey-management-disabled",
  SyncProviderCredentials = "sentinel-extension-provider-secret-sharing-disabled",
}

export type ExtensionConnectRequest =
  ExtensionConnectRequestFor<ExtensionConnectScope>;
export type PairedExtensionIdentityDiscovery =
  PairedExtensionIdentityDiscoveryFor<ExtensionConnectRequest>;

export type ExtensionIdentityAdoption = {
  manager: NookVaultManager;
  request: ExtensionConnectRequest;
};

export enum ExtensionConnectRequestStateKind {
  Absent = "absent",
  Requested = "requested",
}

export type ExtensionConnectRequestState =
  | { kind: ExtensionConnectRequestStateKind.Absent }
  | {
      kind: ExtensionConnectRequestStateKind.Requested;
      request: ExtensionConnectRequest;
    };

export enum InstalledExtensionRuntimeKind {
  NotInstalled = "not-installed",
  Installed = "installed",
}

export type InstalledExtensionRuntime =
  | { kind: InstalledExtensionRuntimeKind.NotInstalled }
  | {
      kind: InstalledExtensionRuntimeKind.Installed;
      extensionRuntimeId: string;
    };

export const isExtensionConnectPath: (pathname: string) => boolean = () =>
  false;

export const extensionConnectRequestFromLocation: (
  location: Location,
) => ExtensionConnectRequestState = () => ({
  kind: ExtensionConnectRequestStateKind.Absent,
});

export function readInstalledExtensionRuntimeId(): InstalledExtensionRuntime {
  return { kind: InstalledExtensionRuntimeKind.NotInstalled };
}

export async function openInstalledExtension(): Promise<boolean> {
  return false;
}

export async function discoverPairedExtensionIdentity(
  _vaultStoreId: string,
): Promise<PairedExtensionIdentityDiscovery> {
  void _vaultStoreId;
  return {
    status: ExtensionPairedVaultIdentityStatusMessageStatus.Unavailable,
  };
}

export async function requestPairedExtensionUnlock(
  _vaultStoreId: string,
): Promise<boolean> {
  void _vaultStoreId;
  return false;
}

export function scopeLabel(): never {
  throw new Error(I18N_KEYS.ErrorsValidationSentinelExtensionForbidden);
}

export async function adoptExtensionIdentity(
  args: ExtensionIdentityAdoption,
): Promise<void> {
  void args;
  throw new Error(I18N_KEYS.ErrorsValidationSentinelExtensionForbidden);
}
