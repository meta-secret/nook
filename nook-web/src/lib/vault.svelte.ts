import {
  getVaultManager,
  isoTimestamp,
  type JoinRequest,
  type NookSecretRecord,
  type NookVaultSyncResult,
  type VaultItemType,
  type VaultMember,
} from '$lib/nook'
import { consumeEnrollmentFromLocation } from '$lib/enrollment-code'
import { SvelteDate } from 'svelte/reactivity'
import type { NookVaultManager } from '$lib/nook-wasm/nook_wasm'
import type { VaultPasswordEntrySummary } from '$lib/vault-password'
import { isVaultSessionLocked, setVaultSessionLocked } from '$lib/vault-session'
import {
  DEFAULT_DRIVE_BACKUP_NAME,
  DEFAULT_GITHUB_REPO,
  formatDriveStorageRef,
  loadAuthProviders,
  providerDefaultLabel,
  saveAuthProviders,
  wasmStorageModeForProvider,
  type LocalFolderConfig,
  type OAuthFileConfig,
  type OAuthFilePreset,
  type StorageProvider,
  type StorageProviderType,
} from '$lib/auth-providers'
import {
  chooseLocalFolderBackupDirectory,
  syncLocalFolderProvider,
} from '$lib/local-folder-sync'
import {
  getBrowserAppLocale,
  parseAppLocale,
  type AppLocale,
} from '$lib/locale'
import { TRANSLATION_CATALOGS, lookupTranslation } from '$lib/locale-catalogs'
import {
  hasActiveLocalVault,
  hasLocalVault,
  switchActiveVault,
} from '$lib/local-vault'
import type { LocalVaultEntry } from '$lib/local-vault'
import { createLogger } from '$lib/log'
import { ensureLocalAuthProviderSnapshot } from '$lib/vault-migration'
import {
  readVaultVersionFromBlob,
  resolveVaultSyncIntervalMs,
  vaultBlobContentHash,
  type PendingSyncConflict,
} from '$lib/vault-sync'
import {
  createVaultIdleSessionTracker,
  resolveVaultIdleTimeoutMs,
  resolveVaultIdleWarningMs,
  type VaultIdleSessionTracker,
} from '$lib/vault-idle-session'
import {
  setupDeviceProtection as createPasskeyProtection,
  unlockDeviceProtection as authorizePasskeyProtection,
} from '$lib/passkey-device-protection'

import * as localeActions from '$lib/vault/locale'
import * as oauthActions from '$lib/vault/oauth'
import * as providersActions from '$lib/vault/providers'
import * as localLoginActions from '$lib/vault/local-login'
import * as syncActions from '$lib/vault/sync'
import * as multiDeviceActions from '$lib/vault/multi-device'
import * as secretsActions from '$lib/vault/secrets'
import * as passwordUnlockActions from '$lib/vault/password-unlock'
import * as idleSessionActions from '$lib/vault/idle-session'
import * as lifecycleActions from '$lib/vault/lifecycle'

const vaultLog = createLogger('vault')

export class VaultState {
  locale = $state<AppLocale>('en')
  translations = $state<Record<string, unknown>>({})

  settingsOpen = $state(false)
  settingsSection = $state<'storage' | 'onboard' | 'admin'>('storage')
  settingsAccordionSection = $state<'devices' | 'language' | null>('devices')
  adminAccordionSection = $state<'vaults' | 'storage' | 'passwords' | null>(
    'vaults',
  )
  helpOpen = $state(false)

  providers = $state<StorageProvider[]>([])
  providersLoaded = $state(false)
  /** Locally cached vaults on this browser (metadata only). */
  localVaults = $state<LocalVaultEntry[]>([])
  /** Active vault store_id — sync providers and local blob are scoped to this. */
  activeVaultStoreId = $state<string | null>(null)
  /** Login gate: user picked a vault but has not unlocked yet. */
  selectedLoginVaultStoreId = $state<string | null>(null)
  /** True when the active vault blob exists in IndexedDB. */
  localVaultPresent = $state(false)
  localLoginPrepared = $state(false)
  loginSetupType = $state<StorageProviderType | null>(null)
  addProviderOpen = $state(false)

  storageMode = $state<StorageProviderType>('local')
  githubPat = $state('')
  githubRepo = $state(DEFAULT_GITHUB_REPO)
  oauthFile = $state<OAuthFileConfig | null>(null)
  localFolder = $state<LocalFolderConfig | null>(null)
  oauthSetupPreset = $state<OAuthFilePreset | null>(null)
  googleOAuthBusy = $state(false)
  icloudOAuthBusy = $state(false)

  manager = $state<NookVaultManager | null>(null)
  deviceProtectionStatus = $state<
    'loading' | 'missing' | 'plaintext' | 'passkey' | 'unlocked' | 'error'
  >('loading')
  isAuthenticated = $state(false)
  /** True when the login gate should explain that the last lock was due to idle timeout. */
  sessionExpiredByIdle = $state(false)
  secrets = $state<NookSecretRecord[]>([])

  errorMsg = $state('')
  successMsg = $state('')
  isVerifying = $state(false)
  isSaving = $state(false)
  isInitializing = $state(true)

  deviceId = $state('')
  devicePublicKey = $state('')
  pendingJoins = $state<JoinRequest[]>([])
  vaultMembers = $state<VaultMember[]>([])
  enrollSecretsKey = $state('')
  enrollMembersKey = $state('')
  joinEnrollmentPrompt = $state<'none' | 'needs_request' | 'pending'>('none')
  /**
   * True from the moment this device sends a join request until it unlocks.
   * Survives the join dialog being dismissed, so background sync can still
   * auto-connect when the approval lands (`applyVaultSyncResult`).
   */
  awaitingJoinApproval = $state(false)
  lastSyncedAt = $state<SvelteDate | null>(null)
  isSyncing = $state(false)
  /** Provider id currently running a manual sync (Settings UI). */
  syncingProviderId = $state<string | null>(null)
  /** Background push to all sync providers after a local vault mutation. */
  isFanOutSyncing = $state(false)
  /** Concurrent secret replacement conflicts from the event log projection. */
  replacementConflicts = $state<
    Array<{ oldSecretId: string; candidatesJson: string }>
  >([])
  /** Concurrent key-epoch rotations; local writes fail closed while present. */
  securityConflicts = $state<
    Array<{ eventsJson: string; reasonsJson: string }>
  >([])
  /** User must pick local vs remote before editing when versions match but content differs. */
  pendingSyncConflict = $state<PendingSyncConflict | null>(null)

  get syncBlocked(): boolean {
    return this.pendingSyncConflict !== null
  }

  get editsBlocked(): boolean {
    return this.syncBlocked || this.securityConflicts.length > 0
  }

  get deviceProtectionReady(): boolean {
    return this.deviceProtectionStatus === 'unlocked'
  }

  get syncProviderCount(): number {
    return this.syncProviders.length
  }

  get syncingProviderLabel(): string | null {
    if (!this.syncingProviderId) return null
    return (
      this.providers.find((p) => p.id === this.syncingProviderId)?.label ?? null
    )
  }

  get isSyncActivityVisible(): boolean {
    return (
      this.isFanOutSyncing ||
      this.syncingProviderId !== null ||
      this.isSyncing ||
      this.isSaving
    )
  }

  unlockMode = $state<'keys' | 'password'>('keys')
  /** Remote vault unlock mode detected on the login screen (before session open). */
  loginUnlockMode = $state<'unknown' | 'keys' | 'password'>('unknown')
  /** Open the login password form after Connect finds a password-mode vault. */
  loginPasswordPrompt = $state(false)
  /** Remote vault file missing on storage — prompt before unlock. */
  remoteVaultRecoveryPrompt = $state<'none' | 'with_cache' | 'missing_only'>(
    'none',
  )
  /** How the next unlock should connect after the user confirms recovery. */
  pendingConnectRecovery = $state<'none' | 'from_cache' | 'fresh'>('none')
  isPasswordBusy = $state(false)
  passwordError = $state('')
  enrollmentCode = $state('')
  prefillEnrollmentCode = $state('')
  enrollmentFromUrlPending = $state(false)
  loginEnrollmentCode = $state('')
  passwordEntries = $state<VaultPasswordEntrySummary[]>([])
  selectedPasswordEntryId = $state<string | null>(null)
  activeEnrollmentEntryId = $state<string | null>(null)

  get hasPasswordEnvelope(): boolean {
    return this.passwordEntries.length > 0 || this.unlockMode === 'password'
  }

  /** Default 60s in production; dev/e2e may override via VITE_VAULT_SYNC_INTERVAL_MS. */
  static syncIntervalMs(): number {
    return resolveVaultSyncIntervalMs(import.meta.env)
  }

  successDismissTimer: ReturnType<typeof setTimeout> | null = null
  idleSessionTracker: VaultIdleSessionTracker | null = null
  syncTimer: ReturnType<typeof setInterval> | null = null
  initPromise: Promise<void> | null = null
  storageChain: Promise<unknown> = Promise.resolve()
  private deviceAuthorizationInProgress = false
  pendingEnrollmentFromUrl: string | null =
    typeof window !== 'undefined' ? consumeEnrollmentFromLocation() : null

  enqueueStorage<T>(operation: () => T | Promise<T>): Promise<T> {
    const next = this.storageChain.then(() => operation())
    this.storageChain = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  /** E2E/dev: wait for the serialized wasm storage queue to finish. */
  waitForStorageChain(): Promise<void> {
    return lifecycleActions.waitForStorageChain(this)
  }

  /** E2E/dev: reset a stuck storage queue (abandons in-flight wasm work). */
  resetStorageChain(): void {
    return lifecycleActions.resetStorageChain(this)
  }

  static storageOpTimeoutMs = 20_000

  raceStorageTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    const timeoutMs = VaultState.storageOpTimeoutMs
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        )
      }),
    ])
  }

  wasmStorageArgs(): [string, string, string] {
    if (this.localVaultPresent) {
      return ['local', '', '']
    }
    if (this.isAuthenticated && this.syncProviders[0]) {
      return this.providerWasmArgs(this.syncProviders[0])
    }
    const mode = wasmStorageModeForProvider(
      this.storageMode,
      this.oauthFile?.preset,
    )
    if (this.storageMode === 'oauth-file') {
      const fileName =
        this.oauthFile?.fileName?.trim() ||
        this.githubRepo.trim() ||
        DEFAULT_DRIVE_BACKUP_NAME
      return [
        mode,
        this.oauthFile?.accessToken?.trim() ?? '',
        formatDriveStorageRef(this.oauthFile?.fileId, fileName),
      ]
    }
    return [mode, this.githubPat, this.githubRepo]
  }

  /** WASM connect always uses the local cache when one exists (unified vault). */
  connectStorageArgs(): [string, string, string] {
    if (
      !this.isAuthenticated &&
      this.syncProviders.length > 0 &&
      this.joinEnrollmentPrompt !== 'none'
    ) {
      return this.providerWasmArgs(this.syncProviders[0]!)
    }
    return this.wasmStorageArgs()
  }

  stagedRemoteStorageArgs(): [string, string, string] | null {
    const type = this.loginSetupType ?? this.storageMode
    if (type === 'local') {
      return null
    }
    if (type === 'github') {
      const pat = this.githubPat.trim()
      const repo = this.githubRepo.trim() || DEFAULT_GITHUB_REPO
      if (!pat) {
        return null
      }
      return ['github', pat, repo]
    }
    if (type === 'oauth-file') {
      const token = this.oauthFile?.accessToken?.trim()
      if (!token) {
        return null
      }
      const fileName =
        this.githubRepo.trim() ||
        this.oauthFile?.fileName?.trim() ||
        DEFAULT_DRIVE_BACKUP_NAME
      return [
        wasmStorageModeForProvider('oauth-file', this.oauthFile?.preset),
        token,
        formatDriveStorageRef(this.oauthFile?.fileId, fileName),
      ]
    }
    return null
  }

  stagedProviderLabel(): string {
    const type = this.loginSetupType ?? this.storageMode
    if (type === 'github') {
      return providerDefaultLabel(
        'github',
        this.githubRepo.trim() || DEFAULT_GITHUB_REPO,
      )
    }
    if (type === 'oauth-file') {
      return providerDefaultLabel(
        'oauth-file',
        this.githubRepo.trim() ||
          this.oauthFile?.fileName?.trim() ||
          DEFAULT_DRIVE_BACKUP_NAME,
        this.oauthFile?.preset ?? this.oauthSetupPreset ?? 'google-drive',
      )
    }
    return providerDefaultLabel(type)
  }

  /**
   * Compare local IndexedDB vault with a staged remote provider before connect.
   * Newer version wins automatically; equal version + different content → conflict UI.
   */
  async reconcileStagedRemoteWithLocal(options?: {
    providerId?: string
    quiet?: boolean
  }): Promise<'ok' | 'conflict' | 'skip'> {
    void options
    return this.stagedRemoteStorageArgs() ? 'ok' : 'skip'
  }

  hasRemoteCredentials(): boolean {
    if (this.storageMode === 'github') {
      return Boolean(this.githubPat.trim())
    }
    if (this.storageMode === 'oauth-file') {
      return Boolean(this.oauthFile?.accessToken?.trim())
    }
    if (this.storageMode === 'local-folder') {
      return Boolean(this.localFolder?.handleId?.trim())
    }
    return true
  }

  syncOAuthRemoteRefFromManager() {
    if (this.storageMode !== 'oauth-file' || !this.manager || !this.oauthFile) {
      return
    }
    const remoteRef = this.manager.storage_remote_ref ?? ''
    if (!remoteRef.trim() || remoteRef === this.oauthFile.fileId) {
      return
    }
    this.oauthFile = { ...this.oauthFile, fileId: remoteRef }
  }

  async ensureOAuthTokensFresh(): Promise<void> {
    return oauthActions.ensureOAuthTokensFresh(this)
  }

  async signInWithGoogle(): Promise<void> {
    return oauthActions.signInWithGoogle(this)
  }

  async signInWithICloud(): Promise<void> {
    return oauthActions.signInWithICloud(this)
  }

  async chooseLocalFolderBackupDirectory(): Promise<void> {
    this.localFolder = await chooseLocalFolderBackupDirectory()
  }

  dismissSuccess() {
    if (this.successDismissTimer !== null) {
      clearTimeout(this.successDismissTimer)
      this.successDismissTimer = null
    }
    this.successMsg = ''
  }

  dismissError() {
    this.errorMsg = ''
  }

  clearLoginPasswordPrompt() {
    this.loginPasswordPrompt = false
  }

  dismissJoinEnrollment() {
    return multiDeviceActions.dismissJoinEnrollment(this)
  }

  async confirmJoinRequest() {
    return multiDeviceActions.confirmJoinRequest(this)
  }

  showSuccess(message: string) {
    this.dismissSuccess()
    this.successMsg = message
    this.successDismissTimer = setTimeout(() => {
      this.dismissSuccess()
    }, 5000)
  }

  get localProvider(): StorageProvider | null {
    return this.activeVaultProviders.find((p) => p.type === 'local') ?? null
  }

  /** Canonical on-device vault row — alias kept while settings code migrates. */
  get activeProvider(): StorageProvider | null {
    return this.localProvider
  }

  /** Providers belonging to the active vault only. */
  get activeVaultProviders(): StorageProvider[] {
    const sid = this.activeVaultStoreId?.trim()
    if (!sid) {
      return this.providers
    }
    return this.providers.filter(
      (provider) => !provider.storeId || provider.storeId === sid,
    )
  }

  /** Cloud sync destinations for the active vault — local row omitted. */
  get syncProviders(): StorageProvider[] {
    return this.activeVaultProviders.filter((p) => p.type !== 'local')
  }

  get hasMultipleLocalVaults(): boolean {
    return this.localVaults.length > 1
  }

  get showLoginVaultPicker(): boolean {
    return (
      !this.isAuthenticated &&
      this.localVaults.length > 1 &&
      this.selectedLoginVaultStoreId === null &&
      this.loginSetupType === null &&
      !this.addProviderOpen &&
      isVaultSessionLocked()
    )
  }

  providerWasmArgs(provider: StorageProvider): [string, string, string] {
    const mode = wasmStorageModeForProvider(
      provider.type,
      provider.oauthFile?.preset,
    )
    if (provider.type === 'oauth-file') {
      const fileName =
        provider.oauthFile?.fileName?.trim() || DEFAULT_DRIVE_BACKUP_NAME
      return [
        mode,
        provider.oauthFile?.accessToken?.trim() ?? '',
        formatDriveStorageRef(provider.oauthFile?.fileId, fileName),
      ]
    }
    if (provider.type === 'local-folder') {
      return ['local', '', '']
    }
    if (provider.type === 'github') {
      return [
        mode,
        provider.githubPat?.trim() ?? '',
        provider.githubRepo?.trim() || DEFAULT_GITHUB_REPO,
      ]
    }
    return ['local', '', '']
  }

  get hasProviders(): boolean {
    return this.providers.length > 0
  }

  get activeProviderLabel(): string {
    return this.activeProvider?.label ?? providerDefaultLabel(this.storageMode)
  }

  async updateLocale(newLocale: AppLocale, options?: { preferWasm?: boolean }) {
    return localeActions.updateLocale(this, newLocale, options)
  }

  resolveErrorMessage(message: string): string {
    const stripped = message
      .replace(/^GitHub error:\s*/i, '')
      .replace(/^Drive error:\s*/i, '')
      .trim()
    if (stripped.startsWith('errors.')) {
      return this.t(stripped)
    }
    if (message.startsWith('errors.')) {
      return this.t(message)
    }
    return message
  }

  t = (key: string, replacements?: Record<string, string>): string => {
    const val =
      lookupTranslation(this.translations, key) ??
      lookupTranslation(TRANSLATION_CATALOGS[this.locale], key) ??
      lookupTranslation(TRANSLATION_CATALOGS.en, key)
    if (val === undefined) {
      return key
    }
    let text = String(val)
    if (replacements) {
      for (const [k, v] of Object.entries(replacements)) {
        text = text.replace(`{${k}}`, v)
      }
    }
    return text
  }

  async init() {
    return lifecycleActions.init(this)
  }

  async initOnce() {
    vaultLog.info('app init started')
    this.isInitializing = true
    let deviceIdentityUnlocked = false
    if (!this.isVerifying) {
      this.errorMsg = ''
    }
    try {
      const savedLocale = parseAppLocale(localStorage.getItem('nook_locale'))
      const browserLocale = getBrowserAppLocale()
      const locale = savedLocale ?? browserLocale
      await this.updateLocale(locale)
      await localLoginActions.refreshLocalVaultCatalog(this)
      this.manager = await getVaultManager()
      await this.updateLocale(locale, { preferWasm: true })
      this.deviceProtectionStatus =
        (await this.manager.deviceProtectionStatus()) as
          | 'missing'
          | 'plaintext'
          | 'passkey'
          | 'unlocked'

      const autoAuthorizeE2e =
        import.meta.env.VITE_E2E_EXPOSE_VAULT === 'true' &&
        localStorage.getItem('nook_e2e_manual_passkey') !== 'true'
      if (!this.deviceProtectionReady && autoAuthorizeE2e) {
        if (this.deviceProtectionStatus === 'passkey') {
          await this.enqueueStorage(() =>
            authorizePasskeyProtection(this.manager!),
          )
        } else {
          await this.enqueueStorage(() =>
            createPasskeyProtection(this.manager!),
          )
        }
        deviceIdentityUnlocked = true
        this.deviceAuthorizationInProgress = true
      }

      if (!this.deviceProtectionReady && !deviceIdentityUnlocked) return
      await this.continueInitializationAfterDeviceUnlock()
      this.deviceProtectionStatus = 'unlocked'
    } catch (error) {
      if (
        this.deviceProtectionStatus === 'unlocked' ||
        deviceIdentityUnlocked
      ) {
        void this.lockDeviceProtection()
      }
      this.deviceProtectionStatus =
        this.deviceProtectionStatus === 'loading'
          ? 'error'
          : this.deviceProtectionStatus
      this.errorMsg =
        error instanceof Error
          ? error.message
          : 'Failed to initialize Nook Session Manager.'
    } finally {
      this.deviceAuthorizationInProgress = false
      this.isInitializing = false
    }
  }

  private async continueInitializationAfterDeviceUnlock() {
    if (!this.manager) return
    await this.initDeviceIdentity({ allowPendingAuthorization: true })
    await this.loadProviders({ ensureLocalRow: true })
    await localLoginActions.refreshLocalVaultCatalog(this)
    if (!this.activeVaultStoreId) {
      this.activeVaultStoreId = this.localVaults[0]?.storeId ?? null
    }
    if (this.activeVaultStoreId) {
      await switchActiveVault(this.activeVaultStoreId).catch(() => undefined)
    }
    this.localVaultPresent = await hasActiveLocalVault()
    if (this.localVaultPresent) {
      this.storageMode = 'local'
      this.githubPat = ''
      this.oauthFile = null
      this.localFolder = null
    } else {
      this.applyActiveProviderCredentials()
    }
    const hasPendingEnrollment = Boolean(this.pendingEnrollmentFromUrl)
    if (this.localVaultPresent) {
      this.storageMode = 'local'
      await this.refreshPasswordEntriesList()
    }
    const autoUnlock = !hasPendingEnrollment && this.shouldAutoUnlock()
    if (autoUnlock) {
      await this.loadDb()
      if (!this.isAuthenticated && this.localProvider) {
        void this.probeLoginUnlockMode()
      }
    } else {
      await this.refreshDeviceState()
    }

    if (this.pendingEnrollmentFromUrl && !this.isAuthenticated) {
      const code = this.pendingEnrollmentFromUrl
      this.pendingEnrollmentFromUrl = null
      this.prefillEnrollmentCode = code
      this.enrollmentFromUrlPending = true
    }

    vaultLog.info('app init finished', {
      localVaultPresent: this.localVaultPresent,
      authenticated: this.isAuthenticated,
      providers: this.providers.length,
      syncProviders: this.syncProviders.length,
      deviceId: this.deviceId || undefined,
    })
  }

  async initDeviceIdentity(options?: { allowPendingAuthorization?: boolean }) {
    if (
      !this.manager ||
      (!this.deviceProtectionReady &&
        !this.deviceAuthorizationInProgress &&
        !options?.allowPendingAuthorization)
    ) {
      throw new Error(this.t('errors.device_protection.authorization_required'))
    }
    const identity = await this.enqueueStorage(() => ({
      deviceId: this.manager!.device_id,
      devicePublicKey: this.manager!.device_public_key,
    }))
    this.deviceId = identity.deviceId
    this.devicePublicKey = identity.devicePublicKey
  }

  async setupDeviceProtection() {
    if (!this.manager || this.isVerifying) return
    this.isVerifying = true
    this.errorMsg = ''
    let deviceIdentityUnlocked = false
    try {
      await this.enqueueStorage(() => createPasskeyProtection(this.manager!))
      deviceIdentityUnlocked = true
      this.deviceAuthorizationInProgress = true
      await this.continueInitializationAfterDeviceUnlock()
      this.deviceProtectionStatus = 'unlocked'
    } catch (error) {
      if (
        this.deviceProtectionStatus === 'unlocked' ||
        deviceIdentityUnlocked
      ) {
        void this.lockDeviceProtection()
      }
      this.errorMsg =
        error instanceof Error ? error.message : 'Failed to create passkey.'
    } finally {
      this.deviceAuthorizationInProgress = false
      this.isVerifying = false
      this.isInitializing = false
    }
  }

  async unlockDeviceProtection() {
    if (!this.manager || this.isVerifying) return
    this.isVerifying = true
    this.errorMsg = ''
    let deviceIdentityUnlocked = false
    try {
      await this.enqueueStorage(() => authorizePasskeyProtection(this.manager!))
      deviceIdentityUnlocked = true
      this.deviceAuthorizationInProgress = true
      await this.continueInitializationAfterDeviceUnlock()
      this.deviceProtectionStatus = 'unlocked'
    } catch (error) {
      if (
        this.deviceProtectionStatus === 'unlocked' ||
        deviceIdentityUnlocked
      ) {
        void this.lockDeviceProtection()
      }
      this.errorMsg =
        error instanceof Error ? error.message : 'Passkey authorization failed.'
    } finally {
      this.deviceAuthorizationInProgress = false
      this.isVerifying = false
      this.isInitializing = false
    }
  }

  async resetDeviceProtectionForRecovery() {
    if (!this.manager || this.isVerifying) return
    this.isVerifying = true
    this.errorMsg = ''
    try {
      await this.manager.resetDeviceProtectionForRecovery()
      this.deviceProtectionStatus = 'missing'
      this.deviceId = ''
      this.devicePublicKey = ''
      this.providers = []
      this.providersLoaded = false
      this.githubPat = ''
      this.oauthFile = null
      this.localFolder = null
      this.storageMode = 'local'
      this.showSuccess(this.t('device_protection.recovery_complete'))
    } catch (error) {
      this.errorMsg =
        error instanceof Error ? error.message : 'Recovery reset failed.'
    } finally {
      this.isVerifying = false
    }
  }

  shouldAutoUnlock(): boolean {
    if (isVaultSessionLocked()) {
      return false
    }
    if (this.localVaultPresent && this.passwordEntries.length > 0) {
      return false
    }
    return (
      this.localVaultPresent &&
      this.syncProviders.length === 0 &&
      this.loginSetupType === null &&
      !this.addProviderOpen
    )
  }

  /** Prepare login gate for local vault unlock (password or device keys). */
  async prepareLocalLogin(): Promise<void> {
    return localLoginActions.prepareLocalLogin(this)
  }

  /**
   * First-time setup: create an empty local vault secured by this device's keys.
   */
  async createLocalVaultWithDeviceKeys(label?: string): Promise<void> {
    return localLoginActions.createLocalVaultWithDeviceKeys(this, label)
  }

  async renameLocalVault(storeId: string, label: string): Promise<void> {
    return localLoginActions.renameLocalVaultLabel(this, storeId, label)
  }

  async selectVaultForUnlock(storeId: string): Promise<void> {
    return localLoginActions.selectVaultForUnlock(this, storeId)
  }

  async reloadProvidersForActiveVault(): Promise<void> {
    const snapshot = await this.enqueueStorage(() =>
      loadAuthProviders(this.manager!),
    )
    this.providers = snapshot.providers.map((p) =>
      p.label === 'GitHub sync' ? { ...p, label: 'GitHub' } : p,
    )
    if (snapshot.activeVaultStoreId) {
      this.activeVaultStoreId = snapshot.activeVaultStoreId
    }
    this.applyActiveProviderCredentials()
  }

  async syncActiveVaultStoreIdToAuth(): Promise<void> {
    return localLoginActions.syncActiveVaultStoreIdToAuth(this)
  }

  beginLoginVaultPicker() {
    this.selectedLoginVaultStoreId = null
    this.localLoginPrepared = false
    this.resetVaultSessionState()
  }

  async chooseLoginVault(storeId: string) {
    await this.selectVaultForUnlock(storeId)
    this.selectedLoginVaultStoreId = storeId
  }

  async refreshLocalVaultCatalog(): Promise<void> {
    return localLoginActions.refreshLocalVaultCatalog(this)
  }

  /** Lock and open the login unlock step for another vault on this device. */
  async switchToVault(storeId: string): Promise<void> {
    const trimmed = storeId.trim()
    if (
      !trimmed ||
      trimmed === this.activeVaultStoreId?.trim() ||
      this.isVerifying
    ) {
      return
    }
    this.helpOpen = false
    this.cancelProviderSetup()
    this.cancelAddProvider()
    this.isVerifying = true
    try {
      await this.waitForStorageChain()
      setVaultSessionLocked(true)
      this.clearUnlockedSession()
      await this.waitForStorageChain()
      await this.chooseLoginVault(trimmed)
      this.isVerifying = true
      await this.lockDeviceProtection()
      vaultLog.info('vault switch completed', { storeId: trimmed })
    } catch (error) {
      this.errorMsg =
        error instanceof Error ? error.message : 'Failed to switch vaults.'
    } finally {
      this.isVerifying = false
    }
  }

  lockDeviceProtection(): Promise<void> {
    this.deviceProtectionStatus = 'passkey'
    this.deviceAuthorizationInProgress = false
    this.deviceId = ''
    this.devicePublicKey = ''
    if (!this.manager) return Promise.resolve()
    return this.enqueueStorage(() => this.manager!.lockDeviceIdentity()).catch(
      () => {
        // Persisted identity remains wrapped even if the manager is tearing down.
      },
    )
  }

  /** @deprecated Use {@link createLocalVaultWithDeviceKeys}. Backup passwords belong in Settings. */
  async createLocalVault(password: string): Promise<void> {
    return localLoginActions.createLocalVault(this, password)
  }

  async loadProviders(options?: { ensureLocalRow?: boolean }) {
    return providersActions.loadProviders(this, options)
  }

  applyActiveProviderCredentials() {
    return providersActions.applyActiveProviderCredentials(this)
  }

  async persistProviders(opts?: { replace?: boolean }) {
    return providersActions.persistProviders(this, opts)
  }

  beginProviderSetup(type: StorageProviderType, oauthPreset?: OAuthFilePreset) {
    return providersActions.beginProviderSetup(this, type, oauthPreset)
  }

  beginAddProvider() {
    return providersActions.beginAddProvider(this)
  }

  cancelAddProvider() {
    return providersActions.cancelAddProvider(this)
  }

  cancelProviderSetup() {
    return providersActions.cancelProviderSetup(this)
  }

  /**
   * Detect whether the vault unlocks with device keys or a password envelope.
   */
  async probeLoginUnlockMode(): Promise<void> {
    return localLoginActions.probeLoginUnlockMode(this)
  }

  async refreshPasswordEntriesList(): Promise<boolean> {
    return secretsActions.refreshPasswordEntriesList(this)
  }

  clearRemoteVaultRecovery() {
    return syncActions.clearRemoteVaultRecovery(this)
  }

  /** User chose to restore a deleted remote vault from the browser cache. */
  async confirmRecoverRemoteVault(): Promise<void> {
    return syncActions.confirmRecoverRemoteVault(this)
  }

  /** User chose to create a fresh vault file on remote storage. */
  async confirmCreateFreshRemoteVault(): Promise<void> {
    return syncActions.confirmCreateFreshRemoteVault(this)
  }

  async assessVaultConnectStatus(
    argsOverride?: [string, string, string],
  ): Promise<string> {
    const args =
      argsOverride ??
      (!this.isAuthenticated &&
      this.syncProviders.length > 0 &&
      this.joinEnrollmentPrompt !== 'none'
        ? this.providerWasmArgs(this.syncProviders[0]!)
        : this.wasmStorageArgs())
    return (await this.enqueueStorage(async () => {
      const assessPromise = this.manager!.assess_vault_connect(...args)
      const assessTimeout = new Promise<never>((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(
                'Connection timed out. Check your PAT, network, and try again.',
              ),
            ),
          30_000,
        )
      })
      return (await Promise.race([assessPromise, assessTimeout])) as string
    })) as string
  }

  async handleRemoteVaultAssessStatus(accessStatus: string): Promise<boolean> {
    if (accessStatus === 'remote_missing_local_cache') {
      this.remoteVaultRecoveryPrompt = 'with_cache'
      await this.refreshPasswordEntriesList()
      return true
    }
    if (accessStatus === 'remote_missing') {
      // Empty remote on first provider setup is normal — genesis runs on connect.
      if (this.loginSetupType !== null) {
        return false
      }
      this.remoteVaultRecoveryPrompt = 'missing_only'
      return true
    }
    return false
  }

  /** Clear wasm session + login password preview so UI matches the active provider. */
  resetVaultSessionState() {
    if (this.manager) {
      void this.enqueueStorage(() => this.manager!.resetVaultSession()).catch(
        () => {
          // Engine may be tearing down.
        },
      )
    }
    this.passwordEntries = []
    this.selectedPasswordEntryId = null
    this.loginUnlockMode = 'unknown'
    this.loginPasswordPrompt = false
  }

  ensureIdleSessionTracker() {
    if (this.idleSessionTracker) return
    this.idleSessionTracker = createVaultIdleSessionTracker({
      timeoutMs: resolveVaultIdleTimeoutMs(import.meta.env),
      warningMs: resolveVaultIdleWarningMs(import.meta.env),
      onExpire: () => this.lockVaultDueToIdle(),
      onWarning: () => this.showIdleLockWarning(),
    })
  }

  startIdleSessionTracking() {
    return idleSessionActions.startIdleSessionTracking(this)
  }

  stopIdleSessionTracking() {
    return idleSessionActions.stopIdleSessionTracking(this)
  }

  showIdleLockWarning() {
    if (!this.isAuthenticated) return
    this.showSuccess(this.t('session.idle_warning'))
  }

  lockVaultDueToIdle() {
    if (!this.isAuthenticated) return
    this.sessionExpiredByIdle = true
    this.lockVault()
  }

  markVaultUnlocked() {
    setVaultSessionLocked(false)
    this.isAuthenticated = true
    this.awaitingJoinApproval = false
    this.sessionExpiredByIdle = false
    vaultLog.info('vault session unlocked', { secrets: this.secrets.length })
  }

  clearUnlockedSession() {
    this.stopIdleSessionTracking()
    this.stopVaultSync()
    this.isAuthenticated = false
    this.secrets = []
    this.pendingJoins = []
    this.vaultMembers = []
    this.joinEnrollmentPrompt = 'none'
    this.enrollSecretsKey = ''
    this.enrollMembersKey = ''
    this.settingsOpen = false
    this.enrollmentCode = ''
    this.errorMsg = ''
    this.resetVaultSessionState()
  }

  /** Drop a saved sync provider from this browser. Local vault row cannot be removed. */
  async removeProvider(id: string): Promise<void> {
    return providersActions.removeProvider(this, id)
  }

  async ensureProviderSaved(): Promise<boolean> {
    return providersActions.ensureProviderSaved(this)
  }

  startVaultSync() {
    return syncActions.startVaultSync(this)
  }

  stopVaultSync() {
    return syncActions.stopVaultSync(this)
  }

  applyVaultSyncResult(result: NookVaultSyncResult) {
    if (this.isAuthenticated) {
      if (result.secrets.length > 0) {
        this.secrets = result.secrets
      }
      this.pendingJoins = result.pendingJoins
      this.vaultMembers = result.vaultMembers
      return
    }

    vaultLog.debug('sync result (unauthenticated)', {
      changed: result.changed,
      accessStatus: result.accessStatus,
      joinEnrollmentPrompt: this.joinEnrollmentPrompt,
    })

    if (!result.changed) return

    if (result.accessStatus) {
      vaultLog.info('sync state changed (login gate)', {
        accessStatus: result.accessStatus,
        pendingJoins: result.pendingJoins.length,
      })
    }

    if (
      result.accessStatus === 'ready' &&
      this.joinEnrollmentPrompt === 'pending'
    ) {
      this.joinEnrollmentPrompt = 'none'
      this.showSuccess(this.t('toasts.device_approved'))
      this.scheduleAutoConnectAfterApproval()
    } else if (result.accessStatus === 'ready' && this.awaitingJoinApproval) {
      // Joiner whose approval landed after the join dialog was dismissed:
      // sync says the remote vault is ready for this device, so unlock it
      // instead of leaving the user stranded on the login gate.
      this.scheduleAutoConnectAfterApproval()
    } else if (
      result.accessStatus === 'join_pending' &&
      this.joinEnrollmentPrompt === 'none'
    ) {
      this.joinEnrollmentPrompt = 'pending'
      this.awaitingJoinApproval = true
    }
  }

  /** Connect once the remote reports this device enrolled (post-approval). */
  private scheduleAutoConnectAfterApproval() {
    if (this.isAuthenticated || this.isVerifying || this.loginPasswordPrompt) {
      return
    }
    // Never auto-unlock a session the user (or idle timer) explicitly locked.
    if (this.sessionExpiredByIdle || isVaultSessionLocked()) {
      return
    }
    vaultLog.info('scheduling auto-connect after join approval')
    // Fire-and-forget outside the sync call stack: loadDb serializes wasm
    // access through the storage chain and guards itself with isVerifying.
    setTimeout(() => {
      if (this.isAuthenticated || this.isVerifying) return
      void this.loadDb()
    }, 0)
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
    if (!this.manager || !this.isAuthenticated) return
    const mergedJoins: JoinRequest[] = []
    try {
      for (const provider of this.syncProviders) {
        if (provider.type === 'local-folder') {
          await syncLocalFolderProvider(this, provider)
          continue
        }
        const [mode, pat, repo] = this.providerWasmArgs(provider)
        const joins = (await this.enqueueStorage(() =>
          this.manager!.mergeRemoteJoinsFromProvider(mode, pat, repo),
        )) as JoinRequest[]
        if (joins.length > 0) {
          mergedJoins.push(...joins)
        }
      }
    } catch {
      // Merge can fail transiently while wasm is busy; still read session joins.
    }
    try {
      const snapshot = await this.enqueueStorage(async () => {
        await Promise.resolve()
        try {
          await this.manager!.ensureVaultRosterHydrated()
        } catch {
          // Roster repair is best-effort; still read the current session.
        }
        let pendingJoins: JoinRequest[]
        let vaultMembers: VaultMember[]
        try {
          pendingJoins = this.manager!.list_pending_joins()
        } catch {
          pendingJoins = []
        }
        try {
          vaultMembers = this.manager!.list_vault_members()
        } catch {
          vaultMembers = []
        }
        return {
          pendingJoins,
          vaultMembers,
          unlockMode: this.manager!.vaultUnlockMode(),
        }
      })
      this.pendingJoins =
        snapshot.pendingJoins.length > 0 ? snapshot.pendingJoins : mergedJoins
      this.vaultMembers = snapshot.vaultMembers
      this.unlockMode = 'keys'
      await this.refreshPasswordEntriesList()
    } catch {
      this.vaultMembers = []
      this.unlockMode = 'keys'
    }
  }

  async refreshPasswordEnvelopeState(): Promise<void> {
    await this.refreshPasswordEntriesList()
  }

  async syncFromStorage(options?: { force?: boolean }) {
    return syncActions.syncFromStorage(this, options)
  }

  /** Pull local vault from every sync provider (background / manual refresh). */
  async syncFromSyncProviders(options?: {
    quiet?: boolean
    force?: boolean
  }): Promise<void> {
    if (!this.manager) return
    if (this.syncBlocked) return
    if (!options?.force && this.isVerifying) return
    if (!options?.force && this.isSaving) return
    if (!options?.force && this.isPasswordBusy) return
    if (!options?.force && this.isSyncing) return
    if (this.syncProviders.length === 0) return

    this.isSyncing = true
    try {
      for (const provider of this.syncProviders) {
        if (this.syncBlocked) break
        await this.syncProviderById(provider.id, {
          quiet: options?.quiet ?? true,
        })
      }
      if (this.isAuthenticated) {
        await this.hydrateMultiDeviceState()
      }
      this.lastSyncedAt = new SvelteDate()
    } catch {
      // Background sync should not interrupt the UI.
    } finally {
      this.isSyncing = false
    }
  }

  async manualSync() {
    return syncActions.manualSync(this)
  }

  /** Sync local event log with one provider. */
  async syncProviderById(
    providerId: string,
    options?: { quiet?: boolean },
  ): Promise<void> {
    return syncActions.syncProviderById(this, providerId, options)
  }

  fanOutSyncChain: Promise<void> = Promise.resolve()

  /** Push the local vault to every connected sync provider (after CRUD or manual sync). */
  async fanOutSyncToProviders(options?: { quiet?: boolean }): Promise<void> {
    return syncActions.fanOutSyncToProviders(this, options)
  }

  async runFanOutSyncToProviders(options?: { quiet?: boolean }): Promise<void> {
    if (this.isFanOutSyncing) return

    this.isFanOutSyncing = true
    try {
      for (const provider of this.syncProviders) {
        if (this.syncBlocked) break
        await this.syncProviderById(provider.id, {
          quiet: options?.quiet ?? true,
        })
      }
    } finally {
      this.isFanOutSyncing = false
    }
  }

  async runFanOutSyncAfterLocalSave(): Promise<void> {
    if (this.syncProviders.length === 0) {
      await this.flushRemoteEventOutboxNow()
      return
    }
    for (const provider of this.syncProviders) {
      if (this.syncBlocked) break
      await this.flushRemoteEventOutboxNow(provider)
    }
  }

  scheduleFanOutSyncAfterLocalSave(): void {
    void this.runFanOutSyncAfterLocalSave()
  }

  remoteEventProviderArgs(
    provider?: StorageProvider,
  ): [string, string, string] | null {
    if (provider?.type === 'local-folder') {
      return null
    }
    if (provider) {
      return this.providerWasmArgs(provider)
    }
    if (this.syncProviders[0]?.type === 'local-folder') {
      return null
    }
    if (this.syncProviders.length > 0) {
      return this.providerWasmArgs(this.syncProviders[0]!)
    }
    if (this.hasRemoteCredentials()) {
      return this.wasmStorageArgs()
    }
    return null
  }

  async updateProviderSyncMetadata(
    providerId: string,
    yaml: string,
    revision: string | null,
  ): Promise<void> {
    const version = await readVaultVersionFromBlob(yaml)
    // `vaultStoreId` borrows the wasm manager; read it through the storage chain
    // so it can't alias an in-flight `&mut self` op (recursive-borrow hang).
    const managerStoreId = this.manager
      ? await this.enqueueStorage(() => this.manager!.vaultStoreId)
      : ''
    this.providers = this.providers.map((p) =>
      p.id === providerId
        ? {
            ...p,
            lastSyncedAt: isoTimestamp(),
            lastSyncedVersion: version || p.lastSyncedVersion,
            lastSyncRevision: revision ?? p.lastSyncRevision,
            lastCommonContentHash: vaultBlobContentHash(yaml),
            storeId: managerStoreId || p.storeId,
          }
        : p,
    )
    await this.persistProviders()
    this.lastSyncedAt = new SvelteDate()
  }

  async refreshReplacementConflicts(): Promise<void> {
    return syncActions.refreshReplacementConflicts(this)
  }

  async resolveReplacementConflict(
    oldSecretId: string,
    chosenSecretId: string,
  ): Promise<void> {
    if (!this.manager || this.isSaving) return
    this.isSaving = true
    this.errorMsg = ''
    try {
      const raw = await this.enqueueStorage(() =>
        this.manager!.resolveProjectionConflict(oldSecretId, chosenSecretId),
      )
      this.secrets = raw as NookSecretRecord[]
      await this.refreshReplacementConflicts()
      this.scheduleFanOutSyncAfterLocalSave()
      this.showSuccess('Secret conflict resolved.')
    } catch (error: unknown) {
      this.errorMsg =
        error instanceof Error ? error.message : 'Could not resolve conflict.'
    } finally {
      this.isSaving = false
    }
  }

  async stageVaultSyncConflict(
    conflict: Omit<
      PendingSyncConflict,
      'localVersion' | 'remoteVersion' | 'kind'
    > &
      Pick<PendingSyncConflict, 'kind' | 'localStoreId' | 'remoteStoreId'>,
  ): Promise<void> {
    const localVersion = await readVaultVersionFromBlob(conflict.localYaml)
    const remoteVersion = await readVaultVersionFromBlob(conflict.remoteYaml)
    this.pendingSyncConflict = {
      ...conflict,
      kind: conflict.kind ?? 'content',
      localVersion,
      remoteVersion,
    }
    this.errorMsg = ''
  }

  clearPendingSyncConflict() {
    this.pendingSyncConflict = null
  }

  /** E2E / dev: open the conflict dialog without reaching remote storage. */
  stageSyncConflict(conflict: PendingSyncConflict) {
    return syncActions.stageSyncConflict(this, conflict)
  }

  async resolveSyncConflictImportRemote(): Promise<void> {
    return syncActions.resolveSyncConflictImportRemote(this)
  }

  async resolveSyncConflictKeepLocal(): Promise<void> {
    return syncActions.resolveSyncConflictKeepLocal(this)
  }

  async resolveSyncConflictKeepRemote(): Promise<void> {
    return syncActions.resolveSyncConflictKeepRemote(this)
  }

  finishStagedProviderConnectAfterConflict(
    conflict: PendingSyncConflict,
  ): void {
    if (conflict.providerId !== '__pending_provider__') {
      return
    }
    this.loginSetupType = null
    this.addProviderOpen = false
  }

  async ensureProviderSavedAfterConflict(
    conflict: PendingSyncConflict,
  ): Promise<string> {
    if (
      conflict.providerId !== '__pending_provider__' &&
      this.providers.some((p) => p.id === conflict.providerId)
    ) {
      return conflict.providerId
    }
    const saved = await this.ensureProviderSaved()
    if (!saved) {
      throw new Error(this.t('auth_storage.duplicate_sync_provider'))
    }
    const provider =
      this.syncProviders[this.syncProviders.length - 1] ??
      this.providers[this.providers.length - 1]
    if (!provider || provider.type === 'local') {
      throw new Error('Choose a cloud sync provider.')
    }
    return provider.id
  }

  async reloadSessionFromLocal(): Promise<void> {
    if (!this.manager) return
    const raw = await this.enqueueStorage(() =>
      this.manager!.sync_vault_from_storage('local', '', ''),
    )
    this.applyVaultSyncResult(raw)
    await this.refreshSecretsFromSession()
    await this.hydrateMultiDeviceState()
  }

  /** Settings: connect a new sync provider and reconcile with local vault. */
  async connectAndSyncStagedProvider(): Promise<void> {
    return providersActions.connectAndSyncStagedProvider(this)
  }

  openSettings(
    section: 'storage' | 'onboard' | 'admin' = 'storage',
    accordion: 'devices' | 'language' = 'devices',
  ) {
    this.helpOpen = false
    this.settingsSection = section
    if (section === 'storage') {
      this.cancelProviderSetup()
      this.cancelAddProvider()
      this.settingsAccordionSection = accordion
    }
    this.settingsOpen = true
    void this.refreshDeviceState()
  }

  openAdmin(accordion: 'vaults' | 'storage' | 'passwords' = 'vaults') {
    this.helpOpen = false
    this.cancelProviderSetup()
    this.cancelAddProvider()
    this.adminAccordionSection = accordion
    this.settingsSection = 'admin'
    this.settingsOpen = true
    void this.refreshLocalVaultCatalog()
    void this.refreshDeviceState()
  }

  closeSettings() {
    this.cancelProviderSetup()
    this.cancelAddProvider()
    this.settingsOpen = false
  }

  /** End the in-memory session and return to the login gate (encrypted vault + sync providers stay on disk). */
  lockVault() {
    this.beginLoginVaultPicker()
    return idleSessionActions.lockVault(this)
  }

  openHelp() {
    this.settingsOpen = false
    this.helpOpen = true
  }

  closeHelp() {
    this.helpOpen = false
  }

  filterSecrets(query: string): NookSecretRecord[] {
    return secretsActions.filterSecrets(this, query)
  }

  async refreshSecretsFromSession() {
    if (!this.manager) {
      this.secrets = []
      return
    }
    // `filter_secrets` borrows the wasm manager; route it through the storage
    // chain so a background sync's refresh can't alias an in-flight foreground
    // `&mut self` op (delete/add) and trigger a recursive-borrow hang.
    this.secrets = await this.enqueueStorage(() =>
      this.manager!.filter_secrets(''),
    )
  }

  async refreshDeviceState() {
    return multiDeviceActions.refreshDeviceState(this)
  }

  /** Refresh event-log joins from providers (manual sync + provider poll). */
  async refreshPendingJoinsFromProviders() {
    return multiDeviceActions.refreshPendingJoinsFromProviders(this)
  }

  async requestVaultAccess() {
    return multiDeviceActions.requestVaultAccess(this)
  }

  async approveJoin(joinDeviceId: string) {
    return multiDeviceActions.approveJoin(this, joinDeviceId)
  }

  async denyJoin(joinDeviceId: string) {
    return multiDeviceActions.denyJoin(this, joinDeviceId)
  }

  async renameDevice(authId: string, label: string) {
    return multiDeviceActions.renameDevice(this, authId, label)
  }

  async revokeDevice(authId: string) {
    return multiDeviceActions.revokeDevice(this, authId)
  }

  async createFreshVault() {
    return lifecycleActions.createFreshVault(this)
  }

  async enrollAndConnect() {
    return multiDeviceActions.enrollAndConnect(this)
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
    )
  }

  async connectStagedProvider(): Promise<void> {
    return providersActions.connectStagedProvider(this)
  }

  async loadDb() {
    return secretsActions.loadDb(this)
  }

  async promoteSessionVaultToLocalIfNeeded(): Promise<void> {
    const { snapshot, migrated } = await ensureLocalAuthProviderSnapshot({
      providers: this.providers,
    })
    if (migrated || snapshot.providers.length !== this.providers.length) {
      this.providers = snapshot.providers
      await this.enqueueStorage(() =>
        saveAuthProviders(this.manager!, snapshot),
      )
    }
    this.localVaultPresent = await hasLocalVault()
    if (this.localVaultPresent) {
      this.storageMode = 'local'
      this.githubPat = ''
      this.oauthFile = null
      this.localFolder = null
    }
  }

  async addVaultPassword(label: string, password: string): Promise<void> {
    return passwordUnlockActions.addVaultPassword(this, label, password)
  }

  async updateVaultPasswordEntry(
    entryId: string,
    password: string,
  ): Promise<void> {
    return passwordUnlockActions.updateVaultPasswordEntry(
      this,
      entryId,
      password,
    )
  }

  async removeVaultPasswordEntry(entryId: string): Promise<void> {
    return passwordUnlockActions.removeVaultPasswordEntry(this, entryId)
  }

  /** @deprecated Use addVaultPassword — kept for older callers. */
  async setVaultPassword(password: string): Promise<void> {
    return passwordUnlockActions.setVaultPassword(this, password)
  }

  async removeVaultPassword(): Promise<void> {
    return passwordUnlockActions.removeVaultPassword(this)
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
    entryId: string,
    password: string,
    providerId = this.syncProviders[0]?.id ?? '',
  ): Promise<string> {
    return passwordUnlockActions.issueEnrollmentCode(
      this,
      entryId,
      password,
      providerId,
    )
  }

  clearEnrollmentCode() {
    return passwordUnlockActions.clearEnrollmentCode(this)
  }

  /**
   * Unlock the vault with a labelled password entry.
   */
  async unlockWithPassword(entryId: string, password: string): Promise<void> {
    return passwordUnlockActions.unlockWithPassword(this, entryId, password)
  }

  /**
   * Joining-side: parse an enrollment code, restore provider credentials, and
   * self-enrol via `connectWithPassword`. Skips approval entirely.
   */
  async connectWithEnrollmentCode(code: string, password = ''): Promise<void> {
    return passwordUnlockActions.connectWithEnrollmentCode(this, code, password)
  }

  async handleAddSecret(id: string, type: VaultItemType, data: string) {
    return secretsActions.handleAddSecret(this, id, type, data)
  }

  scheduleRemoteEventOutboxFlush(): void {
    void this.flushRemoteEventOutboxNow()
  }

  async flushRemoteEventOutboxNow(provider?: StorageProvider): Promise<void> {
    if (!this.manager) return
    const folderProvider =
      provider?.type === 'local-folder'
        ? provider
        : !provider && this.syncProviders[0]?.type === 'local-folder'
          ? this.syncProviders[0]
          : null
    if (folderProvider) {
      try {
        await syncLocalFolderProvider(this, folderProvider)
      } catch (error) {
        vaultLog.warn('local backup sync skipped', {
          providerId: folderProvider.id,
          message: error instanceof Error ? error.message : String(error),
        })
      }
      return
    }
    const args = this.remoteEventProviderArgs(provider)
    if (!args) return
    try {
      await this.enqueueStorage(() =>
        this.manager!.flushEventOutboxForProvider(...args),
      )
    } catch (error) {
      vaultLog.warn('event outbox flush skipped', {
        providerId: provider?.id ?? 'active',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async handleDeleteSecret(id: string) {
    return secretsActions.handleDeleteSecret(this, id)
  }

  async handleReplaceSecret(oldId: string, type: VaultItemType, data: string) {
    return secretsActions.handleReplaceSecret(this, oldId, type, data)
  }
}
