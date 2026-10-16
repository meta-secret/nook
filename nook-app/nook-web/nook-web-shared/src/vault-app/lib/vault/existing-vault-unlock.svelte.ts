import {
  deviceKeySheetShown,
  type DeviceKeySheetRequest,
} from "$lib/vault/device-key-unlock";

/**
 * An existing vault waiting for this browser's device key before it opens.
 * The page-level sheet asks for the key; a card unlock asks on the card and
 * only waits here to open the vault.
 */
export class ExistingVaultUnlockWait {
  pending = $state(false);
  sheet = $state(false);

  begin(request: DeviceKeySheetRequest): void {
    this.pending = true;
    this.sheet = deviceKeySheetShown(request);
  }

  /** A card unlock that did not finish leaves nothing waiting: the card
   * shows why, and its Unlock tries again. */
  settle(deviceProtectionReady: boolean): void {
    if (!this.sheet && !deviceProtectionReady) this.pending = false;
  }

  /** The sheet is up while the wait needs a device unlock it asks for. */
  sheetShown(needsDeviceUnlock: boolean): boolean {
    return this.pending && this.sheet && needsDeviceUnlock;
  }
}
