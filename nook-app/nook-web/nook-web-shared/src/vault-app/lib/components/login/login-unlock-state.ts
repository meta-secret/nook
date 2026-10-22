import type { NookLocalVaultEntry } from "$app-wasm";

export enum LoginVaultEntryKind {
  Unavailable = "unavailable",
  Available = "available",
}

export type LoginVaultEntry =
  | { kind: LoginVaultEntryKind.Unavailable }
  | { kind: LoginVaultEntryKind.Available; entry: NookLocalVaultEntry };

/** Where Unlock on a locked identity card takes its key from. Each unlocks
 * the identity only; a vault then opens from its row. */
export enum IdentityUnlockRoute {
  /** The identity was adopted from the paired extension, which holds its
   * key: this browser has no passkey for it. */
  PairedExtension = "paired-extension",
  Pin = "pin",
  Passkey = "passkey",
}

export type IdentityUnlockRouteRequest = {
  readonly identityKeyInExtension: boolean;
  readonly pinProtected: boolean;
};

export function identityUnlockRoute({
  identityKeyInExtension,
  pinProtected,
}: IdentityUnlockRouteRequest): IdentityUnlockRoute {
  if (identityKeyInExtension) return IdentityUnlockRoute.PairedExtension;
  return pinProtected ? IdentityUnlockRoute.Pin : IdentityUnlockRoute.Passkey;
}
