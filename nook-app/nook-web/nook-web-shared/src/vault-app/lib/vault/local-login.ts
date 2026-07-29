import type { VaultState } from "$lib/vault.svelte";
import type { NookSecretRecord } from "$lib/nook";
import { createLogger } from "$lib/log";
import {
  getActiveVaultId,
  hasActiveLocalVault,
  listLocalVaults,
  prepareNewLocalVaultSlot,
  setActiveVault,
  setLocalVaultLabel,
  setVaultSessionLocked,
  NookVaultSwitchState,
  type NookVaultManager,
} from "$app-wasm";
import { saveAuthProviders } from "$lib/auth-providers";

const log = createLogger("vault-local");

export async function reloadProvidersForActiveVault(
  state: VaultState,
): Promise<void> {
  const snapshot = await state.enqueueStorage(() =>
    state.manager!.loadAuthProviders(),
  );
  state.providers = snapshot.providers;
  if (snapshot.activeVaultStoreId) {
    state.activeVaultStoreId = snapshot.activeVaultStoreId;
  }
  state.applyActiveProviderCredentials();
}

export function beginLoginVaultPicker(state: VaultState): void {
  state.clearSelectedLoginVaultStore();
  state.localLoginPrepared = false;
  state.resetVaultSessionState();
}

export async function chooseLoginVault(
  state: VaultState,
  storeId: string,
): Promise<void> {
  await state.selectVaultForUnlock(storeId);
  state.selectedLoginVaultStoreId = storeId;
}

export async function switchToVault(
  state: VaultState,
  storeId: string,
): Promise<void> {
  const switchDecision = state.clientPolicy.vaultSwitchTarget(
    storeId,
    state.hasActiveVaultStore,
    state.activeVaultStoreId ?? "",
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
    await chooseLoginVault(state, target);
    state.isVerifying = true;
    await state.lockDeviceProtection();
    log.info("vault switch completed", { storeId: target });
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
  const activeFromWasm = await getActiveVaultId();
  if (activeFromWasm) {
    state.activeVaultStoreId = activeFromWasm;
  }
}

export async function prepareLocalLogin(state: VaultState): Promise<void> {
  if (!state.localVaultPresent || state.localLoginPrepared) return;
  log.debug("preparing local login gate");
  state.storageMode = "local";
  state.githubPat = "";
  state.clearOauthFile();
  state.clearLocalFolder();
  await state.refreshPasswordEntriesList();
  state.localLoginPrepared = true;
}

export async function selectVaultForUnlock(
  state: VaultState,
  storeId: string,
): Promise<void> {
  state.errorMsg = "";
  state.dismissSuccess();
  state.isVerifying = true;
  try {
    await setActiveVault(storeId);
    state.activeVaultStoreId = storeId;
    if (state.manager) {
      await state.enqueueStorage(() => state.manager!.resetVaultSession());
    }
    state.localVaultPresent = await hasActiveLocalVault();
    state.localLoginPrepared = false;
    await state.syncActiveVaultStoreIdToAuth();
    await state.reloadProvidersForActiveVault();
    await state.refreshPasswordEntriesList();
    state.localLoginPrepared = true;
  } catch (e: unknown) {
    state.errorMsg =
      e instanceof Error ? e.message : state.t("errors.vault_selection_failed");
  } finally {
    state.isVerifying = false;
  }
}

export async function prepareExistingVaultImportSlot(
  state: VaultState,
): Promise<void> {
  await prepareNewLocalVaultSlot();
  if (state.manager) {
    await state.enqueueStorage(() => state.manager!.resetVaultSession());
  }
  state.clearActiveVaultStore();
  state.localVaultPresent = await hasActiveLocalVault();
  state.localLoginPrepared = false;
}

export async function createLocalVaultWithDeviceKeys(
  state: VaultState,
  label?: string,
): Promise<void> {
  if (!state.manager) {
    state.errorMsg = state.t("errors.engine_unavailable");
    return;
  }
  if (state.isVerifying) return;

  const trimmedLabel = label?.trim() ?? "";
  if (!trimmedLabel) {
    state.errorMsg = state.t("login.vault_name_required");
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
      await state.enqueueStorage(() => state.manager!.resetVaultSession());
    }
    state.applyDraftVaultArchitecture();
    const rawRecords = (await state.enqueueStorage(() => {
      if (creatingAdditionalVault) {
        return state.manager!.connect_fresh("local", "", "");
      }
      return state.manager!.connect("local", "", "");
    })) as NookSecretRecord[];
    for (const record of rawRecords) record.free();
    await state.loadSecretPage("", 0);
    state.markVaultUnlocked();
    const storeId = requireManagerVaultStoreId(state.manager);
    state.activeVaultStoreId = storeId;
    await state.enqueueStorage(() => state.manager!.setVaultName(trimmedLabel));
    await setLocalVaultLabel(storeId, trimmedLabel);
    await refreshLocalVaultCatalog(state);
    state.localLoginPrepared = true;
    await state.ensureProviderSaved();
    await state.syncActiveVaultStoreIdToAuth();
    await state.hydrateMultiDeviceState();
    log.info("local vault created (device keys)", {
      secrets: rawRecords.length,
      deviceId: state.deviceId,
      storeId,
    });
    state.showSuccess(state.t("toasts.local_loaded"));
    state.startIdleSessionTracking();
    state.startVaultSync();
  } catch (e: unknown) {
    state.isAuthenticated = false;
    const message =
      e instanceof Error ? e.message : state.t("errors.vault_creation_failed");
    log.warn("local vault create failed", { error: message });
    state.errorMsg = message;
  } finally {
    state.isVerifying = false;
  }
}

export async function renameLocalVaultLabel(
  state: VaultState,
  storeId: string,
  label: string,
): Promise<void> {
  const trimmedStoreId = storeId.trim();
  const trimmedLabel = label.trim();
  if (!trimmedStoreId) return;
  if (!trimmedLabel) {
    state.errorMsg = state.t("login.vault_name_required");
    return;
  }

  state.errorMsg = "";
  state.dismissSuccess();
  state.isVerifying = true;
  const previousLabel = state.localVaults.find(
    (vault) => vault.storeId.trim() === trimmedStoreId,
  )?.label;
  let renameCommitted = false;

  try {
    await setLocalVaultLabel(trimmedStoreId, trimmedLabel);
    if (trimmedStoreId === state.activeVaultStoreId?.trim()) {
      await state.enqueueStorage(() =>
        state.manager!.setVaultName(trimmedLabel),
      );
    }
    renameCommitted = true;
    await refreshLocalVaultCatalog(state);
    state.showSuccess(state.t("toasts.vault_renamed"));
  } catch (e: unknown) {
    if (!renameCommitted && previousLabel !== undefined) {
      try {
        await setLocalVaultLabel(trimmedStoreId, previousLabel);
        await refreshLocalVaultCatalog(state);
      } catch (rollbackError: unknown) {
        log.warn("local vault rename rollback failed", {
          error:
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError),
        });
      }
    }
    state.errorMsg =
      e instanceof Error ? e.message : state.t("errors.vault_rename_failed");
  } finally {
    state.isVerifying = false;
  }
}

export async function syncActiveVaultStoreIdToAuth(
  state: VaultState,
): Promise<void> {
  const storeId = state.activeVaultStoreId?.trim();
  if (!storeId) return;
  await state.enqueueStorage(() =>
    saveAuthProviders(state.manager!, {
      providers: state.providers,
      activeVaultStoreId: storeId,
    }),
  );
}

export async function activateConnectedExistingVault(
  state: VaultState,
  storeId: string,
): Promise<void> {
  if (!state.manager || !state.isAuthenticated) return;
  const connectedStoreId = requireManagerVaultStoreId(state.manager);
  if (connectedStoreId !== storeId) {
    throw new Error(state.t("errors.vault_selection_failed"));
  }
  await setActiveVault(storeId);
  state.activeVaultStoreId = storeId;
  await refreshLocalVaultCatalog(state);
  await syncActiveVaultStoreIdToAuth(state);
}
