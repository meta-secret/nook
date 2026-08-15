import {
  DeviceProtectionStatus,
  NookManualProviderSyncState,
  VaultEditDecision,
  provider_label_by_id,
  resolve_error_message,
  translate_with_replacements,
  type NookAppLocale,
} from "$app-wasm";
import {
  activeVaultScope,
  unselectedVaultScope,
  type GoogleDriveMode,
  type ICloudMode,
  type StorageProvider,
} from "$lib/auth/providers";
import { SerialOperationQueue } from "$lib/runtime/serial-operation-queue";
import {
  captureLocalDataStorageGeneration,
  runWithExclusiveLocalDataStorageLock,
  runWithLocalDataStorageLock,
  type LocalDataStorageOperation,
} from "$lib/runtime/browser-data";
import * as localeActions from "$lib/vault/locale";
import * as oauthActions from "$lib/vault/oauth";
import * as providersActions from "$lib/vault/providers.svelte";
import * as syncActions from "$lib/vault/sync.svelte";
import { VaultLifecycleState } from "$lib/vault/state/lifecycle.svelte";
import {
  ActiveVaultKind,
  type LocalProviderLookup,
  type StagedRemoteStorage,
} from "$lib/vault/state/provider.svelte";
import {
  translationKey,
  translationReplacements,
  type TranslationRequest,
} from "$lib/vault/translation";
import type { ProviderActionsContext } from "$lib/vault/action-contexts";
import type { VaultState } from "$lib/vault.svelte";
import { I18N_KEYS } from "../../../generated/i18n-keys";

export type VaultEditRestriction =
  | { decision: VaultEditDecision.Allowed }
  | {
      decision:
        | VaultEditDecision.BlockedSecurityConflict
        | VaultEditDecision.BlockedSyncConflict
        | VaultEditDecision.BlockedByArchitecture;
      reason: string;
    };

export type VaultLocaleSelection = {
  readonly newLocale: NookAppLocale;
  readonly preferWasm: boolean;
};

export enum SyncProviderLabelKind {
  Idle = "idle",
  Active = "active",
}

export type SyncProviderLabel =
  | { kind: SyncProviderLabelKind.Idle }
  | { kind: SyncProviderLabelKind.Active; label: string };

interface StorageTimeoutRace<T> {
  readonly promise: Promise<T>;
  readonly label: string;
}

/** Shared runtime, provider, locale, and queue capabilities for the vault facade. */
export abstract class VaultRuntimeState extends VaultLifecycleState {
  private localDataStorageGeneration = captureLocalDataStorageGeneration();
  secretPageGeneration = 0;
  secretPageRequestOffset = 0;
  architectureSecretCreationAllowed = $state(true);
  private storageQueue = new SerialOperationQueue();
  localDataDeletionStarted = false;
  deviceAuthorizationInProgress = false;

  protected abstract providerActionsContext(): ProviderActionsContext;
  protected abstract completeVaultState(): VaultState;

  get syncBlocked(): boolean {
    return this.syncConflictRequiresDecision;
  }

  get syncConflictLabel(): string {
    return syncActions.syncConflictLabel(this);
  }

  get editsBlocked(): boolean {
    return this.clientPolicy.edits_blocked(
      this.securityConflicts.length,
      this.syncBlocked,
      this.architectureCanCreateSecret,
    );
  }

  get architectureCanCreateSecret(): boolean {
    return this.architectureSecretCreationAllowed;
  }

  get editRestriction(): VaultEditRestriction {
    const decision = this.clientPolicy.edit_block_reason(
      this.securityConflicts.length,
      this.syncBlocked,
      this.architectureCanCreateSecret,
    );
    if (decision === VaultEditDecision.Allowed) return { decision };
    const reason = this.clientPolicy.edit_block_message(
      this.securityConflicts.length,
      this.syncBlocked,
      this.architectureCanCreateSecret,
      this.translations,
      this.locale,
    );
    return { decision, reason };
  }

  get deviceProtectionReady(): boolean {
    return this.deviceProtectionStatus === DeviceProtectionStatus.Unlocked;
  }

  get syncProviderCount(): number {
    return this.syncProviders.length;
  }

  get syncingProviderLabel(): SyncProviderLabel {
    if (this.manualProviderSync.state === NookManualProviderSyncState.Idle) {
      return { kind: SyncProviderLabelKind.Idle };
    }
    const snapshotArgs: Parameters<typeof $state.snapshot>[0] = {
      providers: this.providers,
      activeVaultStoreId:
        this.activeVault.kind === ActiveVaultKind.Open
          ? activeVaultScope(this.activeVault.storeId)
          : unselectedVaultScope(),
    };
    return {
      kind: SyncProviderLabelKind.Active,
      label: provider_label_by_id(
        $state.snapshot(snapshotArgs),
        this.manualProviderSync.providerId,
      ),
    };
  }

  get isSyncActivityVisible(): boolean {
    return this.clientPolicy.is_sync_activity_visible(
      this.isFanOutSyncing,
      this.manualProviderSyncRunning,
      this.isSyncing,
      this.isSaving,
    );
  }

  get hasPasswordEnvelope(): boolean {
    return this.passwordEntries.length > 0;
  }

  enqueueStorage<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.localDataDeletionStarted) {
      return Promise.reject(new Error("Local browser data deletion is active"));
    }
    const storageOperation: LocalDataStorageOperation<T> = {
      generation: this.localDataStorageGeneration,
      generationChangedMessage: this.t(
        I18N_KEYS.ErrorsValidationLocalDataChangedInAnotherTab,
      ),
      operation,
    };
    return this.storageQueue.enqueue(() =>
      runWithLocalDataStorageLock(storageOperation),
    );
  }

  enqueueExclusiveStorage<T>(operation: () => T | Promise<T>): Promise<T> {
    return this.storageQueue.enqueue(() =>
      runWithExclusiveLocalDataStorageLock(operation),
    );
  }

  waitForStorageChain(): Promise<void> {
    return this.storageQueue.onIdle();
  }

  resetStorageChain(): void {
    this.storageQueue.reset();
  }

  adoptLocalDataStorageGeneration(): void {
    this.localDataStorageGeneration = captureLocalDataStorageGeneration();
  }

  static storageOpTimeoutMs = 20_000;

  raceStorageTimeout<T>({ promise, label }: StorageTimeoutRace<T>): Promise<T> {
    const timeoutMs = VaultRuntimeState.storageOpTimeoutMs;
    return Promise.race([
      promise,
      // eslint-disable-next-line max-params -- Promise owns this positional executor signature.
      new Promise<T>((_, reject) => {
        setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  }

  wasmStorageArgs(): [string, string, string] {
    return providersActions.wasmStorageArgs(this.providerActionsContext());
  }

  connectStorageArgs(): [string, string, string] {
    return providersActions.connectStorageArgs(this.providerActionsContext());
  }

  shouldUseJoinProviderForConnect(): boolean {
    return providersActions.shouldUseJoinProviderForConnect(
      this.providerActionsContext(),
    );
  }

  stagedRemoteStorageArgs(): StagedRemoteStorage {
    return providersActions.stagedRemoteStorageArgs(
      this.providerActionsContext(),
    );
  }

  stagedProviderLabel(): string {
    return providersActions.stagedProviderLabel(this.providerActionsContext());
  }

  hasRemoteCredentials(): boolean {
    return providersActions.hasRemoteProviderCredentials(
      this.providerActionsContext(),
    );
  }

  syncOAuthRemoteRefFromManager() {
    return providersActions.syncOAuthRemoteRefFromManager(
      this.providerActionsContext(),
    );
  }

  async ensureOAuthTokensFresh(): Promise<void> {
    return oauthActions.ensureOAuthTokensFresh(this.completeVaultState());
  }

  selectGoogleDriveMode(mode: GoogleDriveMode): void {
    const request: Parameters<typeof oauthActions.selectGoogleDriveMode>[0] = {
      state: this.completeVaultState(),
      mode,
    };
    oauthActions.selectGoogleDriveMode(request);
  }

  selectICloudMode(mode: ICloudMode): void {
    const request: Parameters<typeof oauthActions.selectICloudMode>[0] = {
      state: this.completeVaultState(),
      mode,
    };
    oauthActions.selectICloudMode(request);
  }

  async chooseLocalFolderBackupDirectory(): Promise<void> {
    return providersActions.chooseLocalFolder(this.providerActionsContext());
  }

  refreshLocalFolderBackupSupport(): void {
    return providersActions.refreshLocalFolderBackupSupport(
      this.providerActionsContext(),
    );
  }

  dismissSuccess() {
    this.cancelSuccessDismissTimer();
    this.successMsg = "";
  }

  dismissError() {
    this.errorMsg = "";
  }

  showSuccess(message: string) {
    this.dismissSuccess();
    this.successMsg = message;
    this.scheduleSuccessDismiss(setTimeout(() => this.dismissSuccess(), 5000));
  }

  get localProvider(): LocalProviderLookup {
    return providersActions.localProvider(this.providerActionsContext());
  }

  get activeVaultProviders(): StorageProvider[] {
    return providersActions.activeProviders(this.providerActionsContext());
  }

  get syncProviders(): StorageProvider[] {
    return providersActions.syncProviders(this.providerActionsContext());
  }

  get hasMultipleLocalVaults(): boolean {
    return this.localVaults.length > 1;
  }

  get showLoginVaultPicker(): boolean {
    return providersActions.showLoginVaultPicker(this.providerActionsContext());
  }

  providerWasmArgs(provider: StorageProvider): [string, string, string] {
    return providersActions.providerWasmArgs(provider);
  }

  async updateLocale({ newLocale, preferWasm }: VaultLocaleSelection) {
    const request: Parameters<typeof localeActions.updateLocale>[0] = {
      state: this.completeVaultState(),
      newLocale,
      preferWasm,
    };
    return localeActions.updateLocale(request);
  }

  resolveErrorMessage(message: string): string {
    return resolve_error_message(this.translations, this.locale, message);
  }

  t = (request: TranslationRequest): string => {
    const entries = Object.entries(translationReplacements(request));
    return translate_with_replacements(
      this.translations,
      this.locale,
      translationKey(request),
      entries.map(([name]) => name),
      entries.map(([, value]) => value),
    );
  };
}
