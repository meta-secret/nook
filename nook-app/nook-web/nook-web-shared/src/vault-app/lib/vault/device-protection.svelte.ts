import { I18N_KEYS } from "../../../generated/i18n-keys";
/** Device-protection actions that snapshot reactive state for persistence. */
import {
  isPasskeyCeremonyNotAllowedError,
  isPasskeyPrfUnavailableError,
  isPasskeyUnavailableError,
  recoverDeviceProtectionWithPasskey as recoverExistingPasskeyProtection,
  sanitizedPasskeyCeremonyData,
  setupDeviceProtection as createPasskeyProtection,
  unlockDeviceProtection as authorizePasskeyProtection,
} from "$lib/auth/passkey-device-protection";
import {
  activeVaultScope,
  LOCAL_PROVIDER_TYPE,
  unselectedVaultScope,
} from "$lib/auth/providers";
import { createLogger } from "$lib/runtime/log";
import type { DeviceMode } from "$lib/vault/architecture-model";
import type { VaultState } from "$lib/vault.svelte";
import { ActiveVaultKind } from "$lib/vault/state/provider.svelte";
import {
  DeviceProtectionStatus,
  providers_visible_while_device_locked,
} from "$app-wasm";

const log = createLogger("vault-device-protection");

export function lockDeviceProtection(state: VaultState): Promise<void> {
  state.deviceProtectionStatus = state.deviceProtectionLockedStatus;
  state.deviceAuthorizationInProgress = false;
  state.deviceId = "";
  state.devicePublicKey = "";
  const snapshotArgs: Parameters<typeof $state.snapshot>[0] = {
    providers: state.providers,
    activeVaultStoreId:
      state.activeVault.kind === ActiveVaultKind.Open
        ? activeVaultScope(state.activeVault.storeId)
        : unselectedVaultScope(),
  };
  state.providers = providers_visible_while_device_locked(
    $state.snapshot(snapshotArgs),
  ).providers;
  state.providersLoaded = state.providers.length > 0;
  state.githubPat = "";
  state.clearOauthFile();
  state.clearLocalFolder();
  if (state.localVaultPresent) {
    state.storageMode = LOCAL_PROVIDER_TYPE;
  }
  if (!state.hasManager) return Promise.resolve();
  // Zeroize in-memory app-key material immediately. Queuing through storage
  // would leave Devices & access reporting Identity unlocked until the queue
  // drained, including when lock keeps the /devices-access route open.
  try {
    state.requireManager().lock_device_identity();
  } catch {
    // Persisted identity remains wrapped even if the manager is tearing down.
  }
  return Promise.resolve();
}

async function finishAuthorizedInitialization({
  state,
  mode,
}: {
  readonly state: VaultState;
  readonly mode: DeviceProtectionStatus;
}): Promise<void> {
  state.deviceAuthorizationInProgress = true;
  state.deviceProtectionLockedStatus = mode;
  await state.continueInitializationAfterDeviceUnlock();
  state.deviceProtectionStatus = DeviceProtectionStatus.Unlocked;
}

function lockFailedAuthorization({
  state,
  deviceIdentityUnlocked,
}: {
  readonly state: VaultState;
  readonly deviceIdentityUnlocked: boolean;
}): void {
  if (
    state.deviceProtectionStatus === DeviceProtectionStatus.Unlocked ||
    deviceIdentityUnlocked
  ) {
    void state.lockDeviceProtection();
  }
}

function logPasskeyCeremony({
  message,
  data,
}: {
  readonly message: string;
  readonly data: ReturnType<typeof sanitizedPasskeyCeremonyData>;
}): void {
  const context: Parameters<typeof log.warnWithContext>[0] = {
    message,
    serializedContext: JSON.stringify(data),
  };
  log.warnWithContext(context);
}

export async function setupDeviceProtection({
  state,
  passkeyLabel,
  deviceMode,
}: {
  readonly state: VaultState;
  readonly passkeyLabel: string;
  readonly deviceMode: DeviceMode;
}): Promise<void> {
  if (!state.hasManager || state.isVerifying) return;
  state.isVerifying = true;
  state.errorMsg = "";
  let deviceIdentityUnlocked = false;
  try {
    const localizedPasskeyLabel =
      passkeyLabel.trim() ||
      state.t(I18N_KEYS.DeviceProtectionPasskeyDefaultLabel);
    await state.enqueueStorage(() => {
      const protectionArgs: Parameters<typeof createPasskeyProtection>[0] = {
        manager: state.requireManager(),
        passkeyLabel: localizedPasskeyLabel,
        deviceMode,
      };
      return createPasskeyProtection(protectionArgs);
    });
    deviceIdentityUnlocked = true;
    const finishAuthorizedInitializationArgs: Parameters<
      typeof finishAuthorizedInitialization
    >[0] = { state, mode: DeviceProtectionStatus.Passkey };
    await finishAuthorizedInitialization(finishAuthorizedInitializationArgs);
  } catch (error) {
    if (isPasskeyCeremonyNotAllowedError(error)) {
      const logPasskeyCeremonyArgs: Parameters<typeof logPasskeyCeremony>[0] = {
        message: "passkey creation did not finish",
        data: sanitizedPasskeyCeremonyData(error),
      };
      logPasskeyCeremony(logPasskeyCeremonyArgs);
      state.errorMsg = state.t(
        I18N_KEYS.DeviceProtectionPasskeyCreateNotAllowed,
      );
      return;
    }
    if (isPasskeyUnavailableError(error)) {
      const logPasskeyCeremonyArgs2: Parameters<typeof logPasskeyCeremony>[0] =
        {
          message:
            "passkey unavailable; offering PIN device protection fallback",
          data: sanitizedPasskeyCeremonyData(error),
        };
      logPasskeyCeremony(logPasskeyCeremonyArgs2);
      state.deviceProtectionStatus = DeviceProtectionStatus.PinSetup;
      state.errorMsg = state.t(
        I18N_KEYS.DeviceProtectionPasskeyUnavailablePinFallbackReady,
      );
      return;
    }
    if (isPasskeyPrfUnavailableError(error)) {
      const logPasskeyCeremonyArgs3: Parameters<typeof logPasskeyCeremony>[0] =
        {
          message:
            "passkey PRF unavailable; offering PIN device protection fallback",
          data: sanitizedPasskeyCeremonyData(error),
        };
      logPasskeyCeremony(logPasskeyCeremonyArgs3);
      state.deviceProtectionStatus = DeviceProtectionStatus.PinSetup;
      state.errorMsg = state.t(I18N_KEYS.DeviceProtectionPinFallbackReady);
      return;
    }
    const logPasskeyCeremonyArgs4: Parameters<typeof logPasskeyCeremony>[0] = {
      message: "passkey device protection setup failed",
      data: sanitizedPasskeyCeremonyData(error),
    };
    logPasskeyCeremony(logPasskeyCeremonyArgs4);
    const lockFailedAuthorizationArgs: Parameters<
      typeof lockFailedAuthorization
    >[0] = { state, deviceIdentityUnlocked };
    lockFailedAuthorization(lockFailedAuthorizationArgs);
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
    const finishAuthorizedInitializationArgs2: Parameters<
      typeof finishAuthorizedInitialization
    >[0] = { state, mode: DeviceProtectionStatus.Passkey };
    await finishAuthorizedInitialization(finishAuthorizedInitializationArgs2);
  } catch (error) {
    if (isPasskeyCeremonyNotAllowedError(error)) {
      const logPasskeyCeremonyArgs5: Parameters<typeof logPasskeyCeremony>[0] =
        {
          message: "passkey recovery did not finish",
          data: sanitizedPasskeyCeremonyData(error),
        };
      logPasskeyCeremony(logPasskeyCeremonyArgs5);
      state.errorMsg = state.t(
        I18N_KEYS.DeviceProtectionPasskeyRecoveryNotAllowed,
      );
      return;
    }
    if (isPasskeyUnavailableError(error)) {
      const logPasskeyCeremonyArgs6: Parameters<typeof logPasskeyCeremony>[0] =
        {
          message:
            "passkey recovery unavailable; offering PIN device protection fallback",
          data: sanitizedPasskeyCeremonyData(error),
        };
      logPasskeyCeremony(logPasskeyCeremonyArgs6);
      state.deviceProtectionStatus = DeviceProtectionStatus.PinSetup;
      state.errorMsg = state.t(
        I18N_KEYS.DeviceProtectionRecoveryPasskeyUnavailablePinFallbackReady,
      );
      return;
    }
    if (isPasskeyPrfUnavailableError(error)) {
      const logPasskeyCeremonyArgs7: Parameters<typeof logPasskeyCeremony>[0] =
        {
          message:
            "passkey recovery PRF unavailable; offering PIN device protection fallback",
          data: sanitizedPasskeyCeremonyData(error),
        };
      logPasskeyCeremony(logPasskeyCeremonyArgs7);
      state.deviceProtectionStatus = DeviceProtectionStatus.PinSetup;
      state.errorMsg = state.t(
        I18N_KEYS.DeviceProtectionRecoveryPinFallbackReady,
      );
      return;
    }
    const logPasskeyCeremonyArgs8: Parameters<typeof logPasskeyCeremony>[0] = {
      message: "passkey device protection recovery failed",
      data: sanitizedPasskeyCeremonyData(error),
    };
    logPasskeyCeremony(logPasskeyCeremonyArgs8);
    const lockFailedAuthorizationArgs2: Parameters<
      typeof lockFailedAuthorization
    >[0] = { state, deviceIdentityUnlocked };
    lockFailedAuthorization(lockFailedAuthorizationArgs2);
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

export async function setupPinDeviceProtection({
  state,
  pin,
  confirmPin,
}: {
  readonly state: VaultState;
  readonly pin: string;
  readonly confirmPin: string;
}): Promise<void> {
  if (!state.hasManager || state.isVerifying) return;
  state.isVerifying = true;
  state.errorMsg = "";
  let deviceIdentityUnlocked = false;
  try {
    if (pin !== confirmPin) {
      throw new Error(state.t(I18N_KEYS.DeviceProtectionPinMismatch));
    }
    await state.enqueueStorage(() =>
      state.requireManager().finish_pin_device_protection(pin),
    );
    deviceIdentityUnlocked = true;
    const finishAuthorizedInitializationArgs3: Parameters<
      typeof finishAuthorizedInitialization
    >[0] = { state, mode: DeviceProtectionStatus.Pin };
    await finishAuthorizedInitialization(finishAuthorizedInitializationArgs3);
  } catch (error) {
    log.warn("PIN device protection setup failed");
    const lockFailedAuthorizationArgs3: Parameters<
      typeof lockFailedAuthorization
    >[0] = { state, deviceIdentityUnlocked };
    lockFailedAuthorization(lockFailedAuthorizationArgs3);
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
    const finishAuthorizedInitializationArgs4: Parameters<
      typeof finishAuthorizedInitialization
    >[0] = { state, mode: DeviceProtectionStatus.Passkey };
    await finishAuthorizedInitialization(finishAuthorizedInitializationArgs4);
  } catch (error) {
    if (isPasskeyCeremonyNotAllowedError(error)) {
      const logPasskeyCeremonyArgs9: Parameters<typeof logPasskeyCeremony>[0] =
        {
          message: "passkey authorization did not finish",
          data: sanitizedPasskeyCeremonyData(error),
        };
      logPasskeyCeremony(logPasskeyCeremonyArgs9);
      state.errorMsg = state.t(
        I18N_KEYS.DeviceProtectionPasskeyUnlockNotAllowed,
      );
      return;
    }
    const logPasskeyCeremonyArgs10: Parameters<typeof logPasskeyCeremony>[0] = {
      message: "passkey device protection unlock failed",
      data: sanitizedPasskeyCeremonyData(error),
    };
    logPasskeyCeremony(logPasskeyCeremonyArgs10);
    const lockFailedAuthorizationArgs4: Parameters<
      typeof lockFailedAuthorization
    >[0] = { state, deviceIdentityUnlocked };
    lockFailedAuthorization(lockFailedAuthorizationArgs4);
    state.errorMsg =
      error instanceof Error ? error.message : "Passkey authorization failed.";
  } finally {
    state.deviceAuthorizationInProgress = false;
    state.isVerifying = false;
    state.isInitializing = false;
  }
}

export async function unlockPinDeviceProtection({
  state,
  pin,
}: {
  readonly state: VaultState;
  readonly pin: string;
}): Promise<void> {
  if (!state.hasManager || state.isVerifying) return;
  state.isVerifying = true;
  state.errorMsg = "";
  let deviceIdentityUnlocked = false;
  try {
    await state.enqueueStorage(() =>
      state.requireManager().unlock_pin_device_identity(pin),
    );
    deviceIdentityUnlocked = true;
    const finishAuthorizedInitializationArgs5: Parameters<
      typeof finishAuthorizedInitialization
    >[0] = { state, mode: DeviceProtectionStatus.Pin };
    await finishAuthorizedInitialization(finishAuthorizedInitializationArgs5);
  } catch (error) {
    log.warn("PIN device protection unlock failed");
    const lockFailedAuthorizationArgs5: Parameters<
      typeof lockFailedAuthorization
    >[0] = { state, deviceIdentityUnlocked };
    lockFailedAuthorization(lockFailedAuthorizationArgs5);
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
    await state.requireManager().reset_device_protection_for_recovery();
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
    state.showSuccess(state.t(I18N_KEYS.DeviceProtectionRecoveryComplete));
  } catch (error) {
    log.warn("device protection recovery reset failed");
    state.errorMsg =
      error instanceof Error ? error.message : "Recovery reset failed.";
  } finally {
    state.isVerifying = false;
  }
}
