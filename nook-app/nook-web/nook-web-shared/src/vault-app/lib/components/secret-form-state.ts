import type { VaultItemType } from "$lib/nook";

export enum SecretTypeSelectionKind {
  ChoosingType = "choosing-type",
  EditingFields = "editing-fields",
}

export type SecretTypeSelection =
  | { kind: SecretTypeSelectionKind.ChoosingType }
  | { kind: SecretTypeSelectionKind.EditingFields; itemType: VaultItemType };
