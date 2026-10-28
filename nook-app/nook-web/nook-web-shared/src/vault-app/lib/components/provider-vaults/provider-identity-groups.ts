import type {
  CredentialCheckReport,
  FilingIdentity,
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
  /** A passkey checked on this page belongs to the identity. */
  OpenedByPasskey = "openedByPasskey",
  /** Passkeys were checked here, and none belongs to the identity. */
  NotOpened = "notOpened",
  /** Nothing on this browser has opened the identity yet. */
  Unchecked = "unchecked",
}

/** Whether an identity opens here, and how. */
export type IdentityStanding =
  | { readonly kind: IdentityStandingKind.ThisBrowser }
  | {
      readonly kind: IdentityStandingKind.OpenedByPasskey;
      readonly passkey: string;
    }
  | { readonly kind: IdentityStandingKind.NotOpened }
  | { readonly kind: IdentityStandingKind.Unchecked };

/** Identity standings from what this browser holds and what was checked. */
export class IdentityStandings {
  private readonly checked: CheckReports;

  constructor(reports: readonly CredentialCheckReport[]) {
    this.checked = new CheckReports(reports);
  }

  of(identity: FilingIdentity): IdentityStanding {
    switch (identity.log.state) {
      case "read":
        if (identity.log.thisBrowser)
          return { kind: IdentityStandingKind.ThisBrowser };
        break;
      case "absent":
        break;
    }
    const passkey = this.checked.identityOpenedBy(identity.identityId);
    if (passkey) return { kind: IdentityStandingKind.OpenedByPasskey, passkey };
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
}

/** Whether the identity already opens here, so it needs no further action. */
export function identityOpened(standing: IdentityStanding): boolean {
  switch (standing.kind) {
    case IdentityStandingKind.ThisBrowser:
    case IdentityStandingKind.OpenedByPasskey:
      return true;
    case IdentityStandingKind.NotOpened:
    case IdentityStandingKind.Unchecked:
      return false;
  }
}
