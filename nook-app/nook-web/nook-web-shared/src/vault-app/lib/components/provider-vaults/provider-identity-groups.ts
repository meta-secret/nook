import type {
  CredentialCheckReport,
  FilingIdentity,
  ProviderVaultAction,
  ProviderVaultSummary,
} from "$app-wasm";
import { CheckReports } from "$lib/vault/access-check";

/** One identity of a listing and the vaults it files. */
export type ProviderIdentityGroup = {
  readonly identity: FilingIdentity;
  readonly vaults: readonly ProviderVaultSummary[];
};

/** The listed vaults, grouped by the identity that files them, in listing
 * order. Passkeys belong to identities, so access is decided per identity. */
export function groupByIdentity(
  vaults: readonly ProviderVaultSummary[],
): readonly ProviderIdentityGroup[] {
  const groups: { identity: FilingIdentity; vaults: ProviderVaultSummary[] }[] =
    [];
  for (const summary of vaults) {
    const group = groups.find(
      (seen) => seen.identity.identityId === summary.identity.identityId,
    );
    if (group) group.vaults.push(summary);
    else {
      const created: {
        identity: FilingIdentity;
        vaults: ProviderVaultSummary[];
      } = { identity: summary.identity, vaults: [summary] };
      groups.push(created);
    }
  }
  return groups;
}

export enum IdentityStandingKind {
  /** This browser's own key is one of the identity's devices. */
  ThisBrowser = "thisBrowser",
  /** Another identity on this browser was granted its vaults. */
  OtherIdentityHere = "otherIdentityHere",
  /** A passkey checked on this page belongs to the identity. */
  OpenedByPasskey = "openedByPasskey",
  /** This app asked to join; a device of the identity approves it. */
  Requested = "requested",
  /** Passkeys were checked here, and none belongs to the identity. */
  NotOpened = "notOpened",
  /** Nothing on this browser has opened the identity yet. */
  Unchecked = "unchecked",
}

/** Whether an identity opens here, and how. */
export type IdentityStanding =
  | { readonly kind: IdentityStandingKind.ThisBrowser }
  | {
      readonly kind: IdentityStandingKind.OtherIdentityHere;
      readonly identityLabel: string;
    }
  | {
      readonly kind: IdentityStandingKind.OpenedByPasskey;
      readonly passkey: string;
    }
  | { readonly kind: IdentityStandingKind.Requested }
  | { readonly kind: IdentityStandingKind.NotOpened }
  | { readonly kind: IdentityStandingKind.Unchecked };

/** Identity standings from what this browser holds and what was checked. */
export class IdentityStandings {
  private readonly checked: CheckReports;

  constructor(reports: readonly CredentialCheckReport[]) {
    this.checked = new CheckReports(reports);
  }

  of(group: ProviderIdentityGroup): IdentityStanding {
    if (
      this.heldHere(group.identity) ||
      group.vaults.some((summary) => summary.access.state === "syncs")
    )
      return { kind: IdentityStandingKind.ThisBrowser };
    for (const summary of group.vaults)
      if (summary.access.state === "otherIdentityHere")
        return {
          kind: IdentityStandingKind.OtherIdentityHere,
          identityLabel: summary.access.identityLabel,
        };
    const passkey = this.checked.identityOpenedBy(group.identity.identityId);
    if (passkey) return { kind: IdentityStandingKind.OpenedByPasskey, passkey };
    if (group.vaults.every((summary) => summary.access.state === "requested"))
      return { kind: IdentityStandingKind.Requested };
    return this.checked.passkeyChecked()
      ? { kind: IdentityStandingKind.NotOpened }
      : { kind: IdentityStandingKind.Unchecked };
  }

  /** The identity's name some passkey opened, or empty. */
  name(identity: FilingIdentity): string {
    return this.checked.identityName(identity.identityId);
  }

  /** The vault's name some check decrypted, or empty. */
  vaultName(storeId: string): string {
    return this.checked.vaultName(storeId);
  }

  opensWithBackupPassword(storeId: string): boolean {
    return this.checked.opensWithBackupPassword(storeId);
  }

  /** The actions that belong to one vault rather than to its identity: a
   * backup password, a granted key, merging and replacing open a single
   * vault. Recovering and joining go through the identity. */
  vaultActions(summary: ProviderVaultSummary): readonly ProviderVaultAction[] {
    return summary.actions.filter((action) => {
      switch (action) {
        case "useInstead":
        case "mergeIntoOpen":
          return true;
        case "requestAccess":
          return false;
        case "importSeparately":
          switch (summary.access.state) {
            case "backupPassword":
            case "granted":
              return true;
            case "syncs":
            case "otherIdentityHere":
            case "unchecked":
            case "requested":
            case "locked":
              return this.opensWithBackupPassword(summary.storeId);
          }
      }
    });
  }

  /** The vault that opens the identity: recovering any one of its vaults
   * with the identity's passkey opens the identity, and its other vaults
   * then sync through it. Empty when the identity cannot be recovered here. */
  openingVaults(group: ProviderIdentityGroup): readonly ProviderVaultSummary[] {
    const standing = this.of(group);
    switch (standing.kind) {
      case IdentityStandingKind.ThisBrowser:
      case IdentityStandingKind.OtherIdentityHere:
      case IdentityStandingKind.Requested:
      case IdentityStandingKind.NotOpened:
        return [];
      case IdentityStandingKind.OpenedByPasskey:
      case IdentityStandingKind.Unchecked:
        return group.vaults
          .filter(
            (summary) =>
              summary.actions.includes("importSeparately") &&
              (standing.kind === IdentityStandingKind.OpenedByPasskey ||
                summary.access.state === "unchecked"),
          )
          .slice(0, 1);
    }
  }

  private heldHere(identity: FilingIdentity): boolean {
    switch (identity.log.state) {
      case "read":
        return identity.log.thisBrowser;
      case "absent":
        return false;
    }
  }
}

/** Whether the identity still needs its passkey found or a join. */
export function identityLocked(standing: IdentityStanding): boolean {
  switch (standing.kind) {
    case IdentityStandingKind.NotOpened:
    case IdentityStandingKind.Unchecked:
      return true;
    case IdentityStandingKind.ThisBrowser:
    case IdentityStandingKind.OtherIdentityHere:
    case IdentityStandingKind.Requested:
    case IdentityStandingKind.OpenedByPasskey:
      return false;
  }
}
