import type { IdentityControlStanding } from "$app-wasm";

export enum RecoveryAddKind {
  /** Name it and pick its strength. */
  Choosing = "choosing",
  /** Rust generated the words: they show once, to be written down. */
  Writing = "writing",
  /** The words are typed back; Rust records the passphrase if they match. */
  Confirming = "confirming",
}

/** Where adding a recovery passphrase is. Only the writing step holds the
 * words, and only until it ends. */
export type RecoveryAdd =
  | { readonly kind: RecoveryAddKind.Choosing }
  | {
      readonly kind: RecoveryAddKind.Writing;
      readonly label: string;
      readonly words: readonly string[];
    }
  | { readonly kind: RecoveryAddKind.Confirming; readonly label: string };

export enum RecoveryPanelKind {
  /** The list, with the slot that adds one. */
  Listing = "listing",
  Adding = "adding",
}

export enum RecoveryRemovalKind {
  Idle = "idle",
  Confirming = "confirming",
}

/** A removal waiting for its confirmation, on one row. */
export type RecoveryRemoval =
  | { readonly kind: RecoveryRemovalKind.Idle }
  | { readonly kind: RecoveryRemovalKind.Confirming; readonly id: string };

export enum RecoveryManagement {
  /** This app may add and remove the keyring's recovery passphrases. */
  Allowed = "allowed",
  /** It is not an active member: nothing to manage from here. */
  Unavailable = "unavailable",
}

/** Whether this app manages the keyring's recovery passphrases. A keyring
 * without its log yet gets one when the first passphrase is added. */
export function recoveryManagement(
  standing: IdentityControlStanding,
): RecoveryManagement {
  switch (standing) {
    case "member":
    case "notReplicated":
      return RecoveryManagement.Allowed;
    case "pendingJoin":
    case "revoked":
    case "notListed":
      return RecoveryManagement.Unavailable;
  }
}

export enum RecoveryWordsLeaveKind {
  /** The page around the words has its own way back. */
  Elsewhere = "elsewhere",
  /** A quiet action beside Recover leaves the words for another way in. */
  Beside = "beside",
}

/** How the user leaves the recovery words without recovering. */
export type RecoveryWordsLeave =
  | { readonly kind: RecoveryWordsLeaveKind.Elsewhere }
  | {
      readonly kind: RecoveryWordsLeaveKind.Beside;
      readonly onLeave: () => void;
    };
