import { I18N_KEYS } from "../../nook-web-shared/src/generated/i18n-keys";

export const EXTENSION_CONNECT_PATH = "/extension-connect";

import type { ExtensionConnectRequestFor } from "$web-shared/extension/extension-connect-types";
import type { ExtensionConnectScope as ProtocolExtensionConnectScope } from "$web-shared/extension/extension-connect-scope";
import type { ExtensionPairingApprovedMessage } from "$web-shared/extension/runtime-messages";
import type { ExtensionPairingDelivery } from "$lib/extension/extension-pairing-delivery";
import type { ExtensionVaultEventLogChannel } from "$lib/extension/vault-event-log";
import type { KeyringProvidersDelivery } from "$web-shared/extension/keyring-providers-message";

export {
  ExtensionPairingDeliveryKind,
  ExtensionPairingRejectionReason,
  type ExtensionPairingDelivery,
} from "$lib/extension/extension-pairing-delivery";

export type ExtensionConnectScope = ProtocolExtensionConnectScope;

/** Owns Sentinel's fail-closed facade for unreachable extension scope access. */
class SentinelExtensionConnectScopeCatalog {
  get SyncProviderCredentials(): ExtensionConnectScope {
    throw new Error(I18N_KEYS.ErrorsValidationSentinelExtensionForbidden);
  }
}

export const ExtensionConnectScope = new SentinelExtensionConnectScopeCatalog();

export type ExtensionConnectRequest =
  ExtensionConnectRequestFor<ProtocolExtensionConnectScope>;

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

export async function openExtensionSidePanel(): Promise<boolean> {
  return false;
}

type ExtensionPairingApprovalDelivery = {
  readonly request: ExtensionConnectRequest;
  readonly message: ExtensionPairingApprovedMessage;
};

export const extensionConnectionBrowser = {
  isExtensionConnectPath,
  extensionConnectRequestFromLocation,
  readInstalledExtensionRuntimeId,
  pullVaultEventLog(): ReturnType<ExtensionVaultEventLogChannel["pull"]> {
    throw new Error(I18N_KEYS.ErrorsValidationSentinelExtensionForbidden);
  },
  openInstalledExtension,
  openExtensionSidePanel,
  async deliverExtensionPairingApproval(
    _request: ExtensionPairingApprovalDelivery,
  ): Promise<ExtensionPairingDelivery> {
    void _request;
    throw new Error(I18N_KEYS.ErrorsValidationSentinelExtensionForbidden);
  },
  async deliverKeyringProviders(
    _delivery: KeyringProvidersDelivery,
  ): Promise<boolean> {
    void _delivery;
    throw new Error(I18N_KEYS.ErrorsValidationSentinelExtensionForbidden);
  },
};
