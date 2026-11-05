import type { IdentityRecoveryPassphraseView } from "$app-wasm";

export enum RecoveryListKind {
  Loading = "loading",
  /** The keyring's log lists no recovery passphrase. */
  None = "none",
  /** Its passphrases, one of them picked for the words typed. */
  Ready = "ready",
  Failed = "failed",
}

/** What the recover step read of the keyring's recovery passphrases. */
export type RecoveryList =
  | { readonly kind: RecoveryListKind.Loading }
  | { readonly kind: RecoveryListKind.None }
  | {
      readonly kind: RecoveryListKind.Ready;
      readonly passphrases: readonly IdentityRecoveryPassphraseView[];
      /** The id of the passphrase the words are typed for. */
      readonly picked: string;
    }
  | {
      readonly kind: RecoveryListKind.Failed;
      /** Why, in the user's words. */
      readonly message: string;
    };

/** The list Rust read: the first passphrase starts picked. */
export function recoveryList(
  passphrases: readonly IdentityRecoveryPassphraseView[],
): RecoveryList {
  const [first] = passphrases;
  if (!first) return { kind: RecoveryListKind.None };
  return { kind: RecoveryListKind.Ready, passphrases, picked: first.id };
}
