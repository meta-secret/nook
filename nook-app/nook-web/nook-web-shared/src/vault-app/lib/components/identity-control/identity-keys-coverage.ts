import type { IdentityControlSnapshot } from "$app-wasm";
import { I18N_KEYS, type I18nKey } from "../../../../generated/i18n-keys";

/** How far the keyring's keys cover losing this browser. */
export enum KeysCoverageKind {
  /** One app key and nothing else: losing this browser loses the vaults. */
  Single = "single",
  /** One app key, and a recovery passphrase that lets a new device in. */
  SingleRecoverable = "single-recoverable",
  /** Several apps open the keyring. */
  Covered = "covered",
}

/** Named values required by `keysCoverage`. */
export type KeysCoverageRequest = {
  readonly keyCount: number;
  /** The keyring's projected log; `false` until it loads. */
  readonly snapshot: IdentityControlSnapshot | false;
};

/** What the Keys page says about its keys: a recovery passphrase on a
 * single-key keyring means losing this browser does not lock it out. */
export function keysCoverage({
  keyCount,
  snapshot,
}: KeysCoverageRequest): KeysCoverageKind {
  if (keyCount > 1) return KeysCoverageKind.Covered;
  if (snapshot === false || snapshot.recoveryPassphrases.length === 0)
    return KeysCoverageKind.Single;
  return KeysCoverageKind.SingleRecoverable;
}

/** The line the Keys page shows for its coverage. */
export function keysCoverageMessage(coverage: KeysCoverageKind): I18nKey {
  switch (coverage) {
    case KeysCoverageKind.Single:
      return I18N_KEYS.IdentityKeysSingleWarning;
    case KeysCoverageKind.SingleRecoverable:
      return I18N_KEYS.IdentityKeysSingleRecoverable;
    case KeysCoverageKind.Covered:
      return I18N_KEYS.IdentityKeysCovered;
  }
}
