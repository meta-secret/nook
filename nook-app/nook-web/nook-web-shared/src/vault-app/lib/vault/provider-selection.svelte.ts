import { I18N_KEYS } from "../../../generated/i18n-keys";
import {
  activeVaultScope,
  storedLocalFolderDirectory,
  storedLocalFolderHandle,
  unselectedVaultScope,
  type StorageProvider,
} from "$lib/auth/providers";
import {
  activeVaultProviders,
  chooseLocalFolderBackupDirectory,
  isLocalFolderBackupSupported,
  isVaultSessionLocked,
  localProviderForActiveVault,
  NookManagerStoreScope,
  NookProviderSelectionState,
  syncProvidersForActiveVault,
} from "$app-wasm";
import type { ProviderActionsContext } from "$lib/vault/action-contexts";
import {
  ActiveVaultKind,
  LocalProviderLookupKind,
  LoginSetupKind,
  type LocalProviderLookup,
} from "$lib/vault/state/provider.svelte";

function providerSnapshot(state: ProviderActionsContext) {
  const snapshotArgs: Parameters<typeof $state.snapshot>[0] = {
    providers: state.providers,
    activeVaultStoreId:
      state.activeVault.kind === ActiveVaultKind.Open
        ? activeVaultScope(state.activeVault.storeId)
        : unselectedVaultScope(),
  };
  return $state.snapshot(snapshotArgs);
}

export async function chooseLocalFolder(
  state: ProviderActionsContext,
): Promise<void> {
  refreshLocalFolderBackupSupport(state);
  if (!state.localFolderBackupSupported) {
    throw new Error(
      state.t(I18N_KEYS.ProviderSetupLocalFolderUnsupportedBrowser),
    );
  }
  const folder = await chooseLocalFolderBackupDirectory();
  try {
    const request: Parameters<typeof state.configureLocalFolder>[0] = {
      directoryName: storedLocalFolderDirectory(folder.directoryName),
      handleId: storedLocalFolderHandle(folder.handleId),
    };
    state.configureLocalFolder(request);
  } finally {
    folder.free();
  }
}

export function refreshLocalFolderBackupSupport(
  state: ProviderActionsContext,
): void {
  state.localFolderBackupSupported =
    "window" in globalThis && isLocalFolderBackupSupported();
}

export function localProvider(
  state: ProviderActionsContext,
): LocalProviderLookup {
  const scope = state.hasActiveVaultStore
    ? NookManagerStoreScope.scoped(state.requireActiveVaultStoreId())
    : NookManagerStoreScope.unscoped();
  const selection = localProviderForActiveVault(providerSnapshot(state), scope);
  scope.free();
  if (selection.state === NookProviderSelectionState.Selected) {
    const provider = state.providers.find(
      (candidate) => candidate.id === selection.providerId,
    );
    selection.free();
    return provider
      ? { kind: LocalProviderLookupKind.Found, provider }
      : { kind: LocalProviderLookupKind.Missing };
  }
  selection.free();
  return { kind: LocalProviderLookupKind.Missing };
}

export function activeProviders(
  state: ProviderActionsContext,
): StorageProvider[] {
  const scope = state.hasActiveVaultStore
    ? NookManagerStoreScope.scoped(state.requireActiveVaultStoreId())
    : NookManagerStoreScope.unscoped();
  const providers = activeVaultProviders(
    providerSnapshot(state),
    scope,
  ).providers;
  scope.free();
  return providers;
}

export function syncProviders(
  state: ProviderActionsContext,
): StorageProvider[] {
  const scope = state.hasActiveVaultStore
    ? NookManagerStoreScope.scoped(state.requireActiveVaultStoreId())
    : NookManagerStoreScope.unscoped();
  const providers = syncProvidersForActiveVault(
    providerSnapshot(state),
    scope,
  ).providers;
  scope.free();
  return providers;
}

export function showLoginVaultPicker(state: ProviderActionsContext): boolean {
  return state.clientPolicy.shouldShowLoginVaultPicker(
    state.isAuthenticated,
    state.localVaults.length,
    state.hasSelectedLoginVaultStore,
    state.loginSetup.kind === LoginSetupKind.Active,
    state.addProviderOpen,
    isVaultSessionLocked(),
  );
}
