import {
  generateId,
  getVaultManager,
  isoTimestamp,
  type JoinRequest,
  type NookSecretRecord,
  type NookVaultSyncResult,
  type VaultItemType,
  type VaultMember,
} from '$lib/nook'
import {
  consumeEnrollmentFromLocation,
  decryptEnrollmentPayload,
  encryptEnrollmentPayload,
  type EnrollmentIssueInput,
  type EnrollmentProvider,
} from '$lib/enrollment-code'
import { SvelteDate } from 'svelte/reactivity'
import type { NookVaultManager } from '$lib/nook-wasm/nook_wasm'
import type { VaultPasswordEntrySummary } from '$lib/vault-password'
import { isVaultSessionLocked, setVaultSessionLocked } from '$lib/vault-session'
import {
  DEFAULT_DRIVE_VAULT_FILE,
  DEFAULT_GITHUB_REPO,
  findDuplicateSyncProvider,
  formatDriveStorageRef,
  loadAuthProviders,
  loadAuthProvidersWithVaultMigration,
  providerDefaultLabel,
  saveAuthProviders,
  wasmStorageModeForProvider,
  type OAuthFileConfig,
  type OAuthFilePreset,
  type StorageProvider,
  type StorageProviderType,
} from '$lib/auth-providers'
import {
  ensureValidOAuthFileConfig,
  fetchGoogleAccountEmail,
  initGoogleAuth,
  isGoogleOAuthConfigured,
  oauthTokensToConfig,
  requestGoogleAccessToken,
  type GoogleOAuthTokens,
} from '$lib/google-oauth'
import {
  ensureValidICloudOAuthFileConfig,
  fetchICloudAccountEmail,
  initICloudAuth,
  isICloudOAuthConfigured,
  oauthTokensToICloudConfig,
  requestICloudWebAuthToken,
  type ICloudOAuthTokens,
} from '$lib/icloud-oauth'
import {
  getBrowserAppLocale,
  parseAppLocale,
  type AppLocale,
} from '$lib/locale'
import {
  TRANSLATION_CATALOGS,
  loadTranslationCatalogFromWasm,
  lookupTranslation,
  resolveTranslationCatalog,
} from '$lib/locale-catalogs'
import { hasLocalVault } from '$lib/local-vault'
import {
  ensureLocalProviderRow,
  migrateLegacyVaultToLocal,
} from '$lib/vault-migration'
import {
  attemptReconcileVaultSyncBlobs,
  fetchRemoteVaultBlob,
  parseVaultStoreIdMismatch,
  readLocalVaultBlob,
  readVaultVersionFromBlob,
  resolveVaultSyncIntervalMs,
  resolveVaultSyncConflictKeepLocal,
  resolveVaultSyncConflictKeepRemote,
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
  private static syncIntervalMs(): number {
    return resolveVaultSyncIntervalMs(import.meta.env)
  }

  private successDismissTimer: ReturnType<typeof setTimeout> | null = null
  private idleSessionTracker: VaultIdleSessionTracker | null = null
  private syncTimer: ReturnType<typeof setInterval> | null = null
  private initPromise: Promise<void> | null = null
  private storageChain: Promise<unknown> = Promise.resolve()
  private pendingEnrollmentFromUrl: string | null =
    typeof window !== 'undefined' ? consumeEnrollmentFromLocation() : null

  private enqueueStorage<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.storageChain.then(() => operation())
    this.storageChain = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  /** E2E/dev: wait for the serialized wasm storage queue to finish. */
  waitForStorageChain(): Promise<void> {
    return this.storageChain.then(() => undefined)
  }

  /** E2E/dev: reset a stuck storage queue (abandons in-flight wasm work). */
  resetStorageChain(): void {
    this.storageChain = Promise.resolve()
  }

  private static storageOpTimeoutMs = 20_000

  private raceStorageTimeout<T>(
    promise: Promise<T>,
    label: string,
  ): Promise<T> {
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

  private wasmStorageArgs(): [string, string, string] {
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
  private connectStorageArgs(): [string, string, string] {
    if (
      !this.isAuthenticated &&
      this.syncProviders.length > 0 &&
      this.joinEnrollmentPrompt !== 'none'
    ) {
      return this.providerWasmArgs(this.syncProviders[0]!)
    }
    return this.wasmStorageArgs()
  }

  private stagedRemoteStorageArgs(): [string, string, string] | null {
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

  private stagedProviderLabel(): string {
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
  private async reconcileStagedRemoteWithLocal(options?: {
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

  private async reconcileStagedRemoteWithLocalBlobs(ctx: {
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

  private hasRemoteCredentials(): boolean {
    if (this.storageMode === 'github') {
      return Boolean(this.githubPat.trim())
    }
    if (this.storageMode === 'oauth-file') {
      return Boolean(this.oauthFile?.accessToken?.trim())
    }
    return true
  }

  private syncOAuthRemoteRefFromManager() {
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
    if (this.storageMode !== 'oauth-file' || !this.oauthFile) {
      return
    }
    const refreshed =
      this.oauthFile.preset === 'icloud'
        ? await ensureValidICloudOAuthFileConfig(this.oauthFile)
        : await ensureValidOAuthFileConfig(this.oauthFile)
    if (
      refreshed.accessToken === this.oauthFile.accessToken &&
      refreshed.expiresAt === this.oauthFile.expiresAt
    ) {
      return
    }
    this.oauthFile = refreshed
    if (this.oauthFile && this.providers.some((p) => p.type === 'oauth-file')) {
      this.providers = this.providers.map((provider) =>
        provider.type === 'oauth-file' &&
        provider.oauthFile?.preset === refreshed.preset
          ? { ...provider, oauthFile: refreshed }
          : provider,
      )
      await this.persistProviders()
    }
  }

  async signInWithGoogle(): Promise<void> {
    if (!isGoogleOAuthConfigured()) {
      this.errorMsg = this.t('provider_setup.google_oauth_unconfigured')
      return
    }
    this.googleOAuthBusy = true
    this.errorMsg = ''
    try {
      await initGoogleAuth()
      const tokens = await requestGoogleAccessToken({ prompt: 'consent' })
      await this.applyGoogleOAuthTokens(tokens)
    } catch (error) {
      this.errorMsg =
        error instanceof Error ? error.message : 'Google sign-in failed.'
    } finally {
      this.googleOAuthBusy = false
    }
  }

  async signInWithICloud(): Promise<void> {
    if (!isICloudOAuthConfigured()) {
      this.errorMsg = this.t('provider_setup.icloud_oauth_unconfigured')
      return
    }
    this.icloudOAuthBusy = true
    this.errorMsg = ''
    try {
      await initICloudAuth()
      const tokens = await requestICloudWebAuthToken()
      await this.applyICloudOAuthTokens(tokens)
    } catch (error) {
      this.errorMsg =
        error instanceof Error ? error.message : 'iCloud sign-in failed.'
    } finally {
      this.icloudOAuthBusy = false
    }
  }

  private async applyICloudOAuthTokens(
    tokens: ICloudOAuthTokens,
  ): Promise<void> {
    const account = await fetchICloudAccountEmail()
    this.loginSetupType = 'oauth-file'
    if (!this.addProviderOpen) {
      this.storageMode = 'oauth-file'
    }
    this.oauthSetupPreset = 'icloud'
    this.oauthFile = oauthTokensToICloudConfig(tokens, {
      preset: 'icloud',
      accessToken: tokens.accessToken,
      fileId: this.oauthFile?.fileId,
      fileName:
        this.oauthFile?.fileName?.trim() ||
        this.githubRepo.trim() ||
        DEFAULT_DRIVE_VAULT_FILE,
      accountEmail: account,
    })
    this.githubPat = ''
    this.githubRepo =
      this.oauthFile.fileName?.trim() || DEFAULT_DRIVE_VAULT_FILE
  }

  private async applyGoogleOAuthTokens(
    tokens: GoogleOAuthTokens,
  ): Promise<void> {
    const email = await fetchGoogleAccountEmail(tokens.accessToken)
    this.loginSetupType = 'oauth-file'
    if (!this.addProviderOpen) {
      this.storageMode = 'oauth-file'
    }
    this.oauthSetupPreset = 'google-drive'
    this.oauthFile = oauthTokensToConfig(tokens, {
      preset: 'google-drive',
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt,
      fileId: this.oauthFile?.fileId,
      fileName:
        this.oauthFile?.fileName?.trim() ||
        this.githubRepo.trim() ||
        DEFAULT_DRIVE_VAULT_FILE,
      accountEmail: email,
    })
    this.githubPat = ''
    this.githubRepo =
      this.oauthFile.fileName?.trim() || DEFAULT_DRIVE_VAULT_FILE
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
    this.joinEnrollmentPrompt = 'none'
  }

  async confirmJoinRequest() {
    if (!this.manager) return
    this.errorMsg = ''
    this.dismissSuccess()
    this.isVerifying = true
    try {
      const storageArgs =
        this.remoteYamlSnapshotStorageArgs() ?? this.wasmStorageArgs()
      await this.enqueueStorage(() =>
        this.manager!.request_vault_access(...storageArgs, isoTimestamp()),
      )
      await this.ensureProviderSaved()
      this.joinEnrollmentPrompt = 'pending'
    } catch (e: unknown) {
      this.errorMsg =
        e instanceof Error ? e.message : 'Failed to request vault access.'
    } finally {
      this.isVerifying = false
    }
  }

  private showSuccess(message: string) {
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
    this.locale = newLocale
    localStorage.setItem('nook_locale', newLocale)
    if (typeof document !== 'undefined') {
      document.documentElement.lang = newLocale
    }

    const preferWasm = options?.preferWasm ?? Boolean(this.manager)
    let wasmCatalog: Record<string, unknown> | undefined
    if (preferWasm) {
      try {
        wasmCatalog = await loadTranslationCatalogFromWasm(newLocale)
      } catch {
        // Fall back to the bundled JSON catalogs only.
      }
    }
    this.translations = resolveTranslationCatalog(newLocale, wasmCatalog)
  }

  private resolveErrorMessage(message: string): string {
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
    if (this.initPromise) {
      return this.initPromise
    }
    this.initPromise = this.initOnce()
    return this.initPromise
  }

  private async initOnce() {
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

  private async initDeviceIdentity() {
    if (!this.manager) return
    try {
      await this.enqueueStorage(() => this.manager!.init_device())
      this.deviceId = this.manager.device_id
      this.devicePublicKey = this.manager.device_public_key
    } catch {
      // Device identity is optional until first connect/join action.
    }
  }

  private shouldAutoUnlock(): boolean {
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
    if (!this.localVaultPresent || this.localLoginPrepared) return
    this.storageMode = 'local'
    this.githubPat = ''
    this.oauthFile = null
    await this.refreshPasswordEntriesList()
    this.localLoginPrepared = true
  }

  /**
   * First-time setup: create an empty local vault secured by this device's keys.
   */
  async createLocalVaultWithDeviceKeys(): Promise<void> {
    if (!this.manager) {
      this.errorMsg = 'Vault engine is not available.'
      return
    }
    if (this.isVerifying) return

    this.errorMsg = ''
    this.dismissSuccess()
    this.storageMode = 'local'
    this.githubPat = ''
    this.oauthFile = null
    this.isVerifying = true

    try {
      await this.initDeviceIdentity()
      const rawRecords = (await this.enqueueStorage(() =>
        this.manager!.connect('local', '', ''),
      )) as NookSecretRecord[]
      this.secrets = rawRecords
      this.markVaultUnlocked()
      this.localVaultPresent = true
      this.localLoginPrepared = true
      await this.ensureProviderSaved()
      await this.hydrateMultiDeviceState()
      this.showSuccess(this.t('toasts.local_loaded'))
      this.startVaultSync()
    } catch (e: unknown) {
      this.isAuthenticated = false
      this.errorMsg =
        e instanceof Error ? e.message : 'Failed to create local vault.'
    } finally {
      this.isVerifying = false
    }
  }

  /** @deprecated Use {@link createLocalVaultWithDeviceKeys}. Backup passwords belong in Settings. */
  async createLocalVault(password: string): Promise<void> {
    if (!this.manager) {
      this.errorMsg = 'Vault engine is not available.'
      return
    }
    if (this.isVerifying) return
    if (password.trim().length < 8) {
      this.errorMsg = this.t('login.password_too_short')
      return
    }

    this.errorMsg = ''
    this.dismissSuccess()
    this.storageMode = 'local'
    this.githubPat = ''
    this.oauthFile = null
    this.isVerifying = true

    try {
      await this.initDeviceIdentity()
      const rawRecords = (await this.enqueueStorage(() =>
        this.manager!.connect('local', '', ''),
      )) as NookSecretRecord[]
      this.secrets = rawRecords
      this.markVaultUnlocked()
      await this.addVaultPassword(
        this.t('login.master_password_label'),
        password,
      )
      this.localVaultPresent = true
      this.localLoginPrepared = true
      await this.ensureProviderSaved()
      await this.hydrateMultiDeviceState()
      this.showSuccess(this.t('toasts.local_loaded'))
      this.startVaultSync()
    } catch (e: unknown) {
      this.isAuthenticated = false
      this.errorMsg =
        e instanceof Error ? e.message : 'Failed to create local vault.'
    } finally {
      this.isVerifying = false
    }
  }

  async loadProviders(options?: { migrateLegacyVault?: boolean }) {
    const snapshot = options?.migrateLegacyVault
      ? await loadAuthProvidersWithVaultMigration()
      : await loadAuthProviders()
    this.providers = snapshot.providers.map((p) =>
      p.label === 'GitHub sync' ? { ...p, label: 'GitHub' } : p,
    )
    this.providersLoaded = true
  }

  applyActiveProviderCredentials() {
    if (this.localVaultPresent) {
      this.storageMode = 'local'
      this.githubPat = ''
      this.oauthFile = null
      return
    }

    if (this.loginSetupType) {
      this.storageMode = this.loginSetupType
      if (this.loginSetupType !== 'github') {
        this.githubPat = ''
      }
      if (this.loginSetupType !== 'oauth-file') {
        this.oauthFile = null
      }
      return
    }

    const stagingGoogle =
      this.loginSetupType === 'oauth-file' &&
      Boolean(this.oauthFile?.accessToken?.trim())

    const syncProvider = this.syncProviders[0]
    if (!syncProvider) {
      return
    }

    if (stagingGoogle && this.addProviderOpen) {
      this.storageMode = syncProvider.type
      this.githubPat = syncProvider.githubPat ?? ''
      this.githubRepo = syncProvider.githubRepo?.trim() || DEFAULT_GITHUB_REPO
      return
    }

    this.storageMode = syncProvider.type
    this.githubPat = syncProvider.githubPat ?? ''
    if (syncProvider.type === 'oauth-file') {
      this.oauthFile = syncProvider.oauthFile ?? null
      this.githubRepo =
        syncProvider.oauthFile?.fileName?.trim() || DEFAULT_DRIVE_VAULT_FILE
    } else {
      this.githubRepo = syncProvider.githubRepo?.trim() || DEFAULT_GITHUB_REPO
      this.oauthFile = null
    }
  }

  async persistProviders(opts?: { replace?: boolean }) {
    if (!opts?.replace && this.localVaultPresent) {
      const snapshot = await loadAuthProviders()
      const memoryIds = this.providers.map((p) => p.id)
      const extraSync = snapshot.providers.filter(
        (p) => p.type !== 'local' && !memoryIds.includes(p.id),
      )
      if (extraSync.length > 0) {
        this.providers = [...this.providers, ...extraSync]
      }
    }
    await saveAuthProviders({
      providers: this.providers,
    })
  }

  beginProviderSetup(type: StorageProviderType, oauthPreset?: OAuthFilePreset) {
    this.resetVaultSessionState()
    this.loginSetupType = type
    this.storageMode = type
    this.githubPat = ''
    this.githubRepo =
      type === 'oauth-file' ? DEFAULT_DRIVE_VAULT_FILE : DEFAULT_GITHUB_REPO
    if (type === 'oauth-file') {
      const preset = oauthPreset ?? 'google-drive'
      this.oauthSetupPreset = preset
      this.oauthFile = {
        preset,
        accessToken: '',
        fileName: DEFAULT_DRIVE_VAULT_FILE,
      }
    } else {
      this.oauthSetupPreset = null
      this.oauthFile = null
    }
    this.errorMsg = ''
    this.dismissSuccess()
  }

  beginAddProvider() {
    this.resetVaultSessionState()
    this.addProviderOpen = true
    this.loginSetupType = null
    this.errorMsg = ''
  }

  cancelAddProvider() {
    this.addProviderOpen = false
    this.loginSetupType = null
    this.applyActiveProviderCredentials()
    this.errorMsg = ''
  }

  cancelProviderSetup() {
    if (this.addProviderOpen && this.loginSetupType !== null) {
      const setupType = this.loginSetupType
      this.loginSetupType = null
      this.githubPat = ''
      this.githubRepo =
        setupType === 'oauth-file'
          ? DEFAULT_DRIVE_VAULT_FILE
          : DEFAULT_GITHUB_REPO
      this.errorMsg = ''
      return
    }
    this.loginSetupType = null
    this.addProviderOpen = false
    this.applyActiveProviderCredentials()
    this.errorMsg = ''
  }

  /**
   * Detect whether the vault unlocks with device keys or a password envelope.
   */
  async probeLoginUnlockMode(): Promise<void> {
    await this.refreshPasswordEntriesList()
  }

  async refreshPasswordEntriesList(): Promise<boolean> {
    if (!this.manager) return false
    try {
      if (!this.hasRemoteCredentials()) {
        this.passwordEntries = []
        this.loginUnlockMode = 'unknown'
        return false
      }
      await this.ensureOAuthTokensFresh()
      const raw = await this.enqueueStorage(() =>
        this.manager!.fetchVaultPasswordEntries(...this.wasmStorageArgs()),
      )
      this.passwordEntries = raw
      this.loginUnlockMode = 'keys'
      if (this.passwordEntries.length === 1 && !this.selectedPasswordEntryId) {
        this.selectedPasswordEntryId = this.passwordEntries[0]!.id
      }
      return true
    } catch {
      if (!this.isAuthenticated) {
        this.loginUnlockMode = 'unknown'
      }
      this.passwordEntries = []
      return false
    }
  }

  clearRemoteVaultRecovery() {
    this.remoteVaultRecoveryPrompt = 'none'
    this.pendingConnectRecovery = 'none'
    try {
      this.manager?.clearConnectRecovery()
    } catch {
      // Engine not ready yet.
    }
  }

  /** User chose to restore a deleted remote vault from the browser cache. */
  async confirmRecoverRemoteVault(): Promise<void> {
    if (!this.manager) return
    this.errorMsg = ''
    this.isVerifying = true
    try {
      this.manager.prepareConnectFromLocalCache()
      this.pendingConnectRecovery = 'from_cache'
      this.remoteVaultRecoveryPrompt = 'none'
      if (this.loginSetupType) {
        await this.loadDb()
        return
      }
      await this.refreshPasswordEntriesList()
    } catch (e: unknown) {
      this.errorMsg =
        e instanceof Error ? e.message : 'Could not load the local vault copy.'
    } finally {
      this.isVerifying = false
    }
  }

  /** User chose to create a fresh vault file on remote storage. */
  async confirmCreateFreshRemoteVault(): Promise<void> {
    if (!this.manager) return
    this.errorMsg = ''
    this.pendingConnectRecovery = 'fresh'
    this.remoteVaultRecoveryPrompt = 'none'
    if (this.loginSetupType) {
      this.isVerifying = true
      try {
        await this.loadDb()
      } catch (e: unknown) {
        this.errorMsg =
          e instanceof Error ? e.message : 'Could not create a new vault file.'
      } finally {
        this.isVerifying = false
      }
      return
    }
  }

  private async assessVaultConnectStatus(): Promise<string> {
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

  private async handleRemoteVaultAssessStatus(
    accessStatus: string,
  ): Promise<boolean> {
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
  private resetVaultSessionState() {
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

  private ensureIdleSessionTracker() {
    if (this.idleSessionTracker) return
    this.idleSessionTracker = createVaultIdleSessionTracker({
      timeoutMs: resolveVaultIdleTimeoutMs(import.meta.env),
      warningMs: resolveVaultIdleWarningMs(import.meta.env),
      onExpire: () => this.lockVaultDueToIdle(),
      onWarning: () => this.showIdleLockWarning(),
    })
  }

  startIdleSessionTracking() {
    if (!this.isAuthenticated) return
    this.ensureIdleSessionTracker()
    this.idleSessionTracker!.start()
  }

  stopIdleSessionTracking() {
    this.idleSessionTracker?.stop()
  }

  private showIdleLockWarning() {
    if (!this.isAuthenticated) return
    this.showSuccess(this.t('session.idle_warning'))
  }

  private lockVaultDueToIdle() {
    if (!this.isAuthenticated) return
    this.sessionExpiredByIdle = true
    this.lockVault()
  }

  private markVaultUnlocked() {
    setVaultSessionLocked(false)
    this.isAuthenticated = true
    this.sessionExpiredByIdle = false
    this.startIdleSessionTracking()
  }

  private clearUnlockedSession() {
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
    const target = this.providers.find((p) => p.id === id)
    if (!target || target.type === 'local') return

    this.providers = this.providers.filter((p) => p.id !== id)

    if (this.providers.length === 0 && this.isAuthenticated) {
      this.clearUnlockedSession()
    }

    this.applyActiveProviderCredentials()
    await this.persistProviders({ replace: true })

    this.showSuccess(this.t('toasts.removed_device', { label: target.label }))
  }

  async ensureProviderSaved(): Promise<boolean> {
    const pat = this.githubPat.trim()
    const repo = this.githubRepo.trim() || DEFAULT_GITHUB_REPO
    const driveFile = this.githubRepo.trim() || DEFAULT_DRIVE_VAULT_FILE
    const type = this.loginSetupType ?? this.storageMode
    const isNewSetup = this.loginSetupType !== null
    const vaultStoreId = this.manager?.vaultStoreId?.trim() || undefined
    const oauthPreset =
      this.oauthFile?.preset ?? this.oauthSetupPreset ?? 'google-drive'
    const oauthSnapshot: OAuthFileConfig | undefined =
      type === 'oauth-file'
        ? {
            preset: oauthPreset,
            accessToken: this.oauthFile?.accessToken ?? '',
            refreshToken: this.oauthFile?.refreshToken,
            expiresAt: this.oauthFile?.expiresAt,
            fileId: this.oauthFile?.fileId,
            accountEmail: this.oauthFile?.accountEmail,
            fileName: driveFile,
          }
        : undefined

    const isExplicitAdd =
      this.addProviderOpen ||
      (this.isAuthenticated && this.loginSetupType !== null)

    if (isNewSetup && type !== 'local') {
      const provider: StorageProvider = {
        id: generateId(),
        type,
        label: providerDefaultLabel(
          type,
          type === 'github'
            ? repo
            : type === 'oauth-file'
              ? driveFile
              : undefined,
          oauthPreset,
        ),
        githubPat: type === 'github' ? pat : undefined,
        githubRepo: type === 'github' ? repo : undefined,
        oauthFile: oauthSnapshot,
        storeId: vaultStoreId,
        createdAt: isoTimestamp(),
      }
      if (findDuplicateSyncProvider(this.providers, provider)) {
        if (isExplicitAdd) {
          this.errorMsg = this.t('auth_storage.duplicate_sync_provider')
          return false
        }
      } else {
        this.providers = [...this.providers, provider]
      }
    } else if (isNewSetup && type === 'local' && !this.localProvider) {
      const provider: StorageProvider = {
        id: generateId(),
        type: 'local',
        label: providerDefaultLabel('local'),
        storeId: vaultStoreId,
        createdAt: isoTimestamp(),
      }
      this.providers = [...this.providers, provider]
    } else if (this.localProvider) {
      this.providers = this.providers.map((provider) =>
        provider.type === 'local'
          ? {
              ...provider,
              storeId: vaultStoreId ?? provider.storeId,
            }
          : provider,
      )
    } else {
      this.providers = ensureLocalProviderRow({
        providers: this.providers,
      }).providers
    }

    if (this.storageMode === 'oauth-file' && this.oauthFile?.fileId) {
      const activePreset = this.oauthFile.preset
      this.providers = this.providers.map((provider) => {
        if (
          provider.type !== 'oauth-file' ||
          !provider.oauthFile ||
          provider.oauthFile.preset !== activePreset
        ) {
          return provider
        }
        const merged: OAuthFileConfig = {
          preset: activePreset,
          accessToken:
            this.oauthFile!.accessToken || provider.oauthFile.accessToken,
          refreshToken: provider.oauthFile.refreshToken,
          expiresAt: provider.oauthFile.expiresAt ?? this.oauthFile!.expiresAt,
          fileId: this.oauthFile!.fileId,
          fileName:
            provider.oauthFile.fileName?.trim() ||
            this.oauthFile!.fileName?.trim() ||
            driveFile,
          accountEmail:
            provider.oauthFile.accountEmail ?? this.oauthFile!.accountEmail,
        }
        return { ...provider, oauthFile: merged }
      })
      this.oauthFile =
        this.providers.find(
          (p) =>
            p.type === 'oauth-file' && p.oauthFile?.preset === activePreset,
        )?.oauthFile ?? this.oauthFile
    }

    this.loginSetupType = null
    this.addProviderOpen = false
    this.applyActiveProviderCredentials()
    await this.persistProviders()
    return true
  }

  startVaultSync() {
    this.stopVaultSync()
    const needsRemoteUpdates =
      this.isAuthenticated || this.joinEnrollmentPrompt !== 'none'
    if (!needsRemoteUpdates) {
      return
    }
    if (this.isAuthenticated) {
      void this.syncFromStorage()
    }
    this.syncTimer = setInterval(() => {
      if (
        this.isVerifying ||
        this.isSaving ||
        this.isSyncing ||
        this.isPasswordBusy
      ) {
        return
      }
      if (!this.isAuthenticated && this.joinEnrollmentPrompt === 'none') {
        return
      }
      void this.syncFromStorage()
    }, VaultState.syncIntervalMs())
  }

  stopVaultSync() {
    if (this.syncTimer !== null) {
      clearInterval(this.syncTimer)
      this.syncTimer = null
    }
  }

  private applyVaultSyncResult(result: NookVaultSyncResult) {
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
  private async hydrateMultiDeviceState(): Promise<void> {
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

  private async refreshPasswordEnvelopeState(): Promise<void> {
    await this.refreshPasswordEntriesList()
  }

  async syncFromStorage(options?: { force?: boolean }) {
    if (!this.manager) return
    if (this.syncBlocked) return
    if (!options?.force && this.isVerifying) return
    if (!options?.force && this.isSaving) return
    if (!options?.force && this.isPasswordBusy) return
    if (!options?.force && this.isSyncing) return

    if (!this.isAuthenticated && this.syncProviders.length > 0) {
      this.isSyncing = true
      try {
        const [mode, pat, repo] = this.providerWasmArgs(this.syncProviders[0]!)
        const raw = await this.enqueueStorage(() =>
          this.manager!.sync_vault_from_storage(mode, pat, repo),
        )
        this.applyVaultSyncResult(raw)
        this.refreshSecretsFromSession()
        this.lastSyncedAt = new SvelteDate()
      } catch {
        // Background sync should not interrupt the UI.
      } finally {
        this.isSyncing = false
      }
      return
    }

    if (!this.hasRemoteCredentials()) return

    if (
      this.isAuthenticated &&
      this.localVaultPresent &&
      this.syncProviders.length > 0
    ) {
      await this.syncFromSyncProviders({ quiet: true, force: options?.force })
      return
    }

    await this.ensureOAuthTokensFresh()

    this.isSyncing = true
    try {
      const raw = await this.enqueueStorage(() =>
        this.manager!.sync_vault_from_storage(...this.wasmStorageArgs()),
      )
      this.applyVaultSyncResult(raw)
      this.refreshSecretsFromSession()
      this.lastSyncedAt = new SvelteDate()
    } catch {
      // Background sync should not interrupt the UI.
    } finally {
      this.isSyncing = false
    }
  }

  /** Pull local vault from every sync provider (background / manual refresh). */
  private async syncFromSyncProviders(options?: {
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
    if (!this.manager) return
    if (this.syncBlocked) return
    if (this.isSyncing) return
    this.isSyncing = true
    try {
      await this.initDeviceIdentity()
      if (this.syncProviders.length === 0) {
        if (this.hasRemoteCredentials()) {
          await this.syncFromStorage({ force: true })
        } else {
          this.pendingJoins = []
          this.vaultMembers = []
        }
        return
      }
      for (const provider of this.syncProviders) {
        await this.syncProviderById(provider.id)
      }
      if (this.isAuthenticated) {
        await this.hydrateMultiDeviceState()
      } else {
        this.pendingJoins = []
        this.vaultMembers = []
      }
    } catch {
      // Manual refresh should not interrupt the UI.
    } finally {
      this.isSyncing = false
    }
  }

  /** Reconcile local vault with one sync provider using `reconcileVaultBlobs`. */
  async syncProviderById(
    providerId: string,
    options?: { quiet?: boolean },
  ): Promise<void> {
    if (!this.manager) return
    if (this.syncBlocked) return
    const provider = this.providers.find((p) => p.id === providerId)
    if (!provider || provider.type === 'local') return
    if (this.syncingProviderId && this.syncingProviderId !== providerId) return

    this.syncingProviderId = providerId
    if (!options?.quiet) {
      this.errorMsg = ''
    }
    try {
      const [mode, pat, repo] = this.providerWasmArgs(provider)
      // `sync_vault_from_storage` checks the IDB event-log flag; the in-memory
      // `eventLogMode()` bit can be false after reload until connect finishes.
      const raw = await this.enqueueStorage(() =>
        this.raceStorageTimeout(
          this.manager!.sync_vault_from_storage(mode, pat, repo),
          'Vault sync',
        ),
      )
      this.applyVaultSyncResult(raw)
      this.refreshSecretsFromSession()
      await this.refreshReplacementConflicts()
      await this.updateProviderSyncMetadata(
        providerId,
        await readLocalVaultBlob(),
        null,
      )
      return
    } catch (e: unknown) {
      if (!options?.quiet) {
        this.errorMsg =
          e instanceof Error ? e.message : 'Sync failed for this provider.'
      }
    } finally {
      if (this.isAuthenticated) {
        await this.hydrateMultiDeviceState()
      }
      if (this.syncingProviderId === providerId) {
        this.syncingProviderId = null
      }
    }
  }

  private fanOutSyncChain: Promise<void> = Promise.resolve()

  /** Push the local vault to every connected sync provider (after CRUD or manual sync). */
  async fanOutSyncToProviders(options?: { quiet?: boolean }): Promise<void> {
    if (!this.manager || !this.isAuthenticated) return
    if (this.syncBlocked) return
    if (this.syncProviders.length === 0) return

    const run = this.fanOutSyncChain.then(() =>
      this.runFanOutSyncToProviders(options),
    )
    this.fanOutSyncChain = run.catch(() => undefined)
    return run
  }

  private async runFanOutSyncToProviders(options?: {
    quiet?: boolean
  }): Promise<void> {
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

  private async runFanOutSyncAfterLocalSave(): Promise<void> {
    await this.pushRemoteYamlSnapshotNow()
    await this.flushRemoteEventOutboxNow()
    await this.fanOutSyncToProviders({ quiet: true })
  }

  private scheduleFanOutSyncAfterLocalSave(): void {
    void this.runFanOutSyncAfterLocalSave()
  }

  /** Fire-and-forget YAML projection for providers that still read nook-vault.yaml. */
  private scheduleRemoteYamlSnapshotPush(): void {
    void this.pushRemoteYamlSnapshotNow()
  }

  private remoteYamlSnapshotStorageArgs(): [string, string, string] | null {
    if (this.syncProviders.length > 0) {
      return this.providerWasmArgs(this.syncProviders[0]!)
    }
    if (this.hasRemoteCredentials()) {
      return this.wasmStorageArgs()
    }
    return null
  }

  private async pushRemoteYamlSnapshotNow(): Promise<void> {
    if (!this.manager) return
    const args = this.remoteYamlSnapshotStorageArgs()
    if (!args) return
    await this.enqueueStorage(() =>
      this.manager!.pushRemoteVaultYamlSnapshotForProvider(...args),
    )
  }

  private async applyReconcileResult(
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

  private async updateProviderSyncMetadata(
    providerId: string,
    yaml: string,
    revision: string | null,
  ): Promise<void> {
    const version = await readVaultVersionFromBlob(yaml)
    this.providers = this.providers.map((p) =>
      p.id === providerId
        ? {
            ...p,
            lastSyncedAt: isoTimestamp(),
            lastSyncedVersion: version || p.lastSyncedVersion,
            lastSyncRevision: revision ?? p.lastSyncRevision,
            storeId: this.manager?.vaultStoreId || p.storeId,
          }
        : p,
    )
    await this.persistProviders()
    this.lastSyncedAt = new SvelteDate()
  }

  async refreshReplacementConflicts(): Promise<void> {
    if (!this.manager?.eventLogMode()) {
      this.replacementConflicts = []
      return
    }
    const conflicts = await this.manager.listProjectionConflicts()
    this.replacementConflicts = conflicts.map((conflict) => ({
      oldSecretId: conflict.oldSecretId,
      candidatesJson: conflict.candidatesJson,
    }))
  }

  private async stageVaultSyncConflict(
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

  private clearPendingSyncConflict() {
    this.pendingSyncConflict = null
  }

  /** E2E / dev: open the conflict dialog without reaching remote storage. */
  stageSyncConflict(conflict: PendingSyncConflict) {
    this.pendingSyncConflict = conflict
    this.errorMsg = ''
  }

  async resolveSyncConflictKeepLocal(): Promise<void> {
    const conflict = this.pendingSyncConflict
    if (!conflict || this.isVerifying) return

    this.isVerifying = true
    this.errorMsg = ''
    try {
      const remoteYaml = resolveVaultSyncConflictKeepLocal(
        conflict.localYaml,
        conflict.remoteYaml,
        conflict.remoteRevision,
      )
      const revision = await writeRemoteVaultBlob(
        conflict.mode,
        conflict.pat,
        conflict.repo,
        remoteYaml,
        conflict.remoteRevision,
      )
      const providerId = await this.ensureProviderSavedAfterConflict(conflict)
      await this.updateProviderSyncMetadata(
        providerId,
        conflict.localYaml,
        revision,
      )
      this.clearPendingSyncConflict()
      this.finishStagedProviderConnectAfterConflict(conflict)
      this.showSuccess(
        this.t('auth_storage.sync_conflict_resolved_local', {
          provider: conflict.providerLabel,
        }),
      )
    } catch (e: unknown) {
      this.errorMsg =
        e instanceof Error ? e.message : this.t('auth_storage.sync_failed')
    } finally {
      this.isVerifying = false
    }
  }

  async resolveSyncConflictKeepRemote(): Promise<void> {
    const conflict = this.pendingSyncConflict
    if (!conflict || this.isVerifying) return

    this.isVerifying = true
    this.errorMsg = ''
    try {
      const localYaml = resolveVaultSyncConflictKeepRemote(
        conflict.localYaml,
        conflict.remoteYaml,
        conflict.remoteRevision,
      )
      await writeLocalVaultBlob(localYaml)
      if (this.isAuthenticated) {
        await this.reloadSessionFromLocal()
      }
      const providerId = await this.ensureProviderSavedAfterConflict(conflict)
      await this.updateProviderSyncMetadata(
        providerId,
        conflict.remoteYaml,
        conflict.remoteRevision,
      )
      this.clearPendingSyncConflict()
      this.finishStagedProviderConnectAfterConflict(conflict)
      this.showSuccess(
        this.t('auth_storage.sync_conflict_resolved_remote', {
          provider: conflict.providerLabel,
        }),
      )
    } catch (e: unknown) {
      this.errorMsg =
        e instanceof Error ? e.message : this.t('auth_storage.sync_failed')
    } finally {
      this.isVerifying = false
    }
  }

  private finishStagedProviderConnectAfterConflict(
    conflict: PendingSyncConflict,
  ): void {
    if (conflict.providerId !== '__pending_provider__') {
      return
    }
    this.loginSetupType = null
    this.addProviderOpen = false
  }

  private async ensureProviderSavedAfterConflict(
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

  private async reloadSessionFromLocal(): Promise<void> {
    if (!this.manager) return
    const raw = await this.enqueueStorage(() =>
      this.manager!.sync_vault_from_storage('local', '', ''),
    )
    this.applyVaultSyncResult(raw)
    this.refreshSecretsFromSession()
    await this.hydrateMultiDeviceState()
  }

  /** Settings: connect a new sync provider and reconcile with local vault. */
  async connectAndSyncStagedProvider(): Promise<void> {
    if (!this.manager) return
    if (this.isVerifying) return
    this.isVerifying = true
    try {
      const reconcileOutcome = await this.reconcileStagedRemoteWithLocal()
      if (reconcileOutcome === 'conflict') {
        return
      }

      const saved = await this.ensureProviderSaved()
      if (!saved) {
        return
      }
      const provider =
        this.syncProviders[this.syncProviders.length - 1] ??
        this.providers[this.providers.length - 1]
      if (!provider || provider.type === 'local') {
        this.errorMsg = 'Choose a cloud sync provider.'
        return
      }
      await this.syncProviderById(provider.id, { quiet: true })
      this.loginSetupType = null
      this.addProviderOpen = false
    } catch (e: unknown) {
      this.errorMsg =
        e instanceof Error ? e.message : this.t('auth_storage.sync_failed')
    } finally {
      this.isVerifying = false
    }
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
    this.helpOpen = false
    this.stopIdleSessionTracking()
    setVaultSessionLocked(true)
    this.clearUnlockedSession()
  }

  openHelp() {
    this.settingsOpen = false
    this.helpOpen = true
  }

  closeHelp() {
    this.helpOpen = false
  }

  filterSecrets(query: string): NookSecretRecord[] {
    if (!this.manager) return []
    return this.manager.filter_secrets(query)
  }

  private refreshSecretsFromSession() {
    this.secrets = this.filterSecrets('')
  }

  async refreshDeviceState() {
    await this.manualSync()
  }

  /** Merge remote YAML join rows into the session (manual sync + provider poll). */
  async refreshPendingJoinsFromProviders() {
    await this.hydrateMultiDeviceState()
  }

  async requestVaultAccess() {
    if (!this.manager) return
    this.errorMsg = ''
    this.dismissSuccess()
    this.isVerifying = true
    try {
      await this.enqueueStorage(() =>
        this.manager!.request_vault_access(
          ...this.wasmStorageArgs(),
          isoTimestamp(),
        ),
      )
      await this.ensureProviderSaved()
      await this.refreshDeviceState()
      if (this.localVaultPresent && this.syncProviders.length > 0) {
        this.scheduleFanOutSyncAfterLocalSave()
      } else {
        this.scheduleRemoteYamlSnapshotPush()
      }
      this.showSuccess(this.t('login.join_request_sent'))
    } catch (e: unknown) {
      this.errorMsg =
        e instanceof Error ? e.message : 'Failed to request vault access.'
    } finally {
      this.isVerifying = false
    }
  }

  async approveJoin(joinDeviceId: string) {
    if (!this.manager) return
    this.errorMsg = ''
    this.dismissSuccess()
    this.isSaving = true
    try {
      const rawRecords = (await this.enqueueStorage(() =>
        this.manager!.approve_join_request(joinDeviceId),
      )) as NookSecretRecord[]
      this.secrets = rawRecords
      await this.pushRemoteYamlSnapshotNow()
      await this.flushRemoteEventOutboxNow()
      await this.hydrateMultiDeviceState()
      this.pendingJoins = this.pendingJoins.filter(
        (entry) => entry.deviceId !== joinDeviceId,
      )
      await this.fanOutSyncToProviders({ quiet: true })
      this.pendingJoins = this.pendingJoins.filter(
        (entry) => entry.deviceId !== joinDeviceId,
      )
      this.showSuccess(this.t('toasts.device_approved_success'))
    } catch (e: unknown) {
      this.errorMsg =
        e instanceof Error ? e.message : 'Failed to approve join request.'
    } finally {
      this.isSaving = false
    }
  }

  async denyJoin(joinDeviceId: string) {
    if (!this.manager) return
    this.errorMsg = ''
    this.dismissSuccess()
    this.isSaving = true
    try {
      const rawRecords = (await this.enqueueStorage(() =>
        this.manager!.deny_join_request(joinDeviceId),
      )) as NookSecretRecord[]
      this.secrets = rawRecords
      await this.hydrateMultiDeviceState()
      this.scheduleFanOutSyncAfterLocalSave()
      this.showSuccess(this.t('toasts.join_denied'))
    } catch (e: unknown) {
      this.errorMsg =
        e instanceof Error ? e.message : 'Failed to deny join request.'
    } finally {
      this.isSaving = false
    }
  }

  async renameDevice(authId: string, label: string) {
    if (!this.manager) return
    this.errorMsg = ''
    this.dismissSuccess()
    this.isSaving = true
    try {
      await this.enqueueStorage(() =>
        this.manager!.rename_vault_member(authId, label),
      )
      await this.hydrateMultiDeviceState()
      this.scheduleFanOutSyncAfterLocalSave()
      this.showSuccess(
        label.trim()
          ? this.t('toasts.device_renamed')
          : this.t('toasts.device_name_reset'),
      )
    } catch (e: unknown) {
      this.errorMsg =
        e instanceof Error ? e.message : 'Failed to rename device.'
      throw e
    } finally {
      this.isSaving = false
    }
  }

  async revokeDevice(authId: string) {
    if (!this.manager) return
    const isSelf = this.vaultMembers.some(
      (member) => member.authId === authId && member.deviceId === this.deviceId,
    )
    this.errorMsg = ''
    this.dismissSuccess()
    this.isSaving = true
    try {
      const rawRecords = (await this.enqueueStorage(() =>
        this.manager!.revoke_vault_member(authId),
      )) as NookSecretRecord[]
      if (isSelf) {
        this.clearUnlockedSession()
        this.showSuccess(this.t('toasts.device_removed'))
        return
      }
      this.secrets = rawRecords
      await this.hydrateMultiDeviceState()
      this.scheduleFanOutSyncAfterLocalSave()
      this.showSuccess(this.t('toasts.device_revoked'))
    } catch (e: unknown) {
      this.errorMsg =
        e instanceof Error ? e.message : 'Failed to revoke device access.'
      throw e
    } finally {
      this.isSaving = false
    }
  }

  async createFreshVault() {
    if (!this.manager) return
    this.errorMsg = ''
    this.dismissSuccess()
    this.isVerifying = true
    try {
      await this.initDeviceIdentity()
      const rawRecords = await this.enqueueStorage(async () => {
        const connectPromise = this.manager!.connect_fresh(
          ...this.wasmStorageArgs(),
        )
        const timeoutPromise = new Promise<never>((_, reject) => {
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
        return (await Promise.race([
          connectPromise,
          timeoutPromise,
        ])) as NookSecretRecord[]
      })
      this.secrets = rawRecords
      this.markVaultUnlocked()
      await this.ensureProviderSaved()
      await this.hydrateMultiDeviceState()
      this.joinEnrollmentPrompt = 'none'
      this.showSuccess(this.t('toasts.vault_created'))
    } catch (e: unknown) {
      this.isAuthenticated = false
      this.errorMsg =
        e instanceof Error ? e.message : 'Failed to create a new vault.'
    } finally {
      this.isVerifying = false
    }
  }

  async enrollAndConnect() {
    if (!this.manager) return
    const secretsKey = this.enrollSecretsKey.trim()
    const membersKey = this.enrollMembersKey.trim()
    if (!secretsKey || !membersKey) return

    this.errorMsg = ''
    this.dismissSuccess()
    this.isVerifying = true
    try {
      const rawRecords = (await this.enqueueStorage(() =>
        this.manager!.enroll_and_connect(
          ...this.wasmStorageArgs(),
          secretsKey,
          membersKey,
        ),
      )) as NookSecretRecord[]
      this.secrets = rawRecords
      this.markVaultUnlocked()
      this.enrollSecretsKey = ''
      this.enrollMembersKey = ''
      await this.ensureProviderSaved()
      void this.hydrateMultiDeviceState()
      await this.syncFromStorage()
      this.showSuccess(this.t('toasts.enrolled_connected'))
      this.joinEnrollmentPrompt = 'none'
      this.closeSettings()
    } catch (e: unknown) {
      this.errorMsg =
        e instanceof Error ? e.message : 'Failed to enroll with vault keys.'
    } finally {
      this.isVerifying = false
    }
  }

  generatePassword(
    length: number,
    lowercase: boolean,
    uppercase: boolean,
    numbers: boolean,
    symbols: boolean,
  ): string {
    if (!this.manager) {
      throw new Error('Vault engine is not available.')
    }
    return this.manager.generate_password(
      length,
      lowercase,
      uppercase,
      numbers,
      symbols,
    )
  }

  async connectStagedProvider(): Promise<void> {
    if (this.loginSetupType) {
      this.storageMode = this.loginSetupType
    }
    if (this.isAuthenticated && this.loginSetupType !== 'local') {
      await this.connectAndSyncStagedProvider()
      return
    }
    await this.loadDb()
  }

  async loadDb() {
    if (this.isInitializing) {
      this.errorMsg = 'Vault engine is still loading. Try again in a moment.'
      return
    }

    if (!this.manager) {
      this.errorMsg =
        'Vault engine is not available. Refresh the page and try again.'
      return
    }

    if (this.isVerifying) {
      this.errorMsg = 'Connection already in progress.'
      return
    }

    this.errorMsg = ''
    this.dismissSuccess()
    this.isVerifying = true
    try {
      await this.initDeviceIdentity()
      await this.ensureOAuthTokensFresh()

      if (!this.isAuthenticated && this.syncProviders.length > 0) {
        await this.syncProviderById(this.syncProviders[0]!.id, { quiet: true })
      }

      const accessStatus = await this.assessVaultConnectStatus()

      if (
        this.pendingConnectRecovery === 'none' &&
        (await this.handleRemoteVaultAssessStatus(accessStatus))
      ) {
        return
      }

      if (accessStatus === 'needs_enrollment') {
        await this.ensureProviderSaved()
        const hasPasswordFallback = await this.refreshPasswordEntriesList()
        if (hasPasswordFallback && this.passwordEntries.length > 0) {
          this.loginPasswordPrompt = true
          this.joinEnrollmentPrompt = 'none'
          return
        }
        this.joinEnrollmentPrompt = 'needs_request'
        this.startVaultSync()
        return
      }
      if (accessStatus === 'join_pending') {
        await this.ensureProviderSaved()
        const hasPasswordFallback = await this.refreshPasswordEntriesList()
        if (hasPasswordFallback && this.passwordEntries.length > 0) {
          this.loginPasswordPrompt = true
          this.joinEnrollmentPrompt = 'none'
          return
        }
        this.joinEnrollmentPrompt = 'pending'
        this.startVaultSync()
        return
      }

      if (this.stagedRemoteStorageArgs()) {
        const reconcileOutcome = await this.reconcileStagedRemoteWithLocal()
        if (reconcileOutcome === 'conflict') {
          return
        }
      }

      const rawRecords = await this.enqueueStorage(async () => {
        const connectPromise =
          this.pendingConnectRecovery === 'fresh'
            ? this.manager!.connect_fresh(...this.connectStorageArgs())
            : this.manager!.connect(...this.connectStorageArgs())
        this.pendingConnectRecovery = 'none'
        const timeoutPromise = new Promise<never>((_, reject) => {
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
        return (await Promise.race([
          connectPromise,
          timeoutPromise,
        ])) as NookSecretRecord[]
      })
      this.secrets = rawRecords
      this.markVaultUnlocked()
      this.syncOAuthRemoteRefFromManager()
      await this.ensureProviderSaved()
      await this.loadProviders()
      await this.promoteSessionVaultToLocalIfNeeded()
      await this.hydrateMultiDeviceState()
      if (this.storageMode === 'local') {
        this.showSuccess(this.t('toasts.local_loaded'))
      } else if (this.storageMode === 'oauth-file') {
        this.showSuccess(this.t('toasts.google_drive_connected'))
      } else {
        this.showSuccess(this.t('toasts.github_connected'))
      }
    } catch (e: unknown) {
      this.isAuthenticated = false
      const message = e instanceof Error ? e.message : String(e)
      this.errorMsg = this.resolveErrorMessage(message)
    } finally {
      this.isVerifying = false
    }

    if (this.isAuthenticated) {
      try {
        await this.syncFromStorage({ force: true })
      } catch {
        // Post-unlock sync should not block the login gate.
      }
      this.startVaultSync()
    }
  }

  private async promoteSessionVaultToLocalIfNeeded(): Promise<void> {
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
    if (!this.manager) {
      this.passwordError = 'Vault engine is not available.'
      return
    }
    if (!this.isAuthenticated) {
      this.passwordError = 'Unlock the vault before adding a password.'
      return
    }
    const hadPasswords = this.passwordEntries.length > 0
    this.passwordError = ''
    this.isPasswordBusy = true
    try {
      await this.enqueueStorage(() =>
        this.manager!.addVaultPassword(label.trim(), password),
      )
      await this.refreshPasswordEntriesList()
      this.showSuccess(
        hadPasswords
          ? this.t('toasts.password_added_rotate')
          : this.t('toasts.password_set'),
      )
      await this.fanOutSyncToProviders({ quiet: true })
    } catch (e: unknown) {
      this.passwordError =
        e instanceof Error ? e.message : 'Failed to add vault password.'
      throw e
    } finally {
      this.isPasswordBusy = false
    }
  }

  async updateVaultPasswordEntry(
    entryId: string,
    password: string,
  ): Promise<void> {
    if (!this.manager) {
      this.passwordError = 'Vault engine is not available.'
      return
    }
    this.passwordError = ''
    this.isPasswordBusy = true
    try {
      await this.enqueueStorage(() =>
        this.manager!.updateVaultPasswordEntry(entryId, password),
      )
      await this.refreshPasswordEntriesList()
      this.showSuccess(this.t('toasts.password_updated'))
      await this.fanOutSyncToProviders({ quiet: true })
    } catch (e: unknown) {
      this.passwordError =
        e instanceof Error ? e.message : 'Failed to update vault password.'
      throw e
    } finally {
      this.isPasswordBusy = false
    }
  }

  async removeVaultPasswordEntry(entryId: string): Promise<void> {
    if (!this.manager) return
    this.passwordError = ''
    this.isPasswordBusy = true
    try {
      await this.enqueueStorage(() =>
        this.manager!.removeVaultPasswordEntry(entryId),
      )
      await this.refreshPasswordEntriesList()
      if (this.activeEnrollmentEntryId === entryId) {
        this.enrollmentCode = ''
        this.activeEnrollmentEntryId = null
      }
      this.showSuccess(this.t('toasts.password_removed'))
      await this.fanOutSyncToProviders({ quiet: true })
    } catch (e: unknown) {
      this.passwordError =
        e instanceof Error ? e.message : 'Failed to remove vault password.'
      throw e
    } finally {
      this.isPasswordBusy = false
    }
  }

  /** @deprecated Use addVaultPassword — kept for older callers. */
  async setVaultPassword(password: string): Promise<void> {
    await this.addVaultPassword('Vault password', password)
  }

  async removeVaultPassword(): Promise<void> {
    const entry = this.passwordEntries[0]
    if (!entry) return
    await this.removeVaultPasswordEntry(entry.id)
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
    if (!this.manager) {
      throw new Error('Vault engine is not available.')
    }
    // Block the background sync timer for the duration: each verify call
    // takes ~1s of scrypt CPU, and wasm-bindgen aliases the manager
    // borrow if a sync_vault_from_storage future is still pending.
    this.isPasswordBusy = true
    // Drain any in-flight async wasm operation and wait one event-loop
    // turn so wasm-bindgen's RefMut on the manager is observably released
    // before we issue sync `&self` calls. Without this, scrypt verify
    // races a background `sync_vault_from_storage` and trips the
    // aliasing detector.
    try {
      await Promise.race([
        this.storageChain,
        new Promise<void>((_, reject) => {
          setTimeout(
            () => reject(new Error('Vault storage is busy. Try again.')),
            VaultState.storageOpTimeoutMs,
          )
        }),
      ])
    } catch {
      this.resetStorageChain()
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
    try {
      // Background sync can refresh wasm password metadata from remote storage
      // while the UI still holds a stale list — refetch before verify/issue.
      const refreshed = await this.refreshPasswordEntriesList()
      if (!refreshed || this.passwordEntries.length === 0) {
        throw new Error(
          'Add a backup vault password first; enrollment codes wrap that password.',
        )
      }
      if (!this.passwordEntries.some((entry) => entry.id === entryId)) {
        throw new Error(
          'Password entry not found. Wait for sync to finish and try again.',
        )
      }
      // `verifyVaultPassword` returns false on a wrong password but can
      // also throw if the underlying age decryptor panics on certain
      // scrypt failures inside the wasm runtime — treat both as "wrong
      // password" so the UI message stays predictable.
      let verified: boolean
      try {
        verified = await this.enqueueStorage(async () => {
          await Promise.resolve()
          return this.manager!.verifyVaultPassword(entryId, password)
        })
      } catch {
        verified = false
      }
      if (!verified) {
        throw new Error('Password does not match the vault.')
      }
      const selectedProvider = this.providers.find((p) => p.id === providerId)
      if (!selectedProvider) {
        throw new Error('Choose a sync provider.')
      }
      if (selectedProvider.type === 'local') {
        throw new Error(
          'Choose a cloud sync provider — local vault is already on this device.',
        )
      }
      const provider: EnrollmentProvider =
        selectedProvider.type === 'github'
          ? {
              type: 'github',
              pat: selectedProvider.githubPat?.trim() ?? '',
              repo: selectedProvider.githubRepo?.trim() ?? '',
            }
          : (() => {
              throw new Error(
                'Onboarding QR requires a GitHub sync provider for now.',
              )
            })()
      if (provider.type === 'github' && (!provider.pat || !provider.repo)) {
        throw new Error(
          'GitHub sync provider is missing credentials. Reconnect in Settings and try again.',
        )
      }
      const payload: EnrollmentIssueInput = {
        provider,
        entry_id: entryId,
        issued_at: isoTimestamp(),
      }
      const selectedPassword = this.passwordEntries.find(
        (e) => e.id === entryId,
      )
      const code = await encryptEnrollmentPayload(
        payload,
        password,
        selectedPassword?.label ?? '',
      )
      this.enrollmentCode = code
      this.activeEnrollmentEntryId = entryId
      return code
    } finally {
      this.isPasswordBusy = false
    }
  }

  clearEnrollmentCode() {
    this.enrollmentCode = ''
    this.activeEnrollmentEntryId = null
  }

  /**
   * Unlock the vault with a labelled password entry.
   */
  async unlockWithPassword(entryId: string, password: string): Promise<void> {
    if (!this.manager) {
      this.errorMsg = 'Vault engine is not available.'
      return
    }
    if (this.isVerifying) return
    if (!this.hasRemoteCredentials()) {
      this.errorMsg =
        this.storageMode === 'oauth-file'
          ? this.t('errors.google_sign_in_required')
          : 'Configure GitHub credentials before unlocking.'
      return
    }
    await this.ensureOAuthTokensFresh()
    if (!entryId.trim()) {
      this.errorMsg = 'Choose a vault password to unlock.'
      return
    }
    this.errorMsg = ''
    this.dismissSuccess()
    this.isVerifying = true
    try {
      await this.initDeviceIdentity()
      const rawRecords = (await this.enqueueStorage(() =>
        this.manager!.connectWithPassword(
          ...this.wasmStorageArgs(),
          entryId,
          password,
        ),
      )) as NookSecretRecord[]
      this.secrets = rawRecords
      this.markVaultUnlocked()
      await this.ensureProviderSaved()
      await this.loadProviders()
      await this.refreshPasswordEntriesList()
      void this.hydrateMultiDeviceState()
      this.joinEnrollmentPrompt = 'none'
      this.loginPasswordPrompt = false
      this.showSuccess(this.t('toasts.vault_unlocked'))
      this.startVaultSync()
    } catch (e: unknown) {
      this.isAuthenticated = false
      this.errorMsg =
        e instanceof Error ? e.message : 'Failed to unlock with password.'
    } finally {
      this.isVerifying = false
    }
  }

  /**
   * Joining-side: parse an enrollment code, restore provider credentials, and
   * self-enrol via `connectWithPassword`. Skips approval entirely.
   */
  async connectWithEnrollmentCode(code: string, password = ''): Promise<void> {
    if (!this.manager) {
      this.errorMsg = 'Vault engine is not available.'
      return
    }
    this.errorMsg = ''
    this.dismissSuccess()
    this.isVerifying = true
    try {
      const payload = await decryptEnrollmentPayload(code, password)
      const entryId = payload.entry_id.trim()
      const unlockPassword = password.trim()
      if (!entryId) {
        throw new Error('Enrollment code is missing a vault password entry id.')
      }
      if (!unlockPassword) {
        throw new Error('Enter the vault password for this onboarding QR.')
      }

      if (payload.provider.type === 'github') {
        this.storageMode = 'github'
        this.githubPat = payload.provider.pat
        this.githubRepo = payload.provider.repo
        this.loginSetupType = 'github'
      } else {
        this.storageMode = 'local'
        this.loginSetupType = 'local'
      }

      await this.initDeviceIdentity()

      if (payload.provider.type === 'github') {
        const remote = await fetchRemoteVaultBlob(
          'github',
          payload.provider.pat,
          payload.provider.repo,
        )
        if (!remote.content.trim()) {
          throw new Error(
            'This sync provider has no vault copy yet. Save secrets on the issuing device first.',
          )
        }
        const localYaml = await readLocalVaultBlob()
        const attempt = attemptReconcileVaultSyncBlobs(
          localYaml,
          remote.content,
          remote.revision,
        )
        if (attempt.status === 'store_id_mismatch') {
          throw new Error(
            this.t('auth_storage.sync_store_id_mismatch', {
              provider: 'GitHub',
            }),
          )
        }
        const reconcile = attempt.result
        if (reconcile.action === 'conflict') {
          throw new Error(
            'Local and sync-provider vaults conflict. Resolve on the issuing device first.',
          )
        }
        if (!localYaml.trim() || reconcile.action === 'adopt_remote') {
          await writeLocalVaultBlob(reconcile.localYaml)
        }
        this.localVaultPresent = true
      }

      const rawRecords = (await this.enqueueStorage(() =>
        this.manager!.connectWithPassword(
          'local',
          '',
          '',
          entryId,
          unlockPassword,
        ),
      )) as NookSecretRecord[]
      this.secrets = rawRecords
      this.markVaultUnlocked()
      await this.ensureProviderSaved()
      await this.loadProviders()
      await this.refreshPasswordEntriesList()
      void this.hydrateMultiDeviceState()
      this.joinEnrollmentPrompt = 'none'
      this.loginEnrollmentCode = ''
      this.prefillEnrollmentCode = ''
      this.enrollmentFromUrlPending = false
      this.showSuccess(this.t('toasts.device_enrolled'))
      this.startVaultSync()
    } catch (e: unknown) {
      this.isAuthenticated = false
      this.errorMsg =
        e instanceof Error
          ? e.message
          : 'Failed to enroll with the provided code.'
    } finally {
      this.isVerifying = false
    }
  }

  async handleAddSecret(id: string, type: VaultItemType, data: string) {
    if (!this.manager) return
    if (this.syncBlocked) {
      this.errorMsg = this.t('auth_storage.sync_blocked_edits')
      return
    }
    this.errorMsg = ''
    this.dismissSuccess()
    this.isSaving = true
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
    try {
      await this.enqueueStorage(async () => {
        const rawRecords = (await this.raceStorageTimeout(
          this.manager!.add_secret(id, type, data),
          'Add secret',
        )) as NookSecretRecord[]
        this.secrets = rawRecords
      })
      this.refreshSecretsFromSession()
      this.showSuccess(this.t('toasts.secret_saved'))
      await this.runFanOutSyncAfterLocalSave()
    } catch (e: unknown) {
      this.errorMsg = `Failed to save secret: ${e instanceof Error ? e.message : String(e)}`
      throw e
    } finally {
      this.isSaving = false
    }
  }

  private scheduleRemoteEventOutboxFlush(): void {
    void this.flushRemoteEventOutboxNow()
  }

  private async flushRemoteEventOutboxNow(): Promise<void> {
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
    if (!this.manager) return
    if (this.syncBlocked) {
      this.errorMsg = this.t('auth_storage.sync_blocked_edits')
      return
    }
    this.errorMsg = ''
    this.dismissSuccess()
    this.isSaving = true
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
    try {
      await this.enqueueStorage(async () => {
        const rawRecords = (await this.manager!.delete_secret(
          id,
        )) as NookSecretRecord[]
        this.secrets = rawRecords
      })
      this.refreshSecretsFromSession()
      this.showSuccess(this.t('toasts.secret_deleted'))
      this.scheduleFanOutSyncAfterLocalSave()
    } catch (e: unknown) {
      this.errorMsg = `Failed to delete secret: ${e instanceof Error ? e.message : String(e)}`
      throw e
    } finally {
      this.isSaving = false
    }
  }

  async handleReplaceSecret(oldId: string, type: VaultItemType, data: string) {
    if (!this.manager) return
    if (this.syncBlocked) {
      this.errorMsg = this.t('auth_storage.sync_blocked_edits')
      return
    }
    this.errorMsg = ''
    this.dismissSuccess()
    this.isSaving = true
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
    try {
      const newId = this.manager!.generate_secret_id()
      await this.enqueueStorage(async () => {
        const rawRecords = (await this.manager!.replace_secret(
          oldId,
          newId,
          type,
          data,
        )) as NookSecretRecord[]
        this.secrets = rawRecords
      })
      this.refreshSecretsFromSession()
      this.showSuccess(this.t('toasts.item_updated'))
      this.scheduleFanOutSyncAfterLocalSave()
    } catch (e: unknown) {
      this.errorMsg = `Failed to update item: ${e instanceof Error ? e.message : String(e)}`
      throw e
    } finally {
      this.isSaving = false
    }
  }
}
