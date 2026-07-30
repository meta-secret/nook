import type { StoreId } from "$app-wasm";

export enum VaultLabelEditorKind {
  Closed = "closed",
  Editing = "editing",
}

export type VaultLabelEditor =
  | { kind: VaultLabelEditorKind.Closed }
  | { kind: VaultLabelEditorKind.Editing; storeId: StoreId };

export enum VaultRenameOperationKind {
  Idle = "idle",
  Renaming = "renaming",
}

export type VaultRenameOperation =
  | { kind: VaultRenameOperationKind.Idle }
  | { kind: VaultRenameOperationKind.Renaming; storeId: StoreId };

export enum VaultSwitchOperationKind {
  Idle = "idle",
  Switching = "switching",
}

export type VaultSwitchOperation =
  | { kind: VaultSwitchOperationKind.Idle }
  | { kind: VaultSwitchOperationKind.Switching; storeId: StoreId };

export enum ImportProviderSectionKind {
  Closed = "closed",
  Open = "open",
}

export type ImportProviderSection =
  | { kind: ImportProviderSectionKind.Closed }
  | { kind: ImportProviderSectionKind.Open; providerId: string };
