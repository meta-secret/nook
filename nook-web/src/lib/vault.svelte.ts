import {
  generateId,
  getVaultManager,
  isoTimestamp,
  mapVaultSyncResult,
  mapWasmRecords,
  mapWasmJoinRequests,
  mapWasmVaultMembers,
  type JoinRequest,
  type SecretRecord,
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
import type {
  NookVaultManager,
  NookSecretRecord,
} from '$lib/nook-wasm/nook_wasm'
import {
  mapWasmPasswordEntries,
  type VaultPasswordEntrySummary,
} from '$lib/vault-password'
import {
  DEFAULT_DRIVE_VAULT_FILE,
  DEFAULT_GITHUB_REPO,
  formatDriveStorageRef,
  loadAuthProviders,
  providerDefaultLabel,
  saveAuthProviders,
  wasmStorageModeForProvider,
  type OAuthFileConfig,
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

export class VaultState {
  locale = $state<AppLocale>('en')
  translations = $state<Record<string, unknown>>({})

  settingsOpen = $state(false)
  settingsSection = $state<'storage' | 'onboard'>('storage')
  settingsAccordionSection = $state<'storage' | 'passwords' | 'devices'>(
    'storage',
  )
  helpOpen = $state(false)

  providers = $state<StorageProvider[]>([])
  activeProviderId = $state<string | null>(null)
  providersLoaded = $state(false)
  loginSetupType = $state<StorageProviderType | null>(null)
  addProviderOpen = $state(false)

  storageMode = $state<StorageProviderType>('local')
  githubPat = $state('')
  githubRepo = $state(DEFAULT_GITHUB_REPO)
  oauthFile = $state<OAuthFileConfig | null>(null)
  googleOAuthBusy = $state(false)

  manager = $state<NookVaultManager | null>(null)
  isAuthenticated = $state(false)
  secrets = $state<SecretRecord[]>([])

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

  unlockMode = $state<'keys' | 'password'>('keys')
  /** Remote vault unlock mode detected on the login screen (before session open). */
  loginUnlockMode = $state<'unknown' | 'keys' | 'password'>('unknown')
  /** Login gate phase: connect to storage, then authorize to decrypt. */
  loginFlowStep = $state<'connection' | 'authorization'>('connection')
  /** Open the login password form after Connect finds a password-mode vault. */
  loginPasswordPrompt = $state(false)
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

  /** Default 30s; override with VITE_VAULT_SYNC_INTERVAL_MS (min 250) for e2e. */
  private static syncIntervalMs(): number {
    const raw = import.meta.env.VITE_VAULT_SYNC_INTERVAL_MS
    const parsed = raw === undefined || raw === '' ? NaN : Number(raw)
    if (Number.isFinite(parsed) && parsed >= 250) {
      return parsed
    }
    return 30_000
  }

  private successDismissTimer: ReturnType<typeof setTimeout> | null = null
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

  private wasmStorageArgs(): [string, string, string] {
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
    const refreshed = await ensureValidOAuthFileConfig(this.oauthFile)
    if (
      refreshed.accessToken === this.oauthFile.accessToken &&
      refreshed.expiresAt === this.oauthFile.expiresAt
    ) {
      return
    }
    this.oauthFile = refreshed
    if (this.activeProvider?.type === 'oauth-file') {
      this.providers = this.providers.map((provider) =>
        provider.id === this.activeProviderId
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

  private async applyGoogleOAuthTokens(
    tokens: GoogleOAuthTokens,
  ): Promise<void> {
    const email = await fetchGoogleAccountEmail(tokens.accessToken)
    this.loginSetupType = 'oauth-file'
    if (!this.addProviderOpen) {
      this.storageMode = 'oauth-file'
    }
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
      await this.enqueueStorage(() =>
        this.manager!.request_vault_access(
          ...this.wasmStorageArgs(),
          isoTimestamp(),
        ),
      )
      await this.ensureProviderSaved()
      this.joinEnrollmentPrompt = 'pending'
      this.startVaultSync()
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

  get activeProvider(): StorageProvider | null {
    return this.providers.find((p) => p.id === this.activeProviderId) ?? null
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

      await this.loadProviders()
      this.applyActiveProviderCredentials()
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
    const autoUnlock = !hasPendingEnrollment && this.shouldAutoUnlock()
    if (autoUnlock) {
      await this.loadDb()
      if (!this.isAuthenticated && this.activeProvider) {
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
    return (
      this.providers.length === 1 &&
      this.activeProvider !== null &&
      this.loginSetupType === null &&
      !this.addProviderOpen
    )
  }

  async loadProviders() {
    const snapshot = await loadAuthProviders()
    this.providers = snapshot.providers.map((p) =>
      p.label === 'GitHub sync' ? { ...p, label: 'GitHub' } : p,
    )
    this.activeProviderId =
      snapshot.activeProviderId ?? snapshot.providers[0]?.id ?? null
    this.providersLoaded = true
  }

  applyActiveProviderCredentials() {
    const stagingGoogle =
      this.loginSetupType === 'oauth-file' &&
      Boolean(this.oauthFile?.accessToken?.trim())

    const provider = this.activeProvider
    if (!provider) {
      if (this.loginSetupType) {
        this.storageMode = this.loginSetupType
        if (this.loginSetupType !== 'github') {
          this.githubPat = ''
        }
        if (this.loginSetupType !== 'oauth-file') {
          this.oauthFile = null
        }
      }
      return
    }

    if (stagingGoogle && this.addProviderOpen) {
      this.storageMode = provider.type
      this.githubPat = provider.githubPat ?? ''
      this.githubRepo = provider.githubRepo?.trim() || DEFAULT_GITHUB_REPO
      return
    }

    this.storageMode = provider.type
    this.githubPat = provider.githubPat ?? ''
    if (provider.type === 'oauth-file') {
      this.oauthFile = provider.oauthFile ?? null
      this.githubRepo =
        provider.oauthFile?.fileName?.trim() || DEFAULT_DRIVE_VAULT_FILE
    } else {
      this.githubRepo = provider.githubRepo?.trim() || DEFAULT_GITHUB_REPO
      this.oauthFile = null
    }
  }

  async persistProviders() {
    await saveAuthProviders({
      providers: this.providers,
      activeProviderId: this.activeProviderId,
    })
  }

  beginProviderSetup(type: StorageProviderType) {
    this.loginSetupType = type
    this.storageMode = type
    this.githubPat = ''
    this.githubRepo =
      type === 'oauth-file' ? DEFAULT_DRIVE_VAULT_FILE : DEFAULT_GITHUB_REPO
    this.oauthFile = type === 'oauth-file' ? this.oauthFile : null
    this.errorMsg = ''
    this.dismissSuccess()
  }

  beginAddProvider() {
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

  async selectProvider(id: string) {
    this.activeProviderId = id
    this.loginSetupType = null
    this.applyActiveProviderCredentials()
    await this.persistProviders()
    this.errorMsg = ''
  }

  /**
   * Detect whether the active provider's vault unlocks with device keys or a
   * password envelope — drives login-screen copy and routing.
   */
  async probeLoginUnlockMode(): Promise<void> {
    await this.refreshPasswordEntriesList()
  }

  async refreshPasswordEntriesList(): Promise<boolean> {
    if (!this.manager) return false
    try {
      if (this.isAuthenticated) {
        this.passwordEntries = mapWasmPasswordEntries(
          this.manager.listVaultPasswordEntries(),
        )
        this.unlockMode = 'keys'
        return true
      }
      if (!this.hasRemoteCredentials()) {
        this.passwordEntries = []
        this.loginUnlockMode = 'unknown'
        return false
      }
      await this.ensureOAuthTokensFresh()
      const raw = await this.enqueueStorage(() =>
        this.manager!.fetchVaultPasswordEntries(...this.wasmStorageArgs()),
      )
      this.passwordEntries = mapWasmPasswordEntries(raw)
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

  /** Login gate step 1: highlight a saved provider without reaching storage yet. */
  async selectLoginProvider(id: string): Promise<void> {
    if (this.activeProviderId !== id) {
      this.loginFlowStep = 'connection'
      this.passwordEntries = []
      this.selectedPasswordEntryId = null
      this.loginUnlockMode = 'unknown'
    }
    await this.selectProvider(id)
  }

  /** Login gate step 1 → 2: reach the vault file and load password-entry metadata. */
  async connectLoginProvider(): Promise<void> {
    if (!this.activeProviderId) {
      this.errorMsg = 'Choose a storage provider.'
      return
    }
    this.errorMsg = ''
    this.isVerifying = true
    try {
      await this.ensureOAuthTokensFresh()
      const ok = await this.refreshPasswordEntriesList()
      if (!ok) {
        this.errorMsg =
          'Could not reach the vault on this provider. Check credentials and try again.'
        return
      }
      this.loginFlowStep = 'authorization'
    } finally {
      this.isVerifying = false
    }
  }

  backToLoginProviderStep() {
    this.loginFlowStep = 'connection'
    this.passwordEntries = []
    this.selectedPasswordEntryId = null
    this.loginUnlockMode = 'unknown'
    this.errorMsg = ''
  }

  private clearUnlockedSession() {
    this.stopVaultSync()
    this.isAuthenticated = false
    this.secrets = []
    this.pendingJoins = []
    this.vaultMembers = []
    this.joinEnrollmentPrompt = 'none'
    this.enrollSecretsKey = ''
    this.enrollMembersKey = ''
    this.loginUnlockMode = 'unknown'
    this.settingsOpen = false
    this.enrollmentCode = ''
    this.errorMsg = ''
  }

  /** Drop a saved provider from this browser. Vault files on storage are untouched. */
  async removeProvider(id: string): Promise<void> {
    const target = this.providers.find((p) => p.id === id)
    if (!target) return

    const wasActive = this.activeProviderId === id
    const signedOut = this.isAuthenticated && wasActive

    this.providers = this.providers.filter((p) => p.id !== id)

    if (this.providers.length === 0) {
      this.activeProviderId = null
      if (this.isAuthenticated) {
        this.clearUnlockedSession()
      }
    } else if (wasActive) {
      this.activeProviderId = this.providers[0]!.id
      if (signedOut) {
        this.clearUnlockedSession()
      }
    }

    this.applyActiveProviderCredentials()
    await this.persistProviders()

    if (!this.isAuthenticated) {
      this.loginFlowStep = 'connection'
      this.passwordEntries = []
      this.selectedPasswordEntryId = null
      this.loginUnlockMode = 'unknown'
    }

    this.showSuccess(this.t('toasts.removed_device', { label: target.label }))
  }

  async ensureProviderSaved() {
    const pat = this.githubPat.trim()
    const repo = this.githubRepo.trim() || DEFAULT_GITHUB_REPO
    const driveFile = this.githubRepo.trim() || DEFAULT_DRIVE_VAULT_FILE
    const type = this.loginSetupType ?? this.storageMode
    const isNewSetup = this.loginSetupType !== null
    const oauthSnapshot: OAuthFileConfig | undefined =
      type === 'oauth-file'
        ? {
            preset: 'google-drive',
            accessToken: this.oauthFile?.accessToken ?? '',
            refreshToken: this.oauthFile?.refreshToken,
            expiresAt: this.oauthFile?.expiresAt,
            fileId: this.oauthFile?.fileId,
            accountEmail: this.oauthFile?.accountEmail,
            fileName: driveFile,
          }
        : undefined

    if (isNewSetup) {
      const provider: StorageProvider = {
        id: generateId(),
        type,
        label: providerDefaultLabel(
          type,
          type === 'github' ? repo : type === 'oauth-file' ? driveFile : undefined,
        ),
        githubPat: type === 'github' ? pat : undefined,
        githubRepo: type === 'github' ? repo : undefined,
        oauthFile: oauthSnapshot,
        createdAt: isoTimestamp(),
      }
      this.providers = [...this.providers, provider]
      this.activeProviderId = provider.id
    } else if (this.activeProvider) {
      const updated: StorageProvider = {
        ...this.activeProvider,
        type: this.storageMode,
        githubPat:
          this.storageMode === 'github'
            ? pat || this.activeProvider.githubPat
            : undefined,
        githubRepo: this.storageMode === 'github' ? repo : undefined,
        oauthFile:
          this.storageMode === 'oauth-file'
            ? (oauthSnapshot ?? this.activeProvider.oauthFile)
            : undefined,
      }
      this.providers = this.providers.map((p) =>
        p.id === updated.id ? updated : p,
      )
    } else {
      const provider: StorageProvider = {
        id: generateId(),
        type,
        label: providerDefaultLabel(
          type,
          type === 'github' ? repo : type === 'oauth-file' ? driveFile : undefined,
        ),
        githubPat: type === 'github' ? pat : undefined,
        githubRepo: type === 'github' ? repo : undefined,
        oauthFile: oauthSnapshot,
        createdAt: isoTimestamp(),
      }
      this.providers = [provider]
      this.activeProviderId = provider.id
    }

    if (this.storageMode === 'oauth-file' && this.oauthFile?.fileId) {
      const active = this.providers.find((p) => p.id === this.activeProviderId)
      if (
        active?.oauthFile &&
        active.oauthFile.fileId !== this.oauthFile.fileId
      ) {
        const merged: OAuthFileConfig = {
          preset: 'google-drive',
          accessToken:
            this.oauthFile.accessToken || active.oauthFile.accessToken,
          refreshToken: active.oauthFile.refreshToken,
          expiresAt: active.oauthFile.expiresAt ?? this.oauthFile.expiresAt,
          fileId: this.oauthFile.fileId,
          fileName:
            active.oauthFile.fileName?.trim() ||
            this.oauthFile.fileName?.trim() ||
            driveFile,
          accountEmail:
            active.oauthFile.accountEmail ?? this.oauthFile.accountEmail,
        }
        this.oauthFile = merged
        this.providers = this.providers.map((p) =>
          p.id === this.activeProviderId ? { ...p, oauthFile: merged } : p,
        )
      }
    }

    this.loginSetupType = null
    this.addProviderOpen = false
    this.applyActiveProviderCredentials()
    await this.persistProviders()
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

  private applyVaultSyncResult(result: ReturnType<typeof mapVaultSyncResult>) {
    if (this.isAuthenticated) {
      if (result.secrets) {
        this.secrets = result.secrets
      }
      if (result.pending_joins !== undefined) {
        this.pendingJoins = result.pending_joins
      }
      if (result.vault_members !== undefined) {
        this.vaultMembers = result.vault_members
      }
      return
    }

    if (!result.changed) return

    if (
      result.access_status === 'ready' &&
      this.joinEnrollmentPrompt === 'pending'
    ) {
      this.joinEnrollmentPrompt = 'none'
      this.showSuccess(this.t('toasts.device_approved'))
    } else if (
      result.access_status === 'join_pending' &&
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
    try {
      const snapshot = await this.enqueueStorage(async () => {
        await Promise.resolve()
        return {
          pendingJoins: this.manager!.list_pending_joins(),
          vaultMembers: this.manager!.list_vault_members(),
          unlockMode: this.manager!.vaultUnlockMode(),
        }
      })
      this.pendingJoins = mapWasmJoinRequests(snapshot.pendingJoins)
      this.vaultMembers = mapWasmVaultMembers(snapshot.vaultMembers)
      this.unlockMode = 'keys'
      void this.refreshPasswordEntriesList()
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
    if (!options?.force && this.isVerifying) return
    if (!options?.force && this.isSaving) return
    if (!options?.force && this.isSyncing) return
    if (!this.hasRemoteCredentials()) return
    await this.ensureOAuthTokensFresh()

    this.isSyncing = true
    try {
      const raw = await this.enqueueStorage(() =>
        this.manager!.sync_vault_from_storage(...this.wasmStorageArgs()),
      )
      this.applyVaultSyncResult(mapVaultSyncResult(raw))
      this.lastSyncedAt = new SvelteDate()
    } catch {
      // Background sync should not interrupt the UI.
    } finally {
      this.isSyncing = false
    }
  }

  async manualSync() {
    if (!this.manager) return
    try {
      await this.initDeviceIdentity()
      if (!this.hasRemoteCredentials()) {
        this.pendingJoins = []
        this.vaultMembers = []
        return
      }
      await this.syncFromStorage({ force: true })
      if (this.isAuthenticated) {
        void this.hydrateMultiDeviceState()
      } else {
        this.pendingJoins = []
        this.vaultMembers = []
      }
    } catch {
      // Manual refresh should not interrupt the UI.
    }
  }

  openSettings(
    section: 'storage' | 'onboard' = 'storage',
    accordion: 'storage' | 'passwords' | 'devices' = 'storage',
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

  /** End the in-memory session and return to the login gate (device keys stay in this browser). */
  lockVault() {
    this.clearUnlockedSession()
    this.loginFlowStep = 'connection'
    this.passwordEntries = []
    this.selectedPasswordEntryId = null
    this.loginUnlockMode = 'unknown'
  }

  openHelp() {
    this.settingsOpen = false
    this.helpOpen = true
  }

  closeHelp() {
    this.helpOpen = false
  }

  filterSecrets(query: string): SecretRecord[] {
    if (!this.manager) return []
    return mapWasmRecords(this.manager.filter_secrets(query))
  }

  private refreshSecretsFromSession() {
    this.secrets = this.filterSecrets('')
  }

  async refreshDeviceState() {
    await this.manualSync()
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
      this.secrets = mapWasmRecords(rawRecords)
      void this.hydrateMultiDeviceState()
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
      this.secrets = mapWasmRecords(rawRecords)
      await this.hydrateMultiDeviceState()
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
      (member) =>
        member.auth_id === authId && member.device_id === this.deviceId,
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
        this.loginFlowStep = 'connection'
        this.showSuccess(this.t('toasts.device_removed'))
        return
      }
      this.secrets = mapWasmRecords(rawRecords)
      await this.hydrateMultiDeviceState()
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
      this.secrets = mapWasmRecords(rawRecords)
      this.isAuthenticated = true
      await this.ensureProviderSaved()
      void this.hydrateMultiDeviceState()
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
      this.secrets = mapWasmRecords(rawRecords)
      this.isAuthenticated = true
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

      const accessStatus = await this.enqueueStorage(async () => {
        const assessPromise = this.manager!.assess_vault_connect(
          ...this.wasmStorageArgs(),
        )
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
      })

      if (accessStatus === 'needs_enrollment') {
        await this.ensureProviderSaved()
        const hasPasswordFallback = await this.refreshPasswordEntriesList()
        if (hasPasswordFallback && this.passwordEntries.length > 0) {
          this.loginFlowStep = 'authorization'
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
          this.loginFlowStep = 'authorization'
          this.loginPasswordPrompt = true
          this.joinEnrollmentPrompt = 'none'
          return
        }
        this.joinEnrollmentPrompt = 'pending'
        this.startVaultSync()
        return
      }

      const rawRecords = await this.enqueueStorage(async () => {
        const connectPromise = this.manager!.connect(...this.wasmStorageArgs())
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
      this.secrets = mapWasmRecords(rawRecords)
      this.isAuthenticated = true
      this.syncOAuthRemoteRefFromManager()
      await this.ensureProviderSaved()
      void this.hydrateMultiDeviceState()
      await this.syncFromStorage({ force: true })
      if (this.storageMode === 'local') {
        this.showSuccess(this.t('toasts.local_loaded'))
      } else if (this.storageMode === 'oauth-file') {
        this.showSuccess(this.t('toasts.google_drive_connected'))
      } else {
        this.showSuccess(this.t('toasts.github_connected'))
      }
      this.startVaultSync()
    } catch (e: unknown) {
      this.isAuthenticated = false
      const message = e instanceof Error ? e.message : String(e)
      this.errorMsg = this.resolveErrorMessage(message)
    } finally {
      this.isVerifying = false
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
    providerId = this.activeProviderId ?? '',
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
    await this.storageChain
    await new Promise((resolve) => setTimeout(resolve, 0))
    try {
      if (this.passwordEntries.length === 0) {
        throw new Error(
          'Add a backup vault password first; enrollment codes wrap that password.',
        )
      }
      // `verifyVaultPassword` returns false on a wrong password but can
      // also throw if the underlying age decryptor panics on certain
      // scrypt failures inside the wasm runtime — treat both as "wrong
      // password" so the UI message stays predictable.
      let verified: boolean
      try {
        verified = this.manager.verifyVaultPassword(entryId, password)
      } catch {
        verified = false
      }
      if (!verified) {
        throw new Error('Password does not match the vault.')
      }
      const selectedProvider = this.providers.find((p) => p.id === providerId)
      if (!selectedProvider) {
        throw new Error('Choose an auth provider.')
      }
      const provider: EnrollmentProvider =
        selectedProvider.type === 'github'
          ? {
              type: 'github',
              pat: selectedProvider.githubPat?.trim() ?? '',
              repo: selectedProvider.githubRepo?.trim() ?? '',
            }
          : { type: 'local' }
      if (provider.type === 'github' && (!provider.pat || !provider.repo)) {
        throw new Error(
          'GitHub provider is missing credentials. Reconnect and try again.',
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
      this.secrets = mapWasmRecords(rawRecords)
      this.isAuthenticated = true
      await this.ensureProviderSaved()
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

      const rawRecords = (await this.enqueueStorage(() =>
        this.manager!.connectWithPassword(
          ...this.wasmStorageArgs(),
          entryId,
          unlockPassword,
        ),
      )) as NookSecretRecord[]
      this.secrets = mapWasmRecords(rawRecords)
      this.isAuthenticated = true
      await this.ensureProviderSaved()
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
    this.errorMsg = ''
    this.dismissSuccess()
    this.isSaving = true
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
    try {
      await this.enqueueStorage(async () => {
        const rawRecords = (await this.manager!.add_secret(
          id,
          type,
          data,
        )) as NookSecretRecord[]
        this.secrets = mapWasmRecords(rawRecords)
      })
      this.refreshSecretsFromSession()
      this.showSuccess(this.t('toasts.secret_saved'))
    } catch (e: unknown) {
      this.errorMsg = `Failed to save secret: ${e instanceof Error ? e.message : String(e)}`
      throw e
    } finally {
      this.isSaving = false
    }
  }

  async handleDeleteSecret(id: string) {
    if (!this.manager) return
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
        this.secrets = mapWasmRecords(rawRecords)
      })
      this.refreshSecretsFromSession()
      this.showSuccess(this.t('toasts.secret_deleted'))
    } catch (e: unknown) {
      this.errorMsg = `Failed to delete secret: ${e instanceof Error ? e.message : String(e)}`
      throw e
    } finally {
      this.isSaving = false
    }
  }

  async handleReplaceSecret(oldId: string, type: VaultItemType, data: string) {
    if (!this.manager) return
    this.errorMsg = ''
    this.dismissSuccess()
    this.isSaving = true
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
    try {
      const newId = generateId()
      await this.enqueueStorage(async () => {
        const rawRecords = (await this.manager!.replace_secret(
          oldId,
          newId,
          type,
          data,
        )) as NookSecretRecord[]
        this.secrets = mapWasmRecords(rawRecords)
      })
      this.refreshSecretsFromSession()
      this.showSuccess(this.t('toasts.item_updated'))
    } catch (e: unknown) {
      this.errorMsg = `Failed to update item: ${e instanceof Error ? e.message : String(e)}`
      throw e
    } finally {
      this.isSaving = false
    }
  }
}
