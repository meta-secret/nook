import { I18N_KEYS } from "../../../generated/i18n-keys";
import type { VaultState } from "$lib/vault.svelte";
import type {
  AuthenticatorCodeView,
  NookImportResult,
  NookSecretRecord,
  SecretType,
} from "$lib/nook";
import { generate_secret_id } from "$lib/nook";
import { browserLogRuntime } from "$lib/runtime/log";
import { type NookSecretPage, type NookVaultManager } from "$app-wasm";
import { VaultEditDecision } from "$app-wasm";
import { PasswordEntrySelectionKind } from "$lib/vault/state/session.svelte";

export { VaultConnectionActions } from "$lib/vault/connection";

const log = browserLogRuntime.createLogger("connect");

interface VaultSecretAllocation {
  free(): void;
}

type VaultSecretAllocationCollection = ReadonlyArray<VaultSecretAllocation>;

interface PasswordManagerImportExecution {
  readonly importFromManager: (
    manager: NookVaultManager,
  ) => Promise<NookImportResult>;
  readonly sourceName: string;
  readonly successKey: string;
  readonly failureKey: string;
}

interface SecretCreation {
  readonly id: string;
  readonly type: SecretType;
  readonly data: string;
}

interface BitwardenVaultImport {
  readonly json: string;
  readonly password: string;
}

interface KeePassXcVaultImport {
  readonly csv: string;
}

interface LastPassVaultImport {
  readonly csv: string;
}

interface KeeperVaultImport {
  readonly csv: string;
}

interface OnePasswordVaultImport {
  readonly archive: Uint8Array;
}

interface ApplePasswordsVaultImport {
  readonly exportBytes: Uint8Array;
}

interface ChromePasswordsVaultImport {
  readonly csv: string;
}

interface DashlaneVaultImport {
  readonly exportBytes: Uint8Array;
}

interface ProtonPassVaultImport {
  readonly exportBytes: Uint8Array;
}

interface AuthenticatorMigrationImport {
  readonly migrationUris: string[];
}

interface SecretDeletion {
  readonly id: string;
}

interface SecretReplacement {
  readonly oldId: string;
  readonly type: SecretType;
  readonly data: string;
}

interface SecretPageRequest {
  readonly query: string;
  readonly requestedOffset: number;
}

interface ConnectedSecretPageApplication {
  readonly page: NookSecretPage;
  readonly query: string;
}

interface SecretDecryption {
  readonly id: string;
}

interface AuthenticatorCodeRequest {
  readonly id: string;
}

/** Owns browser orchestration for one secrets context. */
export class VaultSecretActions {
  constructor(private readonly state: VaultState) {}

  private static freeSecretRecords(records: VaultSecretAllocationCollection) {
    for (const record of records) record.free();
  }

  private async runPasswordManagerImport({
    importFromManager,
    sourceName,
    successKey,
    failureKey,
  }: PasswordManagerImportExecution): Promise<NookImportResult> {
    const state = this.state;
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
      const result = await state.enqueueStorage(() =>
        importFromManager(manager),
      );
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

  private async prepareSecretMutation(): Promise<boolean> {
    const state = this.state;
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

  async handleAddSecret({ id, type, data }: SecretCreation) {
    const state = this.state;
    if (!(await this.prepareSecretMutation())) return;
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
        VaultSecretActions.freeSecretRecords(rawRecords);
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

  async handleBitwardenImport({
    json,
    password,
  }: BitwardenVaultImport): Promise<NookImportResult> {
    const state = this.state;
    const runPasswordManagerImportArgs: Parameters<
      VaultSecretActions["runPasswordManagerImport"]
    >[0] = {
      importFromManager: (manager) =>
        manager.import_bitwarden_json(json, password),
      sourceName: "Bitwarden",
      successKey: I18N_KEYS.ToastsBitwardenImported,
      failureKey: I18N_KEYS.BitwardenImportFailed,
    };
    return this.runPasswordManagerImport(runPasswordManagerImportArgs);
  }

  async handleKeePassXcImport({
    csv,
  }: KeePassXcVaultImport): Promise<NookImportResult> {
    const state = this.state;
    const runPasswordManagerImportArgs2: Parameters<
      VaultSecretActions["runPasswordManagerImport"]
    >[0] = {
      importFromManager: (manager) => manager.import_keepassxc_csv(csv),
      sourceName: "KeePassXC",
      successKey: I18N_KEYS.ToastsKeepassxcImported,
      failureKey: I18N_KEYS.KeepassxcImportFailed,
    };
    return this.runPasswordManagerImport(runPasswordManagerImportArgs2);
  }

  async handleLastPassImport({
    csv,
  }: LastPassVaultImport): Promise<NookImportResult> {
    const state = this.state;
    const runPasswordManagerImportArgs3: Parameters<
      VaultSecretActions["runPasswordManagerImport"]
    >[0] = {
      importFromManager: (manager) => manager.import_lastpass_csv(csv),
      sourceName: "LastPass",
      successKey: I18N_KEYS.ToastsLastpassImported,
      failureKey: I18N_KEYS.LastpassImportFailed,
    };
    return this.runPasswordManagerImport(runPasswordManagerImportArgs3);
  }

  async handleKeeperImport({
    csv,
  }: KeeperVaultImport): Promise<NookImportResult> {
    const state = this.state;
    const runPasswordManagerImportArgs4: Parameters<
      VaultSecretActions["runPasswordManagerImport"]
    >[0] = {
      importFromManager: (manager) => manager.import_keeper_csv(csv),
      sourceName: "Keeper",
      successKey: I18N_KEYS.ToastsKeeperImported,
      failureKey: I18N_KEYS.KeeperImportFailed,
    };
    return this.runPasswordManagerImport(runPasswordManagerImportArgs4);
  }

  async handleOnePasswordImport({
    archive,
  }: OnePasswordVaultImport): Promise<NookImportResult> {
    const state = this.state;
    const runPasswordManagerImportArgs5: Parameters<
      VaultSecretActions["runPasswordManagerImport"]
    >[0] = {
      importFromManager: (manager) => manager.import_onepassword_pux(archive),
      sourceName: "1Password",
      successKey: I18N_KEYS.ToastsOnepasswordImported,
      failureKey: I18N_KEYS.OnepasswordImportFailed,
    };
    return this.runPasswordManagerImport(runPasswordManagerImportArgs5);
  }

  async handleApplePasswordsImport({
    exportBytes,
  }: ApplePasswordsVaultImport): Promise<NookImportResult> {
    const state = this.state;
    const runPasswordManagerImportArgs6: Parameters<
      VaultSecretActions["runPasswordManagerImport"]
    >[0] = {
      importFromManager: (manager) =>
        manager.import_apple_passwords_export(exportBytes),
      sourceName: "Safari / Apple Passwords",
      successKey: I18N_KEYS.ToastsApplePasswordsImported,
      failureKey: I18N_KEYS.ApplePasswordsImportFailed,
    };
    return this.runPasswordManagerImport(runPasswordManagerImportArgs6);
  }

  async handleChromePasswordsImport({
    csv,
  }: ChromePasswordsVaultImport): Promise<NookImportResult> {
    const state = this.state;
    const runPasswordManagerImportArgs7: Parameters<
      VaultSecretActions["runPasswordManagerImport"]
    >[0] = {
      importFromManager: (manager) => manager.import_chrome_passwords_csv(csv),
      sourceName: "Chrome passwords",
      successKey: I18N_KEYS.ToastsChromePasswordsImported,
      failureKey: I18N_KEYS.ChromePasswordsImportFailed,
    };
    return this.runPasswordManagerImport(runPasswordManagerImportArgs7);
  }

  async handleDashlaneImport({
    exportBytes,
  }: DashlaneVaultImport): Promise<NookImportResult> {
    const state = this.state;
    const runPasswordManagerImportArgs8: Parameters<
      VaultSecretActions["runPasswordManagerImport"]
    >[0] = {
      importFromManager: (manager) =>
        manager.import_dashlane_export(exportBytes),
      sourceName: "Dashlane",
      successKey: I18N_KEYS.ToastsDashlaneImported,
      failureKey: I18N_KEYS.DashlaneImportFailed,
    };
    return this.runPasswordManagerImport(runPasswordManagerImportArgs8);
  }

  async handleGoogleAuthenticatorImport({
    migrationUris,
  }: AuthenticatorMigrationImport): Promise<NookImportResult> {
    const state = this.state;
    const runPasswordManagerImportArgs9: Parameters<
      VaultSecretActions["runPasswordManagerImport"]
    >[0] = {
      importFromManager: (manager) =>
        manager.import_google_authenticator_migration(migrationUris),
      sourceName: "Google Authenticator",
      successKey: I18N_KEYS.ToastsGoogleAuthenticatorImported,
      failureKey: I18N_KEYS.GoogleAuthenticatorImportFailed,
    };
    return this.runPasswordManagerImport(runPasswordManagerImportArgs9);
  }

  async handleProtonPassImport({
    exportBytes,
  }: ProtonPassVaultImport): Promise<NookImportResult> {
    const state = this.state;
    const runPasswordManagerImportArgs10: Parameters<
      VaultSecretActions["runPasswordManagerImport"]
    >[0] = {
      importFromManager: (manager) => manager.import_proton_pass(exportBytes),
      sourceName: "Proton Pass",
      successKey: I18N_KEYS.ToastsProtonPassImported,
      failureKey: I18N_KEYS.ProtonPassImportFailed,
    };
    return this.runPasswordManagerImport(runPasswordManagerImportArgs10);
  }

  async handleDeleteSecret({ id }: SecretDeletion) {
    const state = this.state;
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
        VaultSecretActions.freeSecretRecords(rawRecords);
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

  async handleReplaceSecret({ oldId, type, data }: SecretReplacement) {
    const state = this.state;
    if (!(await this.prepareSecretMutation())) return;
    try {
      const newId = generate_secret_id();
      await state.enqueueStorage(async () => {
        const rawRecords = (await state
          .requireManager()
          .replace_secret(oldId, newId, type, data)) as NookSecretRecord[];
        VaultSecretActions.freeSecretRecords(rawRecords);
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

  async refreshPasswordEntriesList(): Promise<boolean> {
    const state = this.state;
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

  async refreshSecretsFromSession(): Promise<void> {
    const state = this.state;
    if (!state.hasManager) {
      VaultSecretActions.freeSecretRecords(state.secrets);
      state.secrets = [];
      state.secretTotal = 0;
      state.secretPageOffset = 0;
      state.secretPageRequestOffset = 0;
      return;
    }
    const loadSecretPageArgs2: Parameters<
      VaultSecretActions["loadSecretPage"]
    >[0] = {
      query: state.secretQuery,
      requestedOffset: state.secretPageRequestOffset,
    };
    await this.loadSecretPage(loadSecretPageArgs2);
  }

  async loadSecretPage({
    query,
    requestedOffset,
  }: SecretPageRequest): Promise<void> {
    const state = this.state;
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
      VaultSecretActions.freeSecretRecords(records);
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
        VaultSecretActions.freeSecretRecords(records);
        return;
      }
    }

    VaultSecretActions.freeSecretRecords(state.secrets);
    state.secrets = records;
    state.secretTotal = total;
    state.secretPageOffset = offset;
    state.secretPageRequestOffset = offset;
    state.secretQuery = query;
  }

  applyConnectedSecretPage({
    page,
    query,
  }: ConnectedSecretPageApplication): void {
    const state = this.state;
    const records = page.take_items();
    const total = page.total;
    const offset = page.offset;
    page.free();
    VaultSecretActions.freeSecretRecords(state.secrets);
    state.secrets = records;
    state.secretTotal = total;
    state.secretPageOffset = offset;
    state.secretPageRequestOffset = offset;
    state.secretQuery = query;
  }

  async decryptSecret({ id }: SecretDecryption): Promise<NookSecretRecord> {
    const state = this.state;
    if (!state.hasManager) {
      throw new Error("Vault manager is not initialized.");
    }
    return state.enqueueStorage(() =>
      state.requireManager().decrypt_secret_js(id),
    );
  }

  async currentAuthenticatorCode({
    id,
  }: AuthenticatorCodeRequest): Promise<AuthenticatorCodeView> {
    const state = this.state;
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
}
