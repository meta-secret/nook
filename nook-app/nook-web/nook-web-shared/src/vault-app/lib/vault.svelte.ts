import {
  VaultAccessStatus,
  type NookImportResult,
  type NookSecretRecord,
  type NookVaultSyncResult,
  type AuthenticatorCodeView,
  type SecretType,
} from "$lib/nook";
import {
  isVaultSessionLocked,
  DeviceProtectionStatus,
  RemoteVaultRecoveryState,
  SentinelVaultUnlockState,
  VaultEditDecision,
  providerLabelById,
  resolveErrorMessage as wasmResolveErrorMessage,
  translateWithReplacements,
  type NookPendingSyncConflict,
  type NookProviderSyncRevision,
  type NookSecretPage,
  type NookVaultManager,
  type NookAppLocale,
  type PasswordEntryId,
  type StartSentinelGenesisArgs,
  type StoreId,
} from "$app-wasm";
import {
  activeVaultScope,
  type GoogleDriveMode,
  type ICloudMode,
  type OAuthFilePreset,
  type StorageProvider,
  type StorageProviderType,
  unselectedVaultScope,
} from "$lib/auth-providers";
import type { VaultArchitecture } from "$lib/vault-architecture";
import * as localeActions from "$lib/vault/locale";
import * as oauthActions from "$lib/vault/oauth";
import * as providersActions from "$lib/vault/providers.svelte";
import * as localLoginActions from "$lib/vault/local-login";
import * as syncActions from "$lib/vault/sync.svelte";
import * as architectureActions from "$lib/vault/architecture";
import * as sessionActions from "$lib/vault/session";
import * as uiActions from "$lib/vault/ui";
import * as multiDeviceActions from "$lib/vault/multi-device";
import * as secretsActions from "$lib/vault/secrets";
import * as passwordUnlockActions from "$lib/vault/password-unlock";
import * as sentinelUnlockActions from "$lib/vault/sentinel-unlock";
import * as idleSessionActions from "$lib/vault/idle-session";
import * as deviceProtectionActions from "$lib/vault/device-protection.svelte";
import * as lifecycleActions from "$lib/vault/lifecycle";
import * as sentinelGenesisActions from "$lib/vault/sentinel-genesis";
import { SerialOperationQueue } from "$lib/serial-operation-queue";
import { ManualProviderSyncKind } from "$lib/vault/state/sync.svelte";
import { ActiveVaultKind } from "$lib/vault/state/provider.svelte";
import { VaultLifecycleState } from "$lib/vault/state/lifecycle.svelte";
import {
  AdminAccordionSection,
  SettingsAccordionSection,
  SettingsSection,
} from "$lib/vault/state/ui.svelte";
import {
  LoginSetupKind,
  type LocalProviderLookup,
  type StagedRemoteStorage,
} from "$lib/vault/state/provider.svelte";
import type { EventOutboxTarget } from "$lib/vault/sync-operation-state";

export type VaultEditRestriction =
  | { decision: VaultEditDecision.Allowed }
  | {
      decision:
        | VaultEditDecision.BlockedSecurityConflict
        | VaultEditDecision.BlockedSyncConflict
        | VaultEditDecision.BlockedByArchitecture;
      reason: string;
    };

export enum SyncProviderLabelKind {
  Idle = "idle",
  Active = "active",
}

export type SyncProviderLabel =
  | { kind: SyncProviderLabelKind.Idle }
  | { kind: SyncProviderLabelKind.Active; label: string };

export class VaultState extends VaultLifecycleState {
  secretPageGeneration = 0;
  secretPageRequestOffset = 0;
  architectureSecretCreationAllowed = $state(true);

  get syncBlocked(): boolean {
    return this.syncConflictRequiresDecision;
  }

  get syncConflictLabel(): string {
    return syncActions.syncConflictLabel(this);
  }

  get editsBlocked(): boolean {
    return this.clientPolicy.editsBlocked(
      this.securityConflicts.length,
      this.syncBlocked,
      this.architectureCanCreateSecret,
    );
  }

  get architectureCanCreateSecret(): boolean {
    return this.architectureSecretCreationAllowed;
  }

  get editRestriction(): VaultEditRestriction {
    const decision = this.clientPolicy.editBlockReason(
      this.securityConflicts.length,
      this.syncBlocked,
      this.architectureCanCreateSecret,
    );
    if (decision === VaultEditDecision.Allowed) {
      return { decision };
    }
    const reason = this.clientPolicy.editBlockMessage(
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
    if (this.manualProviderSync.kind === ManualProviderSyncKind.Idle) {
      return { kind: SyncProviderLabelKind.Idle };
    }
    return {
      kind: SyncProviderLabelKind.Active,
      label: providerLabelById(
        $state.snapshot({
          providers: this.providers,
          activeVaultStoreId:
            this.activeVault.kind === ActiveVaultKind.Open
              ? activeVaultScope(this.activeVault.storeId)
              : unselectedVaultScope(),
        }),
        this.manualProviderSync.providerId,
      ),
    };
  }

  get isSyncActivityVisible(): boolean {
    return this.clientPolicy.isSyncActivityVisible(
      this.isFanOutSyncing,
      this.manualProviderSyncRunning,
      this.isSyncing,
      this.isSaving,
    );
  }

  get hasPasswordEnvelope(): boolean {
    return this.passwordEntries.length > 0;
  }

  private storageQueue = new SerialOperationQueue();
  localDataDeletionStarted = false;
  /** Internal browser-orchestration flag shared with the device-protection actions. */
  deviceAuthorizationInProgress = false;
  enqueueStorage<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.localDataDeletionStarted) {
      return Promise.reject(new Error("Local browser data deletion is active"));
    }
    return this.storageQueue.enqueue(operation);
  }

  /** E2E/dev: wait for the serialized wasm storage queue to finish. */
  waitForStorageChain(): Promise<void> {
    return this.storageQueue.onIdle();
  }

  /** E2E/dev: reset a stuck storage queue (abandons in-flight wasm work). */
  resetStorageChain(): void {
    this.storageQueue.reset();
  }

  static storageOpTimeoutMs = 20_000;

  raceStorageTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    const timeoutMs = VaultState.storageOpTimeoutMs;
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  }

  wasmStorageArgs(): [string, string, string] {
    return providersActions.wasmStorageArgs(this);
  }

  /** WASM connect always uses the local cache when one exists (unified vault). */
  connectStorageArgs(): [string, string, string] {
    return providersActions.connectStorageArgs(this);
  }

  shouldUseJoinProviderForConnect(): boolean {
    return providersActions.shouldUseJoinProviderForConnect(this);
  }

  stagedRemoteStorageArgs(): StagedRemoteStorage {
    return providersActions.stagedRemoteStorageArgs(this);
  }

  stagedProviderLabel(): string {
    return providersActions.stagedProviderLabel(this);
  }

  hasRemoteCredentials(): boolean {
    return providersActions.hasRemoteProviderCredentials(this);
  }

  syncOAuthRemoteRefFromManager() {
    return providersActions.syncOAuthRemoteRefFromManager(this);
  }

  async ensureOAuthTokensFresh(): Promise<void> {
    return oauthActions.ensureOAuthTokensFresh(this);
  }

  selectGoogleDriveMode(mode: GoogleDriveMode): void {
    oauthActions.selectGoogleDriveMode(this, mode);
  }

  selectICloudMode(mode: ICloudMode): void {
    oauthActions.selectICloudMode(this, mode);
  }

  async chooseLocalFolderBackupDirectory(): Promise<void> {
    return providersActions.chooseLocalFolder(this);
  }

  refreshLocalFolderBackupSupport(): void {
    return providersActions.refreshLocalFolderBackupSupport(this);
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
    this.scheduleSuccessDismiss(
      setTimeout(() => {
        this.dismissSuccess();
      }, 5000),
    );
  }

  get localProvider(): LocalProviderLookup {
    return providersActions.localProvider(this);
  }

  /** Providers belonging to the active vault only. */
  get activeVaultProviders(): StorageProvider[] {
    return providersActions.activeProviders(this);
  }

  /** Cloud sync destinations for the active vault — local row omitted. */
  get syncProviders(): StorageProvider[] {
    return providersActions.syncProviders(this);
  }

  get hasMultipleLocalVaults(): boolean {
    return this.localVaults.length > 1;
  }

  get showLoginVaultPicker(): boolean {
    return providersActions.showLoginVaultPicker(this);
  }

  providerWasmArgs(provider: StorageProvider): [string, string, string] {
    return providersActions.providerWasmArgs(provider);
  }

  async updateLocale(
    newLocale: NookAppLocale,
    options?: { preferWasm?: boolean },
  ) {
    return localeActions.updateLocale(this, newLocale, options);
  }

  resolveErrorMessage(message: string): string {
    return wasmResolveErrorMessage(this.translations, this.locale, message);
  }

  t = (key: string, replacements?: Record<string, string>): string => {
    const entries = replacements ? Object.entries(replacements) : [];
    return translateWithReplacements(
      this.translations,
      this.locale,
      key,
      entries.map(([name]) => name),
      entries.map(([, value]) => value),
    );
  };

  async init() {
    return lifecycleActions.init(this);
  }

  async initOnce() {
    return lifecycleActions.initOnce(this);
  }

  async continueInitializationAfterDeviceUnlock() {
    return lifecycleActions.continueInitializationAfterDeviceUnlock(this);
  }

  async initDeviceIdentity(options?: { allowPendingAuthorization?: boolean }) {
    return lifecycleActions.initDeviceIdentity(this, options);
  }

  async authorizeWithExternalDeviceIdentity(
    adopt: (manager: NookVaultManager) => Promise<void>,
    options?: { deferInitialization?: boolean },
  ): Promise<boolean> {
    return lifecycleActions.authorizeWithExternalDeviceIdentity(
      this,
      adopt,
      options,
    );
  }

  get draftVaultArchitecture(): VaultArchitecture {
    return architectureActions.draftVaultArchitecture(this);
  }

  replaceVaultArchitecture(architecture: VaultArchitecture): void {
    return architectureActions.replaceVaultArchitecture(this, architecture);
  }

  applyDraftVaultArchitecture() {
    return architectureActions.applyDraftVaultArchitecture(this);
  }

  refreshVaultArchitectureFromManager() {
    return architectureActions.refreshVaultArchitectureFromManager(this);
  }

  async refreshArchitectureSecretCreationAllowed(): Promise<void> {
    return architectureActions.refreshArchitectureSecretCreationAllowed(this);
  }

  shouldAutoUnlock(): boolean {
    return this.clientPolicy.shouldAutoUnlock(
      isVaultSessionLocked(),
      this.localVaultPresent,
      this.passwordEntries.length,
      this.syncProviders.length,
      this.loginSetup.kind === LoginSetupKind.Active,
      this.addProviderOpen,
    );
  }

  /** Prepare login gate for local vault unlock (password or device keys). */
  async prepareLocalLogin(): Promise<void> {
    return localLoginActions.prepareLocalLogin(this);
  }

  /**
   * First-time setup: create an empty local vault secured by this device's keys.
   */
  async createLocalVaultWithDeviceKeys(label?: string): Promise<void> {
    return localLoginActions.createLocalVaultWithDeviceKeys(this, label);
  }

  async startSentinelGenesis(args: StartSentinelGenesisArgs): Promise<void> {
    return sentinelGenesisActions.start(this, $state.snapshot(args));
  }

  async renameLocalVault(storeId: StoreId, label: string): Promise<void> {
    return localLoginActions.renameLocalVaultLabel(this, storeId, label);
  }

  async selectVaultForUnlock(storeId: StoreId): Promise<void> {
    return localLoginActions.selectVaultForUnlock(this, storeId);
  }

  async prepareExistingVaultImportSlot(): Promise<void> {
    return localLoginActions.prepareExistingVaultImportSlot(this);
  }

  async reloadProvidersForActiveVault(): Promise<void> {
    return localLoginActions.reloadProvidersForActiveVault(this);
  }

  async syncActiveVaultStoreIdToAuth(): Promise<void> {
    return localLoginActions.syncActiveVaultStoreIdToAuth(this);
  }

  async activateConnectedExistingVault(storeId: StoreId): Promise<void> {
    return localLoginActions.activateConnectedExistingVault(this, storeId);
  }

  beginLoginVaultPicker() {
    return localLoginActions.beginLoginVaultPicker(this);
  }

  async chooseLoginVault(storeId: StoreId) {
    return localLoginActions.chooseLoginVault(this, storeId);
  }

  async refreshLocalVaultCatalog(): Promise<void> {
    return localLoginActions.refreshLocalVaultCatalog(this);
  }

  /** Lock and open the login unlock step for another vault on this device. */
  async switchToVault(storeId: StoreId): Promise<void> {
    return localLoginActions.switchToVault(this, storeId);
  }

  lockDeviceProtection(): Promise<void> {
    return deviceProtectionActions.lockDeviceProtection(this);
  }

  async loadProviders(options?: { ensureLocalRow?: boolean }) {
    return providersActions.loadProviders(this, options);
  }

  applyActiveProviderCredentials() {
    return providersActions.applyActiveProviderCredentials(this);
  }

  async persistProviders(opts?: { replace?: boolean }) {
    return providersActions.persistProviders(this, opts);
  }

  beginProviderSetup(type: StorageProviderType, oauthPreset?: OAuthFilePreset) {
    return providersActions.beginProviderSetup(this, type, oauthPreset);
  }

  beginExistingVaultOpen() {
    this.loginRequiresExistingVault = true;
    this.remoteVaultRecoveryState = RemoteVaultRecoveryState.None;
    this.errorMsg = "";
  }

  cancelExistingVaultOpen() {
    this.loginRequiresExistingVault = false;
    this.remoteVaultRecoveryState = RemoteVaultRecoveryState.None;
    this.errorMsg = "";
  }

  beginAddProvider() {
    return providersActions.beginAddProvider(this);
  }

  cancelAddProvider() {
    return providersActions.cancelAddProvider(this);
  }

  cancelProviderSetup() {
    return providersActions.cancelProviderSetup(this);
  }

  async refreshPasswordEntriesList(): Promise<boolean> {
    return secretsActions.refreshPasswordEntriesList(this);
  }

  clearRemoteVaultRecovery() {
    return syncActions.clearRemoteVaultRecovery(this);
  }

  /** User chose to restore a deleted remote vault from the browser cache. */
  async confirmRecoverRemoteVault(): Promise<void> {
    return syncActions.confirmRecoverRemoteVault(this);
  }

  /** User chose to create a fresh vault file on remote storage. */
  async confirmCreateFreshRemoteVault(): Promise<void> {
    return syncActions.confirmCreateFreshRemoteVault(this);
  }

  async assessVaultConnectStatus(
    argsOverride?: [string, string, string],
  ): Promise<VaultAccessStatus> {
    const args = argsOverride ?? this.connectStorageArgs();
    return providersActions.assessVaultConnectStatus(this, args);
  }

  async handleRemoteVaultAssessStatus(
    accessStatus: VaultAccessStatus,
  ): Promise<boolean> {
    return providersActions.handleRemoteVaultAssessStatus(this, accessStatus);
  }

  /** Clear wasm session + login password preview so UI matches the active provider. */
  resetVaultSessionState(resetManager = true) {
    return sessionActions.resetVaultSessionState(this, resetManager);
  }

  ensureIdleSessionTracker() {
    return idleSessionActions.ensureIdleSessionTracker(this);
  }

  startIdleSessionTracking() {
    return idleSessionActions.startIdleSessionTracking(this);
  }

  stopIdleSessionTracking() {
    return idleSessionActions.stopIdleSessionTracking(this);
  }

  showIdleLockWarning() {
    return idleSessionActions.showIdleLockWarning(this);
  }

  lockVaultDueToIdle() {
    return idleSessionActions.lockVaultDueToIdle(this);
  }

  markVaultUnlocked() {
    return sessionActions.markVaultUnlocked(this);
  }

  clearUnlockedSession(resetManager = true) {
    return sessionActions.clearUnlockedSession(this, resetManager);
  }

  /** Drop a saved sync provider from this browser. Local vault row cannot be removed. */
  async removeProvider(id: string): Promise<void> {
    return providersActions.removeProvider(this, id);
  }

  async ensureProviderSaved(): Promise<boolean> {
    return providersActions.ensureProviderSaved(this);
  }

  startVaultSync() {
    return syncActions.startVaultSync(this);
  }

  stopVaultSync() {
    return syncActions.stopVaultSync(this);
  }

  applyVaultSyncResult(result: NookVaultSyncResult) {
    return syncActions.applyVaultSyncResult(this, result);
  }

  /**
   * Read multi-device state + unlock mode from the wasm manager.
   *
   * Async because every call into the wasm manager (even sync `&self`
   * methods) shares the same wasm-bindgen borrow with in-flight async
   * `&mut self` calls like `sync_vault_from_storage`. Routing through
   * `enqueueStorage` guarantees these reads observe a quiescent
   * manager rather than racing it.
   */
  async hydrateMultiDeviceState(): Promise<void> {
    return syncActions.hydrateMultiDeviceState(this);
  }

  async syncFromStorage(options?: { force?: boolean }) {
    return syncActions.syncFromStorage(this, options);
  }

  /** Pull local vault from every sync provider (background / manual refresh). */
  async syncFromSyncProviders(options?: {
    quiet?: boolean;
    force?: boolean;
  }): Promise<void> {
    return syncActions.syncFromSyncProviders(this, options);
  }

  async manualSync() {
    return syncActions.manualSync(this);
  }

  /** Sync local event log with one provider. */
  async syncProviderById(
    providerId: string,
    options?: { quiet?: boolean; propagateError?: boolean },
  ): Promise<void> {
    return syncActions.syncProviderById(this, providerId, options);
  }

  fanOutSyncChain: Promise<void> = Promise.resolve();

  /** Push the local vault to every connected sync provider (after CRUD or manual sync). */
  async fanOutSyncToProviders(options?: { quiet?: boolean }): Promise<void> {
    return syncActions.fanOutSyncToProviders(this, options);
  }

  async runFanOutSyncToProviders(options?: { quiet?: boolean }): Promise<void> {
    return syncActions.runFanOutSyncToProviders(this, options);
  }

  async runFanOutSyncAfterLocalSave(): Promise<void> {
    return syncActions.runFanOutSyncAfterLocalSave(this);
  }

  async publishExtensionEventLogUpdate(): Promise<void> {
    return syncActions.publishExtensionEventLogUpdateForVault(this);
  }

  scheduleFanOutSyncAfterLocalSave(): void {
    void this.runFanOutSyncAfterLocalSave();
  }

  eventOutboxTarget(provider?: StorageProvider): EventOutboxTarget {
    return syncActions.eventOutboxTarget(this, provider);
  }

  async updateProviderSyncMetadata(
    providerId: string,
    yaml: string,
    revision: NookProviderSyncRevision,
  ): Promise<void> {
    return syncActions.updateProviderSyncMetadata(
      this,
      providerId,
      yaml,
      revision,
    );
  }

  async refreshReplacementConflicts(): Promise<void> {
    return syncActions.refreshReplacementConflicts(this);
  }

  async resolveReplacementConflict(
    oldSecretId: string,
    chosenSecretId: string,
  ): Promise<void> {
    return syncActions.resolveReplacementConflict(
      this,
      oldSecretId,
      chosenSecretId,
    );
  }

  dismissLocalFolderMultipleVaultsIssue() {
    return syncActions.dismissLocalFolderMultipleVaultsIssue(this);
  }

  async disconnectLocalFolderMultipleVaultsProvider(): Promise<void> {
    return syncActions.disconnectLocalFolderMultipleVaultsProvider(this);
  }

  async chooseReplacementLocalFolderForIssue(): Promise<void> {
    return syncActions.chooseReplacementLocalFolderForIssue(this);
  }

  /** E2E / dev: open the conflict dialog without reaching remote storage. */
  stageSyncConflict(conflict: NookPendingSyncConflict) {
    return syncActions.stageSyncConflict(this, conflict);
  }

  async stageStagedProviderSyncIssue(
    args: [string, string, string],
  ): Promise<boolean> {
    return syncActions.stageStagedProviderSyncIssue(this, args);
  }

  async resolveSyncConflictImportRemote(): Promise<void> {
    return syncActions.resolveSyncConflictImportRemote(this);
  }

  async resolveSyncConflictKeepLocal(): Promise<void> {
    return syncActions.resolveSyncConflictKeepLocal(this);
  }

  async resolveSyncConflictKeepRemote(): Promise<void> {
    return syncActions.resolveSyncConflictKeepRemote(this);
  }

  finishStagedProviderConnectAfterConflict(
    conflict: NookPendingSyncConflict,
  ): void {
    return syncActions.finishStagedProviderConnectAfterConflict(this, conflict);
  }

  async ensureProviderSavedAfterConflict(
    conflict: NookPendingSyncConflict,
  ): Promise<string> {
    return syncActions.ensureProviderSavedAfterConflict(this, conflict);
  }

  /** Settings: connect a new sync provider and reconcile with local vault. */
  async connectAndSyncStagedProvider(): Promise<void> {
    return providersActions.connectAndSyncStagedProvider(this);
  }

  async discoverStagedVaultStoreId(): Promise<StoreId> {
    return providersActions.discoverStagedVaultStoreId(this);
  }

  openSettings(
    section: SettingsSection = SettingsSection.Storage,
    accordion: SettingsAccordionSection = SettingsAccordionSection.Devices,
  ) {
    return uiActions.openSettings(this, { section, accordion });
  }

  openAdmin(accordion: AdminAccordionSection = AdminAccordionSection.Vaults) {
    return uiActions.openAdmin(this, accordion);
  }

  closeSettings() {
    return uiActions.closeSettings(this);
  }

  async deleteLocalBrowserData(): Promise<void> {
    return uiActions.deleteLocalData(this);
  }

  async handleRemoteLocalBrowserDataDeletion(): Promise<void> {
    return uiActions.handleRemoteLocalBrowserDataDeletion(this);
  }

  /** End the in-memory session and return to the login gate (encrypted vault + sync providers stay on disk). */
  lockVault() {
    this.beginLoginVaultPicker();
    return idleSessionActions.lockVault(this);
  }

  openHelp() {
    return uiActions.openHelp(this);
  }

  closeHelp() {
    return uiActions.closeHelp(this);
  }

  async refreshSecretsFromSession() {
    return secretsActions.refreshSecretsFromSession(this);
  }

  async loadSecretPage(query: string, requestedOffset = 0) {
    return secretsActions.loadSecretPage(this, query, requestedOffset);
  }

  applyConnectedSecretPage(page: NookSecretPage, query: string) {
    return secretsActions.applyConnectedSecretPage(this, page, query);
  }

  async decryptSecret(id: string): Promise<NookSecretRecord> {
    return secretsActions.decryptSecret(this, id);
  }

  async currentAuthenticatorCode(id: string): Promise<AuthenticatorCodeView> {
    return secretsActions.currentAuthenticatorCode(this, id);
  }

  async refreshDeviceState() {
    return multiDeviceActions.refreshDeviceState(this);
  }

  /** Refresh event-log joins from providers (manual sync + provider poll). */
  async refreshPendingJoinsFromProviders() {
    return multiDeviceActions.refreshPendingJoinsFromProviders(this);
  }

  async approveJoin(joinDeviceId: string) {
    return multiDeviceActions.approveJoin(this, joinDeviceId);
  }

  async denyJoin(joinDeviceId: string) {
    return multiDeviceActions.denyJoin(this, joinDeviceId);
  }

  async renameDevice(authId: string, label: string) {
    return multiDeviceActions.renameDevice(this, authId, label);
  }

  async revokeDevice(authId: string) {
    return multiDeviceActions.revokeDevice(this, authId);
  }

  async createFreshVault() {
    return lifecycleActions.createFreshVault(this);
  }

  async enrollAndConnect() {
    return multiDeviceActions.enrollAndConnect(this);
  }

  generatePassword(
    length: number,
    lowercase: boolean,
    uppercase: boolean,
    numbers: boolean,
    symbols: boolean,
  ): string {
    return secretsActions.generatePassword(
      this,
      length,
      lowercase,
      uppercase,
      numbers,
      symbols,
    );
  }

  async connectStagedProvider(): Promise<void> {
    return providersActions.connectStagedProvider(this);
  }

  async loadDb() {
    return secretsActions.loadDb(this);
  }

  async promoteSessionVaultToLocalIfNeeded(): Promise<void> {
    return providersActions.promoteSessionVaultToLocalIfNeeded(this);
  }

  async addVaultPassword(label: string, password: string): Promise<void> {
    return passwordUnlockActions.addVaultPassword(this, label, password);
  }

  async updateVaultPasswordEntry(
    entryId: PasswordEntryId,
    password: string,
  ): Promise<void> {
    return passwordUnlockActions.updateVaultPasswordEntry(
      this,
      entryId,
      password,
    );
  }

  async removeVaultPasswordEntry(entryId: PasswordEntryId): Promise<void> {
    return passwordUnlockActions.removeVaultPasswordEntry(this, entryId);
  }

  /**
   * Issue a base64url-encoded enrollment payload (provider creds + password
   * entry id) for the joining device to scan or paste. The password is verified
   * locally before any payload is generated but is not embedded in the QR.
   *
   * Async because the wasm manager has `&mut self` background tasks
   * (`sync_vault_from_storage`); the verify call has to go through the
   * shared storage chain or wasm-bindgen rejects it as a recursive borrow.
   */
  async issueEnrollmentCode(
    entryId: PasswordEntryId,
    password: string,
    providerId = this.syncProviders[0]?.id ?? "",
  ): Promise<string> {
    return passwordUnlockActions.issueEnrollmentCode(
      this,
      entryId,
      password,
      providerId,
    );
  }

  clearEnrollmentCode() {
    return passwordUnlockActions.clearEnrollmentCode(this);
  }

  /**
   * Unlock the vault with a labelled password entry.
   */
  async unlockWithPassword(
    entryId: PasswordEntryId,
    password: string,
  ): Promise<void> {
    return passwordUnlockActions.unlockWithPassword(this, entryId, password);
  }

  async refreshSentinelUnlockStatus(): Promise<SentinelVaultUnlockState> {
    const status =
      await sentinelUnlockActions.refreshSentinelUnlockStatus(this);
    await this.refreshArchitectureSecretCreationAllowed();
    return status;
  }

  /**
   * Joining-side: parse an enrollment code, restore provider credentials, and
   * self-enrol via `connectWithPassword`. Skips approval entirely.
   */
  async connectWithEnrollmentCode(code: string, password = ""): Promise<void> {
    return passwordUnlockActions.connectWithEnrollmentCode(
      this,
      code,
      password,
    );
  }

  async handleAddSecret(id: string, type: SecretType, data: string) {
    return secretsActions.handleAddSecret(this, id, type, data);
  }

  async handleBitwardenImport(
    json: string,
    password: string,
  ): Promise<NookImportResult> {
    return secretsActions.handleBitwardenImport(this, json, password);
  }

  async handleLastPassImport(csv: string): Promise<NookImportResult> {
    return secretsActions.handleLastPassImport(this, csv);
  }

  async handleKeeperImport(csv: string): Promise<NookImportResult> {
    return secretsActions.handleKeeperImport(this, csv);
  }

  async handleOnePasswordImport(
    archive: Uint8Array,
  ): Promise<NookImportResult> {
    return secretsActions.handleOnePasswordImport(this, archive);
  }

  async handleApplePasswordsImport(
    exportBytes: Uint8Array,
  ): Promise<NookImportResult> {
    return secretsActions.handleApplePasswordsImport(this, exportBytes);
  }

  async handleChromePasswordsImport(csv: string): Promise<NookImportResult> {
    return secretsActions.handleChromePasswordsImport(this, csv);
  }

  async handleDashlaneImport(
    exportBytes: Uint8Array,
  ): Promise<NookImportResult> {
    return secretsActions.handleDashlaneImport(this, exportBytes);
  }

  async handleGoogleAuthenticatorImport(
    migrationUris: string[],
  ): Promise<NookImportResult> {
    return secretsActions.handleGoogleAuthenticatorImport(this, migrationUris);
  }

  async handleProtonPassImport(
    exportBytes: Uint8Array,
  ): Promise<NookImportResult> {
    return secretsActions.handleProtonPassImport(this, exportBytes);
  }

  async flushRemoteEventOutboxNow(provider?: StorageProvider): Promise<void> {
    return syncActions.flushRemoteEventOutboxNow(this, provider);
  }

  async handleDeleteSecret(id: string) {
    return secretsActions.handleDeleteSecret(this, id);
  }

  async handleReplaceSecret(oldId: string, type: SecretType, data: string) {
    return secretsActions.handleReplaceSecret(this, oldId, type, data);
  }
}
