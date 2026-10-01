import type { PairedExtensionIdentityDiscovery } from "$lib/extension/connect";
import { ExtensionPairedVaultIdentityStatusMessageStatus } from "$web-shared/extension/paired-vault-identity-status";
import {
  LoginVaultEntryKind,
  type LoginVaultEntry,
} from "./login-unlock-state";

export enum LoginVaultExtensionPairingStatusKind {
  NotShown = "not-shown",
  Checking = "checking",
  Paired = "paired",
  NotPaired = "not-paired",
  Unavailable = "unavailable",
}

export type LoginVaultConnectedExtensionIdentity = {
  readonly storeId: string;
  readonly name: string;
};

export type LoginVaultExtensionResolvedPairingStatus =
  | { readonly kind: LoginVaultExtensionPairingStatusKind.Paired }
  | {
      readonly kind: LoginVaultExtensionPairingStatusKind.NotPaired;
      readonly connectedVault: LoginVaultConnectedExtensionIdentity;
    }
  | { readonly kind: LoginVaultExtensionPairingStatusKind.Unavailable };

export type LoginVaultExtensionPairingStatus =
  | { readonly kind: LoginVaultExtensionPairingStatusKind.NotShown }
  | { readonly kind: LoginVaultExtensionPairingStatusKind.Checking }
  | LoginVaultExtensionResolvedPairingStatus;

export type LoginVaultNotPairedExtensionPairingStatus = Extract<
  LoginVaultExtensionPairingStatus,
  { readonly kind: LoginVaultExtensionPairingStatusKind.NotPaired }
>;

export type LoginVaultExtensionPairingStatusEntry = {
  readonly storeId: string;
} & (
  | { readonly kind: LoginVaultExtensionPairingStatusKind.Checking }
  | LoginVaultExtensionResolvedPairingStatus
);

export class LoginVaultExtensionPairingStatusProjection {
  readonly status: LoginVaultExtensionResolvedPairingStatus;

  constructor(discovery: PairedExtensionIdentityDiscovery) {
    switch (discovery.status) {
      case ExtensionPairedVaultIdentityStatusMessageStatus.Locked:
      case ExtensionPairedVaultIdentityStatusMessageStatus.Unlocked:
        this.status = { kind: LoginVaultExtensionPairingStatusKind.Paired };
        break;
      case ExtensionPairedVaultIdentityStatusMessageStatus.DifferentVault:
        this.status = {
          kind: LoginVaultExtensionPairingStatusKind.NotPaired,
          connectedVault: {
            storeId: discovery.connectedVaultStoreId,
            name: discovery.connectedVaultName,
          },
        };
        break;
      case ExtensionPairedVaultIdentityStatusMessageStatus.Unavailable:
        this.status = {
          kind: LoginVaultExtensionPairingStatusKind.Unavailable,
        };
        break;
    }
  }
}

export class LoginVaultExtensionPairingStatusLookup {
  private readonly entries: readonly LoginVaultExtensionPairingStatusEntry[];

  constructor(entries: readonly LoginVaultExtensionPairingStatusEntry[]) {
    this.entries = entries;
  }

  statusForStore(storeId: string): LoginVaultExtensionPairingStatus {
    const entry = this.entries.find(
      (candidate) => candidate.storeId === storeId,
    );
    if (!entry) return { kind: LoginVaultExtensionPairingStatusKind.NotShown };

    switch (entry.kind) {
      case LoginVaultExtensionPairingStatusKind.Checking:
        return { kind: LoginVaultExtensionPairingStatusKind.Checking };
      case LoginVaultExtensionPairingStatusKind.Paired:
        return { kind: LoginVaultExtensionPairingStatusKind.Paired };
      case LoginVaultExtensionPairingStatusKind.NotPaired:
        return { kind: entry.kind, connectedVault: entry.connectedVault };
      case LoginVaultExtensionPairingStatusKind.Unavailable:
        return { kind: LoginVaultExtensionPairingStatusKind.Unavailable };
    }
  }
}

export function statusForActiveVault(
  entries: readonly LoginVaultExtensionPairingStatusEntry[],
): (activeLoginVault: LoginVaultEntry) => LoginVaultExtensionPairingStatus {
  const lookup = new LoginVaultExtensionPairingStatusLookup(entries);
  return (activeLoginVault) => {
    if (activeLoginVault.kind !== LoginVaultEntryKind.Available) {
      return { kind: LoginVaultExtensionPairingStatusKind.NotShown };
    }
    return lookup.statusForStore(activeLoginVault.entry.storeId);
  };
}
