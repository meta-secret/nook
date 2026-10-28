import type {
  NookGoogleDriveVaultListing,
  ProviderVaultSummary,
} from "$app-wasm";
import type { VaultState } from "$lib/vault.svelte";
import { VaultOAuthActions } from "$lib/vault/oauth";
import { ProviderVaultActions } from "$lib/vault/provider-vaults";

export enum DriveVaultInventoryKind {
  Loading = "loading",
  Loaded = "loaded",
  Failed = "failed",
}

/** What the Drive setup step knows about the account's Nook folder. */
export type DriveVaultInventory =
  | { readonly kind: DriveVaultInventoryKind.Loading }
  | {
      readonly kind: DriveVaultInventoryKind.Loaded;
      readonly listing: NookGoogleDriveVaultListing;
    }
  | { readonly kind: DriveVaultInventoryKind.Failed };

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

/** Reads the signed-in Drive account's Nook folder. */
export class DriveVaultInventoryReader {
  constructor(private readonly vault: VaultState) {}

  /** What the folder holds; a failed read says why on the vault. */
  async read(): Promise<DriveVaultInventory> {
    const vault = this.vault;
    const listed = await new VaultOAuthActions(vault).listGoogleDriveVaults(
      new ProviderVaultActions(vault).localVaultOccupancy(),
    );
    if (listed.isErr()) {
      vault.errorMsg = vault.t(listed.error.translationKey);
      return { kind: DriveVaultInventoryKind.Failed };
    }
    return { kind: DriveVaultInventoryKind.Loaded, listing: listed.value };
  }
}

/** The vaults a found Nook root holds; none before it is listed. */
export function listedVaults(
  listing: NookGoogleDriveVaultListing,
): readonly ProviderVaultSummary[] {
  switch (listing.root) {
    case "found":
      return listing.listing.vaults;
    case "absent":
      return [];
  }
}
