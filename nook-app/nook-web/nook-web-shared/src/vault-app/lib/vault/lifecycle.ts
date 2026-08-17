import { I18N_KEYS } from "../../../generated/i18n-keys";
import type { VaultState } from "$lib/vault.svelte";
import type { NookSecretRecord } from "$lib/nook";
import { getVaultManager } from "$lib/nook";
import { createLogger } from "$lib/runtime/log";
import {
  DeviceMode,
  DeviceIdentityInitializationMode,
  DeviceProtectionDeviceModeState,
  DeviceProtectionStatus,
  ExternalDeviceIdentityAuthorizationMode,
  configured_vault_application,
  has_active_local_vault,
  NookAppLocaleParse,
  parse_app_locale,
  prepare_new_local_vault_slot,
  set_active_vault,
  set_vault_session_locked,
  supported_app_locale_code,
  type NookAppLocale,
  type NookVaultManager,
} from "$app-wasm";
import { LOCAL_PROVIDER_TYPE } from "$lib/auth/providers";
import {
  setupDeviceProtection,
  unlockDeviceProtection,
} from "$lib/auth/passkey-device-protection";
import { JoinEnrollmentState } from "$app-wasm";
import * as localLoginActions from "$lib/vault/local-login";
import * as sentinelGenesisActions from "$lib/vault/sentinel-genesis";
import {
  ActiveVaultKind,
  LocalProviderLookupKind,
  LocalVaultCatalogKind,
} from "$lib/vault/state/provider.svelte";
import {
  EnrollmentLinkKind,
  VaultInitializationKind,
} from "$lib/vault/state/lifecycle.svelte";
import { startVaultDiscoveryTimeout } from "$lib/vault/vault-discovery-timeout";

const log = createLogger("vault-lifecycle");

enum SavedAppLocaleKind {
  Missing = "missing",
  Supported = "supported",
}

type SavedAppLocale =
  | { kind: SavedAppLocaleKind.Missing }
  | { kind: SavedAppLocaleKind.Supported; locale: NookAppLocale };

function savedAppLocale(): SavedAppLocale {
  const stored = localStorage.getItem("nook_locale");
  if (!stored) {
    return { kind: SavedAppLocaleKind.Missing };
  }
  const parsed = parse_app_locale(stored);
  return parsed === NookAppLocaleParse.Unsupported
    ? { kind: SavedAppLocaleKind.Missing }
    : {
        kind: SavedAppLocaleKind.Supported,
        locale: supported_app_locale_code(parsed) as NookAppLocale,
      };
}

export async function initOnce(state: VaultState): Promise<void> {
  log.info("app init started");
  state.isInitializing = true;
  let deviceIdentityUnlocked = false;
  if (!state.isVerifying) state.errorMsg = "";
  try {
    const localeState = savedAppLocale();
    const browserLocale = state.browserLocale.app_locale() as NookAppLocale;
    const locale =
      localeState.kind === SavedAppLocaleKind.Supported
        ? localeState.locale
        : browserLocale;
    const initialLocaleArgs: Parameters<typeof state.updateLocale>[0] = {
      newLocale: locale,
      preferWasm: false,
    };
    await state.updateLocale(initialLocaleArgs);
    await state.refreshLocalVaultCatalog();
    state.openManager(await getVaultManager());
    const configuredApplication = configured_vault_application();
    if (state.requireManager().vaultApplication !== configuredApplication) {
      const tArgs: Parameters<typeof state.t>[0] = {
        key: I18N_KEYS.AppCapabilityMismatch,
        replacements: {
          app: String(configuredApplication),
          wasm: String(state.requireManager().vaultApplication),
        },
      };
      throw new Error(state.t(tArgs));
    }
    const updateLocaleArgs: Parameters<typeof state.updateLocale>[0] = {
      newLocale: locale,
      preferWasm: true,
    };
    await state.updateLocale(updateLocaleArgs);
    state.deviceProtectionStatus = await state
      .requireManager()
      .device_protection_status();
    const persistedDeviceMode = await state
      .requireManager()
      .device_protection_device_mode();
    if (persistedDeviceMode === DeviceProtectionDeviceModeState.Standard) {
      state.draftDeviceMode = DeviceMode.Standard;
    } else if (
      persistedDeviceMode === DeviceProtectionDeviceModeState.AntiHacker
    ) {
      state.draftDeviceMode = DeviceMode.AntiHacker;
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
          unlockDeviceProtection(state.requireManager()),
        );
      } else if (state.deviceProtectionStatus === DeviceProtectionStatus.Pin) {
        return;
      } else {
        await state.enqueueStorage(() => {
          const setupArgs: Parameters<typeof setupDeviceProtection>[0] = {
            manager: state.requireManager(),
            passkeyLabel: "",
            deviceMode: state.draftDeviceMode,
          };
          return setupDeviceProtection(setupArgs);
        });
      }
      deviceIdentityUnlocked = true;
      state.deviceAuthorizationInProgress = true;
    }

    if (!state.deviceProtectionReady && !deviceIdentityUnlocked) {
      const enrollment = state.enrollmentLinkState;
      if (enrollment.kind === EnrollmentLinkKind.Pending) {
        state.clearPendingEnrollmentFromUrl();
        state.prefillEnrollmentCode = enrollment.payload;
        state.enrollmentFromUrlPending = true;
      }
      // A backup password opens only its vault keys. Do not create a new app
      // key merely because this browser still has a local vault: that key has
      // not been granted membership and password recovery must remain usable
      // without altering identity ownership.
      if (state.localVaultPresent) {
        state.storageMode = LOCAL_PROVIDER_TYPE;
        await state.prepareLocalLogin();
        return;
      }
      if (state.localVaults.length === 0) {
        try {
          const loadProvidersArgs: Parameters<typeof state.loadProviders>[0] = {
            ensureLocalRow: true,
          };
          await state.loadProviders(loadProvidersArgs);
          state.applyActiveProviderCredentials();
        } catch {
          log.warn("empty-device provider load deferred until passkey ");
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
  if (!state.hasManager) return;
  const initialization: DeviceIdentityInitialization = {
    state,
    mode: DeviceIdentityInitializationMode.AllowPendingAuthorization,
  };
  await initDeviceIdentity(initialization);
  if (
    await state.enqueueStorage(() =>
      state.requireManager().has_pending_sentinel_genesis_finalization(),
    )
  ) {
    const rawResult = await state.enqueueStorage(() =>
      state.requireManager().resume_pending_sentinel_genesis_finalization(),
    );
    const applyFinalizeResultArgs: Parameters<
      typeof sentinelGenesisActions.applyFinalizeResult
    >[0] = { state, result: rawResult };
    sentinelGenesisActions.applyFinalizeResult(applyFinalizeResultArgs);
  }
  const loadProvidersArgs2: Parameters<typeof state.loadProviders>[0] = {
    ensureLocalRow: true,
  };
  await state.loadProviders(loadProvidersArgs2);
  await state.refreshLocalVaultCatalog();
  if (
    state.activeVault.kind === ActiveVaultKind.Closed &&
    state.localVaultCatalog.kind === LocalVaultCatalogKind.Available
  ) {
    state.openActiveVault(state.localVaultCatalog.first.storeId);
  }
  if (state.activeVault.kind === ActiveVaultKind.Open) {
    await set_active_vault(state.activeVault.storeId).catch(() => {});
  }
  state.localVaultPresent = await has_active_local_vault();
  if (state.localVaultPresent) {
    state.storageMode = LOCAL_PROVIDER_TYPE;
    state.githubPat = "";
    state.clearOauthFile();
    state.clearLocalFolder();
  } else {
    state.applyActiveProviderCredentials();
  }
  const hasPendingEnrollment =
    state.enrollmentLinkState.kind === EnrollmentLinkKind.Pending;
  if (state.localVaultPresent) {
    state.storageMode = LOCAL_PROVIDER_TYPE;
    await state.refreshPasswordEntriesList();
  }
  const autoUnlock = !hasPendingEnrollment && state.shouldAutoUnlock();
  if (autoUnlock) {
    await state.loadDb();
    if (
      !state.isAuthenticated &&
      state.localProvider.kind === LocalProviderLookupKind.Found
    ) {
      void state.refreshPasswordEntriesList();
    }
  } else {
    await state.refreshDeviceState();
  }

  const enrollment = state.enrollmentLinkState;
  if (
    enrollment.kind === EnrollmentLinkKind.Pending &&
    !state.isAuthenticated
  ) {
    state.clearPendingEnrollmentFromUrl();
    state.prefillEnrollmentCode = enrollment.payload;
    state.enrollmentFromUrlPending = true;
  }
  if (state.isAuthenticated) {
    await state.runFanOutSyncAfterLocalSave();
    state.startVaultSync();
  }
  log.info("app init finished");
}

type DeviceIdentityInitialization = {
  readonly state: VaultState;
  readonly mode: DeviceIdentityInitializationMode;
};

export async function initDeviceIdentity({
  state,
  mode,
}: DeviceIdentityInitialization): Promise<void> {
  if (
    !state.hasManager ||
    (!state.deviceProtectionReady &&
      !state.deviceAuthorizationInProgress &&
      mode !== DeviceIdentityInitializationMode.AllowPendingAuthorization)
  ) {
    throw new Error(
      state.t(I18N_KEYS.ErrorsDeviceProtectionAuthorizationRequired),
    );
  }
  const identity = await state.enqueueStorage(() => ({
    deviceId: state.requireManager().device_id,
    devicePublicKey: state.requireManager().device_public_key,
  }));
  state.deviceId = identity.deviceId;
  state.devicePublicKey = identity.devicePublicKey;
}

type ExternalDeviceIdentityAuthorization = {
  readonly state: VaultState;
  readonly adopt: (manager: NookVaultManager) => Promise<void>;
  readonly mode: ExternalDeviceIdentityAuthorizationMode;
};

export async function authorizeWithExternalDeviceIdentity({
  state,
  adopt,
  mode,
}: ExternalDeviceIdentityAuthorization): Promise<boolean> {
  if (!state.hasManager) return false;
  const priorDeviceProtectionStatus = state.deviceProtectionStatus;
  state.errorMsg = "";
  state.isVerifying = true;
  state.deviceAuthorizationInProgress = true;
  try {
    await state.enqueueStorage(() => adopt(state.requireManager()));
    if (mode === ExternalDeviceIdentityAuthorizationMode.DeferInitialization) {
      await state.enqueueStorage(() =>
        state
          .requireManager()
          .mark_extension_identity_handoff_existing_vault_import(),
      );
      const initDeviceIdentityRequest: DeviceIdentityInitialization = {
        state,
        mode: DeviceIdentityInitializationMode.AllowPendingAuthorization,
      };
      await initDeviceIdentity(initDeviceIdentityRequest);
    } else {
      await continueInitializationAfterDeviceUnlock(state);
    }
    const requiresConnect = state
      .requireManager()
      .extension_identity_handoff_requires_connect();
    if (!requiresConnect) {
      await state.enqueueStorage(() =>
        state.requireManager().commit_extension_identity_handoff(),
      );
      await state.enqueueStorage(() =>
        state.requireManager().confirm_extension_identity_handoff(),
      );
    }
    state.deviceProtectionStatus = DeviceProtectionStatus.Unlocked;
    const adoptedIdentity: { readonly deviceId: string } = {
      deviceId: state.deviceId,
    };
    const context: Parameters<typeof log.infoWithContext>[0] = {
      message: "extension identity adopted",
      serializedContext: JSON.stringify(adoptedIdentity),
    };
    log.infoWithContext(context);
    return true;
  } catch {
    try {
      state.requireManager().rollback_extension_identity_handoff();
    } catch {
      log.warn("extension identity durable rollback failed");
    }
    set_vault_session_locked(true);
    state.clearUnlockedSession(false);
    state.deviceId = "";
    state.devicePublicKey = "";
    state.deviceProtectionStatus =
      priorDeviceProtectionStatus === DeviceProtectionStatus.Unlocked
        ? state.deviceProtectionLockedStatus
        : priorDeviceProtectionStatus;
    state.errorMsg = state.t(I18N_KEYS.ExtensionConnectIdentityHandoffFailed);
    log.warn("extension identity handoff failed");
    return false;
  } finally {
    state.deviceAuthorizationInProgress = false;
    state.isVerifying = false;
  }
}

export async function init(state: VaultState) {
  const initialization = state.vaultInitialization;
  if (initialization.kind === VaultInitializationKind.Initializing) {
    return initialization.completion;
  }
  const completion = state.initOnce();
  state.beginInitialization(completion);
  return completion;
}

export async function createFreshVault(state: VaultState) {
  if (!state.hasManager) return;
  state.errorMsg = "";
  state.dismissSuccess();
  state.isVerifying = true;
  log.info("creating fresh remote vault");
  try {
    await state.initDeviceIdentity();
    const creatingAdditionalVault = state.localVaults.length > 0;
    if (creatingAdditionalVault) {
      await prepare_new_local_vault_slot();
    }
    const rawRecords = await state.enqueueStorage(async () => {
      if (creatingAdditionalVault) {
        state.requireManager().reset_vault_session();
      }
      const connectPromise = state
        .requireManager()
        .connect_fresh(...state.wasmStorageArgs());
      const startVaultDiscoveryTimeoutArgs: Parameters<
        typeof startVaultDiscoveryTimeout
      >[0] = {
        message: state.t(I18N_KEYS.ToastsErrorTimeout),
        timeoutMs: 30_000,
      };
      const timeout = startVaultDiscoveryTimeout(
        startVaultDiscoveryTimeoutArgs,
      );
      try {
        return (await Promise.race([
          connectPromise,
          timeout.completion,
        ])) as NookSecretRecord[];
      } finally {
        timeout.cancel();
      }
    });
    for (const record of rawRecords) record.free();
    const loadPageArgs: Parameters<typeof state.loadSecretPage>[0] = {
      query: "",
      requestedOffset: 0,
    };
    await state.loadSecretPage(loadPageArgs);
    state.markVaultUnlocked();
    state.openActiveVault(
      localLoginActions.requireManagerVaultStoreId(state.requireManager()),
    );
    await localLoginActions.refreshLocalVaultCatalog(state);
    await state.ensureProviderSaved();
    await state.syncActiveVaultStoreIdToAuth();
    await state.hydrateMultiDeviceState();
    state.joinEnrollmentPrompt = JoinEnrollmentState.None;
    log.info("fresh remote vault created");
    state.showSuccess(state.t(I18N_KEYS.ToastsVaultCreated));
    state.startIdleSessionTracking();
  } catch (e) {
    state.isAuthenticated = false;
    const message =
      e instanceof Error ? e.message : "Failed to create a new vault.";
    log.warn("fresh vault create failed");
    state.errorMsg = message;
  } finally {
    state.isVerifying = false;
  }
}
