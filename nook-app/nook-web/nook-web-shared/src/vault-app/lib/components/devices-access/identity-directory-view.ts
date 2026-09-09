import {
  type DeviceAccessProtectionKind,
  type NookDeviceAccessSnapshot,
  type NookDeviceAccessText,
  type NookDeviceVaultAccess,
  NookIdentityDirectorySelectionKind,
  type NookIdentityLocalAccessKind,
  NookIdentityMemberLabelKind,
  type NookIdentityMemberSnapshot,
  type NookIdentitySnapshot,
  type NookPasskeyTimestampEvidence,
  NookPasskeyTimestampEvidenceKind,
  type NookVaultManager,
  NookDeviceAccessTextKind,
  NookDeviceVaultAccessState,
} from "$app-wasm";
import {
  type DashboardTimestamp,
  DashboardTimestampKind,
  type DashboardText,
  KnownDashboardText,
  UnknownDashboardText,
  type DashboardView,
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
  readonly localProtection: DeviceAccessProtectionKind;
};

export type IdentityDirectoryEntry = {
  readonly identityId: string;
  readonly label: string;
  readonly localAccess: NookIdentityLocalAccessKind;
  readonly members: readonly IdentityMemberView[];
  readonly vaults: readonly VaultAccessView[];
};

export type IdentityDirectorySelection =
  | { readonly kind: IdentityDirectorySelectionKind.Empty }
  | {
      readonly kind: IdentityDirectorySelectionKind.Selected;
      readonly identityId: string;
    };

export type SelectedIdentityEntry =
  | { readonly kind: IdentityDirectorySelectionKind.Empty }
  | {
      readonly kind: IdentityDirectorySelectionKind.Selected;
      readonly identity: IdentityDirectoryEntry;
    };

export type IdentityDirectoryView = {
  readonly identities: readonly IdentityDirectoryEntry[];
  readonly selection: IdentityDirectorySelection;
};

export type IdentityDirectoryAccessView = {
  readonly directory: IdentityDirectoryView;
  readonly access: DashboardView;
};

export type IdentityDirectoryLoadState =
  | { readonly kind: IdentityDirectoryLoadKind.Loading }
  | { readonly kind: IdentityDirectoryLoadKind.Failed }
  | {
      readonly kind: IdentityDirectoryLoadKind.Ready;
      readonly view: IdentityDirectoryView;
    };

export class IdentityDirectoryReader {
  constructor(private readonly request: NookVaultManager) {}
  async load(): Promise<IdentityDirectoryAccessView> {
    const manager = this.request;

    const request = manager.identity_directory_snapshot_request();
    const snapshot = await request.resolve().finally(() => request.free());
    try {
      const identities: IdentityDirectoryEntry[] = [];
      for (let index = 0; index < snapshot.length; index += 1) {
        identities.push(
          IdentityDirectoryReader.readIdentity(snapshot.identity(index)),
        );
      }
      const selection: IdentityDirectorySelection =
        snapshot.selectionKind === NookIdentityDirectorySelectionKind.Selected
          ? {
              kind: IdentityDirectorySelectionKind.Selected,
              identityId: snapshot.selectedIdentityId,
            }
          : { kind: IdentityDirectorySelectionKind.Empty };
      return {
        directory: { identities, selection },
        access: IdentityDirectoryReader.readAccess(snapshot.device_access()),
      };
    } finally {
      snapshot.free();
    }
  }
  private static readMember(
    member: NookIdentityMemberSnapshot,
  ): IdentityMemberView {
    try {
      return {
        appId: member.appId,
        currentBrowser: member.currentBrowser,
        localProtection: member.localProtection,
        label:
          member.labelKind === NookIdentityMemberLabelKind.Known
            ? new KnownDashboardText(member.label())
            : new UnknownDashboardText(),
      };
    } finally {
      member.free();
    }
  }
  private static readText(value: NookDeviceAccessText): DashboardText {
    try {
      return value.kind === NookDeviceAccessTextKind.Known
        ? new KnownDashboardText(value.value())
        : new UnknownDashboardText();
    } finally {
      value.free();
    }
  }
  private static readTimestamp(
    value: NookPasskeyTimestampEvidence,
  ): DashboardTimestamp {
    try {
      if (value.kind === NookPasskeyTimestampEvidenceKind.Known) {
        return { kind: DashboardTimestampKind.Known, value: value.value() };
      }
      return value.kind === NookPasskeyTimestampEvidenceKind.NotYetObserved
        ? { kind: DashboardTimestampKind.NotYetObserved }
        : { kind: DashboardTimestampKind.Unavailable };
    } finally {
      value.free();
    }
  }
  private static readVaultAccess(
    entry: NookDeviceVaultAccess,
  ): VaultAccessView {
    try {
      return {
        storeId: entry.storeId,
        label: entry.label,
        verified: entry.accessState === NookDeviceVaultAccessState.Verified,
        verifiedAt: IdentityDirectoryReader.readText(entry.verifiedAt),
        lastLocalUpdateAt: IdentityDirectoryReader.readText(
          entry.lastLocalUpdateAt,
        ),
      };
    } finally {
      entry.free();
    }
  }
  private static readAccess(
    snapshot: NookDeviceAccessSnapshot,
  ): DashboardView {
    try {
      return {
        protection: snapshot.protection,
        identityState: snapshot.identityState,
        deviceId: IdentityDirectoryReader.readText(snapshot.deviceId),
        credentialId: IdentityDirectoryReader.readText(snapshot.credentialId),
        passkeyName: IdentityDirectoryReader.readText(snapshot.passkeyName),
        providerLabel: IdentityDirectoryReader.readText(
          snapshot.providerLabel,
        ),
        createdAt: IdentityDirectoryReader.readTimestamp(snapshot.createdAt),
        lastUsedAt: IdentityDirectoryReader.readTimestamp(
          snapshot.lastUsedAt,
        ),
        keeper: snapshot.keeper,
        vaults: snapshot
          .vaults()
          .map(IdentityDirectoryReader.readVaultAccess),
      };
    } finally {
      snapshot.free();
    }
  }
  private static readIdentity(
    identity: NookIdentitySnapshot,
  ): IdentityDirectoryEntry {
    try {
      return {
        identityId: identity.identityId,
        label: identity.label,
        localAccess: identity.localAccess,
        members: identity.members().map(IdentityDirectoryReader.readMember),
        vaults: identity
          .vaults()
          .map(IdentityDirectoryReader.readVaultAccess),
      };
    } finally {
      identity.free();
    }
  }
  static selectedIdentity(
    directory: IdentityDirectoryView,
  ): SelectedIdentityEntry {
    if (directory.selection.kind === IdentityDirectorySelectionKind.Empty) {
      return { kind: IdentityDirectorySelectionKind.Empty };
    }
    const selectedIdentityId = directory.selection.identityId;
    for (const identity of directory.identities) {
      if (identity.identityId === selectedIdentityId) {
        return { kind: IdentityDirectorySelectionKind.Selected, identity };
      }
    }
    return { kind: IdentityDirectorySelectionKind.Empty };
  }
}
