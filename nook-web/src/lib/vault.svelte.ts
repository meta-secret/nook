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
import type {
  NookVaultManager,
  NookSecretRecord,
} from '$lib/nook-wasm/nook_wasm'
import {
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

  static readonly SYNC_INTERVAL_MS = 10_000

  private successDismissTimer: ReturnType<typeof setTimeout> | null = null
  private syncTimer: ReturnType<typeof setInterval> | null = null

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
      await this.manager.request_vault_access(
        this.storageMode,
        this.githubPat,
        isoTimestamp(),
      )
      await this.ensureProviderSaved()
      await this.refreshDeviceState()
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
    this.isInitializing = true
    this.isVerifying = false
    this.errorMsg = ''
    try {
      await this.loadProviders()
      this.applyActiveProviderCredentials()
      this.manager = await getVaultManager()
      await this.refreshDeviceState()
    } catch (error) {
      this.errorMsg =
        error instanceof Error
          ? error.message
          : 'Failed to initialize Nook Session Manager.'
    } finally {
      this.isInitializing = false
    }
    this.startVaultSync()
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
    const type = this.loginSetupType ?? this.storageMode
    const isNewSetup = this.loginSetupType !== null

    if (isNewSetup) {
      const provider: StorageProvider = {
        id: crypto.randomUUID(),
        type,
        label: providerDefaultLabel(type),
        githubPat: type === 'github' ? pat : undefined,
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
      }
      this.providers = this.providers.map((p) =>
        p.id === updated.id ? updated : p,
      )
    } else {
      const provider: StorageProvider = {
        id: crypto.randomUUID(),
        type,
        label: providerDefaultLabel(type),
        githubPat: type === 'github' ? pat : undefined,
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
    void this.syncFromStorage()
    this.syncTimer = setInterval(() => {
      void this.syncFromStorage()
    }, VaultState.SYNC_INTERVAL_MS)
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
    if (!this.manager || this.isVerifying) return
    if (!options?.force && this.isSaving) return
    if (this.storageMode === 'github' && !this.githubPat.trim()) return

    try {
      const raw = await this.manager.sync_vault_from_storage(
        this.storageMode,
        this.githubPat,
      )
      this.applyVaultSyncResult(mapVaultSyncResult(raw))
    } catch {
      // Background sync should not interrupt the UI.
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

  async refreshDeviceState() {
    if (!this.manager) return
    try {
      await this.manager.init_device()
      this.deviceId = this.manager.device_id
      this.devicePublicKey = this.manager.device_public_key
      if (this.storageMode === 'github' && !this.githubPat.trim()) {
        this.pendingJoins = []
        this.vaultMembers = []
        return
      }
      await this.syncFromStorage()
      if (!this.isAuthenticated) {
        this.pendingJoins = []
        this.vaultMembers = []
      }
    } catch {
      // Device identity is optional until first connect/join action.
    }
  }

  async requestVaultAccess() {
    if (!this.manager) return
    this.errorMsg = ''
    this.dismissSuccess()
    this.isVerifying = true
    try {
      await this.manager.request_vault_access(
        this.storageMode,
        this.githubPat,
        isoTimestamp(),
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
      const rawRecords = (await this.manager.approve_join_request(
        joinDeviceId,
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

  async enrollAndConnect() {
    if (!this.manager) return
    const secretsKey = this.enrollSecretsKey.trim()
    const membersKey = this.enrollMembersKey.trim()
    if (!secretsKey || !membersKey) return

    this.errorMsg = ''
    this.dismissSuccess()
    this.isVerifying = true
    try {
      const rawRecords = (await this.manager.enroll_and_connect(
        this.storageMode,
        this.githubPat,
        secretsKey,
        membersKey,
      )) as NookSecretRecord[]
      this.secrets = mapWasmRecords(rawRecords)
      this.isAuthenticated = true
      this.enrollSecretsKey = ''
      this.enrollMembersKey = ''
      await this.ensureProviderSaved()
      this.hydrateMultiDeviceState()
      await this.syncFromStorage()
      this.showSuccess('Enrolled and connected to the vault.')
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
      await this.refreshDeviceState()

      const assessPromise = this.manager.assess_vault_connect(
        this.storageMode,
        this.githubPat,
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
      const accessStatus = (await Promise.race([
        assessPromise,
        assessTimeout,
      ])) as string

      if (accessStatus === 'needs_enrollment') {
        this.joinEnrollmentPrompt = 'needs_request'
        return
      }
      if (accessStatus === 'join_pending') {
        this.joinEnrollmentPrompt = 'pending'
        return
      }

      const connectPromise = this.manager.connect(
        this.storageMode,
        this.githubPat,
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
      const rawRecords = (await Promise.race([
        connectPromise,
        timeoutPromise,
      ])) as NookSecretRecord[]
      this.secrets = mapWasmRecords(rawRecords)
      this.isAuthenticated = true
      await this.ensureProviderSaved()
      this.hydrateMultiDeviceState()
      await this.syncFromStorage()
      if (this.storageMode === 'local') {
        this.showSuccess('Local vault loaded from IndexedDB.')
      } else {
        this.showSuccess(
          'Connected to GitHub. Encryption key is stored locally in this browser.',
        )
      }
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
      const rawRecords = (await this.manager.add_secret(
        key,
        value,
      )) as NookSecretRecord[]
      this.secrets = mapWasmRecords(rawRecords)
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
      const rawRecords = (await this.manager.delete_secret(
        key,
      )) as NookSecretRecord[]
      this.secrets = mapWasmRecords(rawRecords)
      this.showSuccess('Secret deleted successfully.')
    } catch (e: unknown) {
      this.errorMsg = `Failed to delete secret: ${e instanceof Error ? e.message : String(e)}`
      throw e
    } finally {
      this.isSaving = false
    }
  }

  async handleInitializeEmpty() {
    if (!this.manager) return
    this.errorMsg = ''
    this.dismissSuccess()
    this.isSaving = true
    try {
      const rawRecords =
        (await this.manager.initialize_empty()) as NookSecretRecord[]
      this.secrets = mapWasmRecords(rawRecords)
      this.isAuthenticated = true
      await this.ensureProviderSaved()
      this.showSuccess('Empty database initialized successfully.')
    } catch (e: unknown) {
      this.errorMsg = `Failed to initialize: ${e instanceof Error ? e.message : String(e)}`
      throw e
    } finally {
      this.isSaving = false
    }
  }
}
