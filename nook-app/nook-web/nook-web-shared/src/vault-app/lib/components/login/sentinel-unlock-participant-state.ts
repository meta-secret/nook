export enum GenesisDeliverySelectionKind {
  NotSelected = "not-selected",
  Selected = "selected",
}

export type GenesisDeliverySelection =
  | { kind: GenesisDeliverySelectionKind.NotSelected }
  | { kind: GenesisDeliverySelectionKind.Selected; storeId: string };
