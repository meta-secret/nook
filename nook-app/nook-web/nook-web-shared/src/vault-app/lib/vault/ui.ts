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

export type OpenSettingsRequest = OpenSettingsArgs & {
  readonly state: UiActionsContext;
};

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
  const pushStateArgs: Parameters<typeof window.history.pushState>[0] = {};
  window.history.pushState(pushStateArgs, "", path);
}

function applySettings({
  state,
  section,
  accordion,
}: {
  readonly state: UiActionsContext;
  readonly section: SettingsSection;
  readonly accordion: SettingsAccordionSection;
}): void {
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

function applyAdmin({
  state,
  accordion,
}: {
  readonly state: UiActionsContext;
  readonly accordion: OpenAdminAccordion;
}): void {
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
export function applyWorkspaceRoute({
  state,
  route,
}: {
  readonly state: UiActionsContext;
  readonly route: WorkspaceRoute;
}): void {
  switch (route) {
    case WorkspaceRoute.Vault:
      applyVault(state);
      return;
    case WorkspaceRoute.DevicesAccess:
      (() => {
        const applySettingsArgs: Parameters<typeof applySettings>[0] = {
          state,
          section: SettingsSection.DevicesAccess,
          accordion: SettingsAccordionSection.Devices,
        };
        return applySettings(applySettingsArgs);
      })();
      return;
    case WorkspaceRoute.Admin:
      (() => {
        const applyAdminArgs: Parameters<typeof applyAdmin>[0] = {
          state,
          accordion: AdminAccordionSection.Vaults,
        };
        return applyAdmin(applyAdminArgs);
      })();
      return;
    case WorkspaceRoute.Onboard:
      (() => {
        const applySettingsArgs2: Parameters<typeof applySettings>[0] = {
          state,
          section: SettingsSection.Onboard,
          accordion: SettingsAccordionSection.Devices,
        };
        return applySettings(applySettingsArgs2);
      })();
      return;
    case WorkspaceRoute.Settings:
      (() => {
        const applySettingsArgs3: Parameters<typeof applySettings>[0] = {
          state,
          section: SettingsSection.Storage,
          accordion: SettingsAccordionSection.Devices,
        };
        return applySettings(applySettingsArgs3);
      })();
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

export function openSettings({
  state,
  section,
  accordion,
}: OpenSettingsRequest): void {
  const applySettingsArgs4: Parameters<typeof applySettings>[0] = {
    state,
    section,
    accordion,
  };
  applySettings(applySettingsArgs4);
  pushWorkspaceRoute(workspaceRouteForSettings(section));
}

export function openAdmin({
  state,
  accordion,
}: {
  readonly state: UiActionsContext;
  readonly accordion: OpenAdminAccordion;
}): void {
  const applyAdminArgs2: Parameters<typeof applyAdmin>[0] = {
    state,
    accordion,
  };
  applyAdmin(applyAdminArgs2);
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
  } catch (error) {
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
