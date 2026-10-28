import type { NookGoogleDriveVaultListing } from "$app-wasm";

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
export type ConnectPlanButton = {
  readonly busy: boolean;
  readonly label: string;
  readonly run: () => Promise<void>;
};
