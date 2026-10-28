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

export enum FirstRunJoinKind {
  /** Setup has not asked to join an identity. */
  None = "none",
  /** Setup asked; a device of the identity answers. */
  Asked = "asked",
}

/** The identity first-run setup asked to join, if any. */
export type FirstRunJoin =
  | { readonly kind: FirstRunJoinKind.None }
  | {
      readonly kind: FirstRunJoinKind.Asked;
      readonly join: IdentityJoinIntent;
    };
