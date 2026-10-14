import type { DashboardView } from "$lib/components/devices-access-dashboard-state";
import type { IdentityDirectoryEntry } from "$lib/components/devices-access/identity-directory-view";

export enum KeysLoadKind {
  Loading = "loading",
  Ready = "ready",
  Failed = "failed",
}

/** What the Keys page has read about the unlocked identity. */
export type KeysLoad =
  | { readonly kind: KeysLoadKind.Loading }
  | { readonly kind: KeysLoadKind.Failed }
  | {
      readonly kind: KeysLoadKind.Ready;
      readonly identity: IdentityDirectoryEntry;
      readonly view: DashboardView;
    };
