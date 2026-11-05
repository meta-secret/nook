import type { IdentityRecoveryPassphraseView } from "$app-wasm";

export enum RecoveryListKind {
  Loading = "loading",
  Loaded = "loaded",
  Failed = "failed",
}

/** What the recover step read of the keyring's recovery passphrases. */
export type RecoveryList =
  | { readonly kind: RecoveryListKind.Loading }
  | {
      readonly kind: RecoveryListKind.Loaded;
      readonly passphrases: readonly IdentityRecoveryPassphraseView[];
    }
  | {
      readonly kind: RecoveryListKind.Failed;
      /** Why, in the user's words. */
      readonly message: string;
    };
