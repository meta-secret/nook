import type { ProviderIdentityChoice } from "$app-wasm";

/** The one button an identity's setup card offers. */
export enum SetupIdentityOffer {
  /** A member continues: setup finishes on it. */
  Continue = "continue",
  /** Anyone else asks to join it. */
  Join = "join",
  /** A join already asked is read again. */
  Check = "check",
  /** The identity in use, or one another identity here holds. */
  NoAction = "no-action",
}

export enum SetupRecoveryKind {
  /** Setup can join a keyring with one of its recovery passphrases. */
  Offered = "offered",
  /** Only its devices let this browser in here. */
  NotOffered = "not-offered",
}

/** Whether a setup list offers recovery with a passphrase beside joining. */
export type SetupRecovery =
  | {
      readonly kind: SetupRecoveryKind.Offered;
      readonly onRecover: (choice: ProviderIdentityChoice) => void;
    }
  | { readonly kind: SetupRecoveryKind.NotOffered };

/** Whether Rust offers recovering this keyring with one of its recovery
 * passphrases: this browser may join it and its log lists one. */
export function recoverableWithPassphrase(
  choice: ProviderIdentityChoice,
): boolean {
  switch (choice.recovery) {
    case "offered":
      return true;
    case "notOffered":
      return false;
  }
}
