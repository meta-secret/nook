import {
  ExtensionSetupOfferKind,
  type ExtensionSetupOffer,
} from "$lib/app/extension-setup";
import { ExtensionSetupStatus } from "$lib/extension/install";

export enum VaultExtensionLinkKind {
  None = "none",
  Unpaired = "unpaired",
  Connected = "connected",
}

export type VaultExtensionLink =
  | { kind: VaultExtensionLinkKind.None }
  | { kind: VaultExtensionLinkKind.Unpaired }
  | {
      kind: VaultExtensionLinkKind.Connected;
      storeId: string;
      vaultName: string;
    };

export type VaultSwitcherEntryLabel = {
  storeId: string;
  displayName: string;
};

export type VaultExtensionLinkRequest = {
  offer: ExtensionSetupOffer;
  activeStoreId: string;
  entries: readonly VaultSwitcherEntryLabel[];
};

export type VaultEntryDisplayNameRequest = {
  entries: readonly VaultSwitcherEntryLabel[];
  storeId: string;
  fallbackName: string;
};

export type CurrentVaultPairingAvailabilityRequest = {
  link: VaultExtensionLink;
  activeStoreId: string;
};

export type ExtensionConnectedEntryRequest = {
  link: VaultExtensionLink;
  storeId: string;
};

export enum ConnectedVaultMenuNoteKind {
  Hidden = "hidden",
  MissingLocally = "missing_locally",
}

export type ConnectedVaultMenuNote =
  | { kind: ConnectedVaultMenuNoteKind.Hidden }
  | { kind: ConnectedVaultMenuNoteKind.MissingLocally; vaultName: string };

export type ConnectedVaultMenuNoteRequest = {
  link: VaultExtensionLink;
  entries: readonly VaultSwitcherEntryLabel[];
};

export function displayNameForVaultStore(
  request: VaultEntryDisplayNameRequest,
): string {
  for (const entry of request.entries) {
    if (entry.storeId === request.storeId) return entry.displayName;
  }
  return request.fallbackName;
}

export function resolveVaultExtensionLink(
  request: VaultExtensionLinkRequest,
): VaultExtensionLink {
  if (request.offer.kind === ExtensionSetupOfferKind.Hidden) {
    return { kind: VaultExtensionLinkKind.None };
  }
  const setup = request.offer.setup;
  if (setup.status === ExtensionSetupStatus.NotInstalled) {
    return { kind: VaultExtensionLinkKind.None };
  }
  if (setup.status === ExtensionSetupStatus.InstalledUnpaired) {
    return { kind: VaultExtensionLinkKind.Unpaired };
  }
  if (setup.status === ExtensionSetupStatus.Paired) {
    const nameRequest: VaultEntryDisplayNameRequest = {
      entries: request.entries,
      storeId: request.activeStoreId,
      fallbackName: request.activeStoreId,
    };
    return {
      kind: VaultExtensionLinkKind.Connected,
      storeId: request.activeStoreId,
      vaultName: displayNameForVaultStore(nameRequest),
    };
  }
  return {
    kind: VaultExtensionLinkKind.Connected,
    storeId: setup.connectedVaultStoreId,
    vaultName: setup.connectedVaultName,
  };
}

export function currentVaultCanPairExtension(
  request: CurrentVaultPairingAvailabilityRequest,
): boolean {
  if (request.activeStoreId.trim() === "") return false;
  if (request.link.kind === VaultExtensionLinkKind.Unpaired) return true;
  return (
    request.link.kind === VaultExtensionLinkKind.Connected &&
    request.link.storeId !== request.activeStoreId
  );
}

export function vaultEntryHoldsExtensionGrant(
  request: ExtensionConnectedEntryRequest,
): boolean {
  return (
    request.link.kind === VaultExtensionLinkKind.Connected &&
    request.link.storeId === request.storeId
  );
}

export function connectedVaultMenuNote(
  request: ConnectedVaultMenuNoteRequest,
): ConnectedVaultMenuNote {
  if (request.link.kind !== VaultExtensionLinkKind.Connected) {
    return { kind: ConnectedVaultMenuNoteKind.Hidden };
  }
  for (const entry of request.entries) {
    if (entry.storeId === request.link.storeId) {
      return { kind: ConnectedVaultMenuNoteKind.Hidden };
    }
  }
  return {
    kind: ConnectedVaultMenuNoteKind.MissingLocally,
    vaultName: request.link.vaultName,
  };
}
