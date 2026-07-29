import type { StoreId } from "$app-wasm";

export enum VaultSwitchStateKind {
  Idle = "idle",
  Switching = "switching",
}

export type VaultSwitchState =
  | { kind: VaultSwitchStateKind.Idle }
  | { kind: VaultSwitchStateKind.Switching; storeId: StoreId };
