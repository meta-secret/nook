import { I18N_KEYS } from "../../../generated/i18n-keys";
import type { VaultState } from "$lib/vault.svelte";
import type { NookSecretRecord } from "$lib/nook";
import { createLogger } from "$lib/runtime/log";
import {
  getActiveVaultSelection,
  hasActiveLocalVault,
  listLocalVaults,
  prepareNewLocalVaultSlot,
  setActiveVault,
  setLocalVaultLabel,
  setVaultSessionLocked,
  NookVaultSwitchState,
  NookActiveVaultSelectionState,
  type NookVaultManager,
} from "$app-wasm";
import { activeVaultScope, saveAuthProviders } from "$lib/auth/providers";
import {
  ActiveVaultKind,
  LocalLoginPreparationState,
} from "$lib/vault/state/provider.svelte";
import { refreshLoginUnlockCapabilities } from "$lib/vault/login-unlock-capabilities";

const log = createLogger("vault-local");

export async function reloadProvidersForActiveVault(
  state: VaultState,
): Promise<void> {
  const snapshot = await state.enqueueStorage(() =>
    state.requireManager().loadAuthProviders(),
  );
  state.providers = snapshot.providers;
  if (snapshot.activeVaultStoreId.state === "storeId") {
    state.openActiveVault(snapshot.activeVaultStoreId.value);
  }
  state.applyActiveProviderCredentials();
}

export function beginLoginVaultPicker(state: VaultState): void {
  state.clearSelectedLoginVaultStore();
  state.localLoginPreparation = LocalLoginPreparationState.Idle;
  state.resetVaultSessionState();
}

export async function chooseLoginVault({
  state,
  storeId,
}: {
  readonly state: VaultState;
  readonly storeId: string;
}): Promise<void> {
  await state.selectVaultForUnlock(storeId);
  state.selectLoginVault(storeId);
}

export async function switchToVault({
  state,
  storeId,
}: {
  readonly state: VaultState;
  readonly storeId: string;
}): Promise<void> {
  const switchDecision = state.clientPolicy.vaultSwitchTarget(
    storeId,
    state.hasActiveVaultStore,
    state.activeVault.kind === ActiveVaultKind.Open
      ? state.activeVault.storeId
      : "",
    state.isVerifying,
  );
  if (switchDecision.state !== NookVaultSwitchState.Switch) {
    switchDecision.free();
    return;
  }
  const target = switchDecision.target();
  switchDecision.free();
  state.helpOpen = false;
  state.cancelProviderSetup();
  state.cancelAddProvider();
  state.isVerifying = true;
  try {
    await state.waitForStorageChain();
    setVaultSessionLocked(true);
    state.clearUnlockedSession();
    await state.waitForStorageChain();
    const chooseLoginVaultArgs: Parameters<typeof chooseLoginVault>[0] = {
      state,
      storeId: target,
    };
    await chooseLoginVault(chooseLoginVaultArgs);
    state.isVerifying = true;
    await state.lockDeviceProtection();
    const infoArgs = { storeId: target };
    log.info("vault switch completed" + " " + JSON.stringify(infoArgs));
  } catch (error) {
    state.errorMsg =
      error instanceof Error ? error.message : "Failed to switch vaults.";
  } finally {
    state.isVerifying = false;
  }
}

/** Every connected vault must have a non-empty `store_id` in its YAML session. */
export function requireManagerVaultStoreId(manager: NookVaultManager): string {
  const storeId = manager.vaultStoreId.trim();
  if (!storeId) {
    throw new Error("Vault is missing store_id after connect.");
  }
  return storeId;
}

export async function refreshLocalVaultCatalog(
  state: VaultState,
): Promise<void> {
  state.localVaults = await listLocalVaults();
  state.localVaultPresent = await hasActiveLocalVault();
  const activeSelection = await getActiveVaultSelection();
  try {
    if (activeSelection.state === NookActiveVaultSelectionState.Selected) {
      state.openActiveVault(activeSelection.storeId);
    }
  } finally {
    activeSelection.free();
  }
}

export async function prepareLocalLogin(state: VaultState): Promise<void> {
  if (
    !state.localVaultPresent ||
    state.localLoginPreparation !== LocalLoginPreparationState.Idle
  )
    return;
  state.localLoginPreparation = LocalLoginPreparationState.Preparing;
  log.debug("preparing local login gate");
  try {
    state.storageMode = "local";
    state.githubPat = "";
    state.clearOauthFile();
    state.clearLocalFolder();
    await state.refreshPasswordEntriesList();
    state.localLoginPreparation = LocalLoginPreparationState.Ready;
  } catch (error) {
    state.localLoginPreparation = LocalLoginPreparationState.Idle;
    throw error;
  }
}

export async function selectVaultForUnlock({
  state,
  storeId,
}: {
  readonly state: VaultState;
  readonly storeId: string;
}): Promise<void> {
  state.errorMsg = "";
  state.dismissSuccess();
  state.isVerifying = true;
  try {
    await setActiveVault(storeId);
    state.openActiveVault(storeId);
    if (state.hasManager) {
      await state.enqueueStorage(() =>
        state.requireManager().resetVaultSession(),
      );
    }
    state.localVaultPresent = await hasActiveLocalVault();
    state.localLoginPreparation = LocalLoginPreparationState.Idle;
    await state.syncActiveVaultStoreIdToAuth();
    await state.reloadProvidersForActiveVault();
    await state.refreshPasswordEntriesList();
    await refreshLoginUnlockCapabilities(state);
    state.localLoginPreparation = LocalLoginPreparationState.Ready;
  } catch (e) {
    state.errorMsg =
      e instanceof Error
        ? e.message
        : state.t(I18N_KEYS.ErrorsVaultSelectionFailed);
  } finally {
    state.isVerifying = false;
  }
}

export async function prepareExistingVaultImportSlot(
  state: VaultState,
): Promise<void> {
  await prepareNewLocalVaultSlot();
  if (state.hasManager) {
    await state.enqueueStorage(() =>
      state.requireManager().resetVaultSession(),
    );
  }
  state.clearActiveVaultStore();
  state.localVaultPresent = await hasActiveLocalVault();
  state.localLoginPreparation = LocalLoginPreparationState.Idle;
}

export async function createLocalVaultWithDeviceKeys({
  state,
  label,
}: {
  readonly state: VaultState;
  readonly label?: string;
}): Promise<void> {
  if (!state.hasManager) {
    state.errorMsg = state.t(I18N_KEYS.ErrorsEngineUnavailable);
    return;
  }
  if (state.isVerifying) return;

  const trimmedLabel = label?.trim() ?? "";
  if (!trimmedLabel) {
    state.errorMsg = state.t(I18N_KEYS.LoginVaultNameRequired);
    return;
  }

  state.errorMsg = "";
  state.dismissSuccess();
  state.storageMode = "local";
  state.githubPat = "";
  state.clearOauthFile();
  state.clearLocalFolder();
  state.isVerifying = true;

  try {
    await state.initDeviceIdentity();
    const creatingAdditionalVault = state.localVaults.length > 0;
    if (creatingAdditionalVault) {
      await prepareNewLocalVaultSlot();
      await state.enqueueStorage(() =>
        state.requireManager().resetVaultSession(),
      );
    }
    state.applyDraftVaultArchitecture();
    const rawRecords = (await state.enqueueStorage(() => {
      if (creatingAdditionalVault) {
        return state.requireManager().connect_fresh("local", "", "");
      }
      return state.requireManager().connect("local", "", "");
    })) as NookSecretRecord[];
    for (const record of rawRecords) record.free();
    const loadPageArgs: Parameters<typeof state.loadSecretPage>[0] = {
      query: "",
      requestedOffset: 0,
    };
    await state.loadSecretPage(loadPageArgs);
    state.markVaultUnlocked();
    const storeId = requireManagerVaultStoreId(state.requireManager());
    state.openActiveVault(storeId);
    await state.enqueueStorage(() =>
      state.requireManager().setVaultName(trimmedLabel),
    );
    await setLocalVaultLabel(storeId, trimmedLabel);
    await refreshLocalVaultCatalog(state);
    state.localLoginPreparation = LocalLoginPreparationState.Ready;
    await state.ensureProviderSaved();
    await state.syncActiveVaultStoreIdToAuth();
    await state.hydrateMultiDeviceState();
    const infoArgs2 = {
      secrets: rawRecords.length,
      deviceId: state.deviceId,
      storeId,
    };
    log.info(
      "local vault created (device keys)" + " " + JSON.stringify(infoArgs2),
    );
    state.showSuccess(state.t(I18N_KEYS.ToastsLocalLoaded));
    state.startIdleSessionTracking();
    state.startVaultSync();
  } catch (e) {
    state.isAuthenticated = false;
    const message =
      e instanceof Error
        ? e.message
        : state.t(I18N_KEYS.ErrorsVaultCreationFailed);
    const warnArgs = { error: message };
    log.warn("local vault create failed" + " " + JSON.stringify(warnArgs));
    state.errorMsg = message;
  } finally {
    state.isVerifying = false;
  }
}

enum PreviousVaultLabelKind {
  Missing = "missing",
  Present = "present",
}

type PreviousVaultLabel =
  | { kind: PreviousVaultLabelKind.Missing }
  | { kind: PreviousVaultLabelKind.Present; label: string };

export async function renameLocalVaultLabel({
  state,
  storeId,
  label,
}: {
  readonly state: VaultState;
  readonly storeId: string;
  readonly label: string;
}): Promise<void> {
  const trimmedStoreId = storeId.trim();
  const trimmedLabel = label.trim();
  if (!trimmedStoreId) return;
  if (!trimmedLabel) {
    state.errorMsg = state.t(I18N_KEYS.LoginVaultNameRequired);
    return;
  }

  state.errorMsg = "";
  state.dismissSuccess();
  state.isVerifying = true;
  const previousLabelInitial: PreviousVaultLabel = {
    kind: PreviousVaultLabelKind.Missing,
  };
  const previousLabel = state.localVaults.reduce<PreviousVaultLabel>(
    // eslint-disable-next-line max-params -- Host API owns this positional callback signature.
    (current, vault) =>
      vault.storeId.trim() === trimmedStoreId
        ? { kind: PreviousVaultLabelKind.Present, label: vault.label }
        : current,
    previousLabelInitial,
  );
  let renameCommitted = false;

  try {
    await setLocalVaultLabel(trimmedStoreId, trimmedLabel);
    if (
      state.activeVault.kind === ActiveVaultKind.Open &&
      trimmedStoreId === state.activeVault.storeId.trim()
    ) {
      await state.enqueueStorage(() =>
        state.requireManager().setVaultName(trimmedLabel),
      );
    }
    renameCommitted = true;
    await refreshLocalVaultCatalog(state);
    state.showSuccess(state.t(I18N_KEYS.ToastsVaultRenamed));
  } catch (e) {
    if (
      !renameCommitted &&
      previousLabel.kind === PreviousVaultLabelKind.Present
    ) {
      try {
        await setLocalVaultLabel(trimmedStoreId, previousLabel.label);
        await refreshLocalVaultCatalog(state);
      } catch (rollbackError) {
        const warnArgs2 = {
          error:
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError),
        };
        log.warn(
          "local vault rename rollback failed" +
            " " +
            JSON.stringify(warnArgs2),
        );
      }
    }
    state.errorMsg =
      e instanceof Error
        ? e.message
        : state.t(I18N_KEYS.ErrorsVaultRenameFailed);
  } finally {
    state.isVerifying = false;
  }
}

export async function syncActiveVaultStoreIdToAuth(
  state: VaultState,
): Promise<void> {
  if (state.activeVault.kind === ActiveVaultKind.Closed) return;
  const storeId = state.activeVault.storeId.trim();
  if (!storeId) return;
  await state.enqueueStorage(() =>
    (() => {
      const saveAuthProvidersArgs: Parameters<typeof saveAuthProviders>[0] = {
        manager: state.requireManager(),
        snapshot: {
          providers: state.providers,
          activeVaultStoreId: activeVaultScope(storeId),
        },
      };
      return saveAuthProviders(saveAuthProvidersArgs);
    })(),
  );
}

export async function activateConnectedExistingVault({
  state,
  storeId,
}: {
  readonly state: VaultState;
  readonly storeId: string;
}): Promise<void> {
  if (!state.hasManager || !state.isAuthenticated) return;
  const connectedStoreId = requireManagerVaultStoreId(state.requireManager());
  if (connectedStoreId !== storeId) {
    throw new Error(state.t(I18N_KEYS.ErrorsVaultSelectionFailed));
  }
  await setActiveVault(storeId);
  state.openActiveVault(storeId);
  await refreshLocalVaultCatalog(state);
  await syncActiveVaultStoreIdToAuth(state);
}
