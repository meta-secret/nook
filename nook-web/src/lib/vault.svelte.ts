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
  DEFAULT_DRIVE_VAULT_FILE,
  DEFAULT_GITHUB_REPO,
  formatDriveStorageRef,
  providerDefaultLabel,
  saveAuthProviders,
  wasmStorageModeForProvider,
  type OAuthFileConfig,
  type OAuthFilePreset,
  type StorageProvider,
  type StorageProviderType,
} from '$lib/auth-providers'
import {
  getBrowserAppLocale,
  parseAppLocale,
  type AppLocale,
} from '$lib/locale'
import { TRANSLATION_CATALOGS, lookupTranslation } from '$lib/locale-catalogs'
import { hasLocalVault } from '$lib/local-vault'
import { migrateLegacyVaultToLocal } from '$lib/vault-migration'
import {
  attemptReconcileVaultSyncBlobs,
  fetchRemoteVaultBlob,
  parseVaultStoreIdMismatch,
  readLocalVaultBlob,
  readVaultVersionFromBlob,
  resolveVaultSyncIntervalMs,
  writeLocalVaultBlob,
  writeRemoteVaultBlob,
  type PendingSyncConflict,
  type ReconcileVaultResult,
} from '$lib/vault-sync'
import {
  createVaultIdleSessionTracker,
  resolveVaultIdleTimeoutMs,
  resolveVaultIdleWarningMs,
  type VaultIdleSessionTracker,
} from '$lib/vault-idle-session'

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

export class VaultState {
  locale = $state<AppLocale>('en')
  translations = $state<Record<string, unknown>>({})

  settingsOpen = $state(false)
  settingsSection = $state<'storage' | 'onboard'>('storage')
  settingsAccordionSection = $state<
    'storage' | 'passwords' | 'devices' | 'language' | null
  >('storage')
  helpOpen = $state(false)

  providers = $state<StorageProvider[]>([])
  providersLoaded = $state(false)
  /** True when `nook_db.encrypted_db` holds a vault blob (local-first model). */
  localVaultPresent = $state(false)
  localLoginPrepared = $state(false)
  loginSetupType = $state<StorageProviderType | null>(null)
  addProviderOpen = $state(false)

  storageMode = $state<StorageProviderType>('local')
  githubPat = $state('')
  githubRepo = $state(DEFAULT_GITHUB_REPO)
  oauthFile = $state<OAuthFileConfig | null>(null)
  oauthSetupPreset = $state<OAuthFilePreset | null>(null)
  googleOAuthBusy = $state(false)
  icloudOAuthBusy = $state(false)

  manager = $state<NookVaultManager | null>(null)
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
  /** User must pick local vs remote before editing when versions match but content differs. */
  pendingSyncConflict = $state<PendingSyncConflict | null>(null)

  get syncBlocked(): boolean {
    return this.pendingSyncConflict !== null
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
        DEFAULT_DRIVE_VAULT_FILE
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
        DEFAULT_DRIVE_VAULT_FILE
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
          DEFAULT_DRIVE_VAULT_FILE,
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
    if (!this.localVaultPresent) {
      return 'skip'
    }
    const args = this.stagedRemoteStorageArgs()
    if (!args) {
      return 'skip'
    }

    const localYaml = await readLocalVaultBlob()
    if (!localYaml.trim()) {
      return 'skip'
    }

    const [mode, pat, repo] = args
    const remote = await fetchRemoteVaultBlob(mode, pat, repo)
    if (!remote.content.trim()) {
      return 'ok'
    }

    try {
      return await this.reconcileStagedRemoteWithLocalBlobs({
        localYaml,
        remote,
        mode,
        pat,
        repo,
        options,
      })
    } catch (error: unknown) {
      const mismatch = parseVaultStoreIdMismatch(error)
      if (!mismatch) {
        throw error
      }
      await this.stageVaultSyncConflict({
        providerId:
          options?.providerId ??
          this.syncProviders[this.syncProviders.length - 1]?.id ??
          '__pending_provider__',
        providerLabel: this.stagedProviderLabel(),
        localYaml,
        remoteYaml: remote.content,
        mode,
        pat,
        repo,
        remoteRevision: remote.revision,
        kind: 'store_id',
        localStoreId: mismatch.localStoreId,
        remoteStoreId: mismatch.remoteStoreId,
      })
      return 'conflict'
    }
  }

  async reconcileStagedRemoteWithLocalBlobs(ctx: {
    localYaml: string
    remote: Awaited<ReturnType<typeof fetchRemoteVaultBlob>>
    mode: string
    pat: string
    repo: string
    options?: { providerId?: string; quiet?: boolean }
  }): Promise<'ok' | 'conflict'> {
    const { localYaml, remote, mode, pat, repo, options } = ctx

    const attempt = attemptReconcileVaultSyncBlobs(
      localYaml,
      remote.content,
      remote.revision,
    )
    if (attempt.status === 'store_id_mismatch') {
      await this.stageVaultSyncConflict({
        providerId:
          options?.providerId ??
          this.syncProviders[this.syncProviders.length - 1]?.id ??
          '__pending_provider__',
        providerLabel: this.stagedProviderLabel(),
        localYaml,
        remoteYaml: remote.content,
        mode,
        pat,
        repo,
        remoteRevision: remote.revision,
        kind: 'store_id',
        localStoreId: attempt.localStoreId,
        remoteStoreId: attempt.remoteStoreId,
      })
      return 'conflict'
    }

    const reconcile = attempt.result

    if (reconcile.action === 'conflict') {
      await this.stageVaultSyncConflict({
        providerId:
          options?.providerId ??
          this.syncProviders[this.syncProviders.length - 1]?.id ??
          '__pending_provider__',
        providerLabel: this.stagedProviderLabel(),
        localYaml: reconcile.localYaml,
        remoteYaml: reconcile.remoteYaml,
        mode,
        pat,
        repo,
        remoteRevision: remote.revision,
        kind: 'content',
      })
      return 'conflict'
    }

    await this.applyReconcileResult(
      reconcile,
      {
        providerId:
          options?.providerId ??
          this.syncProviders[this.syncProviders.length - 1]?.id ??
          '__pending_provider__',
        remote,
        mode,
        pat,
        repo,
      },
      { quiet: options?.quiet ?? false },
    )
    return 'ok'
  }

  hasRemoteCredentials(): boolean {
    if (this.storageMode === 'github') {
      return Boolean(this.githubPat.trim())
    }
    if (this.storageMode === 'oauth-file') {
      return Boolean(this.oauthFile?.accessToken?.trim())
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
    return this.providers.find((p) => p.type === 'local') ?? null
  }

  /** Canonical on-device vault row — alias kept while settings code migrates. */
  get activeProvider(): StorageProvider | null {
    return this.localProvider
  }

  /** Cloud sync destinations — local vault is always canonical and omitted. */
  get syncProviders(): StorageProvider[] {
    return this.providers.filter((p) => p.type !== 'local')
  }

  providerWasmArgs(provider: StorageProvider): [string, string, string] {
    const mode = wasmStorageModeForProvider(
      provider.type,
      provider.oauthFile?.preset,
    )
    if (provider.type === 'oauth-file') {
      const fileName =
        provider.oauthFile?.fileName?.trim() || DEFAULT_DRIVE_VAULT_FILE
      return [
        mode,
        provider.oauthFile?.accessToken?.trim() ?? '',
        formatDriveStorageRef(provider.oauthFile?.fileId, fileName),
      ]
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
    this.isInitializing = true
    if (!this.isVerifying) {
      this.errorMsg = ''
    }
    try {
      const savedLocale = parseAppLocale(localStorage.getItem('nook_locale'))
      const browserLocale = getBrowserAppLocale()
      const locale = savedLocale ?? browserLocale
      await this.updateLocale(locale)

      await this.loadProviders({ migrateLegacyVault: true })
      this.localVaultPresent = await hasLocalVault()
      if (this.localVaultPresent) {
        this.storageMode = 'local'
        this.githubPat = ''
        this.oauthFile = null
      } else {
        this.applyActiveProviderCredentials()
      }
      this.manager = await getVaultManager()
      await this.updateLocale(locale, { preferWasm: true })
      await this.initDeviceIdentity()
    } catch (error) {
      this.errorMsg =
        error instanceof Error
          ? error.message
          : 'Failed to initialize Nook Session Manager.'
    } finally {
      this.isInitializing = false
    }

    const hasPendingEnrollment = Boolean(this.pendingEnrollmentFromUrl)
    if (this.localVaultPresent && this.manager) {
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
  }

  async initDeviceIdentity() {
    if (!this.manager) return
    try {
      await this.enqueueStorage(() => this.manager!.init_device())
      this.deviceId = this.manager.device_id
      this.devicePublicKey = this.manager.device_public_key
    } catch {
      // Device identity is optional until first connect/join action.
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
  async createLocalVaultWithDeviceKeys(): Promise<void> {
    return localLoginActions.createLocalVaultWithDeviceKeys(this)
  }

  /** @deprecated Use {@link createLocalVaultWithDeviceKeys}. Backup passwords belong in Settings. */
  async createLocalVault(password: string): Promise<void> {
    return localLoginActions.createLocalVault(this, password)
  }

  async loadProviders(options?: { migrateLegacyVault?: boolean }) {
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

  async assessVaultConnectStatus(): Promise<string> {
    const args =
      !this.isAuthenticated &&
      this.syncProviders.length > 0 &&
      this.joinEnrollmentPrompt !== 'none'
        ? this.providerWasmArgs(this.syncProviders[0]!)
        : this.wasmStorageArgs()
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
    try {
      this.manager?.resetVaultSession()
    } catch {
      // Engine not ready yet.
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
    this.sessionExpiredByIdle = false
    this.startIdleSessionTracking()
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

    if (!result.changed) return

    if (
      result.accessStatus === 'ready' &&
      this.joinEnrollmentPrompt === 'pending'
    ) {
      this.joinEnrollmentPrompt = 'none'
      this.showSuccess(this.t('toasts.device_approved'))
    } else if (
      result.accessStatus === 'join_pending' &&
      this.joinEnrollmentPrompt === 'none'
    ) {
      this.joinEnrollmentPrompt = 'pending'
    }
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

  /** Reconcile local vault with one sync provider using `reconcileVaultBlobs`. */
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
    await this.pushRemoteYamlSnapshotNow()
    await this.flushRemoteEventOutboxNow()
  }

  scheduleFanOutSyncAfterLocalSave(): void {
    void this.runFanOutSyncAfterLocalSave()
  }

  /** Fire-and-forget YAML projection for providers that still read nook-vault.yaml. */
  scheduleRemoteYamlSnapshotPush(): void {
    void this.pushRemoteYamlSnapshotNow()
  }

  remoteYamlSnapshotStorageArgs(): [string, string, string] | null {
    if (this.syncProviders.length > 0) {
      return this.providerWasmArgs(this.syncProviders[0]!)
    }
    if (this.hasRemoteCredentials()) {
      return this.wasmStorageArgs()
    }
    return null
  }

  async pushRemoteYamlSnapshotNow(): Promise<void> {
    if (!this.manager) return
    const args = this.remoteYamlSnapshotStorageArgs()
    if (!args) return
    await this.enqueueStorage(() =>
      this.manager!.pushRemoteVaultYamlSnapshotForProvider(...args),
    )
  }

  async applyReconcileResult(
    result: ReconcileVaultResult,
    ctx: {
      providerId: string
      remote: Awaited<ReturnType<typeof fetchRemoteVaultBlob>>
      mode: string
      pat: string
      repo: string
    },
    options?: { quiet?: boolean },
  ): Promise<void> {
    const { providerId, remote, mode, pat, repo } = ctx
    const quiet = options?.quiet ?? false

    if (result.action === 'conflict') {
      await this.stageVaultSyncConflict({
        providerId,
        providerLabel:
          this.providers.find((p) => p.id === providerId)?.label ?? providerId,
        localYaml: result.localYaml,
        remoteYaml: result.remoteYaml,
        mode,
        pat,
        repo,
        remoteRevision: remote.revision,
        kind: 'content',
      })
      return
    }

    if (result.action === 'adopt_remote') {
      // Reconcile can start from a stale local read while a mutation (e.g.
      // addVaultPassword) is still landing in IndexedDB, or an in-flight
      // background sync can finish after a newer local save. Re-read local
      // before adopting remote so we never clobber a fresher local copy.
      const freshLocal = await readLocalVaultBlob()
      if (freshLocal.trim()) {
        const retry = attemptReconcileVaultSyncBlobs(
          freshLocal,
          remote.content,
          remote.revision,
        )
        if (retry.status === 'store_id_mismatch') {
          await this.stageVaultSyncConflict({
            providerId,
            providerLabel:
              this.providers.find((p) => p.id === providerId)?.label ??
              providerId,
            localYaml: freshLocal,
            remoteYaml: remote.content,
            mode,
            pat,
            repo,
            remoteRevision: remote.revision,
            kind: 'store_id',
            localStoreId: retry.localStoreId,
            remoteStoreId: retry.remoteStoreId,
          })
          return
        }
        if (retry.result.action !== 'adopt_remote') {
          await this.applyReconcileResult(retry.result, ctx, options)
          return
        }
      }

      await writeLocalVaultBlob(result.localYaml)
      if (this.isAuthenticated) {
        await this.reloadSessionFromLocal()
      }
    } else if (result.action === 'push_local') {
      const revision = await writeRemoteVaultBlob(
        mode,
        pat,
        repo,
        result.remoteYaml,
        remote.revision,
      )
      await this.updateProviderSyncMetadata(
        providerId,
        result.localYaml,
        revision,
      )
      if (!quiet) {
        this.showSuccess(this.t('auth_storage.sync_pushed'))
      }
      return
    }

    await this.updateProviderSyncMetadata(
      providerId,
      result.localYaml,
      remote.revision,
    )
    if (!quiet) {
      if (result.action === 'unchanged') {
        this.showSuccess(this.t('auth_storage.sync_up_to_date'))
      } else {
        this.showSuccess(this.t('auth_storage.sync_pulled'))
      }
    }
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
    section: 'storage' | 'onboard' = 'storage',
    accordion: 'storage' | 'passwords' | 'devices' | 'language' = 'storage',
  ) {
    this.helpOpen = false
    this.settingsSection = section
    if (section !== 'onboard') {
      this.settingsAccordionSection = accordion
    }
    this.settingsOpen = true
    void this.refreshDeviceState()
  }

  closeSettings() {
    this.settingsOpen = false
  }

  /** End the in-memory session and return to the login gate (encrypted vault + sync providers stay on disk). */
  lockVault() {
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

  /** Merge remote YAML join rows into the session (manual sync + provider poll). */
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
    const { snapshot, migrated } = await migrateLegacyVaultToLocal({
      providers: this.providers,
    })
    if (migrated || snapshot.providers.length !== this.providers.length) {
      this.providers = snapshot.providers
      await saveAuthProviders(snapshot)
    }
    this.localVaultPresent = await hasLocalVault()
    if (this.localVaultPresent) {
      this.storageMode = 'local'
      this.githubPat = ''
      this.oauthFile = null
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

  async flushRemoteEventOutboxNow(): Promise<void> {
    if (!this.manager) return
    const args = this.remoteYamlSnapshotStorageArgs()
    if (!args) return
    try {
      await this.enqueueStorage(() =>
        this.manager!.flushEventOutboxForProvider(...args),
      )
    } catch {
      // Best-effort — YAML snapshot push carries the legacy projection.
    }
  }

  async handleDeleteSecret(id: string) {
    return secretsActions.handleDeleteSecret(this, id)
  }

  async handleReplaceSecret(oldId: string, type: VaultItemType, data: string) {
    return secretsActions.handleReplaceSecret(this, oldId, type, data)
  }
}
