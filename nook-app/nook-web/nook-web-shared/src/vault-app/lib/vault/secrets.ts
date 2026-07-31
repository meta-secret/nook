import type { VaultState } from "$lib/vault.svelte";
import type {
  AuthenticatorCodeView,
  NookImportResult,
  NookSecretRecord,
  SecretType,
} from "$lib/nook";
import {
  generatePassword as coreGeneratePassword,
  generateSecretId,
  VaultAccessStatus,
} from "$lib/nook";
import { createLogger } from "$lib/log";
import {
  JoinEnrollmentState,
  RemoteVaultRecoveryState,
  type NookSecretPage,
  type NookVaultManager,
} from "$app-wasm";
import { VaultEditDecision } from "$app-wasm";
import { syncLocalFolderProvider } from "$lib/vault/sync.svelte";
import {
  isSentinelCeremonyRequiredError,
  refreshSentinelUnlockStatus,
  surfaceSentinelCeremonyIfNeeded,
} from "$lib/vault/sentinel-unlock";
import { LoginSetupKind } from "$lib/vault/state/provider.svelte";
import { PasswordEntrySelectionKind } from "$lib/vault/state/session.svelte";
enum StorageConnectionKind {
  Configured = "configured",
  RemoteRecovery = "remote-recovery",
}

type StorageConnection =
  | { kind: StorageConnectionKind.Configured }
  | {
      kind: StorageConnectionKind.RemoteRecovery;
      args: [string, string, string];
    };

const log = createLogger("connect");

function freeSecretRecords(records: ReadonlyArray<{ free(): void }>) {
  for (const record of records) record.free();
}

export async function loadDb(state: VaultState) {
  if (state.isInitializing) {
    state.errorMsg = state.t("errors.engine_loading");
    return;
  }

  if (!state.hasManager) {
    state.errorMsg = state.t("errors.engine_unavailable");
    return;
  }

  if (state.isVerifying) {
    state.errorMsg = state.t("errors.connection_in_progress");
    return;
  }

  state.errorMsg = "";
  state.dismissSuccess();
  state.isVerifying = true;
  try {
    await state.initDeviceIdentity();
    await state.ensureOAuthTokensFresh();

    if (
      !state.isAuthenticated &&
      state.loginSetup.kind === LoginSetupKind.Active &&
      state.loginSetup.providerType === "local-folder"
    ) {
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
    let storageConnection: StorageConnection = {
      kind: StorageConnectionKind.Configured,
    };
    log.debug("loadDb assess", {
      accessStatus,
      localVaultPresent: state.localVaultPresent,
      joinEnrollmentPrompt: state.joinEnrollmentPrompt,
      syncProviders: state.syncProviders.length,
    });

    if (
      accessStatus === VaultAccessStatus.NeedsEnrollment ||
      accessStatus === VaultAccessStatus.JoinPending
    ) {
      log.info("loadDb waiting on enrollment", { accessStatus });
    }

    // A joiner device keeps a pre-approval projection in the local cache
    // (join row, no auth envelope). Once the join is approved remotely, the
    // local cache is stale and keeps reporting join_pending/needs_enrollment
    // forever. The sync provider remote is authoritative for enrollment
    // state, so re-assess against it and connect there when it is ready.
    if (
      (accessStatus === VaultAccessStatus.JoinPending ||
        accessStatus === VaultAccessStatus.NeedsEnrollment) &&
      !state.isAuthenticated &&
      state.syncProviders.length > 0
    ) {
      const providerArgs = state.providerWasmArgs(state.syncProviders[0]!);
      const remoteStatus = await state.assessVaultConnectStatus(providerArgs);
      log.debug("loadDb provider re-assess", { remoteStatus });
      if (remoteStatus === VaultAccessStatus.Ready) {
        accessStatus = VaultAccessStatus.Ready;
        storageConnection = {
          kind: StorageConnectionKind.RemoteRecovery,
          args: providerArgs,
        };
      }
    }

    if (
      !state.clientPolicy.remoteRecoveryConnectConfirmed(
        state.remoteVaultRecoveryState,
      ) &&
      (await state.handleRemoteVaultAssessStatus(accessStatus))
    ) {
      return;
    }

    if (accessStatus === VaultAccessStatus.NeedsEnrollment) {
      await state.ensureProviderSaved();
      const hasPasswordFallback = await state.refreshPasswordEntriesList();
      if (hasPasswordFallback && state.passwordEntries.length > 0) {
        state.loginPasswordPrompt = true;
        state.joinEnrollmentPrompt = JoinEnrollmentState.None;
        return;
      }
      state.joinEnrollmentPrompt = JoinEnrollmentState.NeedsRequest;
      state.startVaultSync();
      return;
    }
    if (accessStatus === VaultAccessStatus.JoinPending) {
      await state.ensureProviderSaved();
      const hasPasswordFallback = await state.refreshPasswordEntriesList();
      if (hasPasswordFallback && state.passwordEntries.length > 0) {
        state.loginPasswordPrompt = true;
        state.joinEnrollmentPrompt = JoinEnrollmentState.None;
        return;
      }
      state.joinEnrollmentPrompt = JoinEnrollmentState.Pending;
      state.awaitingJoinApproval = true;
      state.startVaultSync();
      return;
    }

    const rawRecords = await state.enqueueStorage(async () => {
      const connectArgs =
        storageConnection.kind === StorageConnectionKind.RemoteRecovery
          ? storageConnection.args
          : state.connectStorageArgs();
      log.debug("loadDb connect", { mode: connectArgs[0] });
      const connectPromise =
        state.remoteVaultRecoveryState === RemoteVaultRecoveryState.ConnectFresh
          ? state.requireManager().connect_fresh(...connectArgs)
          : state.requireManager().connect(...connectArgs);
      state.remoteVaultRecoveryState = RemoteVaultRecoveryState.None;
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
    freeSecretRecords(rawRecords);
    await state.loadSecretPage("", 0);
    // Load sync providers before unlocking the UI. Otherwise a fast local
    // edit (especially delete, which used to fire-and-forget fan-out) can run
    // while `syncProviders` is still empty and never push the event remotely.
    state.syncOAuthRemoteRefFromManager();
    await state.ensureProviderSaved();
    await state.loadProviders();
    await state.promoteSessionVaultToLocalIfNeeded();
    await state.refreshPasswordEntriesList();
    await state.hydrateMultiDeviceState();
    state.markVaultUnlocked();
    log.info("vault connected", {
      mode: state.storageMode,
      secrets: state.secretTotal,
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

async function runPasswordManagerImport(
  state: VaultState,
  importFromManager: (manager: NookVaultManager) => Promise<NookImportResult>,
  sourceName: string,
  successKey: string,
  failureKey: string,
): Promise<NookImportResult> {
  if (!state.hasManager) throw new Error(state.t("errors.engine_unavailable"));
  const manager = state.requireManager();
  const editRestriction = state.editRestriction;
  if (editRestriction.decision !== VaultEditDecision.Allowed) {
    throw new Error(editRestriction.reason);
  }
  state.errorMsg = "";
  state.dismissSuccess();
  state.isSaving = true;
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
  try {
    const result = await state.enqueueStorage(() => importFromManager(manager));
    await state.runFanOutSyncAfterLocalSave();
    await state.refreshSecretsFromSession();
    log.info(`${sourceName} import completed`, {
      imported: result.imported,
      skippedUnsupported: result.skippedUnsupported,
      skippedDuplicates: result.skippedDuplicates,
    });
    state.showSuccess(state.t(successKey, { count: String(result.imported) }));
    return result;
  } catch (error: unknown) {
    state.errorMsg = state.t(failureKey, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    state.isSaving = false;
  }
}

async function prepareSecretMutation(state: VaultState): Promise<boolean> {
  if (!state.hasManager) return false;
  const editRestriction = state.editRestriction;
  if (editRestriction.decision !== VaultEditDecision.Allowed) {
    state.errorMsg = editRestriction.reason;
    return false;
  }
  state.errorMsg = "";
  state.dismissSuccess();
  state.isSaving = true;
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
  return true;
}

export async function handleAddSecret(
  state: VaultState,
  id: string,
  type: SecretType,
  data: string,
) {
  if (!(await prepareSecretMutation(state))) return;
  try {
    await state.enqueueStorage(async () => {
      const rawRecords = (await state.raceStorageTimeout(
        state.requireManager().add_secret(id, type, data),
        "Add secret",
      )) as NookSecretRecord[];
      freeSecretRecords(rawRecords);
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

export async function handleBitwardenImport(
  state: VaultState,
  json: string,
  password: string,
): Promise<NookImportResult> {
  return runPasswordManagerImport(
    state,
    (manager) => manager.importBitwardenJson(json, password),
    "Bitwarden",
    "toasts.bitwarden_imported",
    "bitwarden_import.failed",
  );
}

export async function handleLastPassImport(
  state: VaultState,
  csv: string,
): Promise<NookImportResult> {
  return runPasswordManagerImport(
    state,
    (manager) => manager.importLastPassCsv(csv),
    "LastPass",
    "toasts.lastpass_imported",
    "lastpass_import.failed",
  );
}

export async function handleKeeperImport(
  state: VaultState,
  csv: string,
): Promise<NookImportResult> {
  return runPasswordManagerImport(
    state,
    (manager) => manager.importKeeperCsv(csv),
    "Keeper",
    "toasts.keeper_imported",
    "keeper_import.failed",
  );
}

export async function handleOnePasswordImport(
  state: VaultState,
  archive: Uint8Array,
): Promise<NookImportResult> {
  return runPasswordManagerImport(
    state,
    (manager) => manager.importOnePasswordPux(archive),
    "1Password",
    "toasts.onepassword_imported",
    "onepassword_import.failed",
  );
}

export async function handleApplePasswordsImport(
  state: VaultState,
  exportBytes: Uint8Array,
): Promise<NookImportResult> {
  return runPasswordManagerImport(
    state,
    (manager) => manager.importApplePasswordsExport(exportBytes),
    "Safari / Apple Passwords",
    "toasts.apple_passwords_imported",
    "apple_passwords_import.failed",
  );
}

export async function handleChromePasswordsImport(
  state: VaultState,
  csv: string,
): Promise<NookImportResult> {
  return runPasswordManagerImport(
    state,
    (manager) => manager.importChromePasswordsCsv(csv),
    "Chrome passwords",
    "toasts.chrome_passwords_imported",
    "chrome_passwords_import.failed",
  );
}

export async function handleGoogleAuthenticatorImport(
  state: VaultState,
  migrationUris: string[],
): Promise<NookImportResult> {
  return runPasswordManagerImport(
    state,
    (manager) => manager.importGoogleAuthenticatorMigration(migrationUris),
    "Google Authenticator",
    "toasts.google_authenticator_imported",
    "google_authenticator_import.failed",
  );
}

export async function handleProtonPassImport(
  state: VaultState,
  exportBytes: Uint8Array,
): Promise<NookImportResult> {
  return runPasswordManagerImport(
    state,
    (manager) => manager.importProtonPass(exportBytes),
    "Proton Pass",
    "toasts.proton_pass_imported",
    "proton_pass_import.failed",
  );
}

export async function handleDeleteSecret(state: VaultState, id: string) {
  if (!state.hasManager) return;
  const editRestriction = state.editRestriction;
  if (editRestriction.decision !== VaultEditDecision.Allowed) {
    state.errorMsg = editRestriction.reason;
    return;
  }
  state.errorMsg = "";
  state.dismissSuccess();
  state.isSaving = true;
  // Drop the row immediately so the UI reflects the delete without waiting for
  // the authoritative wasm op, which can queue behind background sync work
  // (restored below if the delete fails).
  const previousSecrets = state.secrets;
  const deletedRecord = state.secrets.find((record) => record.id === id);
  let committed = false;
  state.secrets = state.secrets.filter((record) => record.id !== id);
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
  try {
    await state.enqueueStorage(async () => {
      const rawRecords = (await state
        .requireManager()
        .delete_secret(id)) as NookSecretRecord[];
      freeSecretRecords(rawRecords);
    });
    committed = true;
    deletedRecord?.free();
    await state.refreshSecretsFromSession();
    log.info("secret deleted", { id });
    state.showSuccess(state.t("toasts.secret_deleted"));
    // Match add/replace: await fan-out so the delete event is pushed before
    // callers observe remote state (and so an empty provider list is not a
    // silent no-op race right after unlock).
    await state.runFanOutSyncAfterLocalSave();
    await state.refreshSecretsFromSession();
  } catch (e: unknown) {
    if (!committed) {
      state.secrets = previousSecrets;
    }
    state.errorMsg = `Failed to delete secret: ${e instanceof Error ? e.message : String(e)}`;
    throw e;
  } finally {
    state.isSaving = false;
  }
}

export async function handleReplaceSecret(
  state: VaultState,
  oldId: string,
  type: SecretType,
  data: string,
) {
  if (!(await prepareSecretMutation(state))) return;
  try {
    const newId = generateSecretId();
    await state.enqueueStorage(async () => {
      const rawRecords = (await state
        .requireManager()
        .replace_secret(oldId, newId, type, data)) as NookSecretRecord[];
      freeSecretRecords(rawRecords);
    });
    await state.refreshSecretsFromSession();
    log.info("secret replaced", { oldId, newId, type });
    await state.runFanOutSyncAfterLocalSave();
    state.showSuccess(state.t("toasts.item_updated"));
  } catch (e: unknown) {
    state.errorMsg = `Failed to update item: ${e instanceof Error ? e.message : String(e)}`;
    throw e;
  } finally {
    state.isSaving = false;
  }
}

export async function refreshPasswordEntriesList(
  state: VaultState,
): Promise<boolean> {
  if (!state.hasManager) return false;
  try {
    if (!state.hasRemoteCredentials()) {
      state.passwordEntries = [];
      return false;
    }
    await state.ensureOAuthTokensFresh();
    const raw = await state.enqueueStorage(() =>
      state
        .requireManager()
        .fetchVaultPasswordEntries(...state.wasmStorageArgs()),
    );
    state.passwordEntries = raw;
    if (
      state.passwordEntries.length === 1 &&
      state.selectedPasswordEntry.kind ===
        PasswordEntrySelectionKind.NotSelected
    ) {
      for (const entry of state.passwordEntries) {
        state.selectPasswordEntry(entry.id);
      }
    }
    return true;
  } catch {
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

export async function refreshSecretsFromSession(
  state: VaultState,
): Promise<void> {
  if (!state.hasManager) {
    freeSecretRecords(state.secrets);
    state.secrets = [];
    state.secretTotal = 0;
    state.secretPageOffset = 0;
    state.secretPageRequestOffset = 0;
    return;
  }
  await loadSecretPage(state, state.secretQuery, state.secretPageRequestOffset);
}

export async function loadSecretPage(
  state: VaultState,
  query: string,
  requestedOffset = 0,
): Promise<void> {
  if (!state.hasManager) return;
  // Publish the request immediately so maintenance refreshes queued behind it
  // cannot re-submit the previous query or page.
  state.secretQuery = query;
  state.secretPageRequestOffset = requestedOffset;
  // Each request supersedes every older page request. The storage queue
  // serializes WASM access, but it does not prevent an earlier caller from
  // applying its result after a newer search has already been requested.
  const generation = ++state.secretPageGeneration;
  const page = await state.enqueueStorage(() =>
    state
      .requireManager()
      .queryPreparedSecretPage(
        query,
        state.secretTypeFilter,
        requestedOffset,
        state.secretPageSize,
      ),
  );
  let records = page.takeItems();
  let total = page.total;
  let offset = page.offset;
  page.free();
  if (generation !== state.secretPageGeneration) {
    freeSecretRecords(records);
    return;
  }

  if (records.length === 0 && total > 0 && offset >= total) {
    const lastOffset = state.clientPolicy.normalizedSecretPageOffset(
      total,
      offset,
      state.secretPageSize,
    );
    const lastPage = await state.enqueueStorage(() =>
      state
        .requireManager()
        .querySecretPage(
          query,
          state.secretTypeFilter,
          lastOffset,
          state.secretPageSize,
        ),
    );
    records = lastPage.takeItems();
    total = lastPage.total;
    offset = lastPage.offset;
    lastPage.free();
    if (generation !== state.secretPageGeneration) {
      freeSecretRecords(records);
      return;
    }
  }

  freeSecretRecords(state.secrets);
  state.secrets = records;
  state.secretTotal = total;
  state.secretPageOffset = offset;
  state.secretPageRequestOffset = offset;
  state.secretQuery = query;
}

export function applyConnectedSecretPage(
  state: VaultState,
  page: NookSecretPage,
  query: string,
): void {
  const records = page.takeItems();
  const total = page.total;
  const offset = page.offset;
  page.free();
  freeSecretRecords(state.secrets);
  state.secrets = records;
  state.secretTotal = total;
  state.secretPageOffset = offset;
  state.secretPageRequestOffset = offset;
  state.secretQuery = query;
}

export async function decryptSecret(
  state: VaultState,
  id: string,
): Promise<NookSecretRecord> {
  if (!state.hasManager) {
    throw new Error("Vault manager is not initialized.");
  }
  return state.enqueueStorage(() => state.requireManager().decryptSecret(id));
}

export async function currentAuthenticatorCode(
  state: VaultState,
  id: string,
): Promise<AuthenticatorCodeView> {
  if (!state.hasManager) {
    throw new Error("Vault manager is not initialized.");
  }
  const unixSeconds = Math.floor(Date.now() / 1000);
  const result = await state.enqueueStorage(() =>
    state.requireManager().currentAuthenticatorCode(id, unixSeconds),
  );
  try {
    return {
      code: result.code,
      secondsRemaining: result.secondsRemaining,
      period: result.period,
      expiresAtUnixSeconds: result.expiresAtUnixSeconds,
    };
  } finally {
    result.free();
  }
}
