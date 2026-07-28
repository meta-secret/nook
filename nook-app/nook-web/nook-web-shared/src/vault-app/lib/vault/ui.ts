import type {
  OpenAdminAccordion,
  OpenSettingsArgs,
  UiActionsContext,
} from "$lib/vault/action-contexts";
import {
  clearTabScopedBrowserData,
  deleteLocalBrowserData,
} from "$lib/browser-data";
import { setVaultSessionLocked } from "$app-wasm";

export function openSettings(
  state: UiActionsContext,
  { section = "storage", accordion = "devices" }: OpenSettingsArgs = {},
): void {
  state.helpOpen = false;
  state.settingsSection = section;
  if (section === "storage") {
    state.cancelProviderSetup();
    state.cancelAddProvider();
    state.settingsAccordionSection = accordion;
  }
  state.settingsOpen = true;
  void state.refreshDeviceState();
}

export function openAdmin(
  state: UiActionsContext,
  accordion: OpenAdminAccordion = "vaults",
): void {
  state.helpOpen = false;
  state.cancelProviderSetup();
  state.cancelAddProvider();
  state.adminAccordionSection = accordion;
  state.settingsSection = "admin";
  state.settingsOpen = true;
  void state.refreshLocalVaultCatalog();
  void state.refreshDeviceState();
}

export function closeSettings(state: UiActionsContext): void {
  state.cancelProviderSetup();
  state.cancelAddProvider();
  state.settingsOpen = false;
}

export async function deleteLocalData(state: UiActionsContext): Promise<void> {
  if (!state.manager || state.isSaving || state.localDataDeletionStarted)
    return;
  state.errorMsg = "";
  state.dismissSuccess();
  state.isSaving = true;
  state.stopIdleSessionTracking();
  state.stopVaultSync();
  try {
    const manager = state.manager;
    await deleteLocalBrowserData(() => {
      const deletion = state.enqueueStorage(() =>
        manager.deleteLocalBrowserData(),
      );
      state.localDataDeletionStarted = true;
      return deletion;
    });
  } catch (error: unknown) {
    const managerWasZeroized = state.localDataDeletionStarted;
    setVaultSessionLocked(true);
    state.clearUnlockedSession(!managerWasZeroized);
    state.localDataDeletionStarted = false;
    state.errorMsg =
      error instanceof Error
        ? error.message
        : state.t("settings.delete_local_error");
    state.isSaving = false;
  }
}

export async function handleRemoteLocalBrowserDataDeletion(
  state: UiActionsContext,
): Promise<void> {
  if (state.localDataDeletionStarted) return;
  const resetManager = state.manager
    ? state.enqueueStorage(() => state.manager!.resetVaultSession())
    : state.waitForStorageChain();
  state.localDataDeletionStarted = true;
  state.stopIdleSessionTracking();
  state.stopVaultSync();
  setVaultSessionLocked(true);
  state.clearUnlockedSession(false);
  await resetManager;
  clearTabScopedBrowserData();
}

export function openHelp(state: UiActionsContext): void {
  state.settingsOpen = false;
  state.helpOpen = true;
}

export function closeHelp(state: UiActionsContext): void {
  state.helpOpen = false;
}
