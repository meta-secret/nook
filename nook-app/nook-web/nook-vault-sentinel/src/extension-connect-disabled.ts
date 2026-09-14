import { I18N_KEYS } from "../../nook-web-shared/src/generated/i18n-keys";
import { err, type Result } from "neverthrow";
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from "$lib/runtime/storage-failure";
export const EXTENSION_CONNECT_PATH = "/extension-connect";

import type {
  NookVaultManager,
  NookAdoptedExtensionIdentityHandoff,
} from "$app-wasm";
import type {
  ExtensionConnectRequestFor,
  PairedExtensionIdentityDiscoveryFor,
} from "$web-shared/extension/extension-connect-types";
import { ExtensionIdentityRequestSource } from "$web-shared/extension/extension-connect-types";
import { ExtensionConnectScope } from "$web-shared/extension/extension-connect-scope";
import { ExtensionPairedVaultIdentityStatusMessageStatus } from "$web-shared/extension/paired-vault-identity-status";

export { ExtensionConnectScope, ExtensionIdentityRequestSource };

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

export enum ExtensionPairingDeliveryKind {
  Delivered = "delivered",
  MessagingUnavailable = "messaging-unavailable",
  PlaintextProviderMigrationRequired = "plaintext-provider-migration-required",
  Rejected = "rejected",
}

export type ExtensionPairingDelivery =
  | {
      readonly kind: Exclude<
        ExtensionPairingDeliveryKind,
        ExtensionPairingDeliveryKind.Rejected
      >;
    }
  | {
      readonly kind: ExtensionPairingDeliveryKind.Rejected;
      readonly reason?: string;
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
): Promise<Result<NookAdoptedExtensionIdentityHandoff, VaultStorageFailure>> {
  void args;
  return err(
    new VaultStorageFailure(VaultStorageFailureKind.IdentityHandoffRejected),
  );
}

export const extensionConnectionBrowser = {
  isExtensionConnectPath,
  extensionConnectRequestFromLocation,
  readInstalledExtensionRuntimeId,
  openInstalledExtension,
  discoverPairedExtensionIdentity,
  requestPairedExtensionUnlock,
  adoptExtensionIdentity,
  // eslint-disable-next-line @typescript-eslint/no-restricted-types -- Foreign host data is narrowed at this boundary.
  async deliverExtensionPairingApproval(
    _request: unknown,
  ): Promise<ExtensionPairingDelivery> {
    void _request;
    throw new Error(I18N_KEYS.ErrorsValidationSentinelExtensionForbidden);
  },
};
