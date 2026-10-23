import { err, ok } from "neverthrow";
import { DeviceProtectionStatus } from "$app-wasm";
import { NativeVaultStorageFailure } from "$lib/runtime/storage-failure";
import { IdentityLifecycleMutationOutcome } from "$lib/components/devices-access-dashboard-state";
import { IdentitySessionTransition } from "$lib/components/devices-access/identity-session-transition";
import type { VaultState } from "$lib/vault.svelte";
import { DeviceProtectionActions } from "$lib/vault/device-protection.svelte";

export enum IdentitySwitchOutcome {
  /** The identity is this browser's own and unlocked. */
  Unlocked = "unlocked",
  /** It became this browser's identity but its passkey was not used. */
  Locked = "locked",
  /** Nothing changed; the failure is on `vault.errorMsg`. */
  Failed = "failed",
}

/**
 * "Use identity" on an identity card: make another identity on this browser
 * the active one, end the current identity's session, and unlock the new
 * one with its own passkey (a PIN identity unlocks from its card). The
 * identities page then shows it unlocked.
 */
export class IdentitySwitch {
  constructor(private readonly vault: VaultState) {}

  async to(identityId: string): Promise<IdentitySwitchOutcome> {
    const vault = this.vault;
    const activated = await vault.enqueueStorage(async () => {
      const manager = vault.admitManager();
      if (manager.isErr()) return err(manager.error);
      try {
        await manager.value.activate_local_identity(identityId);
        return ok(IdentityLifecycleMutationOutcome.Activated);
      } catch (failure) {
        return err(new NativeVaultStorageFailure(failure));
      }
    });
    if (activated.isErr()) {
      vault.errorMsg = vault.t(activated.error.translationKey);
      return IdentitySwitchOutcome.Failed;
    }
    // The workspace unmounts as soon as the session closes; keep the
    // locked screen alive until the new identity's providers are loaded.
    vault.identityTransitionPending = true;
    vault.deviceProtectionStatus = DeviceProtectionStatus.Loading;
    new IdentitySessionTransition(vault).clearPriorIdentity();
    vault.deviceId = "";
    vault.devicePublicKey = "";
    const manager = vault.admitManager();
    if (manager.isErr()) {
      vault.identityTransitionPending = false;
      vault.errorMsg = vault.t(manager.error.translationKey);
      return IdentitySwitchOutcome.Failed;
    }
    try {
      vault.deviceProtectionStatus =
        await manager.value.device_protection_status();
    } catch (failure) {
      vault.identityTransitionPending = false;
      vault.errorMsg = vault.t(
        new NativeVaultStorageFailure(failure).translationKey,
      );
      return IdentitySwitchOutcome.Failed;
    }
    // A PIN-protected identity is unlocked from its card's PIN field.
    if (vault.deviceProtectionStatus !== DeviceProtectionStatus.Pin) {
      const identityOnly: Parameters<
        DeviceProtectionActions["unlockDeviceProtection"]
      >[0] = { initializeSession: false };
      await new DeviceProtectionActions(vault).unlockDeviceProtection(
        identityOnly,
      );
    }
    // Its providers are read with its key; a locked identity (a PIN, or a
    // passkey prompt that was dismissed) loads them when it is unlocked.
    if (!vault.deviceProtectionReady) {
      vault.identityTransitionPending = false;
      return IdentitySwitchOutcome.Locked;
    }
    const outcome = await this.loadProviders();
    vault.identityTransitionPending = false;
    return outcome;
  }

  /** Load the now-unlocked identity's sync providers. */
  async loadProviders(): Promise<IdentitySwitchOutcome> {
    const vault = this.vault;
    const providerLoad: Parameters<typeof vault.loadProviders>[0] = {
      ensureLocalRow: true,
    };
    const loaded = await vault.loadProviders(providerLoad);
    if (loaded.isErr()) {
      vault.errorMsg = vault.t(loaded.error.translationKey);
      return IdentitySwitchOutcome.Failed;
    }
    vault.applyActiveProviderCredentials();
    return IdentitySwitchOutcome.Unlocked;
  }
}

/**
 * "Use identity" on the locked identities page. A switch that leaves the
 * identity locked (a PIN, or a dismissed passkey prompt) has its providers
 * still unread: they are read once its key is unlocked.
 */
export class LockedIdentitySwitch {
  private providersAwaitUnlock = false;

  constructor(private readonly vault: VaultState) {}

  async use(identityId: string): Promise<void> {
    const outcome = await new IdentitySwitch(this.vault).to(identityId);
    this.providersAwaitUnlock = outcome === IdentitySwitchOutcome.Locked;
  }

  /** Read the providers of an identity switched to while locked, now that
   * its key is unlocked. */
  async loadProvidersOnceUnlocked(): Promise<void> {
    if (!this.providersAwaitUnlock || !this.vault.deviceProtectionReady) return;
    this.providersAwaitUnlock = false;
    await new IdentitySwitch(this.vault).loadProviders();
  }
}
