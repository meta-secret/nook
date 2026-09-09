import { BrowserIdentityHandoffKind } from "$lib/vault/identity-handoff";
import { I18N_KEYS } from "../../../generated/i18n-keys";
import type { VaultState } from "$lib/vault.svelte";
import { browserLogRuntime } from "$lib/runtime/log";
import {
  get_active_vault_selection,
  has_active_local_vault,
  list_local_vaults,
  prepare_new_local_vault_slot,
  set_active_vault,
  set_local_vault_label,
  set_vault_session_locked,
  NookVaultSwitchState,
  NookActiveVaultSelectionState,
  type NookVaultManager,
} from "$app-wasm";
import { activeVaultScope, saveAuthProviders } from "$lib/auth/providers";
import {
  ActiveVaultKind,
  LocalLoginPreparationState,
} from "$lib/vault/state/provider.svelte";
import { LoginUnlockPresentation } from "$lib/vault/login-unlock-capabilities";

const log = browserLogRuntime.createLogger("vault-local");

interface LoginVaultActionRequest {
  readonly storeId: string;
}

interface LocalVaultCreationRequest {
  readonly label: string;
}

interface LocalVaultRenameRequest {
  readonly storeId: string;
  readonly label: string;
}

enum PreviousVaultLabelKind {
  Missing = "missing",
  Present = "present",
}

type PreviousVaultLabel =
  | { kind: PreviousVaultLabelKind.Missing }
  | { kind: PreviousVaultLabelKind.Present; label: string };

/** Owns browser orchestration for one local login context. */
export class VaultLoginActions {
  constructor(private readonly state: VaultState) {}

  async reloadProvidersForActiveVault(): Promise<void> {
    const state = this.state;
    const snapshot = await state.enqueueStorage(() =>
      state.requireManager().load_auth_providers_snapshot(),
    );
    state.providers = snapshot.providers;
    if (snapshot.activeVaultStoreId.state === "storeId") {
      state.openActiveVault(snapshot.activeVaultStoreId.value);
    }
    state.applyActiveProviderCredentials();
  }

  beginLoginVaultPicker(): void {
    const state = this.state;
    state.clearSelectedLoginVaultStore();
    state.localLoginPreparation = LocalLoginPreparationState.Idle;
    state.resetVaultSessionState();
  }

  async chooseLoginVault({ storeId }: LoginVaultActionRequest): Promise<void> {
    const state = this.state;
    await state.selectVaultForUnlock(storeId);
    state.selectLoginVault(storeId);
  }

  async switchToVault({ storeId }: LoginVaultActionRequest): Promise<void> {
    const state = this.state;
    const switchDecision = state.clientPolicy.vault_switch_target(
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
      set_vault_session_locked(true);
      state.clearUnlockedSession();
      await state.waitForStorageChain();
      const chooseLoginVaultArgs: Parameters<
        VaultLoginActions["chooseLoginVault"]
      >[0] = {
        storeId: target,
      };
      await this.chooseLoginVault(chooseLoginVaultArgs);
      state.isVerifying = true;
      await state.lockDeviceProtection();
      log.info("vault switch completed");
    } catch (error) {
      state.errorMsg =
        error instanceof Error ? error.message : "Failed to switch vaults.";
    } finally {
      state.isVerifying = false;
    }
  }

  static requireManagerVaultStoreId(manager: NookVaultManager): string {
    const storeId = manager.vaultStoreId.trim();
    if (!storeId) {
      throw new Error("Vault is missing store_id after connect.");
    }
    return storeId;
  }

  async refreshLocalVaultCatalog(): Promise<void> {
    const state = this.state;
    state.localVaults = await list_local_vaults();
    state.localVaultPresent = await has_active_local_vault();
    const activeSelection = await get_active_vault_selection();
    try {
      if (activeSelection.state === NookActiveVaultSelectionState.Selected) {
        state.openActiveVault(activeSelection.storeId);
      }
    } finally {
      activeSelection.free();
    }
  }

  async prepareLocalLogin(): Promise<void> {
    const state = this.state;
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
      await new LoginUnlockPresentation(state).refresh();
      state.localLoginPreparation = LocalLoginPreparationState.Ready;
    } catch (error) {
      state.localLoginPreparation = LocalLoginPreparationState.Idle;
      throw error;
    }
  }

  async selectVaultForUnlock({
    storeId,
  }: LoginVaultActionRequest): Promise<void> {
    const state = this.state;
    state.errorMsg = "";
    state.dismissSuccess();
    state.isVerifying = true;
    try {
      await set_active_vault(storeId);
      state.openActiveVault(storeId);
      if (state.hasManager) {
        await state.enqueueStorage(() =>
          state.requireManager().reset_vault_session(),
        );
      }
      state.localVaultPresent = await has_active_local_vault();
      state.localLoginPreparation = LocalLoginPreparationState.Idle;
      await state.syncActiveVaultStoreIdToAuth();
      await state.reloadProvidersForActiveVault();
      await state.refreshPasswordEntriesList();
      await new LoginUnlockPresentation(state).refresh();
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

  async prepareExistingVaultImportSlot(): Promise<void> {
    const state = this.state;
    await prepare_new_local_vault_slot();
    if (state.hasManager) {
      await state.enqueueStorage(() =>
        state.requireManager().reset_vault_session(),
      );
    }
    state.clearActiveVaultStore();
    state.localVaultPresent = await has_active_local_vault();
    state.localLoginPreparation = LocalLoginPreparationState.Idle;
  }

  async createLocalVaultWithDeviceKeys({
    label,
  }: LocalVaultCreationRequest): Promise<void> {
    const state = this.state;
    if (!state.hasManager) {
      state.errorMsg = state.t(I18N_KEYS.ErrorsEngineUnavailable);
      return;
    }
    if (state.isVerifying) return;

    const trimmedLabel = label.trim();
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
    let handoffAwaitingVaultCreation = false;

    try {
      await state.initDeviceIdentity();
      handoffAwaitingVaultCreation =
        state.externalIdentityHandoff.kind ===
          BrowserIdentityHandoffKind.Adopted &&
        state.externalIdentityHandoff.adoption.requiresConnect(
          state.requireManager(),
        );
      const creatingAdditionalVault = state.localVaults.length > 0;
      if (creatingAdditionalVault) {
        await prepare_new_local_vault_slot();
        await state.enqueueStorage(() =>
          state.requireManager().reset_vault_session(),
        );
      }
      state.applyDraftVaultArchitecture();
      const rawRecords = await state.enqueueStorage(() => {
        if (creatingAdditionalVault) {
          return state.requireManager().connect_fresh("local", "", "");
        }
        return state.requireManager().connect("local", "", "");
      });
      for (const record of rawRecords) record.free();
      if (handoffAwaitingVaultCreation) {
        const handoff = state.externalIdentityHandoff;
        state.externalIdentityHandoff = {
          kind: BrowserIdentityHandoffKind.Inactive,
        };
        if (handoff.kind === BrowserIdentityHandoffKind.Adopted)
          handoff.adoption.afterVerifiedConnect(state.requireManager());
        handoffAwaitingVaultCreation = false;
      }
      const loadPageArgs: Parameters<typeof state.loadSecretPage>[0] = {
        query: "",
        requestedOffset: 0,
      };
      await state.loadSecretPage(loadPageArgs);
      state.markVaultUnlocked();
      const storeId = VaultLoginActions.requireManagerVaultStoreId(
        state.requireManager(),
      );
      state.openActiveVault(storeId);
      await state.enqueueStorage(() =>
        state.requireManager().set_vault_name(trimmedLabel),
      );
      await set_local_vault_label(storeId, trimmedLabel);
      await this.refreshLocalVaultCatalog();
      state.localLoginPreparation = LocalLoginPreparationState.Ready;
      await state.ensureProviderSaved();
      await state.syncActiveVaultStoreIdToAuth();
      await state.hydrateMultiDeviceState();
      log.info("local vault created (device keys)");
      state.showSuccess(state.t(I18N_KEYS.ToastsLocalLoaded));
      state.startIdleSessionTracking();
      state.startVaultSync();
    } catch (e) {
      if (handoffAwaitingVaultCreation) {
        try {
          const handoff = state.externalIdentityHandoff;
          state.externalIdentityHandoff = {
            kind: BrowserIdentityHandoffKind.Inactive,
          };
          if (handoff.kind === BrowserIdentityHandoffKind.Adopted)
            handoff.adoption.rollback(state.requireManager());
        } catch {
          log.warn("failed vault creation handoff rollback failed");
        }
        state.deviceId = "";
        state.devicePublicKey = "";
        state.deviceProtectionStatus = state.deviceProtectionLockedStatus;
      }
      set_vault_session_locked(true);
      state.clearUnlockedSession(false);
      const message =
        e instanceof Error
          ? e.message
          : state.t(I18N_KEYS.ErrorsVaultCreationFailed);
      log.warn("local vault create failed");
      state.errorMsg = message;
    } finally {
      state.isVerifying = false;
    }
  }

  async renameLocalVaultLabel({
    storeId,
    label,
  }: LocalVaultRenameRequest): Promise<void> {
    const state = this.state;
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
      await set_local_vault_label(trimmedStoreId, trimmedLabel);
      if (
        state.activeVault.kind === ActiveVaultKind.Open &&
        trimmedStoreId === state.activeVault.storeId.trim()
      ) {
        await state.enqueueStorage(() =>
          state.requireManager().set_vault_name(trimmedLabel),
        );
      }
      renameCommitted = true;
      await this.refreshLocalVaultCatalog();
      state.showSuccess(state.t(I18N_KEYS.ToastsVaultRenamed));
    } catch (e) {
      if (
        !renameCommitted &&
        previousLabel.kind === PreviousVaultLabelKind.Present
      ) {
        try {
          await set_local_vault_label(trimmedStoreId, previousLabel.label);
          await this.refreshLocalVaultCatalog();
        } catch {
          log.warn("local vault rename rollback failed");
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

  async syncActiveVaultStoreIdToAuth(): Promise<void> {
    const state = this.state;
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

  async activateConnectedExistingVault({
    storeId,
  }: LoginVaultActionRequest): Promise<void> {
    const state = this.state;
    if (!state.hasManager || !state.isAuthenticated) return;
    const connectedStoreId = VaultLoginActions.requireManagerVaultStoreId(
      state.requireManager(),
    );
    if (connectedStoreId !== storeId) {
      throw new Error(state.t(I18N_KEYS.ErrorsVaultSelectionFailed));
    }
    await set_active_vault(storeId);
    state.openActiveVault(storeId);
    await this.refreshLocalVaultCatalog();
    await this.syncActiveVaultStoreIdToAuth();
  }
}
