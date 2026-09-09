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

export class VaultEntryLabel {
  constructor(private readonly request: VaultEntryDisplayNameRequest) {}
  get text(): string {
    const request = this.request;
    for (const entry of request.entries) {
      if (entry.storeId === request.storeId) return entry.displayName;
    }
    return request.fallbackName;
  }
}
export class VaultExtensionPresentation {
  constructor(private readonly request: VaultExtensionLinkRequest) {}
  get link(): VaultExtensionLink {
    const request = this.request;
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
        vaultName: new VaultEntryLabel(nameRequest).text,
      };
    }
    return {
      kind: VaultExtensionLinkKind.Connected,
      storeId: setup.connectedVaultStoreId,
      vaultName: setup.connectedVaultName,
    };
  }
}
export class VaultPairingPresentation {
  constructor(
    private readonly request: CurrentVaultPairingAvailabilityRequest,
  ) {}
  get available(): boolean {
    const request = this.request;
    if (request.activeStoreId.trim() === "") return false;
    if (request.link.kind === VaultExtensionLinkKind.Unpaired) return true;
    return (
      request.link.kind === VaultExtensionLinkKind.Connected &&
      request.link.storeId !== request.activeStoreId
    );
  }
}
export class VaultGrantPresentation {
  constructor(private readonly request: ExtensionConnectedEntryRequest) {}
  get connected(): boolean {
    const request = this.request;
    return (
      request.link.kind === VaultExtensionLinkKind.Connected &&
      request.link.storeId === request.storeId
    );
  }
}
export class ConnectedVaultMenuPresentation {
  constructor(private readonly request: ConnectedVaultMenuNoteRequest) {}
  get note(): ConnectedVaultMenuNote {
    const request = this.request;
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
}
