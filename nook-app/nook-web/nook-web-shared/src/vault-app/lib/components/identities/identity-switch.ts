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
 * one with its own passkey. The identities page then shows it unlocked.
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
    vault.devicesAccessIdentityTransitionPending = true;
    vault.deviceProtectionStatus = DeviceProtectionStatus.Loading;
    new IdentitySessionTransition(vault).clearPriorIdentity();
    vault.deviceId = "";
    vault.devicePublicKey = "";
    const manager = vault.admitManager();
    if (manager.isErr()) {
      vault.devicesAccessIdentityTransitionPending = false;
      vault.errorMsg = vault.t(manager.error.translationKey);
      return IdentitySwitchOutcome.Failed;
    }
    try {
      vault.deviceProtectionStatus =
        await manager.value.device_protection_status();
    } catch (failure) {
      vault.devicesAccessIdentityTransitionPending = false;
      vault.errorMsg = vault.t(
        new NativeVaultStorageFailure(failure).translationKey,
      );
      return IdentitySwitchOutcome.Failed;
    }
    const identityOnly: Parameters<
      DeviceProtectionActions["unlockDeviceProtection"]
    >[0] = { initializeSession: false };
    await new DeviceProtectionActions(vault).unlockDeviceProtection(
      identityOnly,
    );
    const providerLoad: Parameters<typeof vault.loadProviders>[0] = {
      ensureLocalRow: true,
    };
    const loaded = await vault.loadProviders(providerLoad);
    vault.devicesAccessIdentityTransitionPending = false;
    if (loaded.isErr()) {
      vault.errorMsg = vault.t(loaded.error.translationKey);
      return IdentitySwitchOutcome.Failed;
    }
    vault.applyActiveProviderCredentials();
    return vault.deviceProtectionReady
      ? IdentitySwitchOutcome.Unlocked
      : IdentitySwitchOutcome.Locked;
  }
}
