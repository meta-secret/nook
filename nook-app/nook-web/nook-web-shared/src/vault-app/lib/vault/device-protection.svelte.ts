/** Device-protection actions that snapshot reactive state for persistence. */
import {
  isPasskeyCeremonyNotAllowedError,
  isPasskeyPrfUnavailableError,
  isPasskeyUnavailableError,
  recoverDeviceProtectionWithPasskey as recoverExistingPasskeyProtection,
  sanitizedPasskeyCeremonyData,
  setupDeviceProtection as createPasskeyProtection,
  unlockDeviceProtection as authorizePasskeyProtection,
} from "$lib/passkey-device-protection";
import {
  activeVaultScope,
  LOCAL_PROVIDER_TYPE,
  unselectedVaultScope,
} from "$lib/auth-providers";
import { createLogger } from "$lib/log";
import type { DeviceMode } from "$lib/vault-architecture";
import type { VaultState } from "$lib/vault.svelte";
import { ActiveVaultKind } from "$lib/vault/state/provider.svelte";
import {
  DeviceProtectionStatus,
  providersVisibleWhileDeviceLocked,
} from "$app-wasm";

const log = createLogger("vault-device-protection");

export function lockDeviceProtection(state: VaultState): Promise<void> {
  state.deviceProtectionStatus = state.deviceProtectionLockedStatus;
  state.deviceAuthorizationInProgress = false;
  state.deviceId = "";
  state.devicePublicKey = "";
  state.providers = providersVisibleWhileDeviceLocked(
    $state.snapshot({
      providers: state.providers,
      activeVaultStoreId:
        state.activeVault.kind === ActiveVaultKind.Open
          ? activeVaultScope(state.activeVault.storeId)
          : unselectedVaultScope(),
    }),
  ).providers;
  state.providersLoaded = state.providers.length > 0;
  state.githubPat = "";
  state.clearOauthFile();
  state.clearLocalFolder();
  if (state.localVaultPresent) {
    state.storageMode = LOCAL_PROVIDER_TYPE;
  }
  if (!state.hasManager) return Promise.resolve();
  return state
    .enqueueStorage(() => state.requireManager().lockDeviceIdentity())
    .catch(() => {
      // Persisted identity remains wrapped even if the manager is tearing down.
    });
}

async function finishAuthorizedInitialization(
  state: VaultState,
  mode: DeviceProtectionStatus,
): Promise<void> {
  state.deviceAuthorizationInProgress = true;
  state.deviceProtectionLockedStatus = mode;
  await state.continueInitializationAfterDeviceUnlock();
  state.deviceProtectionStatus = DeviceProtectionStatus.Unlocked;
}

function lockFailedAuthorization(
  state: VaultState,
  deviceIdentityUnlocked: boolean,
): void {
  if (
    state.deviceProtectionStatus === DeviceProtectionStatus.Unlocked ||
    deviceIdentityUnlocked
  ) {
    void state.lockDeviceProtection();
  }
}

function logPasskeyCeremony(message: string, error: unknown): void {
  log.warn(message, sanitizedPasskeyCeremonyData(error));
}

export async function setupDeviceProtection(
  state: VaultState,
  passkeyLabel = "",
  deviceMode: DeviceMode = state.draftDeviceMode,
): Promise<void> {
  if (!state.hasManager || state.isVerifying) return;
  state.isVerifying = true;
  state.errorMsg = "";
  let deviceIdentityUnlocked = false;
  try {
    await state.enqueueStorage(() =>
      createPasskeyProtection(state.requireManager(), passkeyLabel, deviceMode),
    );
    deviceIdentityUnlocked = true;
    await finishAuthorizedInitialization(state, DeviceProtectionStatus.Passkey);
  } catch (error) {
    if (isPasskeyCeremonyNotAllowedError(error)) {
      logPasskeyCeremony("passkey creation did not finish", error);
      state.errorMsg = state.t("device_protection.passkey_create_not_allowed");
      return;
    }
    if (isPasskeyUnavailableError(error)) {
      logPasskeyCeremony(
        "passkey unavailable; offering PIN device protection fallback",
        error,
      );
      state.deviceProtectionStatus = DeviceProtectionStatus.PinSetup;
      state.errorMsg = state.t(
        "device_protection.passkey_unavailable_pin_fallback_ready",
      );
      return;
    }
    if (isPasskeyPrfUnavailableError(error)) {
      logPasskeyCeremony(
        "passkey PRF unavailable; offering PIN device protection fallback",
        error,
      );
      state.deviceProtectionStatus = DeviceProtectionStatus.PinSetup;
      state.errorMsg = state.t("device_protection.pin_fallback_ready");
      return;
    }
    logPasskeyCeremony("passkey device protection setup failed", error);
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
  if (!state.hasManager || state.isVerifying) return;
  state.isVerifying = true;
  state.errorMsg = "";
  let deviceIdentityUnlocked = false;
  try {
    await state.enqueueStorage(() =>
      recoverExistingPasskeyProtection(state.requireManager()),
    );
    deviceIdentityUnlocked = true;
    await finishAuthorizedInitialization(state, DeviceProtectionStatus.Passkey);
  } catch (error) {
    if (isPasskeyCeremonyNotAllowedError(error)) {
      logPasskeyCeremony("passkey recovery did not finish", error);
      state.errorMsg = state.t(
        "device_protection.passkey_recovery_not_allowed",
      );
      return;
    }
    if (isPasskeyUnavailableError(error)) {
      logPasskeyCeremony(
        "passkey recovery unavailable; offering PIN device protection fallback",
        error,
      );
      state.deviceProtectionStatus = DeviceProtectionStatus.PinSetup;
      state.errorMsg = state.t(
        "device_protection.recovery_passkey_unavailable_pin_fallback_ready",
      );
      return;
    }
    if (isPasskeyPrfUnavailableError(error)) {
      logPasskeyCeremony(
        "passkey recovery PRF unavailable; offering PIN device protection fallback",
        error,
      );
      state.deviceProtectionStatus = DeviceProtectionStatus.PinSetup;
      state.errorMsg = state.t("device_protection.recovery_pin_fallback_ready");
      return;
    }
    logPasskeyCeremony("passkey device protection recovery failed", error);
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
  if (!state.hasManager || state.isVerifying) return;
  state.isVerifying = true;
  state.errorMsg = "";
  let deviceIdentityUnlocked = false;
  try {
    if (pin !== confirmPin) {
      throw new Error(state.t("device_protection.pin_mismatch"));
    }
    await state.enqueueStorage(() =>
      state.requireManager().finishPinDeviceProtection(pin),
    );
    deviceIdentityUnlocked = true;
    await finishAuthorizedInitialization(state, DeviceProtectionStatus.Pin);
  } catch (error) {
    log.warn("PIN device protection setup failed", {
      outcome: "pin_setup_failed",
    });
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
  if (!state.hasManager || state.isVerifying) return;
  state.isVerifying = true;
  state.errorMsg = "";
  let deviceIdentityUnlocked = false;
  try {
    await state.enqueueStorage(() =>
      authorizePasskeyProtection(state.requireManager()),
    );
    deviceIdentityUnlocked = true;
    await finishAuthorizedInitialization(state, DeviceProtectionStatus.Passkey);
  } catch (error) {
    if (isPasskeyCeremonyNotAllowedError(error)) {
      logPasskeyCeremony("passkey authorization did not finish", error);
      state.errorMsg = state.t("device_protection.passkey_unlock_not_allowed");
      return;
    }
    logPasskeyCeremony("passkey device protection unlock failed", error);
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
  if (!state.hasManager || state.isVerifying) return;
  state.isVerifying = true;
  state.errorMsg = "";
  let deviceIdentityUnlocked = false;
  try {
    await state.enqueueStorage(() =>
      state.requireManager().unlockPinDeviceIdentity(pin),
    );
    deviceIdentityUnlocked = true;
    await finishAuthorizedInitialization(state, DeviceProtectionStatus.Pin);
  } catch (error) {
    log.warn("PIN device protection unlock failed", {
      outcome: "pin_unlock_failed",
    });
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
  if (!state.hasManager || state.isVerifying) return;
  state.isVerifying = true;
  state.errorMsg = "";
  try {
    await state.requireManager().resetDeviceProtectionForRecovery();
    state.deviceProtectionStatus = DeviceProtectionStatus.Missing;
    state.deviceProtectionLockedStatus = DeviceProtectionStatus.Passkey;
    state.deviceId = "";
    state.devicePublicKey = "";
    state.providers = [];
    state.providersLoaded = false;
    state.githubPat = "";
    state.clearOauthFile();
    state.clearLocalFolder();
    state.storageMode = LOCAL_PROVIDER_TYPE;
    state.showSuccess(state.t("device_protection.recovery_complete"));
  } catch (error) {
    log.warn("device protection recovery reset failed", {
      outcome: "recovery_reset_failed",
    });
    state.errorMsg =
      error instanceof Error ? error.message : "Recovery reset failed.";
  } finally {
    state.isVerifying = false;
  }
}
