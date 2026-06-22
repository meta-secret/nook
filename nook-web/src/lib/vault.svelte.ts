import {
  getVaultManager,
  isoTimestamp,
  mapVaultSyncResult,
  mapWasmRecords,
  mapWasmJoinRequests,
  mapWasmVaultMembers,
  type JoinRequest,
  type SecretRecord,
  type VaultMember,
} from '$lib/nook'
import { SvelteDate } from 'svelte/reactivity'
import type {
  NookVaultManager,
  NookSecretRecord,
} from '$lib/nook-wasm/nook_wasm'
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
    } else {
      await this.refreshDeviceState()
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
      this.hasProviders &&
      this.activeProvider !== null &&
      this.loginSetupType === null &&
      !this.addProviderOpen
    )
  }

  async loadProviders() {
    const snapshot = await loadAuthProviders()
    this.providers = snapshot.providers
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

  async ensureProviderSaved() {
    const pat = this.githubPat.trim()
    const repo = this.githubRepo.trim() || DEFAULT_GITHUB_REPO
    const type = this.loginSetupType ?? this.storageMode
    const isNewSetup = this.loginSetupType !== null

    if (isNewSetup) {
      const provider: StorageProvider = {
        id: crypto.randomUUID(),
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
        id: crypto.randomUUID(),
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
      if (this.isVerifying || this.isSaving || this.isSyncing) {
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

  private hydrateMultiDeviceState() {
    if (!this.manager || !this.isAuthenticated) return
    try {
      this.pendingJoins = mapWasmJoinRequests(this.manager.list_pending_joins())
      this.vaultMembers = mapWasmVaultMembers(this.manager.list_vault_members())
    } catch {
      this.vaultMembers = []
    }
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
        this.hydrateMultiDeviceState()
      } else {
        this.pendingJoins = []
        this.vaultMembers = []
      }
    } catch {
      // Manual refresh should not interrupt the UI.
    }
  }

  openSettings() {
    this.settingsOpen = true
    void this.refreshDeviceState()
  }

  closeSettings() {
    this.settingsOpen = false
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
      this.hydrateMultiDeviceState()
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
      this.hydrateMultiDeviceState()
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
      this.hydrateMultiDeviceState()
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
        this.joinEnrollmentPrompt = 'needs_request'
        this.startVaultSync()
        return
      }
      if (accessStatus === 'join_pending') {
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
      this.hydrateMultiDeviceState()
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

  async handleAddSecret(key: string, value: string) {
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
          key,
          value,
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

  async handleDeleteSecret(key: string) {
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
          key,
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
}
