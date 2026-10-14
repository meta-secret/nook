import {
  DeviceAccessProtectionKind,
  NookIdentityLocalAccessKind,
} from "$app-wasm";
import type { IdentityDirectoryEntry } from "$lib/components/devices-access/identity-directory-view";

/** What an identity card says about its session on this browser. */
export enum IdentityCardStatus {
  /** The current identity with an open vault session. */
  Unlocked = "unlocked",
  /** The current identity; opening one of its vaults unlocks it. */
  Locked = "locked",
  /** Stored on this browser but not the active identity. */
  Inactive = "inactive",
  /** Known from another installation; it cannot be used here. */
  Elsewhere = "elsewhere",
}

export enum IdentityKeyKind {
  None = "none",
  Passkey = "passkey",
  Pin = "pin",
  Mixed = "mixed",
}

export enum IdentityVaultRowState {
  /** The vault this session has open. */
  Open = "open",
  /** A vault on this browser that can be opened or switched to. */
  Available = "available",
  /** Known for this identity but not stored on this browser. */
  Unavailable = "unavailable",
}

export type IdentityVaultRow = {
  readonly storeId: string;
  readonly label: string;
  readonly state: IdentityVaultRowState;
};

export type IdentityCardView = {
  readonly identityId: string;
  readonly label: string;
  readonly monogram: string;
  readonly hue: number;
  readonly fingerprint: readonly string[];
  readonly keyCount: number;
  readonly keyKind: IdentityKeyKind;
  readonly status: IdentityCardStatus;
  readonly current: boolean;
  readonly vaults: readonly IdentityVaultRow[];
};

/** An identity card action (Unlock, Manage) with the vault it opens on this
 * browser ("" when it opens none), so a locked identity can be unlocked. */
export type IdentityVaultTarget = {
  readonly identityId: string;
  readonly storeId: string;
};

export type IdentityLocalVault = {
  readonly storeId: string;
  readonly label: string;
};

export type IdentityCardSource = {
  readonly identities: readonly IdentityDirectoryEntry[];
  readonly localVaults: readonly IdentityLocalVault[];
  /** The open vault's store id, or empty when no vault session is open. */
  readonly openStoreId: string;
  readonly authenticated: boolean;
  /** This device's key is unlocked for the current identity, with or
   * without a vault open. */
  readonly identityUnlocked: boolean;
};

export type IdentityTotals = {
  readonly identities: number;
  readonly keys: number;
  readonly vaults: number;
  readonly unlocked: number;
};

type VaultRowStateRequest = {
  readonly storeId: string;
  readonly local: boolean;
};

type IdentityVaultRowsRequest = {
  readonly entry: IdentityDirectoryEntry;
  readonly current: boolean;
};

const FINGERPRINT_GROUPS = 4;
const FINGERPRINT_GROUP_SIZE = 4;

/** Stable, decorative hue so each identity keeps its monogram colour. */
function identityHue(identityId: string): number {
  let hash = 0;
  for (const character of identityId) {
    hash = (hash * 31 + character.charCodeAt(0)) % 360;
  }
  return hash;
}

/** Short, grouped identity fingerprint for recognition, not verification. */
function identityFingerprint(identityId: string): string[] {
  // Identity ids carry a short type prefix ("id_…"); the fingerprint is the
  // random part after it.
  const random = identityId.replace(/^[a-z]+_/, "");
  const hex = random.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  const source =
    hex.length >= FINGERPRINT_GROUPS * FINGERPRINT_GROUP_SIZE
      ? hex
      : random.replace(/[^0-9a-zA-Z]/g, "").toUpperCase();
  const groups: string[] = [];
  for (let group = 0; group < FINGERPRINT_GROUPS; group += 1) {
    const start = group * FINGERPRINT_GROUP_SIZE;
    const chunk = source.slice(start, start + FINGERPRINT_GROUP_SIZE);
    if (chunk.length > 0) groups.push(chunk);
  }
  return groups;
}

function keyKind(entry: IdentityDirectoryEntry): IdentityKeyKind {
  let passkeys = 0;
  let pins = 0;
  for (const member of entry.members) {
    const protection =
      member.localProtection === DeviceAccessProtectionKind.Missing
        ? member.protectionAssociation
        : member.localProtection;
    switch (protection) {
      case DeviceAccessProtectionKind.PasskeyStandard:
      case DeviceAccessProtectionKind.PasskeyAntiHacker:
        passkeys += 1;
        break;
      case DeviceAccessProtectionKind.PinOrPassphrase:
        pins += 1;
        break;
      case DeviceAccessProtectionKind.Missing:
      case DeviceAccessProtectionKind.CompanionSession:
        break;
    }
  }
  if (passkeys > 0 && pins > 0) return IdentityKeyKind.Mixed;
  if (passkeys > 0) return IdentityKeyKind.Passkey;
  if (pins > 0) return IdentityKeyKind.Pin;
  return IdentityKeyKind.None;
}

type IdentityVaultOwnership = {
  readonly storeId: string;
  readonly identityId: string;
};

/**
 * Project the identity directory and local vault catalog into cards. Every
 * vault belongs to exactly one identity: the identity with a verified access
 * record for it (the current identity first when several claim it), or the
 * current identity for local vaults no identity has opened yet.
 */
export class IdentityCardProjection {
  private readonly owners: ReadonlyMap<string, string>;

  constructor(private readonly source: IdentityCardSource) {
    this.owners = this.vaultOwners();
  }

  private vaultOwners(): Map<string, string> {
    const owners = new Map<string, string>();
    const isCurrent = (entry: IdentityDirectoryEntry): boolean =>
      entry.localAccess === NookIdentityLocalAccessKind.CurrentBrowser;
    const ordered = [
      ...this.source.identities.filter(isCurrent),
      ...this.source.identities.filter((entry) => !isCurrent(entry)),
    ];
    for (const entry of ordered) {
      for (const vault of entry.vaults) {
        if (!owners.has(vault.storeId)) {
          owners.set(vault.storeId, entry.identityId);
        }
      }
    }
    for (const entry of ordered) {
      if (!isCurrent(entry)) continue;
      for (const vault of this.source.localVaults) {
        if (!owners.has(vault.storeId)) {
          owners.set(vault.storeId, entry.identityId);
        }
      }
    }
    return owners;
  }

  private get hasCurrentIdentity(): boolean {
    return this.source.identities.some(
      (entry) =>
        entry.localAccess === NookIdentityLocalAccessKind.CurrentBrowser,
    );
  }

  private owns(request: IdentityVaultOwnership): boolean {
    return this.owners.get(request.storeId) === request.identityId;
  }

  get cards(): IdentityCardView[] {
    return this.source.identities.map((entry) => this.card(entry));
  }

  /** Local vaults no card lists, as when this browser has no current
   * identity to hold them. They still open from their own row. */
  get unlistedVaults(): IdentityLocalVault[] {
    const listed = new Set(
      this.cards.flatMap((card) => card.vaults.map((row) => row.storeId)),
    );
    return this.source.localVaults.filter(
      (vault) => !listed.has(vault.storeId),
    );
  }

  get totals(): IdentityTotals {
    const cards = this.cards;
    let keys = 0;
    let vaults = 0;
    let unlocked = 0;
    for (const card of cards) {
      keys += card.keyCount;
      vaults += card.vaults.length;
      if (card.status === IdentityCardStatus.Unlocked) unlocked += 1;
    }
    return { identities: cards.length, keys, vaults, unlocked };
  }

  private status(entry: IdentityDirectoryEntry): IdentityCardStatus {
    switch (entry.localAccess) {
      case NookIdentityLocalAccessKind.CurrentBrowser:
        return this.source.identityUnlocked
          ? IdentityCardStatus.Unlocked
          : IdentityCardStatus.Locked;
      case NookIdentityLocalAccessKind.ThisBrowser:
        return IdentityCardStatus.Inactive;
      case NookIdentityLocalAccessKind.OtherInstallation:
        return IdentityCardStatus.Elsewhere;
    }
  }

  private vaultRows({
    entry,
    current,
  }: IdentityVaultRowsRequest): IdentityVaultRow[] {
    const local = new Map(
      this.source.localVaults.map((vault) => [vault.storeId, vault.label]),
    );
    const rows: IdentityVaultRow[] = [];
    const seen = new Set<string>();
    for (const vault of entry.vaults) {
      seen.add(vault.storeId);
      const ownership: IdentityVaultOwnership = {
        storeId: vault.storeId,
        identityId: entry.identityId,
      };
      if (!this.owns(ownership)) continue;
      const localLabel = local.get(vault.storeId);
      const label = localLabel ? localLabel : vault.label;
      // With no identity current here (its key was lost), a vault stored on
      // this browser still opens: unlocking it is how the key is recovered.
      const stateRequest: VaultRowStateRequest = {
        storeId: vault.storeId,
        local:
          (current || !this.hasCurrentIdentity) && local.has(vault.storeId),
      };
      const row: IdentityVaultRow = {
        storeId: vault.storeId,
        label,
        state: this.vaultState(stateRequest),
      };
      rows.push(row);
    }
    // The current identity also owns local vaults that no identity has a
    // verified access record for yet (created here, not opened since).
    if (current) {
      for (const vault of this.source.localVaults) {
        if (seen.has(vault.storeId)) continue;
        const ownership: IdentityVaultOwnership = {
          storeId: vault.storeId,
          identityId: entry.identityId,
        };
        if (!this.owns(ownership)) continue;
        const stateRequest: VaultRowStateRequest = {
          storeId: vault.storeId,
          local: true,
        };
        const row: IdentityVaultRow = {
          storeId: vault.storeId,
          label: vault.label,
          state: this.vaultState(stateRequest),
        };
        rows.push(row);
      }
    }
    return rows;
  }

  private vaultState({
    storeId,
    local,
  }: VaultRowStateRequest): IdentityVaultRowState {
    if (!local) return IdentityVaultRowState.Unavailable;
    return this.source.authenticated && storeId === this.source.openStoreId
      ? IdentityVaultRowState.Open
      : IdentityVaultRowState.Available;
  }

  private card(entry: IdentityDirectoryEntry): IdentityCardView {
    const current =
      entry.localAccess === NookIdentityLocalAccessKind.CurrentBrowser;
    const label = entry.label.trim();
    const rowsRequest: IdentityVaultRowsRequest = { entry, current };
    return {
      identityId: entry.identityId,
      label,
      monogram: (label.length > 0 ? label.charAt(0) : "?").toUpperCase(),
      hue: identityHue(entry.identityId),
      fingerprint: identityFingerprint(entry.identityId),
      keyCount: entry.members.length,
      keyKind: keyKind(entry),
      status: this.status(entry),
      current,
      vaults: this.vaultRows(rowsRequest),
    };
  }
}

export enum VaultSetupHostKind {
  /** Waiting for the identity directory before placing the setup. */
  Pending = "pending",
  /** No identity yet: the "Your first identity" card holds the setup. */
  Draft = "draft",
  /** The current identity's card holds the setup. */
  Card = "card",
}

/**
 * Where the first-vault setup lives. It is fixed once placed, so creating
 * keys mid-setup (which adds an identity) never remounts the wizard.
 */
export type VaultSetupHost =
  | { readonly kind: VaultSetupHostKind.Pending }
  | { readonly kind: VaultSetupHostKind.Draft }
  | {
      readonly kind: VaultSetupHostKind.Card;
      readonly identityId: string;
    };
