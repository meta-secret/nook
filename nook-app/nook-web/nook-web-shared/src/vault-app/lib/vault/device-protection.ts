import {
  isPasskeyCeremonyNotAllowedError,
  isPasskeyPrfUnavailableError,
  isPasskeyUnavailableError,
  recoverDeviceProtectionWithPasskey as recoverExistingPasskeyProtection,
  setupDeviceProtection as createPasskeyProtection,
  unlockDeviceProtection as authorizePasskeyProtection,
} from "$lib/passkey-device-protection";
import { LOCAL_PROVIDER_TYPE } from "$lib/auth-providers";
import { createLogger } from "$lib/log";
import type { DeviceMode } from "$lib/vault-architecture";
import type { VaultState } from "$lib/vault.svelte";

const log = createLogger("vault-device-protection");

async function finishAuthorizedInitialization(
  state: VaultState,
  mode: "passkey" | "pin",
): Promise<void> {
  state.deviceAuthorizationInProgress = true;
  state.deviceProtectionLockedMode = mode;
  await state.continueInitializationAfterDeviceUnlock();
  state.deviceProtectionStatus = "unlocked";
}

function lockFailedAuthorization(
  state: VaultState,
  deviceIdentityUnlocked: boolean,
): void {
  if (state.deviceProtectionStatus === "unlocked" || deviceIdentityUnlocked) {
    void state.lockDeviceProtection();
  }
}

export async function setupDeviceProtection(
  state: VaultState,
  passkeyLabel = "",
  deviceMode: DeviceMode = state.draftDeviceMode,
): Promise<void> {
  if (!state.manager || state.isVerifying) return;
  state.isVerifying = true;
  state.errorMsg = "";
  let deviceIdentityUnlocked = false;
  try {
    await state.enqueueStorage(() =>
      createPasskeyProtection(state.manager!, passkeyLabel, deviceMode),
    );
    deviceIdentityUnlocked = true;
    await finishAuthorizedInitialization(state, "passkey");
  } catch (error) {
    if (isPasskeyCeremonyNotAllowedError(error)) {
      log.warn("passkey creation did not finish");
      state.errorMsg = state.t("device_protection.passkey_create_not_allowed");
      return;
    }
    if (isPasskeyUnavailableError(error)) {
      log.warn("passkey unavailable; offering PIN device protection fallback");
      state.deviceProtectionStatus = "pin-setup";
      state.errorMsg = state.t(
        "device_protection.passkey_unavailable_pin_fallback_ready",
      );
      return;
    }
    if (isPasskeyPrfUnavailableError(error)) {
      log.warn(
        "passkey PRF unavailable; offering PIN device protection fallback",
      );
      state.deviceProtectionStatus = "pin-setup";
      state.errorMsg = state.t("device_protection.pin_fallback_ready");
      return;
    }
    log.warn("passkey device protection setup failed");
    lockFailedAuthorization(state, deviceIdentityUnlocked);
    state.errorMsg =
      error instanceof Error ? error.message : "Failed to create passkey.";
  } finally {
    state.deviceAuthorizationInProgress = false;
    state.isVerifying = false;
    state.isInitializing = false;
  }
}

export async function recoverDeviceProtectionWithPasskey(
  state: VaultState,
): Promise<void> {
  if (!state.manager || state.isVerifying) return;
  state.isVerifying = true;
  state.errorMsg = "";
  let deviceIdentityUnlocked = false;
  try {
    await state.enqueueStorage(() =>
      recoverExistingPasskeyProtection(state.manager!),
    );
    deviceIdentityUnlocked = true;
    await finishAuthorizedInitialization(state, "passkey");
  } catch (error) {
    if (isPasskeyCeremonyNotAllowedError(error)) {
      log.warn("passkey recovery did not finish");
      state.errorMsg = state.t(
        "device_protection.passkey_recovery_not_allowed",
      );
      return;
    }
    if (isPasskeyUnavailableError(error)) {
      log.warn(
        "passkey recovery unavailable; offering PIN device protection fallback",
      );
      state.deviceProtectionStatus = "pin-setup";
      state.errorMsg = state.t(
        "device_protection.recovery_passkey_unavailable_pin_fallback_ready",
      );
      return;
    }
    if (isPasskeyPrfUnavailableError(error)) {
      log.warn(
        "passkey recovery PRF unavailable; offering PIN device protection fallback",
      );
      state.deviceProtectionStatus = "pin-setup";
      state.errorMsg = state.t("device_protection.recovery_pin_fallback_ready");
      return;
    }
    log.warn("passkey device protection recovery failed");
    lockFailedAuthorization(state, deviceIdentityUnlocked);
    state.errorMsg =
      error instanceof Error
        ? error.message
        : "Failed to use existing passkey.";
  } finally {
    state.deviceAuthorizationInProgress = false;
    state.isVerifying = false;
    state.isInitializing = false;
  }
}

export async function setupPinDeviceProtection(
  state: VaultState,
  pin: string,
  confirmPin: string,
): Promise<void> {
  if (!state.manager || state.isVerifying) return;
  state.isVerifying = true;
  state.errorMsg = "";
  let deviceIdentityUnlocked = false;
  try {
    if (pin !== confirmPin) {
      throw new Error(state.t("device_protection.pin_mismatch"));
    }
    await state.enqueueStorage(() =>
      state.manager!.finishPinDeviceProtection(pin),
    );
    deviceIdentityUnlocked = true;
    await finishAuthorizedInitialization(state, "pin");
  } catch (error) {
    lockFailedAuthorization(state, deviceIdentityUnlocked);
    state.errorMsg =
      error instanceof Error ? error.message : "Failed to create PIN.";
  } finally {
    state.deviceAuthorizationInProgress = false;
    state.isVerifying = false;
    state.isInitializing = false;
  }
}

export async function unlockDeviceProtection(state: VaultState): Promise<void> {
  if (!state.manager || state.isVerifying) return;
  state.isVerifying = true;
  state.errorMsg = "";
  let deviceIdentityUnlocked = false;
  try {
    await state.enqueueStorage(() =>
      authorizePasskeyProtection(state.manager!),
    );
    deviceIdentityUnlocked = true;
    await finishAuthorizedInitialization(state, "passkey");
  } catch (error) {
    if (isPasskeyCeremonyNotAllowedError(error)) {
      log.warn("passkey authorization did not finish");
      state.errorMsg = state.t("device_protection.passkey_unlock_not_allowed");
      return;
    }
    lockFailedAuthorization(state, deviceIdentityUnlocked);
    state.errorMsg =
      error instanceof Error ? error.message : "Passkey authorization failed.";
  } finally {
    state.deviceAuthorizationInProgress = false;
    state.isVerifying = false;
    state.isInitializing = false;
  }
}

export async function unlockPinDeviceProtection(
  state: VaultState,
  pin: string,
): Promise<void> {
  if (!state.manager || state.isVerifying) return;
  state.isVerifying = true;
  state.errorMsg = "";
  let deviceIdentityUnlocked = false;
  try {
    await state.enqueueStorage(() =>
      state.manager!.unlockPinDeviceIdentity(pin),
    );
    deviceIdentityUnlocked = true;
    await finishAuthorizedInitialization(state, "pin");
  } catch (error) {
    lockFailedAuthorization(state, deviceIdentityUnlocked);
    state.errorMsg =
      error instanceof Error ? error.message : "PIN authorization failed.";
  } finally {
    state.deviceAuthorizationInProgress = false;
    state.isVerifying = false;
    state.isInitializing = false;
  }
}

export async function resetDeviceProtectionForRecovery(
  state: VaultState,
): Promise<void> {
  if (!state.manager || state.isVerifying) return;
  state.isVerifying = true;
  state.errorMsg = "";
  try {
    await state.manager.resetDeviceProtectionForRecovery();
    state.deviceProtectionStatus = "missing";
    state.deviceProtectionLockedMode = "passkey";
    state.deviceId = "";
    state.devicePublicKey = "";
    state.providers = [];
    state.providersLoaded = false;
    state.githubPat = "";
    state.oauthFile = undefined;
    state.localFolder = undefined;
    state.storageMode = LOCAL_PROVIDER_TYPE;
    state.showSuccess(state.t("device_protection.recovery_complete"));
  } catch (error) {
    state.errorMsg =
      error instanceof Error ? error.message : "Recovery reset failed.";
  } finally {
    state.isVerifying = false;
  }
}
