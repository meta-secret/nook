import { getVaultManager, mapWasmRecords, mapWasmJoinRequests, mapWasmVaultMembers, type JoinRequest, type SecretRecord, type VaultMember } from '$lib/nook'
import type {
  NookVaultManager,
  NookSecretRecord,
} from '$lib/nook-wasm/nook_wasm'

export class VaultState {
  settingsOpen = $state(false)

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

  private successDismissTimer: ReturnType<typeof setTimeout> | null = null

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

  private showSuccess(message: string) {
    this.dismissSuccess()
    this.successMsg = message
    this.successDismissTimer = setTimeout(() => {
      this.dismissSuccess()
    }, 5000)
  }

  async init() {
    this.isInitializing = true
    this.isVerifying = false
    this.errorMsg = ''
    try {
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

    this.storageMode =
      (localStorage.getItem('nook_storage_mode') as 'local' | 'github') ||
      'local'
    this.githubPat = localStorage.getItem('nook_github_pat') || ''
  }

  saveConfig() {
    localStorage.setItem('nook_storage_mode', this.storageMode)
    localStorage.setItem('nook_github_pat', this.githubPat)
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
      if (this.isAuthenticated) {
        this.pendingJoins = mapWasmJoinRequests(
          this.manager.list_pending_joins(),
        )
        try {
          this.vaultMembers = mapWasmVaultMembers(
            this.manager.list_vault_members(),
          )
        } catch {
          this.vaultMembers = []
        }
      } else {
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
        new Date().toISOString(),
      )
      this.saveConfig()
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
      await this.refreshDeviceState()
      this.showSuccess('Device approved. They can now connect from their browser.')
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
      this.saveConfig()
      await this.refreshDeviceState()
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
      this.saveConfig()
      await this.refreshDeviceState()
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
      this.showSuccess('Empty database initialized successfully.')
    } catch (e: unknown) {
      this.errorMsg = `Failed to initialize: ${e instanceof Error ? e.message : String(e)}`
      throw e
    } finally {
      this.isSaving = false
    }
  }
}
