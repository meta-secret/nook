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

/** A keyring this browser may join whose log lists recovery passphrases:
 * one of them can let this browser in instead of a device. */
export function recoverableWithPassphrase(
  choice: ProviderIdentityChoice,
): boolean {
  switch (choice.setup.kind) {
    case "requestToJoin":
    case "waiting":
      break;
    case "continue":
    case "inUse":
    case "unavailable":
      return false;
  }
  const log = choice.identity.log;
  switch (log.state) {
    case "read":
      return log.recoveryPassphrases > 0;
    case "absent":
      return false;
  }
}
