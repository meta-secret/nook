import type { NookLocalVaultEntry } from "$app-wasm";

export enum LoginVaultEntryKind {
  Unavailable = "unavailable",
  Available = "available",
}

export type LoginVaultEntry =
  | { kind: LoginVaultEntryKind.Unavailable }
  | { kind: LoginVaultEntryKind.Available; entry: NookLocalVaultEntry };
