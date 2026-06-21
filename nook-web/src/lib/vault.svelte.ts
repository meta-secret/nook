import {
  loadNookSnapshot,
  getVaultManager,
  mapWasmRecords,
  type NookSnapshot,
  type SecretRecord,
} from '$lib/nook'
import type {
  NookVaultManager,
  NookSecretRecord,
} from '$lib/nook-wasm/nook_wasm'

export class VaultState {
  snapshot = $state<NookSnapshot | null>(null)
  loadError = $state('')

  activeTab = $state<'dashboard' | 'auth' | 'secrets'>('dashboard')

  // Storage settings
  storageMode = $state<'local' | 'github'>('local')
  githubPat = $state('')
  githubRepo = $state('')
  githubPath = $state('nook-secrets.age')
  passphrase = $state('')

  // Database manager state
  manager = $state<NookVaultManager | null>(null)
  isAuthenticated = $state(false)
  secrets = $state<SecretRecord[]>([])

  // Status & loading indicators
  errorMsg = $state('')
  successMsg = $state('')
  isVerifying = $state(false)
  isSaving = $state(false)

  async init() {
    // Load workspace snapshot
    try {
      this.snapshot = await loadNookSnapshot()
    } catch (error) {
      this.loadError =
        error instanceof Error ? error.message : 'Unable to load nook-wasm.'
    }

    // Instantiate Rust Wasm Session Manager
    try {
      this.manager = await getVaultManager()
    } catch (error) {
      this.loadError =
        error instanceof Error
          ? error.message
          : 'Failed to initialize Nook Session Manager.'
    }

    // Load credentials
    this.storageMode =
      (localStorage.getItem('nook_storage_mode') as 'local' | 'github') ||
      'local'
    this.githubPat = localStorage.getItem('nook_github_pat') || ''
    this.githubRepo = localStorage.getItem('nook_github_repo') || ''
    this.githubPath =
      localStorage.getItem('nook_github_path') || 'nook-secrets.age'
    this.passphrase = localStorage.getItem('nook_passphrase') || ''

    // Auto-connect if passphrase exists
    if (this.passphrase && this.manager) {
      if (this.storageMode === 'local' || (this.githubPat && this.githubRepo)) {
        await this.loadDb()
      }
    }
  }

  saveConfig() {
    localStorage.setItem('nook_storage_mode', this.storageMode)
    localStorage.setItem('nook_github_pat', this.githubPat)
    localStorage.setItem('nook_github_repo', this.githubRepo)
    localStorage.setItem('nook_github_path', this.githubPath)
    localStorage.setItem('nook_passphrase', this.passphrase)
  }

  async loadDb() {
    if (!this.manager) return
    this.errorMsg = ''
    this.successMsg = ''
    this.isVerifying = true
    this.saveConfig()
    try {
      const rawRecords = (await this.manager.connect(
        this.storageMode,
        this.passphrase,
        this.githubPat,
        this.githubRepo,
        this.githubPath,
      )) as NookSecretRecord[]
      this.secrets = mapWasmRecords(rawRecords)
      this.isAuthenticated = true
      if (this.storageMode === 'local') {
        this.successMsg = 'Local Mock Storage loaded.'
      } else {
        this.successMsg =
          'Secrets file loaded & decrypted successfully from GitHub.'
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
