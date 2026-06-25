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
  DEFAULT_GITHUB_REPO,
  loadAuthProviders,
  providerDefaultLabel,
  saveAuthProviders,
  type StorageProvider,
  type StorageProviderType,
} from '$lib/auth-providers'

export class VaultState {
  settingsOpen = $state(false)
  settingsSection = $state<'storage' | 'onboard'>('storage')
  settingsAccordionSection = $state<'storage' | 'passwords'>('storage')
  helpOpen = $state(false)

  providers = $state<StorageProvider[]>([])
  activeProviderId = $state<string | null>(null)
  providersLoaded = $state(false)
  loginSetupType = $state<StorageProviderType | null>(null)
  addProviderOpen = $state(false)

  storageMode = $state<'local' | 'github'>('local')
  githubPat = $state('')
  githubRepo = $state(DEFAULT_GITHUB_REPO)

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

  private wasmGithubArgs(): [string, string, string] {
    return [this.storageMode, this.githubPat, this.githubRepo]
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
          ...this.wasmGithubArgs(),
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
      await this.loadProviders()
      this.applyActiveProviderCredentials()
      this.manager = await getVaultManager()
      await this.initDeviceIdentity()
    } catch (error) {
      this.errorMsg =
        error instanceof Error
          ? error.message
          : 'Failed to initialize Nook Session Manager.'
    } finally {
      this.isInitializing = false
    }

    const autoUnlock = this.shouldAutoUnlock()
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
    const provider = this.activeProvider
    if (!provider) {
      if (this.loginSetupType) {
        this.storageMode = this.loginSetupType
        if (this.loginSetupType !== 'github') {
          this.githubPat = ''
        }
      }
      return
    }
    this.storageMode = provider.type
    this.githubPat = provider.githubPat ?? ''
    this.githubRepo = provider.githubRepo?.trim() || DEFAULT_GITHUB_REPO
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
    this.githubRepo = DEFAULT_GITHUB_REPO
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
      this.loginSetupType = null
      this.githubPat = ''
      this.githubRepo = DEFAULT_GITHUB_REPO
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
      if (this.storageMode === 'github' && !this.githubPat.trim()) {
        this.passwordEntries = []
        this.loginUnlockMode = 'unknown'
        return false
      }
      const raw = await this.enqueueStorage(() =>
        this.manager!.fetchVaultPasswordEntries(...this.wasmGithubArgs()),
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

    this.showSuccess(`Removed ${target.label}.`)
  }

  async ensureProviderSaved() {
    const pat = this.githubPat.trim()
    const repo = this.githubRepo.trim() || DEFAULT_GITHUB_REPO
    const type = this.loginSetupType ?? this.storageMode
    const isNewSetup = this.loginSetupType !== null

    if (isNewSetup) {
      const provider: StorageProvider = {
        id: generateId(),
        type,
        label: providerDefaultLabel(type, type === 'github' ? repo : undefined),
        githubPat: type === 'github' ? pat : undefined,
        githubRepo: type === 'github' ? repo : undefined,
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
      }
      this.providers = this.providers.map((p) =>
        p.id === updated.id ? updated : p,
      )
    } else {
      const provider: StorageProvider = {
        id: generateId(),
        type,
        label: providerDefaultLabel(type, type === 'github' ? repo : undefined),
        githubPat: type === 'github' ? pat : undefined,
        githubRepo: type === 'github' ? repo : undefined,
        createdAt: isoTimestamp(),
      }
      this.providers = [provider]
      this.activeProviderId = provider.id
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
      this.showSuccess('Your device was approved. Click Connect vault.')
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
    if (this.storageMode === 'github' && !this.githubPat.trim()) return

    this.isSyncing = true
    try {
      const raw = await this.enqueueStorage(() =>
        this.manager!.sync_vault_from_storage(...this.wasmGithubArgs()),
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
      if (this.storageMode === 'github' && !this.githubPat.trim()) {
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
    accordion: 'storage' | 'passwords' = 'storage',
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
          ...this.wasmGithubArgs(),
          isoTimestamp(),
        ),
      )
      await this.ensureProviderSaved()
      await this.refreshDeviceState()
      this.showSuccess(
        'Join request sent. An enrolled device must approve before you can connect.',
      )
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
      this.showSuccess(
        'Device approved. They can now connect from their browser.',
      )
    } catch (e: unknown) {
      this.errorMsg =
        e instanceof Error ? e.message : 'Failed to approve join request.'
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
          ...this.wasmGithubArgs(),
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
      this.showSuccess('Created a new vault on this device.')
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
          ...this.wasmGithubArgs(),
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
      this.showSuccess('Enrolled and connected to the vault.')
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

      const accessStatus = await this.enqueueStorage(async () => {
        const assessPromise = this.manager!.assess_vault_connect(
          ...this.wasmGithubArgs(),
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
        const connectPromise = this.manager!.connect(...this.wasmGithubArgs())
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
      await this.syncFromStorage({ force: true })
      if (this.storageMode === 'local') {
        this.showSuccess('Local vault loaded from IndexedDB.')
      } else {
        this.showSuccess(
          'Connected to GitHub. Encryption key is stored locally in this browser.',
        )
      }
      this.startVaultSync()
    } catch (e: unknown) {
      this.isAuthenticated = false
      this.errorMsg = e instanceof Error ? e.message : String(e)
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
          ? `Added "${label.trim()}".`
          : 'Backup password added. Device keys still unlock this vault.',
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
      this.showSuccess('Vault password updated.')
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
      this.showSuccess('Vault password removed.')
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
    if (this.storageMode === 'github' && !this.githubPat.trim()) {
      this.errorMsg = 'Configure GitHub credentials before unlocking.'
      return
    }
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
          ...this.wasmGithubArgs(),
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
      this.showSuccess('Vault unlocked with password.')
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
          ...this.wasmGithubArgs(),
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
      this.showSuccess('Enrolled this device via enrollment code.')
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
      this.showSuccess('Secret saved successfully.')
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
      this.showSuccess('Secret deleted successfully.')
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
      this.showSuccess('Item updated successfully.')
    } catch (e: unknown) {
      this.errorMsg = `Failed to update item: ${e instanceof Error ? e.message : String(e)}`
      throw e
    } finally {
      this.isSaving = false
    }
  }
}
