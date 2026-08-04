import { I18N_KEYS } from "../../../generated/i18n-keys";
import type {
  OpenAdminAccordion,
  OpenSettingsArgs,
  UiActionsContext,
} from "$lib/vault/action-contexts";
import {
  clearTabScopedBrowserData,
  deleteLocalBrowserData,
} from "$lib/runtime/browser-data";
import { setVaultSessionLocked } from "$app-wasm";
import {
  AdminAccordionSection,
  SettingsAccordionSection,
  SettingsSection,
} from "$lib/vault/state/ui.svelte";
import { WorkspaceRoute, workspacePath } from "$lib/app/workspace-route";

function pushWorkspaceRoute(route: WorkspaceRoute): void {
  if (!("window" in globalThis)) return;
  const path = workspacePath(route);
  const nextUrl = new URL(path, window.location.href);
  if (
    window.location.pathname === nextUrl.pathname &&
    window.location.search === "" &&
    window.location.hash === ""
  ) {
    return;
  }
  window.history.pushState({}, "", path);
}

function applySettings(
  state: UiActionsContext,
  section: SettingsSection,
  accordion: SettingsAccordionSection,
): void {
  state.helpOpen = false;
  state.settingsSection = section;
  if (section === SettingsSection.Storage) {
    state.cancelProviderSetup();
    state.cancelAddProvider();
    state.settingsAccordionSection = accordion;
  }
  state.settingsOpen = true;
  void state.refreshDeviceState();
}

function applyAdmin(
  state: UiActionsContext,
  accordion: OpenAdminAccordion,
): void {
  state.helpOpen = false;
  state.cancelProviderSetup();
  state.cancelAddProvider();
  state.adminAccordionSection = accordion;
  state.settingsSection = SettingsSection.Admin;
  state.settingsOpen = true;
  void state.refreshLocalVaultCatalog();
  void state.refreshDeviceState();
}

function applyVault(state: UiActionsContext): void {
  state.cancelProviderSetup();
  state.cancelAddProvider();
  state.settingsOpen = false;
  state.helpOpen = false;
}

/** Apply browser history to UI state without creating another history entry. */
export function applyWorkspaceRoute(
  state: UiActionsContext,
  route: WorkspaceRoute,
): void {
  switch (route) {
    case WorkspaceRoute.Vault:
      applyVault(state);
      return;
    case WorkspaceRoute.DevicesAccess:
      applySettings(
        state,
        SettingsSection.DevicesAccess,
        SettingsAccordionSection.Devices,
      );
      return;
    case WorkspaceRoute.Admin:
      applyAdmin(state, AdminAccordionSection.Vaults);
      return;
    case WorkspaceRoute.Onboard:
      applySettings(
        state,
        SettingsSection.Onboard,
        SettingsAccordionSection.Devices,
      );
      return;
    case WorkspaceRoute.Settings:
      applySettings(
        state,
        SettingsSection.Storage,
        SettingsAccordionSection.Devices,
      );
      return;
    case WorkspaceRoute.Help:
      state.settingsOpen = false;
      state.helpOpen = true;
  }
}

function workspaceRouteForSettings(section: SettingsSection): WorkspaceRoute {
  switch (section) {
    case SettingsSection.DevicesAccess:
      return WorkspaceRoute.DevicesAccess;
    case SettingsSection.Admin:
      return WorkspaceRoute.Admin;
    case SettingsSection.Onboard:
      return WorkspaceRoute.Onboard;
    case SettingsSection.Storage:
      return WorkspaceRoute.Settings;
  }
}

export function openSettings(
  state: UiActionsContext,
  {
    section = SettingsSection.Storage,
    accordion = SettingsAccordionSection.Devices,
  }: OpenSettingsArgs = {},
): void {
  applySettings(state, section, accordion);
  pushWorkspaceRoute(workspaceRouteForSettings(section));
}

export function openAdmin(
  state: UiActionsContext,
  accordion: OpenAdminAccordion = AdminAccordionSection.Vaults,
): void {
  applyAdmin(state, accordion);
  pushWorkspaceRoute(WorkspaceRoute.Admin);
}

export function closeSettings(state: UiActionsContext): void {
  applyVault(state);
  pushWorkspaceRoute(WorkspaceRoute.Vault);
}

export async function deleteLocalData(state: UiActionsContext): Promise<void> {
  if (!state.hasManager || state.isSaving || state.localDataDeletionStarted)
    return;
  state.errorMsg = "";
  state.dismissSuccess();
  state.isSaving = true;
  state.stopIdleSessionTracking();
  state.stopVaultSync();
  try {
    const manager = state.requireManager();
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
        : state.t(I18N_KEYS.SettingsDeleteLocalError);
    state.isSaving = false;
  }
}

export async function handleRemoteLocalBrowserDataDeletion(
  state: UiActionsContext,
): Promise<void> {
  if (state.localDataDeletionStarted) return;
  const resetManager = state.hasManager
    ? state.enqueueStorage(() => state.requireManager().resetVaultSession())
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
  pushWorkspaceRoute(WorkspaceRoute.Help);
}

export function closeHelp(state: UiActionsContext): void {
  state.helpOpen = false;
  pushWorkspaceRoute(WorkspaceRoute.Vault);
}
