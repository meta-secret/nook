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
  RemoteVaultRecoveryState,
  SentinelVaultUnlockState,
  type NookPendingSyncConflict,
  type NookProviderSyncRevision,
  type NookSyncConflictReview,
  type NookSecretPage,
  type NookVaultManager,
  type PasswordEntryId,
  type StartSentinelGenesisArgs,
  type StoreId,
} from "$app-wasm";
import {
  type OAuthFilePreset,
  type StorageProvider,
  type StorageProviderType,
} from "$lib/auth/providers";
import type { VaultArchitecture } from "$lib/vault/architecture-model";
import type {
  OpenSettingsArgs,
  ProviderActionsContext,
} from "$lib/vault/action-contexts";
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
import { AdminAccordionSection } from "$lib/vault/state/ui.svelte";
import { LoginSetupKind } from "$lib/vault/state/provider.svelte";
import type { EventOutboxTarget } from "$lib/vault/sync-operation-state";
import { VaultRuntimeState } from "$lib/vault/runtime-state.svelte";

export {
  SyncProviderLabelKind,
  type SyncProviderLabel,
  type VaultEditRestriction,
} from "$lib/vault/runtime-state.svelte";

export class VaultState extends VaultRuntimeState {
  protected providerActionsContext(): ProviderActionsContext {
    return this;
  }

  protected completeVaultState(): VaultState {
    return this;
  }

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
    const initDeviceIdentityArgs: Parameters<
      typeof lifecycleActions.initDeviceIdentity
    >[0] = { state: this, options };
    return lifecycleActions.initDeviceIdentity(initDeviceIdentityArgs);
  }

  async authorizeWithExternalDeviceIdentity({
    adopt,
    options,
  }: {
    readonly adopt: (manager: NookVaultManager) => Promise<void>;
    readonly options?: { deferInitialization?: boolean };
  }): Promise<boolean> {
    const authorizationArgs: Parameters<
      typeof lifecycleActions.authorizeWithExternalDeviceIdentity
    >[0] = { state: this, adopt, options };
    return lifecycleActions.authorizeWithExternalDeviceIdentity(
      authorizationArgs,
    );
  }

  get draftVaultArchitecture(): VaultArchitecture {
    return architectureActions.draftVaultArchitecture(this);
  }

  replaceVaultArchitecture(architecture: VaultArchitecture): void {
    const replaceVaultArchitectureArgs: Parameters<
      typeof architectureActions.replaceVaultArchitecture
    >[0] = { state: this, architecture };
    return architectureActions.replaceVaultArchitecture(
      replaceVaultArchitectureArgs,
    );
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
    const createLocalVaultWithDeviceKeysArgs: Parameters<
      typeof localLoginActions.createLocalVaultWithDeviceKeys
    >[0] = { state: this, label };
    return localLoginActions.createLocalVaultWithDeviceKeys(
      createLocalVaultWithDeviceKeysArgs,
    );
  }

  async startSentinelGenesis(args: StartSentinelGenesisArgs): Promise<void> {
    const startArgs: Parameters<typeof sentinelGenesisActions.start>[0] = {
      state: this,
      args: $state.snapshot(args),
    };
    return sentinelGenesisActions.start(startArgs);
  }

  async renameLocalVault({
    storeId,
    label,
  }: {
    readonly storeId: StoreId;
    readonly label: string;
  }): Promise<void> {
    const renameLocalVaultLabelArgs: Parameters<
      typeof localLoginActions.renameLocalVaultLabel
    >[0] = { state: this, storeId, label };
    return localLoginActions.renameLocalVaultLabel(renameLocalVaultLabelArgs);
  }

  async selectVaultForUnlock(storeId: StoreId): Promise<void> {
    const selectVaultForUnlockArgs: Parameters<
      typeof localLoginActions.selectVaultForUnlock
    >[0] = { state: this, storeId };
    return localLoginActions.selectVaultForUnlock(selectVaultForUnlockArgs);
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
    const activateConnectedExistingVaultArgs: Parameters<
      typeof localLoginActions.activateConnectedExistingVault
    >[0] = { state: this, storeId };
    return localLoginActions.activateConnectedExistingVault(
      activateConnectedExistingVaultArgs,
    );
  }

  beginLoginVaultPicker() {
    return localLoginActions.beginLoginVaultPicker(this);
  }

  async chooseLoginVault(storeId: StoreId) {
    const chooseLoginVaultArgs: Parameters<
      typeof localLoginActions.chooseLoginVault
    >[0] = { state: this, storeId };
    return localLoginActions.chooseLoginVault(chooseLoginVaultArgs);
  }

  async refreshLocalVaultCatalog(): Promise<void> {
    return localLoginActions.refreshLocalVaultCatalog(this);
  }

  /** Lock and open the login unlock step for another vault on this device. */
  async switchToVault(storeId: StoreId): Promise<void> {
    const switchToVaultArgs: Parameters<
      typeof localLoginActions.switchToVault
    >[0] = { state: this, storeId };
    return localLoginActions.switchToVault(switchToVaultArgs);
  }

  lockDeviceProtection(): Promise<void> {
    return deviceProtectionActions.lockDeviceProtection(this);
  }

  async loadProviders(options?: { ensureLocalRow?: boolean }) {
    const loadProvidersArgs: Parameters<
      typeof providersActions.loadProviders
    >[0] = { state: this, options };
    return providersActions.loadProviders(loadProvidersArgs);
  }

  applyActiveProviderCredentials() {
    return providersActions.applyActiveProviderCredentials(this);
  }

  async persistProviders(opts?: { replace?: boolean }) {
    const persistProvidersArgs: Parameters<
      typeof providersActions.persistProviders
    >[0] = { state: this, opts };
    return providersActions.persistProviders(persistProvidersArgs);
  }

  beginProviderSetup({
    type,
    oauthPreset,
  }: {
    readonly type: StorageProviderType;
    readonly oauthPreset?: OAuthFilePreset;
  }) {
    const beginProviderSetupArgs: Parameters<
      typeof providersActions.beginProviderSetup
    >[0] = { state: this, type, oauthPreset };
    return providersActions.beginProviderSetup(beginProviderSetupArgs);
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
    const assessVaultConnectStatusArgs: Parameters<
      typeof providersActions.assessVaultConnectStatus
    >[0] = { state: this, args };
    return providersActions.assessVaultConnectStatus(
      assessVaultConnectStatusArgs,
    );
  }

  async handleRemoteVaultAssessStatus(
    accessStatus: VaultAccessStatus,
  ): Promise<boolean> {
    const handleRemoteVaultAssessStatusArgs: Parameters<
      typeof providersActions.handleRemoteVaultAssessStatus
    >[0] = { state: this, accessStatus };
    return providersActions.handleRemoteVaultAssessStatus(
      handleRemoteVaultAssessStatusArgs,
    );
  }

  /** Clear wasm session + login password preview so UI matches the active provider. */
  resetVaultSessionState(resetManager = true) {
    const resetVaultSessionStateArgs: Parameters<
      typeof sessionActions.resetVaultSessionState
    >[0] = { state: this, resetManager };
    return sessionActions.resetVaultSessionState(resetVaultSessionStateArgs);
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
    const clearUnlockedSessionArgs: Parameters<
      typeof sessionActions.clearUnlockedSession
    >[0] = { state: this, resetManager };
    return sessionActions.clearUnlockedSession(clearUnlockedSessionArgs);
  }

  /** Drop a saved sync provider from this browser. Local vault row cannot be removed. */
  async removeProvider(id: string): Promise<void> {
    const removeProviderArgs: Parameters<
      typeof providersActions.removeProvider
    >[0] = { state: this, id };
    return providersActions.removeProvider(removeProviderArgs);
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
    const applyVaultSyncResultArgs: Parameters<
      typeof syncActions.applyVaultSyncResult
    >[0] = { state: this, result };
    return syncActions.applyVaultSyncResult(applyVaultSyncResultArgs);
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
    const syncFromStorageArgs: Parameters<
      typeof syncActions.syncFromStorage
    >[0] = { state: this, options };
    return syncActions.syncFromStorage(syncFromStorageArgs);
  }

  /** Pull local vault from every sync provider (background / manual refresh). */
  async syncFromSyncProviders(options?: {
    quiet?: boolean;
    force?: boolean;
  }): Promise<void> {
    const syncFromSyncProvidersArgs: Parameters<
      typeof syncActions.syncFromSyncProviders
    >[0] = { state: this, options };
    return syncActions.syncFromSyncProviders(syncFromSyncProvidersArgs);
  }

  async manualSync() {
    return syncActions.manualSync(this);
  }

  /** Sync local event log with one provider. */
  async syncProviderById({
    providerId,
    options,
  }: {
    readonly providerId: string;
    readonly options?: { quiet?: boolean; propagateError?: boolean };
  }): Promise<void> {
    const syncProviderArgs: Parameters<typeof syncActions.syncProviderById>[0] =
      { state: this, providerId, options };
    return syncActions.syncProviderById(syncProviderArgs);
  }

  fanOutSyncChain: Promise<void> = Promise.resolve();

  /** Push the local vault to every connected sync provider (after CRUD or manual sync). */
  async fanOutSyncToProviders(options?: { quiet?: boolean }): Promise<void> {
    const fanOutSyncToProvidersArgs: Parameters<
      typeof syncActions.fanOutSyncToProviders
    >[0] = { state: this, options };
    return syncActions.fanOutSyncToProviders(fanOutSyncToProvidersArgs);
  }

  async runFanOutSyncToProviders(options?: { quiet?: boolean }): Promise<void> {
    const runFanOutSyncToProvidersArgs: Parameters<
      typeof syncActions.runFanOutSyncToProviders
    >[0] = { state: this, options };
    return syncActions.runFanOutSyncToProviders(runFanOutSyncToProvidersArgs);
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
    const eventOutboxTargetArgs: Parameters<
      typeof syncActions.eventOutboxTarget
    >[0] = { state: this, provider };
    return syncActions.eventOutboxTarget(eventOutboxTargetArgs);
  }

  async updateProviderSyncMetadata({
    providerId,
    yaml,
    revision,
  }: {
    readonly providerId: string;
    readonly yaml: string;
    readonly revision: NookProviderSyncRevision;
  }): Promise<void> {
    const metadataArgs: Parameters<
      typeof syncActions.updateProviderSyncMetadata
    >[0] = { state: this, providerId, yaml, revision };
    return syncActions.updateProviderSyncMetadata(metadataArgs);
  }

  async refreshReplacementConflicts(): Promise<void> {
    return syncActions.refreshReplacementConflicts(this);
  }

  async resolveReplacementConflict({
    oldSecretId,
    chosenSecretId,
  }: {
    readonly oldSecretId: string;
    readonly chosenSecretId: string;
  }): Promise<void> {
    const resolutionArgs: Parameters<
      typeof syncActions.resolveReplacementConflict
    >[0] = { state: this, oldSecretId, chosenSecretId };
    return syncActions.resolveReplacementConflict(resolutionArgs);
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
    const stageSyncConflictArgs: Parameters<
      typeof syncActions.stageSyncConflict
    >[0] = { state: this, conflict };
    return syncActions.stageSyncConflict(stageSyncConflictArgs);
  }

  async stageStagedProviderSyncIssue(
    args: [string, string, string],
  ): Promise<boolean> {
    const stageStagedProviderSyncIssueArgs: Parameters<
      typeof syncActions.stageStagedProviderSyncIssue
    >[0] = { state: this, args };
    return syncActions.stageStagedProviderSyncIssue(
      stageStagedProviderSyncIssueArgs,
    );
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
    conflict: NookSyncConflictReview,
  ): void {
    const finishStagedProviderConnectAfterConflictArgs: Parameters<
      typeof syncActions.finishStagedProviderConnectAfterConflict
    >[0] = { state: this, conflict };
    return syncActions.finishStagedProviderConnectAfterConflict(
      finishStagedProviderConnectAfterConflictArgs,
    );
  }

  async ensureProviderSavedAfterConflict(
    conflict: NookSyncConflictReview,
  ): Promise<string> {
    const ensureProviderSavedAfterConflictArgs: Parameters<
      typeof syncActions.ensureProviderSavedAfterConflict
    >[0] = { state: this, conflict };
    return syncActions.ensureProviderSavedAfterConflict(
      ensureProviderSavedAfterConflictArgs,
    );
  }

  /** Settings: connect a new sync provider and reconcile with local vault. */
  async connectAndSyncStagedProvider(): Promise<void> {
    return providersActions.connectAndSyncStagedProvider(this);
  }

  async discoverStagedVaultStoreId(): Promise<StoreId> {
    return providersActions.discoverStagedVaultStoreId(this);
  }

  openSettings(options: OpenSettingsArgs = {}) {
    const openSettingsArgs: Parameters<typeof uiActions.openSettings>[0] = {
      state: this,
      ...options,
    };
    return uiActions.openSettings(openSettingsArgs);
  }

  openAdmin(accordion: AdminAccordionSection = AdminAccordionSection.Vaults) {
    const openAdminArgs: Parameters<typeof uiActions.openAdmin>[0] = {
      state: this,
      accordion,
    };
    return uiActions.openAdmin(openAdminArgs);
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

  async loadSecretPage({
    query,
    requestedOffset,
  }: {
    readonly query: string;
    readonly requestedOffset: number;
  }) {
    const loadSecretPageArgs: Parameters<
      typeof secretsActions.loadSecretPage
    >[0] = { state: this, query, requestedOffset };
    return secretsActions.loadSecretPage(loadSecretPageArgs);
  }

  applyConnectedSecretPage({
    page,
    query,
  }: {
    readonly page: NookSecretPage;
    readonly query: string;
  }) {
    const connectedPageArgs: Parameters<
      typeof secretsActions.applyConnectedSecretPage
    >[0] = { state: this, page, query };
    return secretsActions.applyConnectedSecretPage(connectedPageArgs);
  }

  async decryptSecret(id: string): Promise<NookSecretRecord> {
    const decryptSecretArgs: Parameters<
      typeof secretsActions.decryptSecret
    >[0] = { state: this, id };
    return secretsActions.decryptSecret(decryptSecretArgs);
  }

  async currentAuthenticatorCode(id: string): Promise<AuthenticatorCodeView> {
    const currentAuthenticatorCodeArgs: Parameters<
      typeof secretsActions.currentAuthenticatorCode
    >[0] = { state: this, id };
    return secretsActions.currentAuthenticatorCode(
      currentAuthenticatorCodeArgs,
    );
  }

  async refreshDeviceState() {
    return multiDeviceActions.refreshDeviceState(this);
  }

  /** Refresh event-log joins from providers (manual sync + provider poll). */
  async refreshPendingJoinsFromProviders() {
    return multiDeviceActions.refreshPendingJoinsFromProviders(this);
  }

  async approveJoin(joinDeviceId: string) {
    const approveJoinArgs: Parameters<
      typeof multiDeviceActions.approveJoin
    >[0] = { state: this, joinDeviceId };
    return multiDeviceActions.approveJoin(approveJoinArgs);
  }

  async denyJoin(joinDeviceId: string) {
    const denyJoinArgs: Parameters<typeof multiDeviceActions.denyJoin>[0] = {
      state: this,
      joinDeviceId,
    };
    return multiDeviceActions.denyJoin(denyJoinArgs);
  }

  async renameDevice({
    authId,
    label,
  }: {
    readonly authId: string;
    readonly label: string;
  }) {
    const renameDeviceArgs: Parameters<
      typeof multiDeviceActions.renameDevice
    >[0] = { state: this, authId, label };
    return multiDeviceActions.renameDevice(renameDeviceArgs);
  }

  async revokeDevice(authId: string) {
    const revokeDeviceArgs: Parameters<
      typeof multiDeviceActions.revokeDevice
    >[0] = { state: this, authId };
    return multiDeviceActions.revokeDevice(revokeDeviceArgs);
  }

  async createFreshVault() {
    return lifecycleActions.createFreshVault(this);
  }

  async enrollAndConnect() {
    return multiDeviceActions.enrollAndConnect(this);
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

  async addVaultPassword({
    label,
    password,
  }: {
    readonly label: string;
    readonly password: string;
  }): Promise<void> {
    const passwordArgs: Parameters<
      typeof passwordUnlockActions.addVaultPassword
    >[0] = { state: this, label, password };
    return passwordUnlockActions.addVaultPassword(passwordArgs);
  }

  async updateVaultPasswordEntry({
    entryId,
    password,
  }: {
    readonly entryId: PasswordEntryId;
    readonly password: string;
  }): Promise<void> {
    const passwordEntryArgs: Parameters<
      typeof passwordUnlockActions.updateVaultPasswordEntry
    >[0] = { state: this, entryId, password };
    return passwordUnlockActions.updateVaultPasswordEntry(passwordEntryArgs);
  }

  async removeVaultPasswordEntry(entryId: PasswordEntryId): Promise<void> {
    const removeVaultPasswordEntryArgs: Parameters<
      typeof passwordUnlockActions.removeVaultPasswordEntry
    >[0] = { state: this, entryId };
    return passwordUnlockActions.removeVaultPasswordEntry(
      removeVaultPasswordEntryArgs,
    );
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
  async issueEnrollmentCode({
    entryId,
    password,
    providerId,
  }: {
    readonly entryId: PasswordEntryId;
    readonly password: string;
    readonly providerId: string;
  }): Promise<string> {
    const enrollmentArgs: Parameters<
      typeof passwordUnlockActions.issueEnrollmentCode
    >[0] = { state: this, entryId, password, providerId };
    return passwordUnlockActions.issueEnrollmentCode(enrollmentArgs);
  }

  clearEnrollmentCode() {
    return passwordUnlockActions.clearEnrollmentCode(this);
  }

  /**
   * Unlock the vault with a labelled password entry.
   */
  async unlockWithPassword({
    entryId,
    password,
  }: {
    readonly entryId: PasswordEntryId;
    readonly password: string;
  }): Promise<void> {
    const unlockArgs: Parameters<
      typeof passwordUnlockActions.unlockWithPassword
    >[0] = { state: this, entryId, password };
    return passwordUnlockActions.unlockWithPassword(unlockArgs);
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
  async connectWithEnrollmentCode({
    code,
    password,
  }: {
    readonly code: string;
    readonly password: string;
  }): Promise<void> {
    const enrollmentArgs: Parameters<
      typeof passwordUnlockActions.connectWithEnrollmentCode
    >[0] = { state: this, code, password };
    return passwordUnlockActions.connectWithEnrollmentCode(enrollmentArgs);
  }

  async handleAddSecret({
    id,
    type,
    data,
  }: {
    readonly id: string;
    readonly type: SecretType;
    readonly data: string;
  }) {
    const addSecretArgs: Parameters<typeof secretsActions.handleAddSecret>[0] =
      {
        state: this,
        id,
        type,
        data,
      };
    return secretsActions.handleAddSecret(addSecretArgs);
  }

  async handleBitwardenImport({
    json,
    password,
  }: {
    readonly json: string;
    readonly password: string;
  }): Promise<NookImportResult> {
    const importArgs: Parameters<
      typeof secretsActions.handleBitwardenImport
    >[0] = { state: this, json, password };
    return secretsActions.handleBitwardenImport(importArgs);
  }

  async handleKeePassXcImport(csv: string): Promise<NookImportResult> {
    const handleKeePassXcImportArgs: Parameters<
      typeof secretsActions.handleKeePassXcImport
    >[0] = { state: this, csv };
    return secretsActions.handleKeePassXcImport(handleKeePassXcImportArgs);
  }

  async handleLastPassImport(csv: string): Promise<NookImportResult> {
    const handleLastPassImportArgs: Parameters<
      typeof secretsActions.handleLastPassImport
    >[0] = { state: this, csv };
    return secretsActions.handleLastPassImport(handleLastPassImportArgs);
  }

  async handleKeeperImport(csv: string): Promise<NookImportResult> {
    const handleKeeperImportArgs: Parameters<
      typeof secretsActions.handleKeeperImport
    >[0] = { state: this, csv };
    return secretsActions.handleKeeperImport(handleKeeperImportArgs);
  }

  async handleOnePasswordImport(
    archive: Uint8Array,
  ): Promise<NookImportResult> {
    const handleOnePasswordImportArgs: Parameters<
      typeof secretsActions.handleOnePasswordImport
    >[0] = { state: this, archive };
    return secretsActions.handleOnePasswordImport(handleOnePasswordImportArgs);
  }

  async handleApplePasswordsImport(
    exportBytes: Uint8Array,
  ): Promise<NookImportResult> {
    const handleApplePasswordsImportArgs: Parameters<
      typeof secretsActions.handleApplePasswordsImport
    >[0] = { state: this, exportBytes };
    return secretsActions.handleApplePasswordsImport(
      handleApplePasswordsImportArgs,
    );
  }

  async handleChromePasswordsImport(csv: string): Promise<NookImportResult> {
    const handleChromePasswordsImportArgs: Parameters<
      typeof secretsActions.handleChromePasswordsImport
    >[0] = { state: this, csv };
    return secretsActions.handleChromePasswordsImport(
      handleChromePasswordsImportArgs,
    );
  }

  async handleDashlaneImport(
    exportBytes: Uint8Array,
  ): Promise<NookImportResult> {
    const handleDashlaneImportArgs: Parameters<
      typeof secretsActions.handleDashlaneImport
    >[0] = { state: this, exportBytes };
    return secretsActions.handleDashlaneImport(handleDashlaneImportArgs);
  }

  async handleGoogleAuthenticatorImport(
    migrationUris: string[],
  ): Promise<NookImportResult> {
    const handleGoogleAuthenticatorImportArgs: Parameters<
      typeof secretsActions.handleGoogleAuthenticatorImport
    >[0] = { state: this, migrationUris };
    return secretsActions.handleGoogleAuthenticatorImport(
      handleGoogleAuthenticatorImportArgs,
    );
  }

  async handleProtonPassImport(
    exportBytes: Uint8Array,
  ): Promise<NookImportResult> {
    const handleProtonPassImportArgs: Parameters<
      typeof secretsActions.handleProtonPassImport
    >[0] = { state: this, exportBytes };
    return secretsActions.handleProtonPassImport(handleProtonPassImportArgs);
  }

  async flushRemoteEventOutboxNow(provider?: StorageProvider): Promise<void> {
    const flushRemoteEventOutboxNowArgs: Parameters<
      typeof syncActions.flushRemoteEventOutboxNow
    >[0] = { state: this, provider };
    return syncActions.flushRemoteEventOutboxNow(flushRemoteEventOutboxNowArgs);
  }

  async handleDeleteSecret(id: string) {
    const handleDeleteSecretArgs: Parameters<
      typeof secretsActions.handleDeleteSecret
    >[0] = { state: this, id };
    return secretsActions.handleDeleteSecret(handleDeleteSecretArgs);
  }

  async handleReplaceSecret({
    oldId,
    type,
    data,
  }: {
    readonly oldId: string;
    readonly type: SecretType;
    readonly data: string;
  }) {
    const replaceSecretArgs: Parameters<
      typeof secretsActions.handleReplaceSecret
    >[0] = { state: this, oldId, type, data };
    return secretsActions.handleReplaceSecret(replaceSecretArgs);
  }
}
