import type { PasswordEntryId } from "$app-wasm";

export enum ActivePasswordEntryKind {
  None = "none",
  Selected = "selected",
}

export type ActivePasswordEntry =
  | { kind: ActivePasswordEntryKind.None }
  | { kind: ActivePasswordEntryKind.Selected; entryId: PasswordEntryId };

export enum VaultPasswordPanel {
  Idle = "idle",
  Add = "add",
  Rotate = "rotate",
  Remove = "remove",
  Issue = "issue",
}
