import { DeviceProtectionStatus } from "$app-wasm";

/** Where unlocking this browser's device key asks for it and reports back. */
export enum DeviceKeyUnlockPresentation {
  /** The page-level sheet: setting up a key, restoring, or joining. */
  Sheet = "sheet",
  /** An identity card: the vault's panel shows the unlock, its failure, and
   * this browser's key recovery. */
  Card = "card",
}

export type VaultUnlockRequest = {
  readonly presentation: DeviceKeyUnlockPresentation;
};

/** This browser has no protected device key to unlock yet; one is set up. */
export function deviceKeySetupNeeded(status: DeviceProtectionStatus): boolean {
  return (
    status === DeviceProtectionStatus.Missing ||
    status === DeviceProtectionStatus.Plaintext ||
    status === DeviceProtectionStatus.PinSetup
  );
}

export type DeviceKeySheetRequest = {
  readonly presentation: DeviceKeyUnlockPresentation;
  readonly status: DeviceProtectionStatus;
};

/**
 * Whether unlocking a locked vault opens the page-level sheet. A card unlocks
 * an existing key itself; setting up a key always uses the sheet.
 */
export function deviceKeySheetShown({
  presentation,
  status,
}: DeviceKeySheetRequest): boolean {
  return (
    presentation === DeviceKeyUnlockPresentation.Sheet ||
    deviceKeySetupNeeded(status)
  );
}
