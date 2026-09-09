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
  type LocalDataStorageOperation,
  browserDataLifecycle,
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
  TranslationMessage,
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
  private localDataStorageGeneration =
    browserDataLifecycle.captureLocalDataStorageGeneration();
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
    return new syncActions.SyncConflictPresentation(this).label;
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
      browserDataLifecycle.runWithLocalDataStorageLock(storageOperation),
    );
  }

  enqueueExclusiveStorage<T>(operation: () => T | Promise<T>): Promise<T> {
    return this.storageQueue.enqueue(() =>
      browserDataLifecycle.runWithExclusiveLocalDataStorageLock(operation),
    );
  }

  waitForStorageChain(): Promise<void> {
    return this.storageQueue.onIdle();
  }

  resetStorageChain(): void {
    this.storageQueue.reset();
  }

  adoptLocalDataStorageGeneration(): void {
    this.localDataStorageGeneration =
      browserDataLifecycle.captureLocalDataStorageGeneration();
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
    return new providersActions.VaultProviderActions(
      this.providerActionsContext(),
    ).wasmStorageArgs();
  }

  connectStorageArgs(): [string, string, string] {
    return new providersActions.VaultProviderActions(
      this.providerActionsContext(),
    ).connectStorageArgs();
  }

  shouldUseJoinProviderForConnect(): boolean {
    return new providersActions.VaultProviderActions(
      this.providerActionsContext(),
    ).shouldUseJoinProviderForConnect();
  }

  stagedRemoteStorageArgs(): StagedRemoteStorage {
    return new providersActions.VaultProviderActions(
      this.providerActionsContext(),
    ).stagedRemoteStorageArgs();
  }

  stagedProviderLabel(): string {
    return new providersActions.VaultProviderActions(
      this.providerActionsContext(),
    ).stagedProviderLabel();
  }

  hasRemoteCredentials(): boolean {
    return new providersActions.VaultProviderActions(
      this.providerActionsContext(),
    ).hasRemoteProviderCredentials();
  }

  syncOAuthRemoteRefFromManager() {
    return new providersActions.VaultProviderActions(
      this.providerActionsContext(),
    ).syncOAuthRemoteRefFromManager();
  }

  async ensureOAuthTokensFresh(): Promise<void> {
    return new oauthActions.VaultOAuthActions(
      this.completeVaultState(),
    ).ensureOAuthTokensFresh();
  }

  selectGoogleDriveMode(mode: GoogleDriveMode): void {
    const request: Parameters<
      oauthActions.VaultOAuthActions["selectGoogleDriveMode"]
    >[0] = {
      state: this.completeVaultState(),
      mode,
    };
    new oauthActions.VaultOAuthActions(
      this.completeVaultState(),
    ).selectGoogleDriveMode(request);
  }

  selectICloudMode(mode: ICloudMode): void {
    const request: Parameters<
      oauthActions.VaultOAuthActions["selectICloudMode"]
    >[0] = {
      state: this.completeVaultState(),
      mode,
    };
    new oauthActions.VaultOAuthActions(
      this.completeVaultState(),
    ).selectICloudMode(request);
  }

  async chooseLocalFolderBackupDirectory(): Promise<void> {
    return new providersActions.ProviderSelectionActions(
      this.providerActionsContext(),
    ).chooseLocalFolder();
  }

  refreshLocalFolderBackupSupport(): void {
    return new providersActions.ProviderSelectionActions(
      this.providerActionsContext(),
    ).refreshLocalFolderBackupSupport();
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
    return new providersActions.ProviderSelectionActions(
      this.providerActionsContext(),
    ).localProvider();
  }

  get activeVaultProviders(): StorageProvider[] {
    return new providersActions.ProviderSelectionActions(
      this.providerActionsContext(),
    ).activeProviders();
  }

  get syncProviders(): StorageProvider[] {
    return new providersActions.ProviderSelectionActions(
      this.providerActionsContext(),
    ).syncProviders();
  }

  get hasMultipleLocalVaults(): boolean {
    return this.localVaults.length > 1;
  }

  get showLoginVaultPicker(): boolean {
    return new providersActions.ProviderSelectionActions(
      this.providerActionsContext(),
    ).showLoginVaultPicker();
  }

  providerWasmArgs(provider: StorageProvider): [string, string, string] {
    return providersActions.VaultProviderActions.providerWasmArgs(provider);
  }

  async updateLocale({ newLocale, preferWasm }: VaultLocaleSelection) {
    const request: Parameters<
      localeActions.VaultLocaleActions["updateLocale"]
    >[0] = {
      newLocale,
      preferWasm,
    };
    return new localeActions.VaultLocaleActions(
      this.completeVaultState(),
    ).updateLocale(request);
  }

  resolveErrorMessage(message: string): string {
    return resolve_error_message(this.translations, this.locale, message);
  }

  t = (request: TranslationRequest): string => {
    const entries = Object.entries(
      new TranslationMessage(request).translationReplacements(),
    );
    return translate_with_replacements(
      this.translations,
      this.locale,
      new TranslationMessage(request).translationKey(),
      entries.map(([name]) => name),
      entries.map(([, value]) => value),
    );
  };
}
