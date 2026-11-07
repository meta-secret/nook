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

/** What a join does once its fresh key exists. */
export enum IdentityJoinPurpose {
  /** Ask one of the identity's devices to let this browser in. */
  Ask = "ask",
  /** Let this browser in with one of the identity's recovery passphrases:
   * its words are typed next. */
  Recover = "recover",
}

/** A join that waits for the fresh, protected key it asks with. */
export type WaitingIdentityJoin =
  | {
      readonly kind: IdentityJoinWaitKind.Device;
      readonly join: IdentityJoinIntent;
      readonly purpose: IdentityJoinPurpose;
    }
  | {
      readonly kind: IdentityJoinWaitKind.NewKey;
      readonly join: IdentityJoinIntent;
      readonly purpose: IdentityJoinPurpose;
    };

export type IdentityJoinWait =
  { readonly kind: IdentityJoinWaitKind.Idle } | WaitingIdentityJoin;

export enum KeyringRecoveryKind {
  /** No keyring waits for its recovery words. */
  None = "none",
  /** This browser's fresh key exists: the words of one of the keyring's
   * recovery passphrases are typed next. */
  Words = "words",
}

/** The keyring a list of keyrings recovers with a passphrase, if any. */
export type KeyringRecovery =
  | { readonly kind: KeyringRecoveryKind.None }
  | {
      readonly kind: KeyringRecoveryKind.Words;
      readonly join: IdentityJoinIntent;
    };

export enum FirstRunJoinKind {
  /** Setup has not asked to join an identity. */
  None = "none",
  /** Setup asked; a device of the identity answers. */
  Asked = "asked",
  /** Setup joins with one of the identity's recovery passphrases. */
  Recovering = "recovering",
}

/** The identity first-run setup asked to join, or joins with a recovery
 * passphrase, if any. */
export type FirstRunJoin =
  | { readonly kind: FirstRunJoinKind.None }
  | {
      readonly kind: FirstRunJoinKind.Asked;
      readonly join: IdentityJoinIntent;
    }
  | {
      readonly kind: FirstRunJoinKind.Recovering;
      readonly join: IdentityJoinIntent;
    };
