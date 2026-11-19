import type {
  CredentialCheckReport,
  NookGoogleDriveVaultListing,
  ProviderListedIdentity,
  ProviderVaultSummary,
} from "$app-wasm";

export enum DriveVaultInventoryKind {
  Loading = "loading",
  Loaded = "loaded",
  Failed = "failed",
}

/** What the Drive setup step knows about the account's Nook folder. */
export type DriveVaultInventory =
  | { readonly kind: DriveVaultInventoryKind.Loading; readonly token: string }
  | {
      readonly kind: DriveVaultInventoryKind.Loaded;
      readonly token: string;
      readonly listing: NookGoogleDriveVaultListing;
      readonly checks: readonly CredentialCheckReport[];
      readonly passkeyCheck: DrivePasskeyCheck;
    }
  | { readonly kind: DriveVaultInventoryKind.Failed; readonly token: string };

export enum DrivePasskeyCheckKind {
  Idle = "idle",
  Checking = "checking",
  NoMatch = "no-match",
}

type DrivePasskeyCheck =
  | { readonly kind: DrivePasskeyCheckKind.Idle }
  | {
      readonly kind: DrivePasskeyCheckKind.Checking;
      readonly identityId: string;
    }
  | {
      readonly kind: DrivePasskeyCheckKind.NoMatch;
      readonly identityId: string;
    };

/** The step's one action button: Connect & sync, or the identity plan
 * followed by it. An empty label keeps the button's own words. */
/** How the step shows its one action. */
export enum ConnectButtonLook {
  /** The step's primary button. */
  Primary = "primary",
  /** "Create a new identity" under the listed identities: the identity in
   * use is saved on the provider as a new one. */
  NewIdentity = "new-identity",
}

export type ConnectPlanButton = {
  readonly busy: boolean;
  readonly label: string;
  /** The new-identity option's second line; the primary button has none. */
  readonly detail: string;
  readonly look: ConnectButtonLook;
  readonly run: () => Promise<void>;
};

/** The vaults a found Nook root holds; none before it is listed. */
/** The vaults a listing holds and the identities they are filed under. */
export type ListedVaults = {
  readonly vaults: readonly ProviderVaultSummary[];
  readonly identities: readonly ProviderListedIdentity[];
};

/** A Drive account without a Nook root holds no vaults. */
export function listedVaults(
  listing: NookGoogleDriveVaultListing,
): ListedVaults {
  switch (listing.root) {
    case "found":
      return listing.listing;
    case "absent":
      return { vaults: [], identities: [] };
  }
}
