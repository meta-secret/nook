import { I18N_KEYS } from "../../../generated/i18n-keys";
import type {
  OpenAdminAccordion,
  SettingsNavigationRequest,
  UiActionsContext,
} from "$lib/vault/action-contexts";
import {
  clearTabScopedBrowserData,
  deleteLocalBrowserData,
  requireLocalDataRecoverySupport,
} from "$lib/runtime/browser-data";
import { set_vault_session_locked } from "$app-wasm";
import {
  AdminAccordionSection,
  SettingsAccordionSection,
  SettingsSection,
} from "$lib/vault/state/ui.svelte";
import { WorkspaceRoute, workspacePath } from "$lib/app/workspace-route";

export type OpenSettingsRequest = SettingsNavigationRequest & {
  readonly state: UiActionsContext;
};

export function pushWorkspaceRoute(route: WorkspaceRoute): void {
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
  window.dispatchEvent(new PopStateEvent("popstate"));
}

type SettingsViewSelection = {
  readonly state: UiActionsContext;
  readonly section: SettingsSection;
  readonly accordion: SettingsAccordionSection;
};

function applySettings({
  state,
  section,
  accordion,
}: SettingsViewSelection): void {
  state.helpOpen = false;
  state.settingsSection = section;
  if (section === SettingsSection.Storage) {
    state.cancelProviderSetup();
    state.cancelAddProvider();
    state.settingsAccordionSection = accordion;
  }
  state.settingsOpen = true;
  // Access and enrolled-device settings read last-known evidence. A vault
  // sync here races that snapshot when the dashboard remounts after leaving
  // Access through "Manage enrolled devices".
  const skipDeviceRefresh =
    section === SettingsSection.DevicesAccess ||
    (section === SettingsSection.Storage &&
      accordion === SettingsAccordionSection.Devices);
  if (!skipDeviceRefresh) {
    void state.refreshDeviceState();
  }
}

type AdminViewSelection = {
  readonly state: UiActionsContext;
  readonly accordion: OpenAdminAccordion;
};

function applyAdmin({ state, accordion }: AdminViewSelection): void {
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
type WorkspaceRouteApplication = {
  readonly state: UiActionsContext;
  readonly route: WorkspaceRoute;
};

export function applyWorkspaceRoute({
  state,
  route,
}: WorkspaceRouteApplication): void {
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
  pushWorkspaceRoute(workspaceRouteForSettings(section));
  const applySettingsArgs4: Parameters<typeof applySettings>[0] = {
    state,
    section,
    accordion,
  };
  applySettings(applySettingsArgs4);
}

type AdminPanelOpening = {
  readonly state: UiActionsContext;
  readonly accordion: OpenAdminAccordion;
};

export function openAdmin({ state, accordion }: AdminPanelOpening): void {
  pushWorkspaceRoute(WorkspaceRoute.Admin);
  const applyAdminArgs2: Parameters<typeof applyAdmin>[0] = {
    state,
    accordion,
  };
  applyAdmin(applyAdminArgs2);
}

export function closeSettings(state: UiActionsContext): void {
  pushWorkspaceRoute(WorkspaceRoute.Vault);
  applyVault(state);
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
    await state.waitForStorageChain();
    requireLocalDataRecoverySupport();
    state.localDataDeletionStarted = true;
    await deleteLocalBrowserData(() => {
      return manager.delete_local_browser_data();
    });
  } catch {
    const managerWasZeroized = state.localDataDeletionStarted;
    set_vault_session_locked(true);
    state.clearUnlockedSession(!managerWasZeroized);
    state.localDataDeletionStarted = false;
    state.errorMsg = state.t(I18N_KEYS.SettingsDeleteLocalError);
    state.isSaving = false;
  }
}

export async function handleRemoteLocalBrowserDataDeletion(
  state: UiActionsContext,
): Promise<void> {
  if (state.localDataDeletionStarted) return;
  const resetManager = state.hasManager
    ? state.enqueueStorage(() =>
        state.requireManager().quiesce_for_local_recovery(),
      )
    : state.waitForStorageChain();
  state.localDataDeletionStarted = true;
  state.stopIdleSessionTracking();
  state.stopVaultSync();
  set_vault_session_locked(true);
  state.clearUnlockedSession(false);
  await resetManager;
  clearTabScopedBrowserData();
}

export function openHelp(state: UiActionsContext): void {
  pushWorkspaceRoute(WorkspaceRoute.Help);
  state.settingsOpen = false;
  state.helpOpen = true;
}

export function closeHelp(state: UiActionsContext): void {
  pushWorkspaceRoute(WorkspaceRoute.Vault);
  state.helpOpen = false;
}
