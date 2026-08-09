import { I18N_KEYS } from "../../../generated/i18n-keys";
import { VaultState } from "$lib/vault.svelte";
import { EnrollmentEntryKind } from "$lib/vault/state/session.svelte";
import { createLogger, runtimeFailure } from "$lib/runtime/log";
import {
  isSentinelPasswordUnlockForbiddenError,
  isSentinelVault,
} from "$lib/vault/sentinel-unlock";
export {
  findSharedGrantProvider,
  SharedGrantProviderKind,
  SharedStorageTargetKind,
  shouldFlushSharedDriveGrant,
  type SharedGrantProvider,
  type SharedStorageTarget,
} from "$lib/vault/password-enrollment";
import { JoinEnrollmentState } from "$app-wasm";

const log = createLogger("vault-password");

type E2ePasswordManager = {
  addVaultPasswordForE2e?: (args: {
    readonly label: string;
    readonly password: string;
  }) => Promise<void>;
  updateVaultPasswordEntryForE2e?: (args: {
    readonly entryId: string;
    readonly password: string;
  }) => Promise<void>;
};

export async function addVaultPassword({
  state,
  label,
  password,
}: {
  readonly state: VaultState;
  readonly label: string;
  readonly password: string;
}): Promise<void> {
  if (!state.hasManager) {
    state.passwordError = "Vault engine is not available.";
    return;
  }
  if (!state.isAuthenticated) {
    state.passwordError = "Unlock the vault before adding a password.";
    return;
  }
  const hadPasswords = state.passwordEntries.length > 0;
  state.passwordError = "";
  state.isPasswordBusy = true;
  try {
    const manager = state.requireManager();
    await state.enqueueStorage(() => {
      const trimmedLabel = label.trim();
      const e2eManager = manager as typeof manager & E2ePasswordManager;
      if (
        state.runtimeConfig.e2eExposeVault &&
        e2eManager.addVaultPasswordForE2e
      ) {
        const addVaultPasswordForE2eArgs: Parameters<
          typeof e2eManager.addVaultPasswordForE2e
        >[0] = { label: trimmedLabel, password };
        return e2eManager.addVaultPasswordForE2e(addVaultPasswordForE2eArgs);
      }
      return manager.addVaultPassword(trimmedLabel, password);
    });
    await state.refreshPasswordEntriesList();
    const infoArgs = {
      hadPasswords,
      label: label.trim(),
    };
    log.info("vault password added" + " " + JSON.stringify(infoArgs));
    state.showSuccess(
      hadPasswords
        ? state.t(I18N_KEYS.ToastsPasswordAddedRotate)
        : state.t(I18N_KEYS.ToastsPasswordSet),
    );
    await state.hydrateMultiDeviceState();
    await state.runFanOutSyncAfterLocalSave();
  } catch (e) {
    state.passwordError =
      e instanceof Error ? e.message : "Failed to add vault password.";
    throw e;
  } finally {
    state.isPasswordBusy = false;
  }
}

export async function updateVaultPasswordEntry({
  state,
  entryId,
  password,
}: {
  readonly state: VaultState;
  readonly entryId: string;
  readonly password: string;
}): Promise<void> {
  if (!state.hasManager) {
    state.passwordError = "Vault engine is not available.";
    return;
  }
  state.passwordError = "";
  state.isPasswordBusy = true;
  try {
    const manager = state.requireManager();
    await state.enqueueStorage(() => {
      const e2eManager = manager as typeof manager & E2ePasswordManager;
      if (
        state.runtimeConfig.e2eExposeVault &&
        e2eManager.updateVaultPasswordEntryForE2e
      ) {
        const updateVaultPasswordEntryForE2eArgs: Parameters<
          typeof e2eManager.updateVaultPasswordEntryForE2e
        >[0] = { entryId, password };
        return e2eManager.updateVaultPasswordEntryForE2e(
          updateVaultPasswordEntryForE2eArgs,
        );
      }
      return manager.updateVaultPasswordEntry(entryId, password);
    });
    await state.refreshPasswordEntriesList();
    state.showSuccess(state.t(I18N_KEYS.ToastsPasswordUpdated));
    await state.runFanOutSyncAfterLocalSave();
  } catch (e) {
    state.passwordError =
      e instanceof Error ? e.message : "Failed to update vault password.";
    throw e;
  } finally {
    state.isPasswordBusy = false;
  }
}

export async function removeVaultPasswordEntry({
  state,
  entryId,
}: {
  readonly state: VaultState;
  readonly entryId: string;
}): Promise<void> {
  if (!state.hasManager) return;
  state.passwordError = "";
  state.isPasswordBusy = true;
  try {
    await state.enqueueStorage(() =>
      state.requireManager().removeVaultPasswordEntry(entryId),
    );
    await state.refreshPasswordEntriesList();
    if (
      state.activeEnrollmentEntry.kind === EnrollmentEntryKind.Active &&
      state.activeEnrollmentEntry.entryId === entryId
    ) {
      state.enrollmentCode = "";
      state.clearActiveEnrollmentEntry();
    }
    state.showSuccess(state.t(I18N_KEYS.ToastsPasswordRemoved));
    await state.runFanOutSyncAfterLocalSave();
  } catch (e) {
    state.passwordError =
      e instanceof Error ? e.message : "Failed to remove vault password.";
    throw e;
  } finally {
    state.isPasswordBusy = false;
  }
}

export async function unlockWithPassword({
  state,
  entryId,
  password,
}: {
  readonly state: VaultState;
  readonly entryId: string;
  readonly password: string;
}): Promise<void> {
  if (!state.hasManager) {
    state.errorMsg = state.t(I18N_KEYS.ErrorsEngineUnavailable);
    return;
  }
  if (state.isVerifying) return;
  if (isSentinelVault(state)) {
    state.errorMsg = state.t(
      I18N_KEYS.ArchitectureModesSentinelPasswordForbidden,
    );
    state.sentinelCeremonyPrompt = true;
    return;
  }
  if (!state.hasRemoteCredentials()) {
    state.errorMsg =
      state.storageMode === "oauth-file"
        ? state.t(I18N_KEYS.ErrorsGoogleSignInRequired)
        : state.t(I18N_KEYS.ErrorsGithubCredentialsRequired);
    return;
  }
  await state.ensureOAuthTokensFresh();
  if (!entryId.trim()) {
    state.errorMsg = state.t(I18N_KEYS.ErrorsVaultPasswordRequired);
    return;
  }
  state.errorMsg = "";
  state.dismissSuccess();
  state.isVerifying = true;
  try {
    const page = await state.enqueueStorage(() =>
      state
        .requireManager()
        .connectWithPassword(
          ...state.wasmStorageArgs(),
          entryId,
          password,
          state.secretPageSize,
        ),
    );
    const connectedPageArgs: Parameters<
      typeof state.applyConnectedSecretPage
    >[0] = { page, query: "" };
    state.applyConnectedSecretPage(connectedPageArgs);
    if (state.deviceProtectionReady) {
      await state.ensureProviderSaved();
      await state.loadProviders();
    }
    await state.refreshPasswordEntriesList();
    if (state.deviceProtectionReady) {
      void state.hydrateMultiDeviceState();
    }
    state.markVaultUnlocked();
    const infoArgs2 = {
      mode: state.storageMode,
      secrets: state.secretTotal,
      entryId,
    };
    log.info("vault unlocked with password" + " " + JSON.stringify(infoArgs2));
    state.joinEnrollmentPrompt = JoinEnrollmentState.None;
    state.loginPasswordPrompt = false;
    state.showSuccess(state.t(I18N_KEYS.ToastsVaultUnlocked));
    state.startIdleSessionTracking();
    if (state.deviceProtectionReady) {
      state.startVaultSync();
    }
  } catch (e) {
    state.isAuthenticated = false;
    const message =
      e instanceof Error ? e.message : "Failed to unlock with password.";
    const warnArgs = { error: message };
    log.warn("vault password unlock failed" + " " + JSON.stringify(warnArgs));
    if (isSentinelPasswordUnlockForbiddenError(runtimeFailure(e))) {
      state.errorMsg = state.t(
        I18N_KEYS.ArchitectureModesSentinelPasswordForbidden,
      );
      state.sentinelCeremonyPrompt = true;
      return;
    }
    state.errorMsg = message;
  } finally {
    state.isVerifying = false;
  }
}

export {
  clearEnrollmentCode,
  connectWithEnrollmentCode,
  issueEnrollmentCode,
} from "$lib/vault/password-enrollment-flow";
