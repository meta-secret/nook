import { DeviceProtectionStatus, VaultIdentityKeySource } from "$app-wasm";
import {
  DeviceProtectionActionOutcome,
  DeviceProtectionActions,
} from "$lib/vault/device-protection.svelte";
import { ActiveVaultKind } from "$lib/vault/state/provider.svelte";
import { browserLogRuntime } from "$lib/runtime/log";
import type { VaultState } from "$lib/vault.svelte";

const log = browserLogRuntime.createLogger("vault-browser-key-switch");

export enum BrowserKeySwitchOutcome {
  /** The page runs on this browser's own key again. */
  Switched = "switched",
  /** The page stays locked; the reason is shown on the page. */
  Incomplete = "incomplete",
}

/**
 * Leaves the paired extension's key for this browser's own passkey. Only
 * this page locks: the extension stays unlocked, and its automatic resume
 * stays held, so the page reopens the same vault with this browser's key
 * and returns to the page it was on. With a member key here, the extension
 * is then invited into the identity it has not joined.
 */
export class BrowserKeySwitch {
  constructor(private readonly vault: VaultState) {}

  /** The page uses the extension's key and this browser holds its own key
   * behind a passkey. */
  get available(): boolean {
    const vault = this.vault;
    return (
      vault.identityKeySource === VaultIdentityKeySource.PairedCompanion &&
      vault.deviceProtectionLockedStatus === DeviceProtectionStatus.Passkey &&
      vault.activeVault.kind === ActiveVaultKind.Open
    );
  }

  async run(): Promise<BrowserKeySwitchOutcome> {
    const vault = this.vault;
    if (!this.available || vault.activeVault.kind !== ActiveVaultKind.Open)
      return BrowserKeySwitchOutcome.Incomplete;
    const storeId = vault.activeVault.storeId;
    const section = vault.workspaceSection;
    // This page's lock alone: the extension is not asked to lock.
    vault.lockVault();
    await vault.waitForStorageChain();
    if (!(await vault.chooseLoginVault(storeId)))
      return BrowserKeySwitchOutcome.Incomplete;
    const unlockRequest: Parameters<
      DeviceProtectionActions["unlockDeviceProtection"]
    >[0] = { initializeSession: true };
    const unlocked = await new DeviceProtectionActions(
      vault,
    ).unlockDeviceProtection(unlockRequest);
    if (unlocked !== DeviceProtectionActionOutcome.Ready)
      return BrowserKeySwitchOutcome.Incomplete;
    if (!vault.isAuthenticated) await vault.loadDb();
    if (!vault.isAuthenticated) return BrowserKeySwitchOutcome.Incomplete;
    vault.openSection(section);
    log.info("page switched to this browser's key");
    return BrowserKeySwitchOutcome.Switched;
  }
}
