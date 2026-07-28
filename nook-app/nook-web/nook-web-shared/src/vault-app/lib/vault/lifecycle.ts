import type { VaultState } from "$lib/vault.svelte";
import type { NookSecretRecord } from "$lib/nook";
import { getVaultManager } from "$lib/nook";
import { createLogger } from "$lib/log";
import {
  DeviceProtectionStatus,
  hasActiveLocalVault,
  parseAppLocale,
  prepareNewLocalVaultSlot,
  setActiveVault,
  type NookAppLocale,
  type NookVaultManager,
} from "$app-wasm";
import { APP_KIND } from "$lib/app-kind";
import { LOCAL_PROVIDER_TYPE } from "$lib/auth-providers";
import {
  setupDeviceProtection,
  unlockDeviceProtection,
} from "$lib/passkey-device-protection";
import {
  intoWasmStringValue,
  takeWasmStringValue,
} from "$lib/wasm-string-value";
import { JoinEnrollmentState } from "$app-wasm";
import * as localLoginActions from "$lib/vault/local-login";
import * as sentinelGenesisActions from "$lib/vault/sentinel-genesis";

const log = createLogger("vault-lifecycle");

export async function initOnce(state: VaultState): Promise<void> {
  log.info("app init started");
  state.isInitializing = true;
  let deviceIdentityUnlocked = false;
  if (!state.isVerifying) state.errorMsg = "";
  try {
    const savedLocale = takeWasmStringValue(
      parseAppLocale(
        intoWasmStringValue(localStorage.getItem("nook_locale") ?? undefined),
      ),
    ) as NookAppLocale | undefined;
    const browserLocale = state.browserLocale.appLocale() as NookAppLocale;
    const locale = savedLocale ?? browserLocale;
    await state.updateLocale(locale);
    await state.refreshLocalVaultCatalog();
    state.manager = await getVaultManager();
    if (state.manager.vaultApplication !== APP_KIND) {
      throw new Error(
        state.t("app.capability_mismatch", {
          app: APP_KIND,
          wasm: state.manager.vaultApplication,
        }),
      );
    }
    await state.updateLocale(locale, { preferWasm: true });
    state.deviceProtectionStatus = await state.manager.deviceProtectionStatus();
    const persistedDeviceMode =
      await state.manager.deviceProtectionDeviceMode();
    if (
      persistedDeviceMode === "standard" ||
      persistedDeviceMode === "anti-hacker"
    ) {
      state.draftDeviceMode = persistedDeviceMode;
    }
    if (state.deviceProtectionStatus === DeviceProtectionStatus.Pin) {
      state.deviceProtectionLockedStatus = DeviceProtectionStatus.Pin;
    } else if (
      state.deviceProtectionStatus === DeviceProtectionStatus.Passkey
    ) {
      state.deviceProtectionLockedStatus = DeviceProtectionStatus.Passkey;
    }

    const autoAuthorizeE2e =
      state.runtimeConfig.e2eExposeVault &&
      localStorage.getItem("nook_e2e_manual_passkey") !== "true";
    if (!state.deviceProtectionReady && autoAuthorizeE2e) {
      if (state.deviceProtectionStatus === DeviceProtectionStatus.Passkey) {
        await state.enqueueStorage(() =>
          unlockDeviceProtection(state.manager!),
        );
      } else if (state.deviceProtectionStatus === DeviceProtectionStatus.Pin) {
        return;
      } else {
        await state.enqueueStorage(() =>
          setupDeviceProtection(state.manager!, ""),
        );
      }
      deviceIdentityUnlocked = true;
      state.deviceAuthorizationInProgress = true;
    }

    if (!state.deviceProtectionReady && !deviceIdentityUnlocked) {
      if (state.pendingEnrollmentFromUrl) {
        const code = state.pendingEnrollmentFromUrl;
        state.pendingEnrollmentFromUrl = undefined;
        state.prefillEnrollmentCode = code;
        state.enrollmentFromUrlPending = true;
      }
      if (!state.localVaultPresent && state.localVaults.length === 0) {
        try {
          await state.loadProviders({ ensureLocalRow: true });
          state.applyActiveProviderCredentials();
        } catch (error) {
          log.warn("empty-device provider load deferred until passkey", {
            error: error instanceof Error ? error.message : String(error),
          });
          state.providersLoaded = true;
        }
      }
      return;
    }
    await continueInitializationAfterDeviceUnlock(state);
    state.deviceProtectionStatus = DeviceProtectionStatus.Unlocked;
  } catch (error) {
    if (
      state.deviceProtectionStatus === DeviceProtectionStatus.Unlocked ||
      deviceIdentityUnlocked
    ) {
      void state.lockDeviceProtection();
    }
    state.deviceProtectionStatus =
      state.deviceProtectionStatus === DeviceProtectionStatus.Loading
        ? DeviceProtectionStatus.Error
        : state.deviceProtectionStatus;
    state.errorMsg =
      error instanceof Error
        ? error.message
        : "Failed to initialize Nook Session Manager.";
  } finally {
    state.deviceAuthorizationInProgress = false;
    state.isInitializing = false;
  }
}

export async function continueInitializationAfterDeviceUnlock(
  state: VaultState,
): Promise<void> {
  if (!state.manager) return;
  await state.initDeviceIdentity({ allowPendingAuthorization: true });
  if (
    await state.enqueueStorage(() =>
      state.manager!.hasPendingSentinelGenesisFinalization(),
    )
  ) {
    const rawResult = await state.enqueueStorage(() =>
      state.manager!.resumePendingSentinelGenesisFinalization(),
    );
    sentinelGenesisActions.applyFinalizeResult(state, rawResult);
  }
  await state.loadProviders({ ensureLocalRow: true });
  await state.refreshLocalVaultCatalog();
  if (!state.activeVaultStoreId) {
    state.activeVaultStoreId = state.localVaults[0]?.storeId;
  }
  if (state.activeVaultStoreId) {
    await setActiveVault(state.activeVaultStoreId).catch(() => undefined);
  }
  state.localVaultPresent = await hasActiveLocalVault();
  if (state.localVaultPresent) {
    state.storageMode = LOCAL_PROVIDER_TYPE;
    state.githubPat = "";
    state.oauthFile = undefined;
    state.localFolder = undefined;
  } else {
    state.applyActiveProviderCredentials();
  }
  const hasPendingEnrollment = Boolean(state.pendingEnrollmentFromUrl);
  if (state.localVaultPresent) {
    state.storageMode = LOCAL_PROVIDER_TYPE;
    await state.refreshPasswordEntriesList();
  }
  const autoUnlock = !hasPendingEnrollment && state.shouldAutoUnlock();
  if (autoUnlock) {
    await state.loadDb();
    if (!state.isAuthenticated && state.localProvider) {
      void state.refreshPasswordEntriesList();
    }
  } else {
    await state.refreshDeviceState();
  }

  if (state.pendingEnrollmentFromUrl && !state.isAuthenticated) {
    const code = state.pendingEnrollmentFromUrl;
    state.pendingEnrollmentFromUrl = undefined;
    state.prefillEnrollmentCode = code;
    state.enrollmentFromUrlPending = true;
  }
  if (state.isAuthenticated) {
    await state.runFanOutSyncAfterLocalSave();
    state.startVaultSync();
  }

  log.info("app init finished", {
    localVaultPresent: state.localVaultPresent,
    authenticated: state.isAuthenticated,
    providers: state.providers.length,
    syncProviders: state.syncProviders.length,
    deviceId: state.deviceId || undefined,
  });
}

export async function initDeviceIdentity(
  state: VaultState,
  options?: { allowPendingAuthorization?: boolean },
): Promise<void> {
  if (
    !state.manager ||
    (!state.deviceProtectionReady &&
      !state.deviceAuthorizationInProgress &&
      !options?.allowPendingAuthorization)
  ) {
    throw new Error(state.t("errors.device_protection.authorization_required"));
  }
  const identity = await state.enqueueStorage(() => ({
    deviceId: state.manager!.device_id,
    devicePublicKey: state.manager!.device_public_key,
  }));
  state.deviceId = identity.deviceId;
  state.devicePublicKey = identity.devicePublicKey;
}

export async function authorizeWithExternalDeviceIdentity(
  state: VaultState,
  adopt: (manager: NookVaultManager) => Promise<void>,
  options?: { deferInitialization?: boolean },
): Promise<boolean> {
  if (!state.manager) return false;
  const priorDeviceProtectionStatus = state.deviceProtectionStatus;
  state.errorMsg = "";
  state.isVerifying = true;
  state.deviceAuthorizationInProgress = true;
  try {
    await state.enqueueStorage(() => adopt(state.manager!));
    if (options?.deferInitialization) {
      await initDeviceIdentity(state, { allowPendingAuthorization: true });
    } else {
      await continueInitializationAfterDeviceUnlock(state);
    }
    state.deviceProtectionStatus = DeviceProtectionStatus.Unlocked;
    log.info("extension identity adopted", { deviceId: state.deviceId });
    return true;
  } catch (error) {
    await state.enqueueStorage(() =>
      state.manager!.rollbackExtensionIdentityHandoff(),
    );
    state.deviceProtectionStatus =
      priorDeviceProtectionStatus === DeviceProtectionStatus.Unlocked
        ? state.deviceProtectionLockedStatus
        : priorDeviceProtectionStatus;
    state.errorMsg = state.t("extension.connect.identity_handoff_failed");
    log.warn("extension identity handoff failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  } finally {
    state.deviceAuthorizationInProgress = false;
    state.isVerifying = false;
  }
}

export async function init(state: VaultState) {
  if (state.initPromise) {
    return state.initPromise;
  }
  state.initPromise = state.initOnce();
  return state.initPromise;
}

export async function createFreshVault(state: VaultState) {
  if (!state.manager) return;
  state.errorMsg = "";
  state.dismissSuccess();
  state.isVerifying = true;
  log.info("creating fresh remote vault", { mode: state.storageMode });
  try {
    await state.initDeviceIdentity();
    const creatingAdditionalVault = state.localVaults.length > 0;
    if (creatingAdditionalVault) {
      await prepareNewLocalVaultSlot();
    }
    const rawRecords = await state.enqueueStorage(async () => {
      if (creatingAdditionalVault) {
        state.manager!.resetVaultSession();
      }
      const connectPromise = state.manager!.connect_fresh(
        ...state.wasmStorageArgs(),
      );
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(
                "Connection timed out. Check your PAT, network, and try again.",
              ),
            ),
          30_000,
        );
      });
      return (await Promise.race([
        connectPromise,
        timeoutPromise,
      ])) as NookSecretRecord[];
    });
    for (const record of rawRecords) record.free();
    await state.loadSecretPage("", 0);
    state.markVaultUnlocked();
    state.activeVaultStoreId = localLoginActions.requireManagerVaultStoreId(
      state.manager,
    );
    await localLoginActions.refreshLocalVaultCatalog(state);
    await state.ensureProviderSaved();
    await state.syncActiveVaultStoreIdToAuth();
    await state.hydrateMultiDeviceState();
    state.joinEnrollmentPrompt = JoinEnrollmentState.None;
    log.info("fresh remote vault created", {
      mode: state.storageMode,
      secrets: rawRecords.length,
    });
    state.showSuccess(state.t("toasts.vault_created"));
    state.startIdleSessionTracking();
  } catch (e: unknown) {
    state.isAuthenticated = false;
    const message =
      e instanceof Error ? e.message : "Failed to create a new vault.";
    log.warn("fresh vault create failed", { error: message });
    state.errorMsg = message;
  } finally {
    state.isVerifying = false;
  }
}
