import type { NookLocalVaultEntry, StoreId } from "$app-wasm";

export enum VaultSwitchStateKind {
  Idle = "idle",
  Switching = "switching",
}

export type VaultSwitchState =
  | { kind: VaultSwitchStateKind.Idle }
  | { kind: VaultSwitchStateKind.Switching; storeId: StoreId };

export enum DisplayedVaultKind {
  Unavailable = "unavailable",
  Available = "available",
}

export type DisplayedVault =
  | { kind: DisplayedVaultKind.Unavailable }
  | { kind: DisplayedVaultKind.Available; entry: NookLocalVaultEntry };

export enum VaultSwitcherRootKind {
  Unmounted = "unmounted",
  Mounted = "mounted",
}

export type VaultSwitcherRoot =
  | { kind: VaultSwitcherRootKind.Unmounted }
  | { kind: VaultSwitcherRootKind.Mounted; element: HTMLDivElement };
