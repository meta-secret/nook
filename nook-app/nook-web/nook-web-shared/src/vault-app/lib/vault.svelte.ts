import type { PasswordOperationResult } from '$lib/vault/password-unlock'
import type { SecretOperationResult } from '$lib/vault/secret-operation-failure'
import { err, type Result } from 'neverthrow'
import type { VaultStorageFailure } from '$lib/runtime/storage-failure'
import { ExtensionSyncPublication } from '$lib/vault/sync-extension-bridge'
import type { NookAdoptedExtensionIdentityHandoff } from '$app-wasm'
import {
  VaultAccessStatus,
  type NookImportResult,
  type NookVaultSyncResult,
  type SecretType,
} from '$lib/nook'
import {
  DeviceIdentityInitializationMode,
  ExternalDeviceIdentityAuthorizationMode,
  is_vault_session_locked,
  ProviderSyncFreshness,
  ProviderSyncVisibility,
  RemoteVaultRecoveryState,
  type NookPendingSyncConflict,
  type NookProviderSyncRevision,
  type NookSyncConflictReview,
  type NookSecretPage,
  type NookVaultManager,
  type PasswordEntryId,
  type StartSentinelGenesisArgs,
  type StoreId,
} from '$app-wasm'
import { type ProviderSetupRequest } from '$lib/auth/providers'
import type { ProviderVaultIdentitySelection } from '$lib/vault/provider-vault-decision'
import type { VaultArchitecture } from '$lib/vault/architecture-model'
import type {
  SettingsNavigationRequest,
  ProviderActionsContext,
  ProviderSyncRequest,
  SyncFromProvidersRequest,
  VaultStorageArguments,
} from '$lib/vault/action-contexts'
import * as providersActions from '$lib/vault/providers.svelte'
import * as localLoginActions from '$lib/vault/local-login'
import * as syncActions from '$lib/vault/sync.svelte'
import * as architectureActions from '$lib/vault/architecture'
import * as sessionActions from '$lib/vault/session'
import * as uiActions from '$lib/vault/ui'
import * as multiDeviceActions from '$lib/vault/multi-device'
import * as secretsActions from '$lib/vault/secrets'
import * as passwordUnlockActions from '$lib/vault/password-unlock'
import * as sentinelUnlockActions from '$lib/vault/sentinel-unlock'
import * as idleSessionActions from '$lib/vault/idle-session'
import * as deviceProtectionActions from '$lib/vault/device-protection.svelte'
import * as lifecycleActions from '$lib/vault/lifecycle'
import * as sentinelGenesisActions from '$lib/vault/sentinel-genesis'
import { AdminAccordionSection } from '$lib/vault/state/ui.svelte'
import { LoginSetupKind } from '$lib/vault/state/provider.svelte'
import type {
  EventOutboxRequest,
  EventOutboxTarget,
} from '$lib/vault/sync-operation-state'
import { VaultRuntimeState } from '$lib/vault/runtime-state.svelte'

export {
  SyncProviderLabelKind,
  type SyncProviderLabel,
  type VaultEditRestriction,
} from '$lib/vault/runtime-state.svelte'

type ExternalDeviceIdentityAdoptionRequest = {
  readonly adopt: (
    manager: NookVaultManager,
  ) => Promise<Result<NookAdoptedExtensionIdentityHandoff, VaultStorageFailure>>
  readonly mode: ExternalDeviceIdentityAuthorizationMode
}

interface LocalVaultRenameRequest {
  readonly storeId: StoreId
  readonly label: string
}

interface ProviderSyncMetadataChange {
  readonly providerId: string
  readonly yaml: string
  readonly revision: NookProviderSyncRevision
}

interface ReplacementConflictChoice {
  readonly oldSecretId: string
  readonly chosenSecretId: string
}

interface SecretPageSelection {
  readonly query: string
  readonly requestedOffset: number
}

interface ConnectedSecretPage {
  readonly page: NookSecretPage
  readonly query: string
}

interface DeviceRename {
  readonly authId: string
  readonly label: string
}

interface VaultPasswordCreation {
  readonly label: string
  readonly password: string
}

interface VaultPasswordEntryUpdate {
  readonly entryId: PasswordEntryId
  readonly password: string
}

interface EnrollmentCodeIssue {
  readonly entryId: PasswordEntryId
  readonly password: string
  readonly providerId: string
}

interface VaultPasswordUnlock {
  readonly entryId: PasswordEntryId
  readonly password: string
}

interface EnrollmentCodeConnectionInput {
  readonly code: string
  readonly password: string
}

interface SecretCreationInput {
  readonly id: string
  readonly type: SecretType
  readonly data: string
}

interface BitwardenVaultImportInput {
  readonly json: string
  readonly password: string
}

type AuthenticatorMigrationUriCollection = string[]

interface SecretReplacementInput {
  readonly oldId: string
  readonly type: SecretType
  readonly data: string
}

export class VaultState extends VaultRuntimeState {
  private readonly lifecycleActions =
    new lifecycleActions.VaultInitializationActions(this)
  private readonly architectureActions =
    new architectureActions.VaultArchitectureActions(this)
  private readonly localLoginActions = new localLoginActions.VaultLoginActions(this)
  private readonly sentinelGenesisActions =
    new sentinelGenesisActions.SentinelGenesisActions(this)
  private readonly secretsActions = new secretsActions.VaultSecretActions(this)
  private readonly sessionActions = new sessionActions.VaultSessionActions(this)
  private readonly idleSessionActions =
    new idleSessionActions.VaultIdleSessionActions(this)
  private readonly uiActions = new uiActions.VaultWorkspaceActions(this)
  private readonly multiDeviceActions = new multiDeviceActions.VaultDeviceActions(
    this,
  )
  private readonly passwordUnlockActions =
    new passwordUnlockActions.VaultPasswordActions(this)
  private readonly sentinelUnlockActions =
    new sentinelUnlockActions.SentinelUnlockActions(this)
  protected providerActionsContext(): ProviderActionsContext {
    return this
  }

  protected completeVaultState(): VaultState {
    return this
  }

  async init() {
    return this.lifecycleActions.init()
  }

  async initOnce() {
    return this.lifecycleActions.initOnce()
  }

  async continueInitializationAfterDeviceUnlock() {
    return this.lifecycleActions.continueInitializationAfterDeviceUnlock()
  }

  async initDeviceIdentity() {
    return this.lifecycleActions.initDeviceIdentity({
      mode: DeviceIdentityInitializationMode.RequireCompletedAuthorization,
    })
  }

  async authorizeWithExternalDeviceIdentity({
    adopt,
    mode,
  }: ExternalDeviceIdentityAdoptionRequest): Promise<boolean> {
    return this.lifecycleActions.authorizeWithExternalDeviceIdentity({
      adopt,
      mode,
    })
  }

  replaceVaultArchitecture(architecture: VaultArchitecture): void {
    return this.architectureActions.replaceVaultArchitecture({ architecture })
  }

  applyDraftVaultArchitecture() {
    return this.architectureActions.applyDraftVaultArchitecture()
  }

  refreshVaultArchitectureFromManager() {
    return this.architectureActions.refreshVaultArchitectureFromManager()
  }

  async refreshArchitectureSecretCreationAllowed() {
    return this.architectureActions.refreshArchitectureSecretCreationAllowed()
  }

  shouldAutoUnlock(): boolean {
    return this.clientPolicy.should_auto_unlock(
      is_vault_session_locked(),
      this.localVaultPresent,
      this.passwordEntries.length,
      this.syncProviders.length,
      this.loginSetup.kind === LoginSetupKind.Active,
      this.addProviderOpen,
    )
  }

  /** Prepare login gate for local vault unlock (password or device keys). */
  async prepareLocalLogin(): Promise<void> {
    return this.localLoginActions.prepareLocalLogin()
  }

  /**
   * First-time setup: create an empty local vault secured by this device's keys.
   */
  async createLocalVaultWithDeviceKeys(label: string): Promise<void> {
    return this.localLoginActions.createLocalVaultWithDeviceKeys({ label })
  }

  async startSentinelGenesis(args: StartSentinelGenesisArgs) {
    return this.sentinelGenesisActions.start({
      args: $state.snapshot(args),
    })
  }

  async renameLocalVault({
    storeId,
    label,
  }: LocalVaultRenameRequest): Promise<void> {
    return this.localLoginActions.renameLocalVaultLabel({ storeId, label })
  }

  async selectVaultForUnlock(storeId: StoreId) {
    return this.localLoginActions.selectVaultForUnlock({ storeId })
  }

  async prepareExistingVaultImportSlot() {
    return this.localLoginActions.prepareExistingVaultImportSlot()
  }

  async reloadProvidersForActiveVault() {
    return this.localLoginActions.reloadProvidersForActiveVault()
  }

  async syncActiveVaultStoreIdToAuth() {
    return this.localLoginActions.syncActiveVaultStoreIdToAuth()
  }

  async activateConnectedExistingVault(
    storeId: StoreId,
  ): Promise<Result<void, VaultStorageFailure>> {
    return this.localLoginActions.activateConnectedExistingVault({ storeId })
  }

  beginLoginVaultPicker() {
    return this.localLoginActions.beginLoginVaultPicker()
  }

  async chooseLoginVault(storeId: StoreId) {
    return this.localLoginActions.chooseLoginVault({ storeId })
  }

  async refreshLocalVaultCatalog() {
    return this.localLoginActions.refreshLocalVaultCatalog()
  }

  /** Lock and open the login unlock step for another vault on this device. */
  async switchToVault(storeId: StoreId): Promise<void> {
    return this.localLoginActions.switchToVault({ storeId })
  }

  lockDeviceProtection() {
    return new deviceProtectionActions.DeviceProtectionActions(
      this,
    ).lockDeviceProtection()
  }

  async loadProviders(options: providersActions.ProviderLoadOptions) {
    return new providersActions.VaultProviderActions(this).loadProviders({
      options,
    })
  }

  applyActiveProviderCredentials() {
    return new providersActions.ActiveProviderCredentialsActions(
      this,
    ).applyActiveProviderCredentials()
  }

  async persistProviders(opts: providersActions.ProviderPersistenceOptions) {
    return new providersActions.VaultProviderActions(this).persistProviders({
      opts,
    })
  }

  beginProviderSetup(request: ProviderSetupRequest) {
    return new providersActions.VaultProviderActions(this).beginProviderSetup({
      request,
    })
  }

  beginExistingVaultOpen() {
    this.loginRequiresExistingVault = true
    this.remoteVaultRecoveryState = RemoteVaultRecoveryState.None
    this.errorMsg = ''
  }

  cancelExistingVaultOpen() {
    this.loginRequiresExistingVault = false
    this.remoteVaultRecoveryState = RemoteVaultRecoveryState.None
    this.errorMsg = ''
  }

  beginAddProvider() {
    return new providersActions.VaultProviderActions(this).beginAddProvider()
  }

  cancelAddProvider() {
    return new providersActions.VaultProviderActions(this).cancelAddProvider()
  }

  cancelProviderSetup() {
    return new providersActions.VaultProviderActions(this).cancelProviderSetup()
  }

  async refreshPasswordEntriesList() {
    return this.secretsActions.refreshPasswordEntriesList()
  }

  clearRemoteVaultRecovery() {
    return new syncActions.SyncConflictActions(this).clearRemoteVaultRecovery()
  }

  /** User chose to restore a deleted remote vault from the browser cache. */
  async confirmRecoverRemoteVault(): Promise<void> {
    return new syncActions.SyncConflictActions(this).confirmRecoverRemoteVault()
  }

  /** User chose to create a fresh vault file on remote storage. */
  async confirmCreateFreshRemoteVault(): Promise<void> {
    return new syncActions.SyncConflictActions(this).confirmCreateFreshRemoteVault()
  }

  async assessVaultConnectStatus(argsOverride?: VaultStorageArguments) {
    const [args = this.connectStorageArgs()] = [argsOverride]

    return new providersActions.VaultProviderActions(this).assessVaultConnectStatus({
      args,
    })
  }

  async handleRemoteVaultAssessStatus(
    accessStatus: VaultAccessStatus,
  ): Promise<boolean> {
    return new providersActions.VaultProviderActions(
      this,
    ).handleRemoteVaultAssessStatus({ accessStatus })
  }

  /** Clear wasm session + login password preview so UI matches the active provider. */
  resetVaultSessionState(resetManager = true) {
    return this.sessionActions.resetVaultSessionState({ resetManager })
  }

  ensureIdleSessionTracker() {
    return this.idleSessionActions.ensureIdleSessionTracker()
  }

  startIdleSessionTracking() {
    return this.idleSessionActions.startIdleSessionTracking()
  }

  stopIdleSessionTracking() {
    return this.idleSessionActions.stopIdleSessionTracking()
  }

  showIdleLockWarning() {
    return this.idleSessionActions.showIdleLockWarning()
  }

  lockVaultDueToIdle() {
    return this.idleSessionActions.lockVaultDueToIdle()
  }

  markVaultUnlocked() {
    return this.sessionActions.markVaultUnlocked()
  }

  clearUnlockedSession(resetManager = true) {
    return this.sessionActions.clearUnlockedSession({ resetManager })
  }

  /** Drop a saved sync provider from this browser. Local vault row cannot be removed. */
  async removeProvider(id: string): Promise<Result<void, VaultStorageFailure>> {
    return new providersActions.VaultProviderActions(this).removeProvider({
      id,
    })
  }

  async ensureProviderSaved() {
    return new providersActions.ProviderPersistenceActions(
      this,
    ).ensureProviderSaved()
  }

  startVaultSync() {
    return new syncActions.VaultSyncActions(this).startVaultSync()
  }

  stopVaultSync() {
    return new syncActions.VaultSyncActions(this).stopVaultSync()
  }

  applyVaultSyncResult(result: NookVaultSyncResult) {
    return new syncActions.VaultSyncRuntimeActions(this).applyVaultSyncResult({
      result,
    })
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
  async hydrateMultiDeviceState(): Promise<syncActions.RosterHydrationResult> {
    return new syncActions.VaultSyncActions(this).hydrateMultiDeviceState()
  }

  async syncFromStorage(freshness: ProviderSyncFreshness) {
    return new syncActions.VaultSyncActions(this).syncFromStorage({
      freshness,
    })
  }

  /** Pull local vault from every sync provider (background / manual refresh). */
  async syncFromSyncProviders(request: SyncFromProvidersRequest) {
    return new syncActions.VaultSyncActions(this).syncFromSyncProviders({
      ...request,
    })
  }

  async manualSync() {
    return new syncActions.VaultSyncActions(this).manualSync()
  }

  /** Sync local event log with one provider. */
  async syncProviderById(request: ProviderSyncRequest) {
    return new syncActions.ProviderSyncActions(this).syncProviderById({
      ...request,
    })
  }

  fanOutSyncChain: Promise<void> = Promise.resolve()

  /** Push the local vault to every connected sync provider (after CRUD or manual sync). */
  async fanOutSyncToProviders(visibility: ProviderSyncVisibility) {
    return new syncActions.VaultSyncActions(this).fanOutSyncToProviders({
      visibility,
    })
  }

  async runFanOutSyncToProviders(visibility: ProviderSyncVisibility) {
    return new syncActions.VaultSyncActions(this).runFanOutSyncToProviders({
      visibility,
    })
  }

  async runFanOutSyncAfterLocalSave() {
    return new syncActions.VaultSyncActions(this).runFanOutSyncAfterLocalSave()
  }

  async publishExtensionEventLogUpdate() {
    return new ExtensionSyncPublication(
      this,
    ).publishExtensionEventLogUpdateForVault()
  }

  scheduleFanOutSyncAfterLocalSave(): void {
    void this.runFanOutSyncAfterLocalSave().then((synchronized) => {
      if (synchronized.isErr())
        this.errorMsg = this.t(synchronized.error.translationKey)
    })
  }

  eventOutboxTarget(request: EventOutboxRequest): EventOutboxTarget {
    return new syncActions.VaultSyncActions(this).eventOutboxTarget({
      request,
    })
  }

  async updateProviderSyncMetadata({
    providerId,
    yaml,
    revision,
  }: ProviderSyncMetadataChange) {
    return new syncActions.VaultSyncActions(this).updateProviderSyncMetadata({
      providerId,
      yaml,
      revision,
    })
  }

  async refreshReplacementConflicts() {
    return new syncActions.SyncConflictActions(this).refreshReplacementConflicts()
  }

  async resolveReplacementConflict({
    oldSecretId,
    chosenSecretId,
  }: ReplacementConflictChoice): Promise<void> {
    return new syncActions.SyncConflictActions(this).resolveReplacementConflict({
      oldSecretId,
      chosenSecretId,
    })
  }

  dismissLocalFolderMultipleVaultsIssue() {
    return new syncActions.VaultSyncActions(
      this,
    ).dismissLocalFolderMultipleVaultsIssue()
  }

  async disconnectLocalFolderMultipleVaultsProvider(): Promise<void> {
    return new syncActions.VaultSyncActions(
      this,
    ).disconnectLocalFolderMultipleVaultsProvider()
  }

  async chooseReplacementLocalFolderForIssue(): Promise<void> {
    return new syncActions.VaultSyncActions(
      this,
    ).chooseReplacementLocalFolderForIssue()
  }

  /** E2E / dev: open the conflict dialog without reaching remote storage. */
  stageSyncConflict(conflict: NookPendingSyncConflict) {
    return new syncActions.VaultSyncActions(this).stageSyncConflict({
      conflict,
    })
  }

  async stageStagedProviderSyncIssue(args: VaultStorageArguments) {
    return new syncActions.VaultSyncActions(this).stageStagedProviderSyncIssue({
      args,
    })
  }

  async resolveSyncConflictImportRemote(
    identitySelection: ProviderVaultIdentitySelection,
  ): Promise<void> {
    const request: syncActions.ProviderVaultImportRequest = {
      identitySelection,
    }
    return new syncActions.SyncConflictActions(this).resolveSyncConflictImportRemote(
      request,
    )
  }

  async resolveSyncConflictKeepLocal(): Promise<void> {
    return new syncActions.SyncConflictActions(this).resolveSyncConflictKeepLocal()
  }

  async resolveSyncConflictKeepRemote(): Promise<void> {
    return new syncActions.SyncConflictActions(this).resolveSyncConflictKeepRemote()
  }

  finishStagedProviderConnectAfterConflict(conflict: NookSyncConflictReview): void {
    return new syncActions.VaultSyncActions(
      this,
    ).finishStagedProviderConnectAfterConflict({ conflict })
  }

  async ensureProviderSavedAfterConflict(conflict: NookSyncConflictReview) {
    return new syncActions.VaultSyncActions(this).ensureProviderSavedAfterConflict({
      conflict,
    })
  }

  /** Settings: connect a new sync provider and reconcile with local vault. */
  async connectAndSyncStagedProvider(): Promise<void> {
    return new providersActions.ProviderConnectionActions(
      this,
    ).connectAndSyncStagedProvider()
  }

  async discoverStagedVaultStoreId() {
    return new providersActions.ProviderConnectionActions(
      this,
    ).discoverStagedVaultStoreId()
  }

  openSettings(options: SettingsNavigationRequest) {
    return this.uiActions.openSettings({
      ...options,
    })
  }

  openAdmin(accordion: AdminAccordionSection = AdminAccordionSection.Vaults) {
    return this.uiActions.openAdmin({
      accordion,
    })
  }

  closeSettings() {
    return this.uiActions.closeSettings()
  }

  async deleteLocalBrowserData(): Promise<void> {
    return this.uiActions.deleteLocalData()
  }

  async handleRemoteLocalBrowserDataDeletion() {
    return this.uiActions.handleRemoteLocalBrowserDataDeletion()
  }

  /** End the in-memory session and return to the login gate (encrypted vault + sync providers stay on disk). */
  lockVault() {
    this.beginLoginVaultPicker()
    return this.idleSessionActions.lockVault()
  }

  openHelp() {
    return this.uiActions.openHelp()
  }

  closeHelp() {
    return this.uiActions.closeHelp()
  }

  async refreshSecretsFromSession() {
    return this.secretsActions.refreshSecretsFromSession()
  }

  async loadSecretPage({ query, requestedOffset }: SecretPageSelection) {
    return this.secretsActions.loadSecretPage({ query, requestedOffset })
  }

  applyConnectedSecretPage({ page, query }: ConnectedSecretPage) {
    return this.secretsActions.applyConnectedSecretPage({ page, query })
  }

  async decryptSecret(id: string) {
    return this.secretsActions.decryptSecret({ id })
  }

  async currentAuthenticatorCode(id: string) {
    return this.secretsActions.currentAuthenticatorCode({ id })
  }

  async refreshDeviceState() {
    return this.multiDeviceActions.refreshDeviceState()
  }

  /** Refresh event-log joins from providers (manual sync + provider poll). */
  async refreshPendingJoinsFromProviders() {
    return this.multiDeviceActions.refreshPendingJoinsFromProviders()
  }

  async approveJoin(joinDeviceId: string) {
    return this.multiDeviceActions.approveJoin({ joinDeviceId })
  }

  async denyJoin(joinDeviceId: string) {
    return this.multiDeviceActions.denyJoin({
      joinDeviceId,
    })
  }

  async renameDevice({ authId, label }: DeviceRename) {
    return this.multiDeviceActions.renameDevice({ authId, label })
  }

  async revokeDevice(authId: string) {
    return this.multiDeviceActions.revokeDevice({ authId })
  }

  async createFreshVault() {
    return this.lifecycleActions.createFreshVault()
  }

  async enrollAndConnect() {
    return this.multiDeviceActions.enrollAndConnect()
  }

  async connectStagedProvider(): Promise<void> {
    return new providersActions.ProviderConnectionActions(
      this,
    ).connectStagedProvider()
  }

  async loadDb() {
    return new secretsActions.VaultConnectionActions(this).loadDb()
  }

  async promoteSessionVaultToLocalIfNeeded(): Promise<
    Result<void, VaultStorageFailure>
  > {
    return new providersActions.VaultProviderActions(
      this,
    ).promoteSessionVaultToLocalIfNeeded()
  }

  async addVaultPassword({
    label,
    password,
  }: VaultPasswordCreation): Promise<PasswordOperationResult> {
    return this.passwordUnlockActions.addVaultPassword({ label, password })
  }

  async updateVaultPasswordEntry({
    entryId,
    password,
  }: VaultPasswordEntryUpdate): Promise<PasswordOperationResult> {
    return this.passwordUnlockActions.updateVaultPasswordEntry({
      entryId,
      password,
    })
  }

  async removeVaultPasswordEntry(
    entryId: PasswordEntryId,
  ): Promise<PasswordOperationResult> {
    return this.passwordUnlockActions.removeVaultPasswordEntry({ entryId })
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
  async issueEnrollmentCode({ entryId, password, providerId }: EnrollmentCodeIssue) {
    const enrollmentArgs: Parameters<
      passwordUnlockActions.PasswordEnrollmentIssue['issueEnrollmentCode']
    >[0] = { entryId, password, providerId }
    return new passwordUnlockActions.PasswordEnrollmentIssue(
      this,
    ).issueEnrollmentCode(enrollmentArgs)
  }

  clearEnrollmentCode() {
    return new passwordUnlockActions.PasswordEnrollmentActions(
      this,
    ).clearEnrollmentCode()
  }

  /**
   * Unlock the vault with a labelled password entry.
   */
  async unlockWithPassword({
    entryId,
    password,
  }: VaultPasswordUnlock): Promise<void> {
    return this.passwordUnlockActions.unlockWithPassword({ entryId, password })
  }

  async refreshSentinelUnlockStatus() {
    const status = await this.sentinelUnlockActions.refreshSentinelUnlockStatus()
    if (status.isErr()) {
      this.errorMsg = this.t(status.error.translationKey)
      return status
    }
    const permission = await this.refreshArchitectureSecretCreationAllowed()
    if (permission.isErr()) {
      this.errorMsg = this.t(permission.error.translationKey)
      return err(permission.error)
    }
    return status
  }

  /**
   * Joining-side: parse an enrollment code, restore provider credentials, and
   * self-enrol via `connect_with_password`. Skips approval entirely.
   */
  async connectWithEnrollmentCode({
    code,
    password,
  }: EnrollmentCodeConnectionInput): Promise<void> {
    return new passwordUnlockActions.PasswordEnrollmentActions(
      this,
    ).connectWithEnrollmentCode({ code, password })
  }

  async handleAddSecret({ id, type, data }: SecretCreationInput) {
    return this.secretsActions.handleAddSecret({
      id,
      type,
      data,
    })
  }

  async handleBitwardenImport({
    json,
    password,
  }: BitwardenVaultImportInput): Promise<SecretOperationResult<NookImportResult>> {
    return this.secretsActions.handleBitwardenImport({ json, password })
  }

  async handleKeePassXcImport(
    csv: string,
  ): Promise<SecretOperationResult<NookImportResult>> {
    return this.secretsActions.handleKeePassXcImport({ csv })
  }

  async handleLastPassImport(
    csv: string,
  ): Promise<SecretOperationResult<NookImportResult>> {
    return this.secretsActions.handleLastPassImport({ csv })
  }

  async handleKeeperImport(
    csv: string,
  ): Promise<SecretOperationResult<NookImportResult>> {
    return this.secretsActions.handleKeeperImport({ csv })
  }

  async handleOnePasswordImport(
    archive: Uint8Array,
  ): Promise<SecretOperationResult<NookImportResult>> {
    return this.secretsActions.handleOnePasswordImport({ archive })
  }

  async handleApplePasswordsImport(
    exportBytes: Uint8Array,
  ): Promise<SecretOperationResult<NookImportResult>> {
    return this.secretsActions.handleApplePasswordsImport({ exportBytes })
  }

  async handleChromePasswordsImport(
    csv: string,
  ): Promise<SecretOperationResult<NookImportResult>> {
    return this.secretsActions.handleChromePasswordsImport({ csv })
  }

  async handleDashlaneImport(
    exportBytes: Uint8Array,
  ): Promise<SecretOperationResult<NookImportResult>> {
    return this.secretsActions.handleDashlaneImport({ exportBytes })
  }

  async handleGoogleAuthenticatorImport(
    migrationUris: AuthenticatorMigrationUriCollection,
  ): Promise<SecretOperationResult<NookImportResult>> {
    return this.secretsActions.handleGoogleAuthenticatorImport({
      migrationUris,
    })
  }

  async handleProtonPassImport(
    exportBytes: Uint8Array,
  ): Promise<SecretOperationResult<NookImportResult>> {
    return this.secretsActions.handleProtonPassImport({ exportBytes })
  }

  async flushRemoteEventOutboxNow(request: EventOutboxRequest) {
    return new syncActions.VaultSyncActions(this).flushRemoteEventOutboxNow({
      request,
    })
  }

  async handleDeleteSecret(id: string) {
    return this.secretsActions.handleDeleteSecret({ id })
  }

  async handleReplaceSecret({ oldId, type, data }: SecretReplacementInput) {
    return this.secretsActions.handleReplaceSecret({ oldId, type, data })
  }
}
