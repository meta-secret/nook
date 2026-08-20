import {
  NookIdentityDirectorySelectionKind,
  type NookIdentityLocalAccessKind,
  NookIdentityMemberLabelKind,
  type NookIdentityMemberSnapshot,
  type NookIdentitySnapshot,
  type NookVaultManager,
  NookDeviceAccessTextKind,
  NookDeviceVaultAccessState,
} from "$app-wasm";
import {
  type DashboardText,
  DashboardTextKind,
} from "../devices-access-dashboard-state";
import type { VaultAccessView } from "./access-chain";

export enum IdentityDirectoryLoadKind {
  Loading = "loading",
  Failed = "failed",
  Ready = "ready",
}

export enum IdentityDirectorySelectionKind {
  Empty = "empty",
  Selected = "selected",
}

export type IdentityMemberView = {
  readonly appId: string;
  readonly label: DashboardText;
  readonly currentBrowser: boolean;
};

export type IdentityDirectoryEntry = {
  readonly identityId: string;
  readonly label: string;
  readonly fingerprint: string;
  readonly localAccess: NookIdentityLocalAccessKind;
  readonly members: readonly IdentityMemberView[];
  readonly vaultStoreIds: readonly string[];
  readonly vaults: readonly VaultAccessView[];
};

export type IdentityDirectorySelection =
  | { readonly kind: IdentityDirectorySelectionKind.Empty }
  | {
      readonly kind: IdentityDirectorySelectionKind.Selected;
      readonly identityId: string;
    };

export type IdentityDirectoryView = {
  readonly identities: readonly IdentityDirectoryEntry[];
  readonly selection: IdentityDirectorySelection;
};

export type IdentityDirectoryLoadState =
  | { readonly kind: IdentityDirectoryLoadKind.Loading }
  | { readonly kind: IdentityDirectoryLoadKind.Failed }
  | {
      readonly kind: IdentityDirectoryLoadKind.Ready;
      readonly view: IdentityDirectoryView;
    };

function readMember(member: NookIdentityMemberSnapshot): IdentityMemberView {
  try {
    return {
      appId: member.appId,
      currentBrowser: member.currentBrowser,
      label:
        member.labelKind === NookIdentityMemberLabelKind.Known
          ? { kind: DashboardTextKind.Known, value: member.label() }
          : { kind: DashboardTextKind.Unknown },
    };
  } finally {
    member.free();
  }
}

function readIdentity(identity: NookIdentitySnapshot): IdentityDirectoryEntry {
  try {
    return {
      identityId: identity.identityId,
      label: identity.label,
      fingerprint: identity.fingerprint,
      localAccess: identity.localAccess,
      members: identity.members().map(readMember),
      vaultStoreIds: identity.vaultStoreIds(),
      vaults: identity.vaults().map((entry) => {
        try {
          const verifiedAt = entry.verifiedAt;
          const lastLocalUpdateAt = entry.lastLocalUpdateAt;
          try {
            return {
              storeId: entry.storeId,
              label: entry.label,
              verified:
                entry.accessState === NookDeviceVaultAccessState.Verified,
              verifiedAt:
                verifiedAt.kind === NookDeviceAccessTextKind.Known
                  ? { kind: DashboardTextKind.Known, value: verifiedAt.value() }
                  : { kind: DashboardTextKind.Unknown },
              lastLocalUpdateAt:
                lastLocalUpdateAt.kind === NookDeviceAccessTextKind.Known
                  ? {
                      kind: DashboardTextKind.Known,
                      value: lastLocalUpdateAt.value(),
                    }
                  : { kind: DashboardTextKind.Unknown },
            };
          } finally {
            verifiedAt.free();
            lastLocalUpdateAt.free();
          }
        } finally {
          entry.free();
        }
      }),
    };
  } finally {
    identity.free();
  }
}

export async function loadIdentityDirectoryView(
  manager: NookVaultManager,
): Promise<IdentityDirectoryView> {
  const request = manager.identity_directory_snapshot_request();
  const snapshot = await request.resolve().finally(() => request.free());
  try {
    const identities: IdentityDirectoryEntry[] = [];
    for (let index = 0; index < snapshot.length; index += 1) {
      identities.push(readIdentity(snapshot.identity(index)));
    }
    const selection: IdentityDirectorySelection =
      snapshot.selectionKind === NookIdentityDirectorySelectionKind.Selected
        ? {
            kind: IdentityDirectorySelectionKind.Selected,
            identityId: snapshot.selectedIdentityId,
          }
        : { kind: IdentityDirectorySelectionKind.Empty };
    return { identities, selection };
  } finally {
    snapshot.free();
  }
}

export function selectedIdentity(
  directory: IdentityDirectoryView,
): IdentityDirectoryEntry | undefined {
  if (directory.selection.kind === IdentityDirectorySelectionKind.Empty) {
    return undefined;
  }
  return directory.identities.find(
    (identity) => identity.identityId === directory.selection.identityId,
  );
}
