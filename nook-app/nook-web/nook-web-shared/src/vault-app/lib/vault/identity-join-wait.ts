import type { NookProviderSource } from "$app-wasm";

/** One identity this browser asks to join, on the provider that holds it. */
export type IdentityJoinIntent = {
  readonly source: NookProviderSource;
  readonly identityId: string;
  /** The identity's listed name; a new local identity for it takes it. */
  readonly label: string;
};

export enum IdentityJoinWaitKind {
  Idle = "idle",
  /** No key is unlocked here: the device protection gate runs first. */
  Device = "device",
  /** The key in use belongs to an identity: a new local identity's key
   * ceremony runs first. Rust has staged that identity. */
  NewKey = "new-key",
}

/** A join that waits for the fresh, protected key it asks with. */
export type WaitingIdentityJoin =
  | {
      readonly kind: IdentityJoinWaitKind.Device;
      readonly join: IdentityJoinIntent;
    }
  | {
      readonly kind: IdentityJoinWaitKind.NewKey;
      readonly join: IdentityJoinIntent;
    };

export type IdentityJoinWait =
  { readonly kind: IdentityJoinWaitKind.Idle } | WaitingIdentityJoin;
