import type { VaultState } from "$lib/vault.svelte";
import type { NookSecretRecord, VaultItemType } from "$lib/nook";
import {
  generatePassword as coreGeneratePassword,
  generateSecretId,
} from "$lib/nook";
import { createLogger } from "$lib/log";
import { syncLocalFolderProvider } from "$lib/vault/sync";
import {
  isSentinelCeremonyRequiredError,
  refreshSentinelUnlockStatus,
  surfaceSentinelCeremonyIfNeeded,
} from "$lib/vault/sentinel-unlock";

const log = createLogger("connect");

export interface LoadDbOptions {
  allowActiveVerification?: boolean;
  loadSiteProviders?: boolean;
  validateExtensionIdentity?: boolean;
}

export async function loadDb(state: VaultState, options?: LoadDbOptions) {
  if (state.isInitializing) {
    state.errorMsg = state.t("errors.engine_loading");
    return;
  }

  if (!state.manager) {
    state.errorMsg = state.t("errors.engine_unavailable");
    return;
  }

  if (state.isVerifying && options?.allowActiveVerification !== true) {
    state.errorMsg = state.t("errors.connection_in_progress");
    return;
  }

  state.errorMsg = "";
  state.dismissSuccess();
  state.isVerifying = true;
  try {
    await state.initDeviceIdentity();
    if (options?.loadSiteProviders !== false) {
      await state.ensureOAuthTokensFresh();
    }

    if (!state.isAuthenticated && state.loginSetupType === "local-folder") {
      const saved = await state.ensureProviderSaved();
      if (!saved) return;
      const provider =
        state.syncProviders[state.syncProviders.length - 1] ??
        state.providers[state.providers.length - 1];
      if (provider?.type === "local-folder") {
        await syncLocalFolderProvider(state, provider);
      }
    }

    if (!state.isAuthenticated && state.syncProviders.length > 0) {
      await state.syncProviderById(state.syncProviders[0]!.id, { quiet: true });
    }

    let accessStatus = await state.assessVaultConnectStatus();
    let connectArgsOverride: [string, string, string] | undefined = undefined;
    log.debug("loadDb assess", {
      accessStatus,
      localVaultPresent: state.localVaultPresent,
      joinEnrollmentPrompt: state.joinEnrollmentPrompt,
      syncProviders: state.syncProviders.length,
    });

    if (
      accessStatus === "needs_enrollment" ||
      accessStatus === "join_pending"
    ) {
      log.info("loadDb waiting on enrollment", { accessStatus });
    }

    // A joiner device keeps a pre-approval projection in the local cache
    // (join row, no auth envelope). Once the join is approved remotely, the
    // local cache is stale and keeps reporting join_pending/needs_enrollment
    // forever. The sync provider remote is authoritative for enrollment
    // state, so re-assess against it and connect there when it is ready.
    if (
      (accessStatus === "join_pending" ||
        accessStatus === "needs_enrollment") &&
      !state.isAuthenticated &&
      state.syncProviders.length > 0
    ) {
      const providerArgs = state.providerWasmArgs(state.syncProviders[0]!);
      const remoteStatus = await state.assessVaultConnectStatus(providerArgs);
      log.debug("loadDb provider re-assess", { remoteStatus });
      if (remoteStatus === "ready") {
        accessStatus = "ready";
        connectArgsOverride = providerArgs;
      }
    }

    if (
      state.pendingConnectRecovery === "none" &&
      (await state.handleRemoteVaultAssessStatus(accessStatus))
    ) {
      return;
    }

    if (accessStatus === "needs_enrollment") {
      await state.ensureProviderSaved();
      const hasPasswordFallback = await state.refreshPasswordEntriesList();
      if (hasPasswordFallback && state.passwordEntries.length > 0) {
        state.loginPasswordPrompt = true;
        state.joinEnrollmentPrompt = "none";
        return;
      }
      state.joinEnrollmentPrompt = "needs_request";
      state.startVaultSync();
      return;
    }
    if (accessStatus === "join_pending") {
      await state.ensureProviderSaved();
      const hasPasswordFallback = await state.refreshPasswordEntriesList();
      if (hasPasswordFallback && state.passwordEntries.length > 0) {
        state.loginPasswordPrompt = true;
        state.joinEnrollmentPrompt = "none";
        return;
      }
      state.joinEnrollmentPrompt = "pending";
      state.awaitingJoinApproval = true;
      state.startVaultSync();
      return;
    }

    if (state.stagedRemoteStorageArgs()) {
      const reconcileOutcome = await state.reconcileStagedRemoteWithLocal();
      if (reconcileOutcome === "skip") return;
    }

    const rawRecords = await state.enqueueStorage(async () => {
      const connectArgs = connectArgsOverride ?? state.connectStorageArgs();
      log.debug("loadDb connect", { mode: connectArgs[0] });
      const connectPromise =
        state.pendingConnectRecovery === "fresh"
          ? state.manager!.connect_fresh(...connectArgs)
          : state.manager!.connect(...connectArgs);
      state.pendingConnectRecovery = "none";
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(
                "Connection timed out. Check your PAT, network, and try again.",
              ),
            ),
          30_000,
        );
      });
      return (await Promise.race([
        connectPromise,
        timeoutPromise,
      ])) as NookSecretRecord[];
    });
    if (options?.validateExtensionIdentity === true) {
      await state.enqueueStorage(() =>
        state.manager!.validateExtensionDeviceIdentityForHandoff(),
      );
    }
    state.secrets = rawRecords;
    // Load sync providers before unlocking the UI. Otherwise a fast local
    // edit (especially delete, which used to fire-and-forget fan-out) can run
    // while `syncProviders` is still empty and never push the event remotely.
    state.syncOAuthRemoteRefFromManager();
    await state.ensureProviderSaved();
    if (options?.loadSiteProviders !== false) {
      await state.loadProviders();
    }
    await state.promoteSessionVaultToLocalIfNeeded();
    await state.refreshPasswordEntriesList();
    await state.hydrateMultiDeviceState();
    state.markVaultUnlocked();
    log.info("vault connected", {
      mode: state.storageMode,
      secrets: rawRecords.length,
      accessStatus,
    });
    if (state.storageMode === "local") {
      state.showSuccess(state.t("toasts.local_loaded"));
    } else if (state.storageMode === "local-folder") {
      state.showSuccess(state.t("toasts.local_folder_connected"));
    } else if (state.storageMode === "oauth-file") {
      state.showSuccess(state.t("toasts.google_drive_connected"));
    } else {
      state.showSuccess(state.t("toasts.github_connected"));
    }
  } catch (e: unknown) {
    state.isAuthenticated = false;
    const message = e instanceof Error ? e.message : String(e);
    log.warn("loadDb failed", message);
    if (await surfaceSentinelCeremonyIfNeeded(state, e)) {
      state.refreshVaultArchitectureFromManager();
      await refreshSentinelUnlockStatus(state);
      return;
    }
    if (isSentinelCeremonyRequiredError(e)) {
      state.sentinelCeremonyPrompt = true;
      state.errorMsg = "";
      return;
    }
    state.errorMsg = state.resolveErrorMessage(message);
  } finally {
    if (state.isAuthenticated) {
      try {
        await state.syncFromStorage({ force: true });
      } catch {
        // Post-unlock sync should not block the login gate.
      }
      state.startIdleSessionTracking();
      state.startVaultSync();
    }
    state.isVerifying = false;
  }
}

function editBlockedMessage(state: VaultState): string {
  if (state.editBlockReason) return state.editBlockReason;
  return state.securityConflicts.length > 0
    ? state.t("auth_storage.security_conflict_edits")
    : state.t("auth_storage.sync_blocked_edits");
}

export async function handleAddSecret(
  state: VaultState,
  id: string,
  type: VaultItemType,
  data: string,
) {
  if (!state.manager) return;
  if (state.editsBlocked) {
    state.errorMsg = editBlockedMessage(state);
    return;
  }
  state.errorMsg = "";
  state.dismissSuccess();
  state.isSaving = true;
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
  try {
    await state.enqueueStorage(async () => {
      const rawRecords = (await state.raceStorageTimeout(
        state.manager!.add_secret(id, type, data),
        "Add secret",
      )) as NookSecretRecord[];
      state.secrets = rawRecords;
    });
    await state.refreshSecretsFromSession();
    log.info("secret added", { id, type });
    state.showSuccess(state.t("toasts.secret_saved"));
    await state.runFanOutSyncAfterLocalSave();
    await state.refreshSecretsFromSession();
  } catch (e: unknown) {
    state.errorMsg = `Failed to save secret: ${e instanceof Error ? e.message : String(e)}`;
    throw e;
  } finally {
    state.isSaving = false;
  }
}

export async function handleDeleteSecret(state: VaultState, id: string) {
  if (!state.manager) return;
  if (state.editsBlocked) {
    state.errorMsg = editBlockedMessage(state);
    return;
  }
  state.errorMsg = "";
  state.dismissSuccess();
  state.isSaving = true;
  // Drop the row immediately so the UI reflects the delete without waiting for
  // the authoritative wasm op, which can queue behind background sync work
  // (restored below if the delete fails).
  const previousSecrets = state.secrets;
  state.secrets = state.secrets.filter((record) => record.id !== id);
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
  try {
    await state.enqueueStorage(async () => {
      const rawRecords = (await state.manager!.delete_secret(
        id,
      )) as NookSecretRecord[];
      state.secrets = rawRecords;
    });
    await state.refreshSecretsFromSession();
    log.info("secret deleted", { id });
    state.showSuccess(state.t("toasts.secret_deleted"));
    // Match add/replace: await fan-out so the delete event is pushed before
    // callers observe remote state (and so an empty provider list is not a
    // silent no-op race right after unlock).
    await state.runFanOutSyncAfterLocalSave();
    await state.refreshSecretsFromSession();
  } catch (e: unknown) {
    state.secrets = previousSecrets;
    state.errorMsg = `Failed to delete secret: ${e instanceof Error ? e.message : String(e)}`;
    throw e;
  } finally {
    state.isSaving = false;
  }
}

export async function handleReplaceSecret(
  state: VaultState,
  oldId: string,
  type: VaultItemType,
  data: string,
) {
  if (!state.manager) return;
  if (state.editsBlocked) {
    state.errorMsg = editBlockedMessage(state);
    return;
  }
  state.errorMsg = "";
  state.dismissSuccess();
  state.isSaving = true;
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
  try {
    const newId = generateSecretId();
    await state.enqueueStorage(async () => {
      const rawRecords = (await state.manager!.replace_secret(
        oldId,
        newId,
        type,
        data,
      )) as NookSecretRecord[];
      state.secrets = rawRecords;
    });
    await state.refreshSecretsFromSession();
    log.info("secret replaced", { oldId, newId, type });
    state.showSuccess(state.t("toasts.item_updated"));
    state.scheduleFanOutSyncAfterLocalSave();
  } catch (e: unknown) {
    state.errorMsg = `Failed to update item: ${e instanceof Error ? e.message : String(e)}`;
    throw e;
  } finally {
    state.isSaving = false;
  }
}

export function filterSecrets(
  state: VaultState,
  query: string,
): NookSecretRecord[] {
  if (!state.manager) return [];
  return state.manager.filter_secrets(query);
}

export async function refreshPasswordEntriesList(
  state: VaultState,
): Promise<boolean> {
  if (!state.manager) return false;
  try {
    if (!state.hasRemoteCredentials()) {
      state.passwordEntries = [];
      state.loginUnlockMode = "unknown";
      return false;
    }
    await state.ensureOAuthTokensFresh();
    const raw = await state.enqueueStorage(() =>
      state.manager!.fetchVaultPasswordEntries(...state.wasmStorageArgs()),
    );
    state.passwordEntries = raw;
    state.loginUnlockMode = "keys";
    if (state.passwordEntries.length === 1 && !state.selectedPasswordEntryId) {
      state.selectedPasswordEntryId = state.passwordEntries[0]!.id;
    }
    return true;
  } catch {
    if (!state.isAuthenticated) {
      state.loginUnlockMode = "unknown";
    }
    state.passwordEntries = [];
    return false;
  }
}

export function generatePassword(
  _state: VaultState,
  length: number,
  lowercase: boolean,
  uppercase: boolean,
  numbers: boolean,
  symbols: boolean,
): string {
  return coreGeneratePassword(length, lowercase, uppercase, numbers, symbols);
}
