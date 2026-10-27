import type { NookGoogleDriveVaultListing } from "$app-wasm";
import type { EmptyVaultSwap } from "$lib/vault/provider-vaults";

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

export enum EmptyVaultConfirmationKind {
  Closed = "closed",
  Confirming = "confirming",
}

/** The swap being confirmed and the short id of the vault taking over. */
export interface EmptyVaultConfirmationRequest {
  readonly swap: EmptyVaultSwap;
  readonly shortId: string;
}

/** The explicit confirmation before an empty vault gives way. */
export type EmptyVaultConfirmation =
  | { readonly kind: EmptyVaultConfirmationKind.Closed }
  | ({
      readonly kind: EmptyVaultConfirmationKind.Confirming;
    } & EmptyVaultConfirmationRequest);
