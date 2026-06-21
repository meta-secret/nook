<script lang="ts">
  import { onMount } from 'svelte'
  import {
    Boxes,
    CheckCircle2,
    GitBranch,
    Layers3,
    TriangleAlert,
    Lock,
    Unlock,
    Eye,
    EyeOff,
    Copy,
    Check,
    Trash2,
    KeyRound,
    Server,
    Plus,
    RefreshCw,
    ShieldCheck,
    Search,
  } from '@lucide/svelte'
  import { Badge } from '$lib/components/ui/badge'
  import { Button } from '$lib/components/ui/button'
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from '$lib/components/ui/card'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import { getProjectInitials } from '$lib/project-format'
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

  // Svelte 5 States
  let snapshot = $state<NookSnapshot | null>(null)
  let loadError = $state('')

  let activeTab = $state<'dashboard' | 'auth' | 'secrets'>('dashboard')

  // Storage settings
  let storageMode = $state<'local' | 'github'>('local')
  let githubPat = $state('')
  let githubRepo = $state('')
  let githubPath = $state('nook-secrets.age')
  let passphrase = $state('')

  // Database manager state
  let manager = $state<NookVaultManager | null>(null)
  let isAuthenticated = $state(false)
  let secrets = $state<SecretRecord[]>([])

  // Status & loading indicators
  let errorMsg = $state('')
  let successMsg = $state('')
  let isVerifying = $state(false)
  let isSaving = $state(false)

  // Vault page states
  let newKey = $state('')
  let newValue = $state('')
  let searchPattern = $state('')
  let revealSecrets = $state<Record<string, boolean>>({})
  let copiedKey = $state<string | null>(null)

  // Password Generator states
  let genLength = $state(16)
  let genUppercase = $state(true)
  let genLowercase = $state(true)
  let genNumbers = $state(true)
  let genSymbols = $state(true)

  onMount(async () => {
    // Load workspace snapshot
    try {
      snapshot = await loadNookSnapshot()
    } catch (error) {
      loadError =
        error instanceof Error ? error.message : 'Unable to load nook-wasm.'
    }

    // Instantiate Rust Wasm Session Manager
    try {
      manager = await getVaultManager()
    } catch (error) {
      loadError =
        error instanceof Error
          ? error.message
          : 'Failed to initialize Nook Session Manager.'
    }

    // Load credentials
    storageMode =
      (localStorage.getItem('nook_storage_mode') as 'local' | 'github') ||
      'local'
    githubPat = localStorage.getItem('nook_github_pat') || ''
    githubRepo = localStorage.getItem('nook_github_repo') || ''
    githubPath = localStorage.getItem('nook_github_path') || 'nook-secrets.age'
    passphrase = localStorage.getItem('nook_passphrase') || ''

    // Auto-connect if passphrase exists
    if (passphrase && manager) {
      if (storageMode === 'local' || (githubPat && githubRepo)) {
        loadDb()
      }
    }
  })

  function saveConfig() {
    localStorage.setItem('nook_storage_mode', storageMode)
    localStorage.setItem('nook_github_pat', githubPat)
    localStorage.setItem('nook_github_repo', githubRepo)
    localStorage.setItem('nook_github_path', githubPath)
    localStorage.setItem('nook_passphrase', passphrase)
  }

  async function loadDb() {
    if (!manager) return
    errorMsg = ''
    successMsg = ''
    isVerifying = true
    saveConfig()
    try {
      const rawRecords = (await manager.connect(
        storageMode,
        passphrase,
        githubPat,
        githubRepo,
        githubPath,
      )) as NookSecretRecord[]
      secrets = mapWasmRecords(rawRecords)
      isAuthenticated = true
      if (storageMode === 'local') {
        successMsg = 'Local Mock Storage loaded.'
      } else {
        successMsg = 'Secrets file loaded & decrypted successfully from GitHub.'
      }
    } catch (e: unknown) {
      isAuthenticated = false
      errorMsg = e instanceof Error ? e.message : String(e)
    } finally {
      isVerifying = false
    }
  }

  async function handleAddSecret(e: SubmitEvent) {
    e.preventDefault()
    if (!newKey || !newValue) {
      errorMsg = 'Please provide both a label/key and a secret value.'
      return
    }
    if (!manager) return
    errorMsg = ''
    successMsg = ''
    isSaving = true
    try {
      const rawRecords = (await manager.add_secret(
        newKey,
        newValue,
      )) as NookSecretRecord[]
      secrets = mapWasmRecords(rawRecords)
      newKey = ''
      newValue = ''
      successMsg = 'Secret saved successfully.'
    } catch (e: unknown) {
      errorMsg = `Failed to save secret: ${e instanceof Error ? e.message : String(e)}`
    } finally {
      isSaving = false
    }
  }

  async function handleDeleteSecret(key: string) {
    if (!confirm(`Are you sure you want to delete the secret for "${key}"?`)) {
      return
    }
    if (!manager) return
    errorMsg = ''
    successMsg = ''
    isSaving = true
    try {
      const rawRecords = (await manager.delete_secret(
        key,
      )) as NookSecretRecord[]
      secrets = mapWasmRecords(rawRecords)
      successMsg = 'Secret deleted successfully.'
    } catch (e: unknown) {
      errorMsg = `Failed to delete secret: ${e instanceof Error ? e.message : String(e)}`
    } finally {
      isSaving = false
    }
  }

  async function handleInitializeEmpty() {
    if (!manager) return
    errorMsg = ''
    successMsg = ''
    isSaving = true
    try {
      const rawRecords =
        (await manager.initialize_empty()) as NookSecretRecord[]
      secrets = mapWasmRecords(rawRecords)
      isAuthenticated = true
      successMsg = 'Empty database initialized successfully.'
    } catch (e: unknown) {
      errorMsg = `Failed to initialize: ${e instanceof Error ? e.message : String(e)}`
    } finally {
      isSaving = false
    }
  }

  async function copyToClipboard(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text)
      copiedKey = key
      setTimeout(() => {
        if (copiedKey === key) copiedKey = null
      }, 2000)
    } catch (err) {
      console.error('Copy failed:', err)
    }
  }

  function toggleReveal(key: string) {
    revealSecrets = {
      ...revealSecrets,
      [key]: !revealSecrets[key],
    }
  }

  function generatePassword() {
    let chars = ''
    if (genLowercase) chars += 'abcdefghijklmnopqrstuvwxyz'
    if (genUppercase) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    if (genNumbers) chars += '0123456789'
    if (genSymbols) chars += '!@#$%^&*()_+-=[]{}|;:,.<>?'

    if (!chars) {
      errorMsg = 'Please select at least one character set.'
      return
    }

    let result = ''
    const array = new Uint32Array(genLength)
    window.crypto.getRandomValues(array)
    for (let i = 0; i < genLength; i++) {
      result += chars[array[i] % chars.length]
    }
    newValue = result
  }

  // Derived state for filtered secrets
  let filteredSecrets = $derived(
    secrets.filter((s) =>
      s.key.toLowerCase().includes(searchPattern.toLowerCase()),
    ),
  )
</script>

<main
  class="min-h-svh bg-linear-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100 pb-16"
>
  <!-- Nav Header -->
  <header
    class="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50"
  >
    <div
      class="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8"
    >
      <div class="flex items-center gap-3">
        <div
          class="p-2 bg-indigo-600/10 rounded-lg border border-indigo-500/20 text-indigo-400"
        >
          <Lock class="size-6" />
        </div>
        <div>
          <span
            class="text-xl font-bold tracking-tight bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent"
            >nook</span
          >
          <span
            class="ml-2 text-xs font-medium text-slate-500 border border-slate-800 px-1.5 py-0.5 rounded-sm"
            >v0.1.0</span
          >
        </div>
      </div>

      <!-- Tab Buttons -->
      <nav
        class="flex p-1 bg-slate-900/90 border border-slate-800/80 rounded-lg"
        aria-label="Main Navigation"
      >
        <button
          class="px-4 py-1.5 text-sm font-medium rounded-md transition-all duration-200 {activeTab ===
          'dashboard'
            ? 'bg-slate-800 text-white shadow-sm'
            : 'text-slate-400 hover:text-slate-200'}"
          onclick={() => (activeTab = 'dashboard')}
        >
          Dashboard
        </button>
        <button
          class="px-4 py-1.5 text-sm font-medium rounded-md transition-all duration-200 {activeTab ===
          'auth'
            ? 'bg-slate-800 text-white shadow-sm'
            : 'text-slate-400 hover:text-slate-200'}"
          onclick={() => (activeTab = 'auth')}
        >
          Auth & Storage
        </button>
        <button
          class="px-4 py-1.5 text-sm font-medium rounded-md transition-all duration-200 {activeTab ===
          'secrets'
            ? 'bg-slate-800 text-white shadow-sm'
            : 'text-slate-400 hover:text-slate-200'}"
          onclick={() => (activeTab = 'secrets')}
        >
          Secret Vault
        </button>
      </nav>
    </div>
  </header>

  <div class="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
    <!-- Notifications -->
    {#if errorMsg}
      <div
        class="mb-6 flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-950/40 p-4 text-sm text-red-300 animate-in fade-in slide-in-from-top-2"
        role="alert"
      >
        <TriangleAlert class="size-5 shrink-0 text-red-400 mt-0.5" />
        <div class="flex-1">
          <p class="font-semibold">Action Failed</p>
          <p class="mt-1 text-red-400/90">{errorMsg}</p>
        </div>
      </div>
    {/if}

    {#if successMsg}
      <div
        class="mb-6 flex items-start gap-3 rounded-lg border border-emerald-500/20 bg-emerald-950/40 p-4 text-sm text-emerald-300 animate-in fade-in slide-in-from-top-2"
        role="alert"
      >
        <ShieldCheck class="size-5 shrink-0 text-emerald-400 mt-0.5" />
        <div class="flex-1">
          <p class="font-semibold">Success</p>
          <p class="mt-1 text-emerald-400/90">{successMsg}</p>
        </div>
      </div>
    {/if}

    <!-- Tab Panels -->
    {#if activeTab === 'dashboard'}
      <div class="space-y-8 animate-in fade-in duration-200">
        <!-- Banner -->
        <div
          class="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50 p-6 md:p-8"
        >
          <div
            class="absolute -right-16 -top-16 size-48 rounded-full bg-indigo-500/10 blur-3xl"
          ></div>
          <div
            class="absolute -left-16 -bottom-16 size-48 rounded-full bg-violet-500/10 blur-3xl"
          ></div>

          <div class="relative max-w-3xl space-y-3">
            <Badge
              variant="outline"
              class="border-indigo-500/30 text-indigo-400 bg-indigo-950/20"
              >Monorepo Workspace</Badge
            >
            <h1
              class="text-3xl font-bold tracking-tight text-white md:text-5xl"
            >
              Stateless security, backed by Rust.
            </h1>
            <p class="text-base text-slate-400 md:text-lg">
              {snapshot?.summary ?? 'Loading Wasm toolchain...'}
            </p>
          </div>
        </div>

        <!-- Metrics Grid -->
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card class="bg-slate-900/40 border-slate-800/80">
            <CardHeader class="pb-2">
              <CardTitle
                class="flex items-center gap-2 text-sm font-semibold text-slate-400"
              >
                <Boxes class="size-4 text-indigo-400" />
                Workspace Crates
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div class="text-3xl font-bold text-white">
                {snapshot?.projects.length ?? 0}
              </div>
              <p class="text-xs text-slate-500 mt-1">
                Svelte web interface & core modules
              </p>
            </CardContent>
          </Card>

          <Card class="bg-slate-900/40 border-slate-800/80">
            <CardHeader class="pb-2">
              <CardTitle
                class="flex items-center gap-2 text-sm font-semibold text-slate-400"
              >
                <Layers3 class="size-4 text-indigo-400" />
                Dependency Flow
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div class="text-3xl font-bold text-white">1-Way</div>
              <p class="text-xs text-slate-500 mt-1">
                nook-core ➔ nook-wasm ➔ nook-web
              </p>
            </CardContent>
          </Card>

          <Card class="bg-slate-900/40 border-slate-800/80">
            <CardHeader class="pb-2">
              <CardTitle
                class="flex items-center gap-2 text-sm font-semibold text-slate-400"
              >
                <CheckCircle2 class="size-4 text-emerald-400" />
                Rust WASM Runtime
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div class="text-3xl font-bold text-white">
                {snapshot ? 'Ready' : 'Initializing...'}
              </div>
              <p class="text-xs text-slate-500 mt-1">
                Encrypted with rage-compatible age standard
              </p>
            </CardContent>
          </Card>
        </div>

        <!-- Projects Grid -->
        <div>
          <h2 class="text-lg font-semibold text-white mb-4">Crate Registry</h2>
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {#each snapshot?.projects ?? [] as project (project.name)}
              <Card
                class="bg-slate-900/20 border-slate-800/80 hover:border-slate-700/80 transition-all duration-200"
              >
                <CardHeader>
                  <div
                    class="mb-4 flex size-10 items-center justify-center rounded-lg bg-indigo-600/10 border border-indigo-500/20 text-sm font-bold text-indigo-400"
                  >
                    {getProjectInitials(project.name)}
                  </div>
                  <CardTitle class="text-white text-base"
                    >{project.name}</CardTitle
                  >
                  <CardDescription class="text-slate-400 text-xs mt-1"
                    >{project.purpose}</CardDescription
                  >
                </CardHeader>
                <CardContent class="pt-0">
                  <Badge class="bg-slate-800 text-slate-300 hover:bg-slate-800"
                    >{project.language}</Badge
                  >
                </CardContent>
              </Card>
            {/each}

            {#if !snapshot && !loadError}
              {#each [1, 2, 3] as index (index)}
                <Card
                  class="bg-slate-900/20 border-slate-800/80"
                  aria-hidden="true"
                  data-index={index}
                >
                  <CardHeader>
                    <Skeleton class="mb-4 size-10 rounded-lg bg-slate-800" />
                    <Skeleton class="h-4 w-28 bg-slate-800" />
                    <Skeleton class="h-3 w-full mt-2 bg-slate-800" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton class="h-6 w-16 bg-slate-800" />
                  </CardContent>
                </Card>
              {/each}
            {/if}
          </div>
        </div>
      </div>
    {:else if activeTab === 'auth'}
      <div class="grid gap-6 md:grid-cols-3 animate-in fade-in duration-200">
        <!-- Main config panel -->
        <div class="md:col-span-2 space-y-6">
          <Card class="bg-slate-900/40 border-slate-800/80">
            <CardHeader>
              <CardTitle class="text-white"
                >Credentials & Storage Providers</CardTitle
              >
              <CardDescription class="text-slate-400"
                >Choose where to store your encrypted vault and configure your
                master passphrase.</CardDescription
              >
            </CardHeader>
            <CardContent>
              <form
                onsubmit={(e) => {
                  e.preventDefault()
                  loadDb()
                }}
                class="space-y-5"
              >
                <!-- Mode Toggle -->
                <div class="space-y-2">
                  <label
                    class="text-sm font-medium text-slate-300"
                    for="storage-mode-select">Storage Target</label
                  >
                  <div class="grid grid-cols-2 gap-2" id="storage-mode-select">
                    <button
                      type="button"
                      class="flex items-center justify-center gap-2 p-3 rounded-lg border text-sm font-medium transition-all {storageMode ===
                      'local'
                        ? 'bg-indigo-600/10 border-indigo-500/50 text-indigo-400'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-300'}"
                      onclick={() => (storageMode = 'local')}
                    >
                      <Server class="size-4" />
                      Local Storage Mock (IndexedDB)
                    </button>
                    <button
                      type="button"
                      class="flex items-center justify-center gap-2 p-3 rounded-lg border text-sm font-medium transition-all {storageMode ===
                      'github'
                        ? 'bg-indigo-600/10 border-indigo-500/50 text-indigo-400'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-300'}"
                      onclick={() => (storageMode = 'github')}
                    >
                      <GitBranch class="size-4" />
                      GitHub Repository
                    </button>
                  </div>
                </div>

                <!-- Passphrase -->
                <div class="space-y-2">
                  <div class="flex items-center justify-between">
                    <label
                      class="text-sm font-medium text-slate-300"
                      for="passphrase">Master Passphrase</label
                    >
                    <span class="text-xs text-slate-500"
                      >Used for client-side age encryption</span
                    >
                  </div>
                  <div class="relative">
                    <input
                      id="passphrase"
                      type="password"
                      bind:value={passphrase}
                      placeholder="Enter master password key"
                      required
                      class="flex h-10 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/50"
                    />
                  </div>
                </div>

                {#if storageMode === 'github'}
                  <div
                    class="border-t border-slate-800/80 pt-5 space-y-4 animate-in fade-in duration-300"
                  >
                    <!-- PAT -->
                    <div class="space-y-2">
                      <label
                        class="text-sm font-medium text-slate-300"
                        for="pat">GitHub PAT (Personal Access Token)</label
                      >
                      <input
                        id="pat"
                        type="password"
                        bind:value={githubPat}
                        placeholder="ghp_xxxxxxxxxxxx"
                        required
                        class="flex h-10 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/50"
                      />
                      <p class="text-xs text-slate-500">
                        Requires `repo` scope to read and write files in private
                        repositories.
                      </p>
                    </div>

                    <!-- Repository -->
                    <div class="space-y-2">
                      <label
                        class="text-sm font-medium text-slate-300"
                        for="repo">GitHub Repository</label
                      >
                      <input
                        id="repo"
                        type="text"
                        bind:value={githubRepo}
                        placeholder="owner/repository"
                        required
                        class="flex h-10 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/50"
                      />
                    </div>

                    <!-- Path -->
                    <div class="space-y-2">
                      <label
                        class="text-sm font-medium text-slate-300"
                        for="path">File Storage Path</label
                      >
                      <input
                        id="path"
                        type="text"
                        bind:value={githubPath}
                        placeholder="nook-secrets.age"
                        required
                        class="flex h-10 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/50"
                      />
                    </div>
                  </div>
                {/if}

                <div class="pt-2 flex gap-3">
                  <Button
                    type="submit"
                    class="bg-indigo-600 hover:bg-indigo-500 text-white flex-1"
                    disabled={isVerifying}
                  >
                    {#if isVerifying}
                      <RefreshCw class="size-4 animate-spin mr-2" />
                      Connecting...
                    {:else}
                      <ShieldCheck class="size-4 mr-2" />
                      Verify & Connect Vault
                    {/if}
                  </Button>

                  {#if isAuthenticated && secrets.length === 0}
                    <Button
                      variant="outline"
                      onclick={handleInitializeEmpty}
                      disabled={isSaving}
                      class="border-slate-800 text-slate-300 hover:bg-slate-900"
                    >
                      Initialize Vault
                    </Button>
                  {/if}
                </div>
              </form>
            </CardContent>
          </Card>
        </div>

        <!-- Sidebar notes -->
        <div class="space-y-6">
          <Card class="bg-slate-900/40 border-slate-800/80">
            <CardHeader>
              <CardTitle class="text-white text-sm"
                >Security & Architecture</CardTitle
              >
            </CardHeader>
            <CardContent class="text-xs text-slate-400 space-y-4">
              <div class="flex gap-2">
                <ShieldCheck class="size-4 shrink-0 text-indigo-400 mt-0.5" />
                <p>
                  <strong class="text-slate-200">Zero Knowledge:</strong> All data
                  is encrypted and decrypted in WebAssembly directly in your browser.
                  Passphrases and keys never leave your device.
                </p>
              </div>
              <div class="flex gap-2">
                <KeyRound class="size-4 shrink-0 text-indigo-400 mt-0.5" />
                <p>
                  <strong class="text-slate-200">Age Encryption:</strong> Employs
                  the `age` format (via scrypt and x25519) to guard data. Compatible
                  with the command-line `rage` utility.
                </p>
              </div>
              <div class="flex gap-2">
                <Boxes class="size-4 shrink-0 text-indigo-400 mt-0.5" />
                <p>
                  <strong class="text-slate-200">IndexedDB:</strong> Stored locally
                  using the Rust-Wasm futures wrapper crate `rexie` for safe storage
                  inside the browser.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card class="bg-slate-900/40 border-slate-800/80">
            <CardHeader>
              <CardTitle class="text-white text-sm">Status Info</CardTitle>
            </CardHeader>
            <CardContent class="space-y-3">
              <div class="flex items-center justify-between text-sm">
                <span class="text-slate-400">Vault Status:</span>
                {#if isAuthenticated}
                  <Badge
                    class="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/10"
                    >Unlocked</Badge
                  >
                {:else}
                  <Badge
                    class="bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/10"
                    >Locked</Badge
                  >
                {/if}
              </div>
              <div class="flex items-center justify-between text-sm">
                <span class="text-slate-400">Mode:</span>
                <span class="text-white font-medium capitalize"
                  >{storageMode}</span
                >
              </div>
              {#if storageMode === 'github' && githubRepo}
                <div class="flex items-center justify-between text-sm">
                  <span class="text-slate-400">Repo:</span>
                  <span class="text-white font-mono text-xs">{githubRepo}</span>
                </div>
              {/if}
              <div class="flex items-center justify-between text-sm">
                <span class="text-slate-400">Total Secrets:</span>
                <span class="text-indigo-400 font-bold">{secrets.length}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    {:else if activeTab === 'secrets'}
      <div class="animate-in fade-in duration-200">
        {#if !isAuthenticated}
          <!-- Unauthenticated Vault Lock View -->
          <div
            class="flex flex-col items-center justify-center border border-slate-800 bg-slate-900/30 rounded-xl p-16 text-center max-w-2xl mx-auto space-y-6"
          >
            <div
              class="p-4 bg-indigo-600/10 rounded-full border border-indigo-500/20 text-indigo-400"
            >
              <Lock class="size-12" />
            </div>
            <div class="space-y-2">
              <h2 class="text-2xl font-bold text-white">Vault is Locked</h2>
              <p class="text-slate-400 max-w-md">
                Please configure your master passphrase and select a storage
                provider under the Auth & Storage tab to unlock the vault.
              </p>
            </div>
            <Button
              onclick={() => (activeTab = 'auth')}
              class="bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              Configure Storage Provider
            </Button>
          </div>
        {:else}
          <!-- Authenticated Vault Interface -->
          <div class="grid gap-6 lg:grid-cols-3">
            <!-- Left panel: Add Secret & Generator -->
            <div class="space-y-6">
              <!-- Add Secret Form -->
              <Card class="bg-slate-900/40 border-slate-800/80">
                <CardHeader>
                  <CardTitle class="text-white text-base"
                    >Add New Secret</CardTitle
                  >
                  <CardDescription class="text-slate-400"
                    >Insert or update a key/value pair in your encrypted
                    database.</CardDescription
                  >
                </CardHeader>
                <CardContent>
                  <form onsubmit={handleAddSecret} class="space-y-4">
                    <div class="space-y-2">
                      <label
                        class="text-xs font-semibold text-slate-400"
                        for="secret-label">Label / Identifier</label
                      >
                      <input
                        id="secret-label"
                        type="text"
                        bind:value={newKey}
                        placeholder="e.g. github.com (personal)"
                        required
                        class="flex h-10 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/50"
                      />
                    </div>

                    <div class="space-y-2">
                      <label
                        class="text-xs font-semibold text-slate-400"
                        for="secret-value">Secret Value / Password</label
                      >
                      <input
                        id="secret-value"
                        type="text"
                        bind:value={newValue}
                        placeholder="Enter secret text"
                        required
                        class="flex h-10 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/50"
                      />
                    </div>

                    <Button
                      type="submit"
                      class="w-full bg-indigo-600 hover:bg-indigo-500 text-white"
                      disabled={isSaving}
                    >
                      {#if isSaving}
                        <RefreshCw class="size-4 animate-spin mr-2" />
                        Saving to {storageMode === 'github'
                          ? 'GitHub'
                          : 'Local'}...
                      {:else}
                        <Plus class="size-4 mr-2" />
                        Save Secret
                      {/if}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <!-- Password Generator -->
              <Card class="bg-slate-900/40 border-slate-800/80">
                <CardHeader class="pb-3">
                  <CardTitle
                    class="text-white text-base flex items-center gap-2"
                  >
                    <KeyRound class="size-4 text-indigo-400" />
                    Password Generator
                  </CardTitle>
                  <CardDescription class="text-slate-400"
                    >Generate a cryptographically secure random password.</CardDescription
                  >
                </CardHeader>
                <CardContent class="space-y-4">
                  <div class="space-y-1.5">
                    <div
                      class="flex items-center justify-between text-xs font-semibold text-slate-400"
                    >
                      <span>Length</span>
                      <span class="text-indigo-400 font-bold"
                        >{genLength} chars</span
                      >
                    </div>
                    <input
                      type="range"
                      min="8"
                      max="64"
                      bind:value={genLength}
                      class="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>

                  <div class="grid grid-cols-2 gap-2.5">
                    <label
                      class="flex items-center gap-2 text-xs text-slate-300 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        bind:checked={genLowercase}
                        class="rounded-sm border-slate-800 text-indigo-600 bg-slate-950 focus:ring-0"
                      />
                      a-z (lowercase)
                    </label>
                    <label
                      class="flex items-center gap-2 text-xs text-slate-300 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        bind:checked={genUppercase}
                        class="rounded-sm border-slate-800 text-indigo-600 bg-slate-950 focus:ring-0"
                      />
                      A-Z (uppercase)
                    </label>
                    <label
                      class="flex items-center gap-2 text-xs text-slate-300 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        bind:checked={genNumbers}
                        class="rounded-sm border-slate-800 text-indigo-600 bg-slate-950 focus:ring-0"
                      />
                      0-9 (numbers)
                    </label>
                    <label
                      class="flex items-center gap-2 text-xs text-slate-300 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        bind:checked={genSymbols}
                        class="rounded-sm border-slate-800 text-indigo-600 bg-slate-950 focus:ring-0"
                      />
                      !@#$ (symbols)
                    </label>
                  </div>

                  <Button
                    variant="outline"
                    onclick={generatePassword}
                    class="w-full border-slate-800 text-slate-300 hover:bg-slate-900 mt-2"
                  >
                    <RefreshCw class="size-3.5 mr-2" />
                    Generate & Populate
                  </Button>
                </CardContent>
              </Card>
            </div>

            <!-- Right panel: Vault Secrets List -->
            <div class="lg:col-span-2 space-y-4">
              <!-- Search Bar -->
              <div class="relative">
                <Search class="absolute left-3 top-3 size-4 text-slate-500" />
                <input
                  type="text"
                  bind:value={searchPattern}
                  placeholder="Search labels..."
                  class="flex h-10 w-full rounded-lg border border-slate-800 bg-slate-900/50 pl-10 pr-4 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/50"
                />
              </div>

              <!-- List Card -->
              <Card class="bg-slate-900/40 border-slate-800/80">
                <CardContent class="p-0">
                  {#if filteredSecrets.length === 0}
                    <div class="p-12 text-center text-slate-500 space-y-2">
                      <Unlock class="size-8 mx-auto text-slate-700" />
                      <p>No secrets matched your search.</p>
                      <p class="text-xs">
                        Add new secrets on the left to fill your secure vault.
                      </p>
                    </div>
                  {:else}
                    <div class="divide-y divide-slate-800/60" role="list">
                      {#each filteredSecrets as secret (secret.key)}
                        <div
                          class="flex items-center justify-between p-4 hover:bg-slate-900/40 transition-colors"
                          role="listitem"
                        >
                          <div class="space-y-1 pr-4 min-w-0 flex-1">
                            <h3
                              class="text-sm font-semibold text-white truncate"
                            >
                              {secret.key}
                            </h3>
                            <div class="flex items-center gap-2">
                              {#if revealSecrets[secret.key]}
                                <code
                                  class="text-xs font-mono text-indigo-300 break-all select-all"
                                  >{secret.value}</code
                                >
                              {:else}
                                <span
                                  class="text-xs font-mono text-slate-600 tracking-wider"
                                  >••••••••••••••••</span
                                >
                              {/if}
                            </div>
                          </div>

                          <div class="flex items-center gap-1.5">
                            <!-- Toggle reveal -->
                            <button
                              onclick={() => toggleReveal(secret.key)}
                              aria-label={revealSecrets[secret.key]
                                ? 'Hide password'
                                : 'Show password'}
                              class="p-2 text-slate-400 hover:text-white hover:bg-slate-800/80 rounded-md transition-colors"
                            >
                              {#if revealSecrets[secret.key]}
                                <EyeOff class="size-4" />
                              {:else}
                                <Eye class="size-4" />
                              {/if}
                            </button>

                            <!-- Copy to clipboard -->
                            <button
                              onclick={() =>
                                copyToClipboard(secret.value, secret.key)}
                              aria-label="Copy password to clipboard"
                              class="p-2 text-slate-400 hover:text-white hover:bg-slate-800/80 rounded-md transition-colors relative"
                            >
                              {#if copiedKey === secret.key}
                                <Check
                                  class="size-4 text-emerald-400 animate-in zoom-in duration-200"
                                />
                              {:else}
                                <Copy class="size-4" />
                              {/if}
                            </button>

                            <!-- Delete -->
                            <button
                              onclick={() => handleDeleteSecret(secret.key)}
                              aria-label="Delete secret"
                              class="p-2 text-slate-400 hover:text-red-400 hover:bg-red-950/20 rounded-md transition-colors"
                            >
                              <Trash2 class="size-4" />
                            </button>
                          </div>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </CardContent>
              </Card>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</main>
