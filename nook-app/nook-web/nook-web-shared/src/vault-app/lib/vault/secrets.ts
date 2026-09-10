import type { OAuthFailure } from "$lib/auth/oauth-failure";
import {
  SecretEditRejection,
  type SecretOperationResult,
} from "./secret-operation-failure";
import { NativeVaultStorageFailure } from "$lib/runtime/storage-failure";
import { err as storageErr, ok as storageOk, type Result } from "neverthrow";
import {
  VaultStorageFailure as StorageOperationFailure,
  VaultStorageFailureKind as StorageOperationFailureKind,
} from "$lib/runtime/storage-failure";
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
  ) => Promise<SecretOperationResult<NookImportResult>>;
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

  private freeSecretRecords(records: VaultSecretAllocationCollection) {
    for (const record of records) record.free();
  }

  private async runPasswordManagerImport({
    importFromManager,
    sourceName,
    successKey,
  }: PasswordManagerImportExecution): Promise<
    SecretOperationResult<NookImportResult>
  > {
    const state = this.state;
    const prepared = await this.prepareSecretMutation();
    if (prepared.isErr()) return storageErr(prepared.error);
    state.isSaving = true;
    try {
      const imported = await state.enqueueStorage(async () => {
        const manager = state.admitManager();
        if (manager.isErr()) return storageErr(manager.error);
        return importFromManager(manager.value);
      });
      if (imported.isErr()) return storageErr(imported.error);
      const localSaveSync = await state.runFanOutSyncAfterLocalSave();
      if (localSaveSync.isErr()) {
        imported.value.free();
        return storageErr(localSaveSync.error);
      }
      const refreshed = await state.refreshSecretsFromSession();
      if (refreshed.isErr()) {
        imported.value.free();
        return storageErr(refreshed.error);
      }
      log.info(sourceName + " import completed");
      state.showSuccess(
        state.t({
          key: successKey,
          replacements: { count: String(imported.value.imported) },
        }),
      );
      return imported;
    } finally {
      state.isSaving = false;
    }
  }

  private async prepareSecretMutation(): Promise<SecretOperationResult<void>> {
    const state = this.state;
    const manager = state.admitManager();
    if (manager.isErr()) return storageErr(manager.error);
    const restriction = state.editRestriction;
    if (restriction.decision !== VaultEditDecision.Allowed)
      return storageErr(new SecretEditRejection(restriction));
    state.errorMsg = "";
    state.dismissSuccess();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    return storageOk();
  }

  async handleAddSecret({
    id,
    type,
    data,
  }: SecretCreation): Promise<SecretOperationResult<void>> {
    const state = this.state;
    const prepared = await this.prepareSecretMutation();
    if (prepared.isErr()) return storageErr(prepared.error);
    state.isSaving = true;
    try {
      const added = await state.enqueueStorage(async () => {
        const manager = state.admitManager();
        if (manager.isErr()) return storageErr(manager.error);
        const operation = (async () => {
          try {
            return storageOk(await manager.value.add_secret(id, type, data));
          } catch (nativeFailure) {
            return storageErr(new NativeVaultStorageFailure(nativeFailure));
          }
        })();
        return state.raceStorageTimeout({
          promise: operation,
          releaseLateValue: (records) => this.freeSecretRecords(records),
        });
      });
      if (added.isErr()) {
        return storageErr(added.error);
      }
      this.freeSecretRecords(added.value);
      const refreshed = await state.refreshSecretsFromSession();
      if (refreshed.isErr()) return storageErr(refreshed.error);
      log.info("secret added");
      const localSaveSync = await state.runFanOutSyncAfterLocalSave();
      if (localSaveSync.isErr()) return storageErr(localSaveSync.error);
      const synchronized = await state.refreshSecretsFromSession();
      if (synchronized.isErr()) return storageErr(synchronized.error);
      state.showSuccess(state.t(I18N_KEYS.ToastsSecretSaved));
      return storageOk();
    } finally {
      state.isSaving = false;
    }
  }

  async handleBitwardenImport({
    json,
    password,
  }: BitwardenVaultImport): Promise<SecretOperationResult<NookImportResult>> {
    const state = this.state;
    const runPasswordManagerImportArgs: Parameters<
      VaultSecretActions["runPasswordManagerImport"]
    >[0] = {
      importFromManager: async (manager) => {
        try {
          return storageOk(await manager.import_bitwarden_json(json, password));
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure));
        }
      },
      sourceName: "Bitwarden",
      successKey: I18N_KEYS.ToastsBitwardenImported,
      failureKey: I18N_KEYS.BitwardenImportFailed,
    };
    return this.runPasswordManagerImport(runPasswordManagerImportArgs);
  }

  async handleKeePassXcImport({
    csv,
  }: KeePassXcVaultImport): Promise<SecretOperationResult<NookImportResult>> {
    const state = this.state;
    const runPasswordManagerImportArgs2: Parameters<
      VaultSecretActions["runPasswordManagerImport"]
    >[0] = {
      importFromManager: async (manager) => {
        try {
          return storageOk(await manager.import_keepassxc_csv(csv));
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure));
        }
      },
      sourceName: "KeePassXC",
      successKey: I18N_KEYS.ToastsKeepassxcImported,
      failureKey: I18N_KEYS.KeepassxcImportFailed,
    };
    return this.runPasswordManagerImport(runPasswordManagerImportArgs2);
  }

  async handleLastPassImport({
    csv,
  }: LastPassVaultImport): Promise<SecretOperationResult<NookImportResult>> {
    const state = this.state;
    const runPasswordManagerImportArgs3: Parameters<
      VaultSecretActions["runPasswordManagerImport"]
    >[0] = {
      importFromManager: async (manager) => {
        try {
          return storageOk(await manager.import_lastpass_csv(csv));
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure));
        }
      },
      sourceName: "LastPass",
      successKey: I18N_KEYS.ToastsLastpassImported,
      failureKey: I18N_KEYS.LastpassImportFailed,
    };
    return this.runPasswordManagerImport(runPasswordManagerImportArgs3);
  }

  async handleKeeperImport({
    csv,
  }: KeeperVaultImport): Promise<SecretOperationResult<NookImportResult>> {
    const state = this.state;
    const runPasswordManagerImportArgs4: Parameters<
      VaultSecretActions["runPasswordManagerImport"]
    >[0] = {
      importFromManager: async (manager) => {
        try {
          return storageOk(await manager.import_keeper_csv(csv));
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure));
        }
      },
      sourceName: "Keeper",
      successKey: I18N_KEYS.ToastsKeeperImported,
      failureKey: I18N_KEYS.KeeperImportFailed,
    };
    return this.runPasswordManagerImport(runPasswordManagerImportArgs4);
  }

  async handleOnePasswordImport({
    archive,
  }: OnePasswordVaultImport): Promise<SecretOperationResult<NookImportResult>> {
    const state = this.state;
    const runPasswordManagerImportArgs5: Parameters<
      VaultSecretActions["runPasswordManagerImport"]
    >[0] = {
      importFromManager: async (manager) => {
        try {
          return storageOk(await manager.import_onepassword_pux(archive));
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure));
        }
      },
      sourceName: "1Password",
      successKey: I18N_KEYS.ToastsOnepasswordImported,
      failureKey: I18N_KEYS.OnepasswordImportFailed,
    };
    return this.runPasswordManagerImport(runPasswordManagerImportArgs5);
  }

  async handleApplePasswordsImport({
    exportBytes,
  }: ApplePasswordsVaultImport): Promise<
    SecretOperationResult<NookImportResult>
  > {
    const state = this.state;
    const runPasswordManagerImportArgs6: Parameters<
      VaultSecretActions["runPasswordManagerImport"]
    >[0] = {
      importFromManager: async (manager) => {
        try {
          return storageOk(
            await manager.import_apple_passwords_export(exportBytes),
          );
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure));
        }
      },
      sourceName: "Safari / Apple Passwords",
      successKey: I18N_KEYS.ToastsApplePasswordsImported,
      failureKey: I18N_KEYS.ApplePasswordsImportFailed,
    };
    return this.runPasswordManagerImport(runPasswordManagerImportArgs6);
  }

  async handleChromePasswordsImport({
    csv,
  }: ChromePasswordsVaultImport): Promise<
    SecretOperationResult<NookImportResult>
  > {
    const state = this.state;
    const runPasswordManagerImportArgs7: Parameters<
      VaultSecretActions["runPasswordManagerImport"]
    >[0] = {
      importFromManager: async (manager) => {
        try {
          return storageOk(await manager.import_chrome_passwords_csv(csv));
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure));
        }
      },
      sourceName: "Chrome passwords",
      successKey: I18N_KEYS.ToastsChromePasswordsImported,
      failureKey: I18N_KEYS.ChromePasswordsImportFailed,
    };
    return this.runPasswordManagerImport(runPasswordManagerImportArgs7);
  }

  async handleDashlaneImport({
    exportBytes,
  }: DashlaneVaultImport): Promise<SecretOperationResult<NookImportResult>> {
    const state = this.state;
    const runPasswordManagerImportArgs8: Parameters<
      VaultSecretActions["runPasswordManagerImport"]
    >[0] = {
      importFromManager: async (manager) => {
        try {
          return storageOk(await manager.import_dashlane_export(exportBytes));
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure));
        }
      },
      sourceName: "Dashlane",
      successKey: I18N_KEYS.ToastsDashlaneImported,
      failureKey: I18N_KEYS.DashlaneImportFailed,
    };
    return this.runPasswordManagerImport(runPasswordManagerImportArgs8);
  }

  async handleGoogleAuthenticatorImport({
    migrationUris,
  }: AuthenticatorMigrationImport): Promise<
    SecretOperationResult<NookImportResult>
  > {
    const state = this.state;
    const runPasswordManagerImportArgs9: Parameters<
      VaultSecretActions["runPasswordManagerImport"]
    >[0] = {
      importFromManager: async (manager) => {
        try {
          return storageOk(
            await manager.import_google_authenticator_migration(migrationUris),
          );
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure));
        }
      },
      sourceName: "Google Authenticator",
      successKey: I18N_KEYS.ToastsGoogleAuthenticatorImported,
      failureKey: I18N_KEYS.GoogleAuthenticatorImportFailed,
    };
    return this.runPasswordManagerImport(runPasswordManagerImportArgs9);
  }

  async handleProtonPassImport({
    exportBytes,
  }: ProtonPassVaultImport): Promise<SecretOperationResult<NookImportResult>> {
    const state = this.state;
    const runPasswordManagerImportArgs10: Parameters<
      VaultSecretActions["runPasswordManagerImport"]
    >[0] = {
      importFromManager: async (manager) => {
        try {
          return storageOk(await manager.import_proton_pass(exportBytes));
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure));
        }
      },
      sourceName: "Proton Pass",
      successKey: I18N_KEYS.ToastsProtonPassImported,
      failureKey: I18N_KEYS.ProtonPassImportFailed,
    };
    return this.runPasswordManagerImport(runPasswordManagerImportArgs10);
  }

  async handleDeleteSecret({
    id,
  }: SecretDeletion): Promise<SecretOperationResult<void>> {
    const state = this.state;
    const prepared = await this.prepareSecretMutation();
    if (prepared.isErr()) return storageErr(prepared.error);
    state.isSaving = true;
    const previousSecrets = state.secrets;
    const deletedRecord = previousSecrets.find((record) => record.id === id);
    state.secrets = previousSecrets.filter((record) => record.id !== id);
    let committed = false;
    try {
      const deleted = await state.enqueueStorage(async () => {
        const manager = state.admitManager();
        if (manager.isErr()) return storageErr(manager.error);
        try {
          return storageOk(await manager.value.delete_secret(id));
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure));
        }
      });
      if (deleted.isErr()) return storageErr(deleted.error);
      this.freeSecretRecords(deleted.value);
      committed = true;
      deletedRecord?.free();
      const refreshed = await state.refreshSecretsFromSession();
      if (refreshed.isErr()) return storageErr(refreshed.error);
      const localSaveSync = await state.runFanOutSyncAfterLocalSave();
      if (localSaveSync.isErr()) return storageErr(localSaveSync.error);
      const synchronized = await state.refreshSecretsFromSession();
      if (synchronized.isErr()) return storageErr(synchronized.error);
      state.showSuccess(state.t(I18N_KEYS.ToastsSecretDeleted));
      return storageOk();
    } finally {
      if (!committed) state.secrets = previousSecrets;
      state.isSaving = false;
    }
  }

  async handleReplaceSecret({
    oldId,
    type,
    data,
  }: SecretReplacement): Promise<SecretOperationResult<void>> {
    const state = this.state;
    const prepared = await this.prepareSecretMutation();
    if (prepared.isErr()) return storageErr(prepared.error);
    state.isSaving = true;
    try {
      const replaced = await state.enqueueStorage(async () => {
        const manager = state.admitManager();
        if (manager.isErr()) return storageErr(manager.error);
        try {
          return storageOk(
            await manager.value.replace_secret(
              oldId,
              generate_secret_id(),
              type,
              data,
            ),
          );
        } catch (failure) {
          return storageErr(new NativeVaultStorageFailure(failure));
        }
      });
      if (replaced.isErr()) return storageErr(replaced.error);
      this.freeSecretRecords(replaced.value);
      const refreshed = await state.refreshSecretsFromSession();
      if (refreshed.isErr()) return storageErr(refreshed.error);
      const localSaveSync = await state.runFanOutSyncAfterLocalSave();
      if (localSaveSync.isErr()) return storageErr(localSaveSync.error);
      state.showSuccess(state.t(I18N_KEYS.ToastsItemUpdated));
      return storageOk();
    } finally {
      state.isSaving = false;
    }
  }

  async refreshPasswordEntriesList(): Promise<
    Result<void, OAuthFailure | StorageOperationFailure>
  > {
    const state = this.state;
    if (state.storageMode !== "local" && !state.hasRemoteCredentials()) {
      state.passwordEntries = [];
      return storageOk();
    }
    if (state.storageMode !== "local") {
      const refreshed = await state.ensureOAuthTokensFresh();
      if (refreshed.isErr()) return storageErr(refreshed.error);
    }
    const entries = await state.enqueueStorage(async () => {
      const manager = state.admitManager();
      if (manager.isErr()) return storageErr(manager.error);
      const args = state.wasmStorageArgs();
      try {
        return storageOk(
          await manager.value.fetch_vault_password_entries(
            args.mode,
            args.pat,
            args.repo,
          ),
        );
      } catch (failure) {
        return storageErr(new NativeVaultStorageFailure(failure));
      }
    });
    if (entries.isErr()) return storageErr(entries.error);
    state.passwordEntries = entries.value;
    if (
      state.passwordEntries.length === 1 &&
      state.selectedPasswordEntry.kind ===
        PasswordEntrySelectionKind.NotSelected
    ) {
      for (const entry of state.passwordEntries)
        state.selectPasswordEntry(entry.id);
    }
    return storageOk();
  }

  async refreshSecretsFromSession(): Promise<
    Result<void, StorageOperationFailure>
  > {
    const state = this.state;
    if (!state.hasManager) {
      this.freeSecretRecords(state.secrets);
      state.secrets = [];
      state.secretTotal = 0;
      state.secretPageOffset = 0;
      state.secretPageRequestOffset = 0;
      return storageErr(
        new StorageOperationFailure(
          StorageOperationFailureKind.ManagerUnavailable,
        ),
      );
    }
    const loadSecretPageArgs2: Parameters<
      VaultSecretActions["loadSecretPage"]
    >[0] = {
      query: state.secretQuery,
      requestedOffset: state.secretPageRequestOffset,
    };
    return this.loadSecretPage(loadSecretPageArgs2);
  }

  async loadSecretPage({
    query,
    requestedOffset,
  }: SecretPageRequest): Promise<Result<void, StorageOperationFailure>> {
    const state = this.state;
    if (!state.hasManager)
      return storageErr(
        new StorageOperationFailure(
          StorageOperationFailureKind.ManagerUnavailable,
        ),
      );
    // Publish the request immediately so maintenance refreshes queued behind it
    // cannot re-submit the previous query or page.
    state.secretQuery = query;
    state.secretPageRequestOffset = requestedOffset;
    // Each request supersedes every older page request. The storage queue
    // serializes WASM access, but it does not prevent an earlier caller from
    // applying its result after a newer search has already been requested.
    const generation = ++state.secretPageGeneration;
    const page = await state.enqueueStorage(async () => {
      const admittedManager = state.admitManager();
      if (admittedManager.isErr()) return storageErr(admittedManager.error);
      try {
        return storageOk(
          await admittedManager.value.query_prepared_secret_page_js(
            query,
            state.secretTypeFilter,
            requestedOffset,
            state.secretPageSize,
          ),
        );
      } catch (nativeFailure) {
        return storageErr(new NativeVaultStorageFailure(nativeFailure));
      }
    });
    if (page.isErr()) {
      if (generation === state.secretPageGeneration) {
        state.errorMsg = state.t(page.error.translationKey);
      }
      return storageErr(page.error);
    }
    let records = page.value.take_items();
    let total = page.value.total;
    let offset = page.value.offset;
    page.value.free();
    if (generation !== state.secretPageGeneration) {
      this.freeSecretRecords(records);
      return storageErr(
        new StorageOperationFailure(
          StorageOperationFailureKind.GenerationChanged,
        ),
      );
    }

    if (records.length === 0 && total > 0 && offset >= total) {
      const lastOffset = state.clientPolicy.normalized_secret_page_offset(
        total,
        offset,
        state.secretPageSize,
      );
      const lastPage = await state.enqueueStorage(async () => {
        const admittedManager = state.admitManager();
        if (admittedManager.isErr()) return storageErr(admittedManager.error);
        try {
          return storageOk(
            await admittedManager.value.query_secret_page_js(
              query,
              state.secretTypeFilter,
              lastOffset,
              state.secretPageSize,
            ),
          );
        } catch (nativeFailure) {
          return storageErr(new NativeVaultStorageFailure(nativeFailure));
        }
      });
      if (lastPage.isErr()) {
        this.freeSecretRecords(records);
        if (generation === state.secretPageGeneration) {
          state.errorMsg = state.t(lastPage.error.translationKey);
        }
        return storageErr(lastPage.error);
      }
      records = lastPage.value.take_items();
      total = lastPage.value.total;
      offset = lastPage.value.offset;
      lastPage.value.free();
      if (generation !== state.secretPageGeneration) {
        this.freeSecretRecords(records);
        return storageErr(
          new StorageOperationFailure(
            StorageOperationFailureKind.GenerationChanged,
          ),
        );
      }
    }

    this.freeSecretRecords(state.secrets);
    state.secrets = records;
    state.secretTotal = total;
    state.secretPageOffset = offset;
    state.secretPageRequestOffset = offset;
    state.secretQuery = query;
    return storageOk();
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
    this.freeSecretRecords(state.secrets);
    state.secrets = records;
    state.secretTotal = total;
    state.secretPageOffset = offset;
    state.secretPageRequestOffset = offset;
    state.secretQuery = query;
  }

  async decryptSecret({
    id,
  }: SecretDecryption): Promise<
    Result<NookSecretRecord, StorageOperationFailure>
  > {
    const state = this.state;

    return state.enqueueStorage(async () => {
      const admittedManager = state.admitManager();
      if (admittedManager.isErr()) return storageErr(admittedManager.error);
      try {
        return storageOk(await admittedManager.value.decrypt_secret_js(id));
      } catch (nativeFailure) {
        return storageErr(new NativeVaultStorageFailure(nativeFailure));
      }
    });
  }

  async currentAuthenticatorCode({
    id,
  }: AuthenticatorCodeRequest): Promise<
    Result<AuthenticatorCodeView, StorageOperationFailure>
  > {
    const state = this.state;
    const unixSeconds = Math.floor(Date.now() / 1000);
    const result = await state.enqueueStorage(async () => {
      const admittedManager = state.admitManager();
      if (admittedManager.isErr()) return storageErr(admittedManager.error);
      try {
        return storageOk(
          await admittedManager.value.current_authenticator_code(
            id,
            unixSeconds,
          ),
        );
      } catch (nativeFailure) {
        return storageErr(new NativeVaultStorageFailure(nativeFailure));
      }
    });
    if (result.isErr()) return storageErr(result.error);
    try {
      return storageOk({
        code: result.value.code,
        secondsRemaining: result.value.secondsRemaining,
        period: result.value.period,
        expiresAtUnixSeconds: result.value.expiresAtUnixSeconds,
      });
    } finally {
      result.value.free();
    }
  }
}
