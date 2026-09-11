import {
  LocaleCatalogSource,
  SavedAppLocaleKind,
  VaultLocaleActions,
} from "$lib/vault/locale";
import type { OAuthFailure } from "$lib/auth/oauth-failure";
import { NativeVaultStorageFailure } from "$lib/runtime/storage-failure";
import { err as storageErr, ok as storageOk, type Result } from "neverthrow";
import {
  VaultStorageFailure as StorageOperationFailure,
  VaultStorageFailureKind as StorageOperationFailureKind,
} from "$lib/runtime/storage-failure";
import {
  AdoptedBrowserIdentity,
  BrowserIdentityHandoffKind,
} from "$lib/vault/identity-handoff";
import type { NookAdoptedExtensionIdentityHandoff } from "$app-wasm";
import { I18N_KEYS } from "../../../generated/i18n-keys";
import type { VaultState } from "$lib/vault.svelte";
import { VaultManagerRuntime } from "$lib/nook";
import { browserLogRuntime } from "$lib/runtime/log";
import {
  DeviceMode,
  DeviceIdentityInitializationMode,
  DeviceProtectionDeviceModeState,
  DeviceProtectionStatus,
  ExternalDeviceIdentityAuthorizationMode,
  configured_vault_application,
  has_active_local_vault,
  prepare_new_local_vault_slot,
  set_active_vault,
  set_vault_session_locked,
  type NookVaultManager,
} from "$app-wasm";
import { LOCAL_PROVIDER_TYPE } from "$lib/auth/providers";
import {
  setupDeviceProtection,
  unlockDeviceProtection,
  type PasskeyCeremonyFailure,
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
import { VaultDiscoveryTimeout } from "$lib/vault/vault-discovery-timeout";
import { LoginUnlockPresentation } from "$lib/vault/login-unlock-capabilities";

const log = browserLogRuntime.createLogger("vault-lifecycle");

type DeviceIdentityInitialization = {
  readonly mode: DeviceIdentityInitializationMode;
};

type ExternalDeviceIdentityAuthorization = {
  readonly adopt: (
    manager: NookVaultManager,
  ) => Promise<
    Result<NookAdoptedExtensionIdentityHandoff, StorageOperationFailure>
  >;
  readonly mode: ExternalDeviceIdentityAuthorizationMode;
};

/** Owns browser orchestration for one lifecycle context. */
export class VaultInitializationActions {
  constructor(private readonly state: VaultState) {}

  async initOnce(): Promise<void> {
    const state = this.state;
    log.info("app init started");
    state.isInitializing = true;
    let deviceIdentityUnlocked = false;
    if (!state.isVerifying) state.errorMsg = "";
    try {
      const savedLocale = new VaultLocaleActions(state).savedAppLocale();
      if (savedLocale.isErr()) {
        state.errorMsg = state.t(savedLocale.error.translationKey);
        return;
      }
      const localeState = savedLocale.value;
      const browserLocale = state.browserLocale.app_locale();
      const locale =
        localeState.kind === SavedAppLocaleKind.Supported
          ? localeState.locale
          : browserLocale;
      const initialLocaleArgs: Parameters<typeof state.updateLocale>[0] = {
        newLocale: locale,
        catalogSource: LocaleCatalogSource.Bundled,
      };
      const initialLocale = await state.updateLocale(initialLocaleArgs);
      if (initialLocale.isErr()) {
        state.errorMsg = state.t(initialLocale.error.translationKey);
        return;
      }
      const catalogRefresh1 = await state.refreshLocalVaultCatalog();
      if (catalogRefresh1.isErr()) {
        state.errorMsg = state.t(catalogRefresh1.error.translationKey);
        return;
      }
      const manager = await new VaultManagerRuntime().open();
      if (manager.isErr()) {
        state.deviceProtectionStatus = DeviceProtectionStatus.Error;
        state.errorMsg = state.t(I18N_KEYS.ErrorsEngineUnavailable);
        return;
      }
      state.openManager(manager.value);
      const configuredApplication = configured_vault_application();
      if (manager.value.vaultApplication !== configuredApplication) {
        const tArgs: Parameters<typeof state.t>[0] = {
          key: I18N_KEYS.AppCapabilityMismatch,
          replacements: {
            app: String(configuredApplication),
            wasm: String(manager.value.vaultApplication),
          },
        };
        state.errorMsg = state.t(tArgs);
        state.deviceProtectionStatus = DeviceProtectionStatus.Error;
        return;
      }
      const updateLocaleArgs: Parameters<typeof state.updateLocale>[0] = {
        newLocale: locale,
        catalogSource: LocaleCatalogSource.Engine,
      };
      const updatedLocale = await state.updateLocale(updateLocaleArgs);
      if (updatedLocale.isErr()) {
        state.errorMsg = state.t(updatedLocale.error.translationKey);
        return;
      }
      const protectionStatus = await state.enqueueStorage(async () => {
        const admitted = state.admitManager();
        if (admitted.isErr()) return storageErr(admitted.error);
        try {
          return storageOk(await admitted.value.device_protection_status());
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure));
        }
      });
      if (protectionStatus.isErr()) {
        state.deviceProtectionStatus = DeviceProtectionStatus.Error;
        state.errorMsg = state.t(protectionStatus.error.translationKey);
        return;
      }
      state.deviceProtectionStatus = protectionStatus.value;
      const protectionMode = await state.enqueueStorage(async () => {
        const admitted = state.admitManager();
        if (admitted.isErr()) return storageErr(admitted.error);
        try {
          return storageOk(
            await admitted.value.device_protection_device_mode(),
          );
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure));
        }
      });
      if (protectionMode.isErr()) {
        state.errorMsg = state.t(protectionMode.error.translationKey);
        return;
      }
      const persistedDeviceMode = protectionMode.value;
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
          const authorization = await state.enqueueStorage(
            async (): Promise<
              Result<void, PasskeyCeremonyFailure | StorageOperationFailure>
            > => {
              const manager = state.admitManager();
              if (manager.isErr()) return storageErr(manager.error);
              return unlockDeviceProtection(manager.value);
            },
          );
          if (authorization.isErr()) {
            state.errorMsg = state.t(authorization.error.translationKey);
            return;
          }
          deviceIdentityUnlocked = true;
          state.deviceAuthorizationInProgress = true;
        } else if (
          state.deviceProtectionStatus === DeviceProtectionStatus.Pin
        ) {
          return;
        } else if (!state.localVaultPresent) {
          // A surviving local vault must not mint a replacement app key. That
          // key is not on the roster, and backup-password recovery would fail.
          const authorization = await state.enqueueStorage(
            async (): Promise<
              Result<void, PasskeyCeremonyFailure | StorageOperationFailure>
            > => {
              const manager = state.admitManager();
              if (manager.isErr()) return storageErr(manager.error);
              // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
              return setupDeviceProtection({
                manager: manager.value,
                passkeyLabel: "",
                deviceMode: state.draftDeviceMode,
              });
            },
          );
          if (authorization.isErr()) {
            state.errorMsg = state.t(authorization.error.translationKey);
            return;
          }
          deviceIdentityUnlocked = true;
          state.deviceAuthorizationInProgress = true;
        }
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
          state.initializePristineDeviceProviders();
        }
        return;
      }
      const continued = await this.continueInitializationAfterDeviceUnlock();
      if (continued.isErr()) {
        if (deviceIdentityUnlocked) {
          const locked = await state.lockDeviceProtection();
          if (locked.isErr()) {
            state.errorMsg = state.t(locked.error.translationKey);
            return;
          }
        }
        state.errorMsg = state.t(continued.error.translationKey);
        return;
      }
      state.deviceProtectionStatus = DeviceProtectionStatus.Unlocked;
    } catch (error) {
      log.warn("app init diagnostic: initialization exception");
      if (
        state.deviceProtectionStatus === DeviceProtectionStatus.Unlocked ||
        deviceIdentityUnlocked
      ) {
        void state.lockDeviceProtection().then((locked) => {
          if (locked.isErr())
            state.errorMsg = state.t(locked.error.translationKey);
        });
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

  async continueInitializationAfterDeviceUnlock(): Promise<
    Result<void, StorageOperationFailure | OAuthFailure>
  > {
    const continuation = DeviceInitializationContinuation.admit(this.state);
    if (continuation.isErr()) return storageErr(continuation.error);
    return continuation.value.continue();
  }

  async initDeviceIdentity({
    mode,
  }: DeviceIdentityInitialization): Promise<
    Result<void, StorageOperationFailure>
  > {
    const state = this.state;
    if (
      !state.hasManager ||
      (!state.deviceProtectionReady &&
        !state.deviceAuthorizationInProgress &&
        mode !== DeviceIdentityInitializationMode.AllowPendingAuthorization)
    ) {
      return storageErr(
        new StorageOperationFailure(
          StorageOperationFailureKind.DeviceAuthorizationRequired,
        ),
      );
    }
    const identity = await state.enqueueStorage(() => {
      const admitted = state.admitManager();
      if (admitted.isErr()) return storageErr(admitted.error);
      try {
        // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
        return storageOk({
          deviceId: admitted.value.device_id,
          devicePublicKey: admitted.value.device_public_key,
        });
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure));
      }
    });
    if (identity.isErr()) return storageErr(identity.error);
    state.deviceId = identity.value.deviceId;
    state.devicePublicKey = identity.value.devicePublicKey;
    return storageOk();
  }

  async authorizeWithExternalDeviceIdentity({
    adopt,
    mode,
  }: ExternalDeviceIdentityAuthorization): Promise<boolean> {
    const state = this.state;
    const manager = state.admitManager();
    if (manager.isErr()) {
      state.errorMsg = state.t(manager.error.translationKey);
      return false;
    }
    const priorDeviceProtectionStatus = state.deviceProtectionStatus;
    state.errorMsg = "";
    state.isVerifying = true;
    state.deviceAuthorizationInProgress = true;
    let completed = false;
    try {
      const adopted = await state.enqueueStorage(() => adopt(manager.value));
      if (adopted.isErr()) {
        state.errorMsg = state.t(adopted.error.translationKey);
        return false;
      }
      const adoption = new AdoptedBrowserIdentity(adopted.value);
      state.externalIdentityHandoff = {
        kind: BrowserIdentityHandoffKind.Adopted,
        adoption,
      };
      if (
        mode === ExternalDeviceIdentityAuthorizationMode.DeferInitialization
      ) {
        const marked = await state.enqueueStorage(() =>
          adoption.markExistingVaultImport(manager.value),
        );
        if (marked.isErr()) {
          state.errorMsg = state.t(marked.error.translationKey);
          return false;
        }
        // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
        const initialized = await this.initDeviceIdentity({
          mode: DeviceIdentityInitializationMode.AllowPendingAuthorization,
        });
        if (initialized.isErr()) {
          state.errorMsg = state.t(initialized.error.translationKey);
          return false;
        }
      } else {
        const continued = await this.continueInitializationAfterDeviceUnlock();
        if (continued.isErr()) {
          state.errorMsg = state.t(continued.error.translationKey);
          return false;
        }
      }
      const handoff = state.externalIdentityHandoff;
      if (handoff.kind === BrowserIdentityHandoffKind.Adopted) {
        const required = handoff.adoption.requiresConnect(manager.value);
        if (required.isErr()) {
          state.errorMsg = state.t(required.error.translationKey);
          return false;
        }
        if (!required.value) {
          const committed = await state.enqueueStorage(() =>
            adoption.commit(manager.value),
          );
          if (committed.isErr()) {
            state.errorMsg = state.t(committed.error.translationKey);
            return false;
          }
          state.externalIdentityHandoff = {
            kind: BrowserIdentityHandoffKind.Inactive,
          };
        }
      }
      state.deviceProtectionStatus = DeviceProtectionStatus.Unlocked;
      completed = true;
      log.info("extension identity adopted");
      return true;
    } finally {
      if (!completed) {
        const handoff = state.externalIdentityHandoff;
        state.externalIdentityHandoff = {
          kind: BrowserIdentityHandoffKind.Inactive,
        };
        if (handoff.kind === BrowserIdentityHandoffKind.Adopted) {
          const rolledBack = handoff.adoption.rollback(manager.value);
          if (rolledBack.isErr()) {
            state.errorMsg = state.t(rolledBack.error.translationKey);
            log.warn("extension identity durable rollback failed");
          }
        }
        const failureMessage = state.errorMsg;
        try {
          set_vault_session_locked(true);
        } catch {
          // The in-memory session still has to be cleared when browser-backed
          // session storage is unavailable during failure compensation.
        }
        state.clearUnlockedSession(false);
        state.deviceId = "";
        state.devicePublicKey = "";
        state.deviceProtectionStatus =
          priorDeviceProtectionStatus === DeviceProtectionStatus.Unlocked
            ? state.deviceProtectionLockedStatus
            : priorDeviceProtectionStatus;
        state.errorMsg =
          failureMessage ||
          state.t(I18N_KEYS.ExtensionConnectIdentityHandoffFailed);
      }
      state.deviceAuthorizationInProgress = false;
      state.isVerifying = false;
    }
  }

  async init() {
    const state = this.state;
    const initialization = state.vaultInitialization;
    if (initialization.kind === VaultInitializationKind.Initializing) {
      return initialization.completion;
    }
    const completion = state.initOnce();
    state.beginInitialization(completion);
    return completion;
  }

  async createFreshVault() {
    const state = this.state;
    if (!state.hasManager) return;
    state.errorMsg = "";
    state.dismissSuccess();
    state.isVerifying = true;
    log.info("creating fresh remote vault");
    try {
      const initialized = await state.initDeviceIdentity();
      if (initialized.isErr()) {
        state.errorMsg = state.t(initialized.error.translationKey);
        return;
      }
      const creatingAdditionalVault = state.localVaults.length > 0;
      if (creatingAdditionalVault) {
        await prepare_new_local_vault_slot();
      }
      const rawRecords = await state.enqueueStorage(async () => {
        const storageArgs = state.wasmStorageArgs();
        const admitted = state.admitManager();
        if (admitted.isErr()) return storageErr(admitted.error);
        const operation = (async () => {
          try {
            if (creatingAdditionalVault) admitted.value.reset_vault_session();
            return storageOk(
              await admitted.value.connect_fresh(
                storageArgs.mode,
                storageArgs.pat,
                storageArgs.repo,
              ),
            );
          } catch (nativeFailure) {
            return storageErr(new NativeVaultStorageFailure(nativeFailure));
          }
        })();
        // eslint-disable-next-line nook-typed-api/no-raw-object-arguments, nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
        return new VaultDiscoveryTimeout({ timeoutMs: 30_000 }).waitFor({
          operation,
          releaseLateValue: (records) => {
            for (const record of records) record.free();
          },
        });
      });
      if (rawRecords.isErr()) {
        state.errorMsg = state.t(rawRecords.error.translationKey);
        return;
      }
      for (const record of rawRecords.value) record.free();
      const loadPageArgs: Parameters<typeof state.loadSecretPage>[0] = {
        query: "",
        requestedOffset: 0,
      };
      const secretRefresh1 = await state.loadSecretPage(loadPageArgs);
      if (secretRefresh1.isErr()) {
        state.errorMsg = state.t(secretRefresh1.error.translationKey);
        return;
      }
      const unlocked = state.markVaultUnlocked();
      if (unlocked.isErr()) {
        state.errorMsg = state.t(unlocked.error.translationKey);
        return;
      }
      const connectedStore = new localLoginActions.VaultLoginActions(
        state,
      ).connectedVaultStoreId();
      if (connectedStore.isErr()) {
        state.errorMsg = state.t(connectedStore.error.translationKey);
        return;
      }
      state.openActiveVault(connectedStore.value);
      const catalogRefresh2 = await new localLoginActions.VaultLoginActions(
        state,
      ).refreshLocalVaultCatalog();
      if (catalogRefresh2.isErr()) {
        state.errorMsg = state.t(catalogRefresh2.error.translationKey);
        return;
      }
      const savedProvider1 = await state.ensureProviderSaved();
      if (savedProvider1.isErr()) {
        state.errorMsg = state.t(savedProvider1.error.translationKey);
        return;
      }
      const activeVaultPersistence = await state.syncActiveVaultStoreIdToAuth();
      if (activeVaultPersistence.isErr()) {
        state.errorMsg = state.t(activeVaultPersistence.error.translationKey);
        return;
      }
      const rosterRefresh1 = await state.hydrateMultiDeviceState();
      if (rosterRefresh1.isErr()) {
        state.errorMsg = state.t(rosterRefresh1.error.translationKey);
        return;
      }
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
}

/** Browser continuation is admitted only after the existing device-authorization transition. */
class DeviceInitializationContinuation {
  private readonly state: VaultState;
  private readonly manager: NookVaultManager;
  // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
  private constructor(request: {
    state: VaultState;
    manager: NookVaultManager;
  }) {
    this.state = request.state;
    this.manager = request.manager;
  }
  static admit(
    state: VaultState,
  ): Result<DeviceInitializationContinuation, StorageOperationFailure> {
    const manager = state.admitManager();
    if (manager.isErr()) return storageErr(manager.error);
    if (!state.deviceProtectionReady && !state.deviceAuthorizationInProgress)
      return storageErr(
        new StorageOperationFailure(
          StorageOperationFailureKind.DeviceAuthorizationRequired,
        ),
      );
    return storageOk(
      // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
      new DeviceInitializationContinuation({ state, manager: manager.value }),
    );
  }
  private requireCurrentManager(): Result<void, StorageOperationFailure> {
    const manager = this.state.admitManager();
    if (manager.isErr()) return storageErr(manager.error);
    if (
      manager.value !== this.manager ||
      (!this.state.deviceProtectionReady &&
        !this.state.deviceAuthorizationInProgress)
    )
      return storageErr(
        new StorageOperationFailure(
          StorageOperationFailureKind.DeviceAuthorizationRequired,
        ),
      );
    return storageOk();
  }
  async continue(): Promise<
    Result<void, StorageOperationFailure | OAuthFailure>
  > {
    const state = this.state;
    const current = this.requireCurrentManager();
    if (current.isErr()) return storageErr(current.error);
    const initialization: DeviceIdentityInitialization = {
      mode: DeviceIdentityInitializationMode.AllowPendingAuthorization,
    };
    const initialized = await new VaultInitializationActions(
      state,
    ).initDeviceIdentity(initialization);
    if (initialized.isErr()) return storageErr(initialized.error);
    const pending = await state.enqueueStorage(async () => {
      const admittedManager = state.admitManager();
      if (admittedManager.isErr()) return storageErr(admittedManager.error);
      try {
        return storageOk(
          await admittedManager.value.has_pending_sentinel_genesis_finalization(),
        );
      } catch (nativeFailure) {
        return storageErr(new NativeVaultStorageFailure(nativeFailure));
      }
    });
    if (pending.isErr()) return storageErr(pending.error);
    if (pending.value) {
      const rawResult = await state.enqueueStorage(async () => {
        const admittedManager = state.admitManager();
        if (admittedManager.isErr()) return storageErr(admittedManager.error);
        try {
          return storageOk(
            await admittedManager.value.resume_pending_sentinel_genesis_finalization(),
          );
        } catch (nativeFailure) {
          return storageErr(new NativeVaultStorageFailure(nativeFailure));
        }
      });
      if (rawResult.isErr()) return storageErr(rawResult.error);
      const applyFinalizeResultArgs: Parameters<
        sentinelGenesisActions.SentinelGenesisActions["applyFinalizeResult"]
      >[0] = { result: rawResult.value };
      new sentinelGenesisActions.SentinelGenesisActions(
        state,
      ).applyFinalizeResult(applyFinalizeResultArgs);
    }
    const loadProvidersArgs2: Parameters<typeof state.loadProviders>[0] = {
      ensureLocalRow: true,
    };
    const loadedProviders2 = await state.loadProviders(loadProvidersArgs2);
    if (loadedProviders2.isErr()) {
      log.warn("app init diagnostic: authorized provider load rejected");
      return storageErr(loadedProviders2.error);
    }
    const catalogRefresh3 = await state.refreshLocalVaultCatalog();
    if (catalogRefresh3.isErr()) {
      return storageErr(catalogRefresh3.error);
    }
    if (
      state.activeVault.kind === ActiveVaultKind.Closed &&
      state.localVaultCatalog.kind === LocalVaultCatalogKind.Available
    ) {
      state.openActiveVault(state.localVaultCatalog.first.storeId);
    }
    if (state.activeVault.kind === ActiveVaultKind.Open) {
      try {
        await set_active_vault(state.activeVault.storeId);
      } catch (failure) {
        log.warn("app init diagnostic: active vault selection rejected");
        return storageErr(new NativeVaultStorageFailure(failure));
      }
      const activeVaultPersistence = await state.syncActiveVaultStoreIdToAuth();
      if (activeVaultPersistence.isErr()) {
        log.warn("app init diagnostic: active vault persistence rejected");
        return storageErr(activeVaultPersistence.error);
      }
    }
    try {
      state.localVaultPresent = await has_active_local_vault();
    } catch (failure) {
      return storageErr(new NativeVaultStorageFailure(failure));
    }
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
      const passwordRefresh1 = await state.refreshPasswordEntriesList();
      if (passwordRefresh1.isErr()) {
        return storageErr(passwordRefresh1.error);
      }
      const presentation = await new LoginUnlockPresentation(state).refresh();
      if (presentation.isErr()) {
        log.warn("app init diagnostic: unlock assessment rejected");
        return storageErr(presentation.error);
      }
    }
    const autoUnlock = !hasPendingEnrollment && state.shouldAutoUnlock();
    if (autoUnlock) {
      await state.loadDb();
      if (
        !state.isAuthenticated &&
        state.localProvider.kind === LocalProviderLookupKind.Found
      ) {
        void state.refreshPasswordEntriesList().then((result) => {
          if (result.isErr())
            state.errorMsg = state.t(result.error.translationKey);
        });
      }
    } else {
      const devices = await state.refreshDeviceState();
      if (devices.isErr()) return storageErr(devices.error);
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
      const localSaveSync = await state.runFanOutSyncAfterLocalSave();
      if (localSaveSync.isErr()) return storageErr(localSaveSync.error);
      state.startVaultSync();
    }
    log.info("app init finished");
    return storageOk();
  }
}
