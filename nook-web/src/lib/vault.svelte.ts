import { getVaultManager, mapWasmRecords, type SecretRecord } from '$lib/nook'
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

  async init() {
    this.isInitializing = true
    this.isVerifying = false
    this.errorMsg = ''
    try {
      this.manager = await getVaultManager()
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
  }

  closeSettings() {
    this.settingsOpen = false
  }

  filterSecrets(query: string): SecretRecord[] {
    if (!this.manager) return []
    return mapWasmRecords(this.manager.filter_secrets(query))
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
    this.successMsg = ''
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
      if (this.storageMode === 'local') {
        this.successMsg = 'Local vault loaded from IndexedDB.'
      } else {
        this.successMsg =
          'Connected to GitHub. Encryption key is stored locally in this browser.'
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
    this.successMsg = ''
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
      this.successMsg = 'Secret saved successfully.'
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
    this.successMsg = ''
    this.isSaving = true
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
    try {
      const rawRecords = (await this.manager.delete_secret(
        key,
      )) as NookSecretRecord[]
      this.secrets = mapWasmRecords(rawRecords)
      this.successMsg = 'Secret deleted successfully.'
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
    this.successMsg = ''
    this.isSaving = true
    try {
      const rawRecords =
        (await this.manager.initialize_empty()) as NookSecretRecord[]
      this.secrets = mapWasmRecords(rawRecords)
      this.isAuthenticated = true
      this.successMsg = 'Empty database initialized successfully.'
    } catch (e: unknown) {
      this.errorMsg = `Failed to initialize: ${e instanceof Error ? e.message : String(e)}`
      throw e
    } finally {
      this.isSaving = false
    }
  }
}
