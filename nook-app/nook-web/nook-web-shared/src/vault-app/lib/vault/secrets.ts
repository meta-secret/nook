import { I18N_KEYS } from "../../../generated/i18n-keys";
import type { VaultState } from "$lib/vault.svelte";
import type {
  AuthenticatorCodeView,
  NookImportResult,
  NookSecretRecord,
  SecretType,
} from "$lib/nook";
import { generate_secret_id } from "$lib/nook";
import { createLogger } from "$lib/runtime/log";
import { type NookSecretPage, type NookVaultManager } from "$app-wasm";
import { VaultEditDecision } from "$app-wasm";
import { PasswordEntrySelectionKind } from "$lib/vault/state/session.svelte";

export { loadDb } from "$lib/vault/connection";

const log = createLogger("connect");

interface VaultSecretAllocation {
  free(): void;
}
type VaultSecretAllocationCollection = ReadonlyArray<VaultSecretAllocation>;

interface PasswordManagerImportExecution {
  readonly state: VaultState;
  readonly importFromManager: (
    manager: NookVaultManager,
  ) => Promise<NookImportResult>;
  readonly sourceName: string;
  readonly successKey: string;
  readonly failureKey: string;
}

interface SecretCreation {
  readonly state: VaultState;
  readonly id: string;
  readonly type: SecretType;
  readonly data: string;
}

interface BitwardenVaultImport {
  readonly state: VaultState;
  readonly json: string;
  readonly password: string;
}

interface KeePassXcVaultImport {
  readonly state: VaultState;
  readonly csv: string;
}

interface LastPassVaultImport {
  readonly state: VaultState;
  readonly csv: string;
}

interface KeeperVaultImport {
  readonly state: VaultState;
  readonly csv: string;
}

interface OnePasswordVaultImport {
  readonly state: VaultState;
  readonly archive: Uint8Array;
}

interface ApplePasswordsVaultImport {
  readonly state: VaultState;
  readonly exportBytes: Uint8Array;
}

interface ChromePasswordsVaultImport {
  readonly state: VaultState;
  readonly csv: string;
}

interface DashlaneVaultImport {
  readonly state: VaultState;
  readonly exportBytes: Uint8Array;
}

interface ProtonPassVaultImport {
  readonly state: VaultState;
  readonly exportBytes: Uint8Array;
}

interface AuthenticatorMigrationImport {
  readonly state: VaultState;
  readonly migrationUris: string[];
}

interface SecretDeletion {
  readonly state: VaultState;
  readonly id: string;
}

interface SecretReplacement {
  readonly state: VaultState;
  readonly oldId: string;
  readonly type: SecretType;
  readonly data: string;
}

interface SecretPageRequest {
  readonly state: VaultState;
  readonly query: string;
  readonly requestedOffset: number;
}

interface ConnectedSecretPageApplication {
  readonly state: VaultState;
  readonly page: NookSecretPage;
  readonly query: string;
}

interface SecretDecryption {
  readonly state: VaultState;
  readonly id: string;
}

interface AuthenticatorCodeRequest {
  readonly state: VaultState;
  readonly id: string;
}

function freeSecretRecords(records: VaultSecretAllocationCollection) {
  for (const record of records) record.free();
}

async function runPasswordManagerImport({
  state,
  importFromManager,
  sourceName,
  successKey,
  failureKey,
}: PasswordManagerImportExecution): Promise<NookImportResult> {
  if (!state.hasManager)
    throw new Error(state.t(I18N_KEYS.ErrorsEngineUnavailable));
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
    log.info(`${sourceName} import completed`);
    const tArgs: Parameters<typeof state.t>[0] = {
      key: successKey,
      replacements: { count: String(result.imported) },
    };
    state.showSuccess(state.t(tArgs));
    return result;
  } catch (error) {
    const tArgs2: Parameters<typeof state.t>[0] = {
      key: failureKey,
      replacements: {
        error: error instanceof Error ? error.message : String(error),
      },
    };
    state.errorMsg = state.t(tArgs2);
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

export async function handleAddSecret({
  state,
  id,
  type,
  data,
}: SecretCreation) {
  if (!(await prepareSecretMutation(state))) return;
  try {
    await state.enqueueStorage(async () => {
      const raceStorageTimeoutArgs: Parameters<
        typeof state.raceStorageTimeout
      >[0] = {
        promise: state.requireManager().add_secret(id, type, data),
        label: "Add secret",
      };
      const rawRecords = (await state.raceStorageTimeout(
        raceStorageTimeoutArgs,
      )) as NookSecretRecord[];
      freeSecretRecords(rawRecords);
    });
    await state.refreshSecretsFromSession();
    log.info("secret added");
    state.showSuccess(state.t(I18N_KEYS.ToastsSecretSaved));
    await state.runFanOutSyncAfterLocalSave();
    await state.refreshSecretsFromSession();
  } catch (e) {
    state.errorMsg = `Failed to save secret: ${e instanceof Error ? e.message : String(e)}`;
    throw e;
  } finally {
    state.isSaving = false;
  }
}

export async function handleBitwardenImport({
  state,
  json,
  password,
}: BitwardenVaultImport): Promise<NookImportResult> {
  const runPasswordManagerImportArgs: Parameters<
    typeof runPasswordManagerImport
  >[0] = {
    state,
    importFromManager: (manager) =>
      manager.import_bitwarden_json(json, password),
    sourceName: "Bitwarden",
    successKey: I18N_KEYS.ToastsBitwardenImported,
    failureKey: I18N_KEYS.BitwardenImportFailed,
  };
  return runPasswordManagerImport(runPasswordManagerImportArgs);
}

export async function handleKeePassXcImport({
  state,
  csv,
}: KeePassXcVaultImport): Promise<NookImportResult> {
  const runPasswordManagerImportArgs2: Parameters<
    typeof runPasswordManagerImport
  >[0] = {
    state,
    importFromManager: (manager) => manager.import_keepassxc_csv(csv),
    sourceName: "KeePassXC",
    successKey: I18N_KEYS.ToastsKeepassxcImported,
    failureKey: I18N_KEYS.KeepassxcImportFailed,
  };
  return runPasswordManagerImport(runPasswordManagerImportArgs2);
}

export async function handleLastPassImport({
  state,
  csv,
}: LastPassVaultImport): Promise<NookImportResult> {
  const runPasswordManagerImportArgs3: Parameters<
    typeof runPasswordManagerImport
  >[0] = {
    state,
    importFromManager: (manager) => manager.import_lastpass_csv(csv),
    sourceName: "LastPass",
    successKey: I18N_KEYS.ToastsLastpassImported,
    failureKey: I18N_KEYS.LastpassImportFailed,
  };
  return runPasswordManagerImport(runPasswordManagerImportArgs3);
}

export async function handleKeeperImport({
  state,
  csv,
}: KeeperVaultImport): Promise<NookImportResult> {
  const runPasswordManagerImportArgs4: Parameters<
    typeof runPasswordManagerImport
  >[0] = {
    state,
    importFromManager: (manager) => manager.import_keeper_csv(csv),
    sourceName: "Keeper",
    successKey: I18N_KEYS.ToastsKeeperImported,
    failureKey: I18N_KEYS.KeeperImportFailed,
  };
  return runPasswordManagerImport(runPasswordManagerImportArgs4);
}

export async function handleOnePasswordImport({
  state,
  archive,
}: OnePasswordVaultImport): Promise<NookImportResult> {
  const runPasswordManagerImportArgs5: Parameters<
    typeof runPasswordManagerImport
  >[0] = {
    state,
    importFromManager: (manager) => manager.import_onepassword_pux(archive),
    sourceName: "1Password",
    successKey: I18N_KEYS.ToastsOnepasswordImported,
    failureKey: I18N_KEYS.OnepasswordImportFailed,
  };
  return runPasswordManagerImport(runPasswordManagerImportArgs5);
}

export async function handleApplePasswordsImport({
  state,
  exportBytes,
}: ApplePasswordsVaultImport): Promise<NookImportResult> {
  const runPasswordManagerImportArgs6: Parameters<
    typeof runPasswordManagerImport
  >[0] = {
    state,
    importFromManager: (manager) =>
      manager.import_apple_passwords_export(exportBytes),
    sourceName: "Safari / Apple Passwords",
    successKey: I18N_KEYS.ToastsApplePasswordsImported,
    failureKey: I18N_KEYS.ApplePasswordsImportFailed,
  };
  return runPasswordManagerImport(runPasswordManagerImportArgs6);
}

export async function handleChromePasswordsImport({
  state,
  csv,
}: ChromePasswordsVaultImport): Promise<NookImportResult> {
  const runPasswordManagerImportArgs7: Parameters<
    typeof runPasswordManagerImport
  >[0] = {
    state,
    importFromManager: (manager) => manager.import_chrome_passwords_csv(csv),
    sourceName: "Chrome passwords",
    successKey: I18N_KEYS.ToastsChromePasswordsImported,
    failureKey: I18N_KEYS.ChromePasswordsImportFailed,
  };
  return runPasswordManagerImport(runPasswordManagerImportArgs7);
}

export async function handleDashlaneImport({
  state,
  exportBytes,
}: DashlaneVaultImport): Promise<NookImportResult> {
  const runPasswordManagerImportArgs8: Parameters<
    typeof runPasswordManagerImport
  >[0] = {
    state,
    importFromManager: (manager) => manager.import_dashlane_export(exportBytes),
    sourceName: "Dashlane",
    successKey: I18N_KEYS.ToastsDashlaneImported,
    failureKey: I18N_KEYS.DashlaneImportFailed,
  };
  return runPasswordManagerImport(runPasswordManagerImportArgs8);
}

export async function handleGoogleAuthenticatorImport({
  state,
  migrationUris,
}: AuthenticatorMigrationImport): Promise<NookImportResult> {
  const runPasswordManagerImportArgs9: Parameters<
    typeof runPasswordManagerImport
  >[0] = {
    state,
    importFromManager: (manager) =>
      manager.import_google_authenticator_migration(migrationUris),
    sourceName: "Google Authenticator",
    successKey: I18N_KEYS.ToastsGoogleAuthenticatorImported,
    failureKey: I18N_KEYS.GoogleAuthenticatorImportFailed,
  };
  return runPasswordManagerImport(runPasswordManagerImportArgs9);
}

export async function handleProtonPassImport({
  state,
  exportBytes,
}: ProtonPassVaultImport): Promise<NookImportResult> {
  const runPasswordManagerImportArgs10: Parameters<
    typeof runPasswordManagerImport
  >[0] = {
    state,
    importFromManager: (manager) => manager.import_proton_pass(exportBytes),
    sourceName: "Proton Pass",
    successKey: I18N_KEYS.ToastsProtonPassImported,
    failureKey: I18N_KEYS.ProtonPassImportFailed,
  };
  return runPasswordManagerImport(runPasswordManagerImportArgs10);
}

export async function handleDeleteSecret({ state, id }: SecretDeletion) {
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
    log.info("secret deleted");
    state.showSuccess(state.t(I18N_KEYS.ToastsSecretDeleted));
    // Match add/replace: await fan-out so the delete event is pushed before
    // callers observe remote state (and so an empty provider list is not a
    // silent no-op race right after unlock).
    await state.runFanOutSyncAfterLocalSave();
    await state.refreshSecretsFromSession();
  } catch (e) {
    if (!committed) {
      state.secrets = previousSecrets;
    }
    state.errorMsg = `Failed to delete secret: ${e instanceof Error ? e.message : String(e)}`;
    throw e;
  } finally {
    state.isSaving = false;
  }
}

export async function handleReplaceSecret({
  state,
  oldId,
  type,
  data,
}: SecretReplacement) {
  if (!(await prepareSecretMutation(state))) return;
  try {
    const newId = generate_secret_id();
    await state.enqueueStorage(async () => {
      const rawRecords = (await state
        .requireManager()
        .replace_secret(oldId, newId, type, data)) as NookSecretRecord[];
      freeSecretRecords(rawRecords);
    });
    await state.refreshSecretsFromSession();
    log.info("secret replaced");
    await state.runFanOutSyncAfterLocalSave();
    state.showSuccess(state.t(I18N_KEYS.ToastsItemUpdated));
  } catch (e) {
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
    if (state.storageMode !== "local" && !state.hasRemoteCredentials()) {
      state.passwordEntries = [];
      return false;
    }
    if (state.storageMode !== "local") {
      await state.ensureOAuthTokensFresh();
    }
    const raw = await state.enqueueStorage(() =>
      state
        .requireManager()
        .fetch_vault_password_entries(...state.wasmStorageArgs()),
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
  const loadSecretPageArgs2: Parameters<typeof loadSecretPage>[0] = {
    state,
    query: state.secretQuery,
    requestedOffset: state.secretPageRequestOffset,
  };
  await loadSecretPage(loadSecretPageArgs2);
}

export async function loadSecretPage({
  state,
  query,
  requestedOffset,
}: SecretPageRequest): Promise<void> {
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
      .query_prepared_secret_page_js(
        query,
        state.secretTypeFilter,
        requestedOffset,
        state.secretPageSize,
      ),
  );
  let records = page.take_items();
  let total = page.total;
  let offset = page.offset;
  page.free();
  if (generation !== state.secretPageGeneration) {
    freeSecretRecords(records);
    return;
  }

  if (records.length === 0 && total > 0 && offset >= total) {
    const lastOffset = state.clientPolicy.normalized_secret_page_offset(
      total,
      offset,
      state.secretPageSize,
    );
    const lastPage = await state.enqueueStorage(() =>
      state
        .requireManager()
        .query_secret_page_js(
          query,
          state.secretTypeFilter,
          lastOffset,
          state.secretPageSize,
        ),
    );
    records = lastPage.take_items();
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

export function applyConnectedSecretPage({
  state,
  page,
  query,
}: ConnectedSecretPageApplication): void {
  const records = page.take_items();
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

export async function decryptSecret({
  state,
  id,
}: SecretDecryption): Promise<NookSecretRecord> {
  if (!state.hasManager) {
    throw new Error("Vault manager is not initialized.");
  }
  return state.enqueueStorage(() =>
    state.requireManager().decrypt_secret_js(id),
  );
}

export async function currentAuthenticatorCode({
  state,
  id,
}: AuthenticatorCodeRequest): Promise<AuthenticatorCodeView> {
  if (!state.hasManager) {
    throw new Error("Vault manager is not initialized.");
  }
  const unixSeconds = Math.floor(Date.now() / 1000);
  const result = await state.enqueueStorage(() =>
    state.requireManager().current_authenticator_code(id, unixSeconds),
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
