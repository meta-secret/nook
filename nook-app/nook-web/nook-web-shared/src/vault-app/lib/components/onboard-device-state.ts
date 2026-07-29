import type { PasswordEntryId } from "$app-wasm";

export enum ProviderSelectionKind {
  Automatic = "automatic",
  Selected = "selected",
}

export type ProviderSelection =
  | { kind: ProviderSelectionKind.Automatic }
  | { kind: ProviderSelectionKind.Selected; providerId: string };

export enum PasswordEntrySelectionKind {
  NotSelected = "not-selected",
  Selected = "selected",
}

export type PasswordEntrySelection =
  | { kind: PasswordEntrySelectionKind.NotSelected }
  | { kind: PasswordEntrySelectionKind.Selected; entryId: PasswordEntryId };
