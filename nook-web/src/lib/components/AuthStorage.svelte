<script lang="ts">
  import {
    Server,
    GitBranch,
    KeyRound,
    ShieldCheck,
    Boxes,
    RefreshCw,
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

  let {
    storageMode = $bindable(),
    githubPat = $bindable(),
    githubRepo = $bindable(),
    githubPath = $bindable(),
    passphrase = $bindable(),
    isAuthenticated,
    isVerifying,
    isSaving,
    secretsCount,
    onConnect,
    onInitializeEmpty,
  }: {
    storageMode: 'local' | 'github'
    githubPat: string
    githubRepo: string
    githubPath: string
    passphrase: string
    isAuthenticated: boolean
    isVerifying: boolean
    isSaving: boolean
    secretsCount: number
    onConnect: () => void
    onInitializeEmpty: () => void
  } = $props()
</script>

<div class="grid gap-6 md:grid-cols-3 animate-in fade-in duration-200">
  <!-- Main config panel -->
  <div class="md:col-span-2 space-y-6">
    <Card class="bg-slate-900/40 border-slate-800/80">
      <CardHeader>
        <CardTitle class="text-white">Credentials & Storage Providers</CardTitle
        >
        <CardDescription class="text-slate-400"
          >Choose where to store your encrypted vault and configure your master
          passphrase.</CardDescription
        >
      </CardHeader>
      <CardContent>
        <form
          onsubmit={(e) => {
            e.preventDefault()
            onConnect()
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
              <label class="text-sm font-medium text-slate-300" for="passphrase"
                >Master Passphrase</label
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
                <label class="text-sm font-medium text-slate-300" for="pat"
                  >GitHub PAT (Personal Access Token)</label
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
                <label class="text-sm font-medium text-slate-300" for="repo"
                  >GitHub Repository</label
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
                <label class="text-sm font-medium text-slate-300" for="path"
                  >File Storage Path</label
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

            {#if isAuthenticated && secretsCount === 0}
              <Button
                variant="outline"
                onclick={onInitializeEmpty}
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
        <CardTitle class="text-white text-sm">Security & Architecture</CardTitle
        >
      </CardHeader>
      <CardContent class="text-xs text-slate-400 space-y-4">
        <div class="flex gap-2">
          <ShieldCheck class="size-4 shrink-0 text-indigo-400 mt-0.5" />
          <p>
            <strong class="text-slate-200">Zero Knowledge:</strong> All data is encrypted
            and decrypted in WebAssembly directly in your browser. Passphrases and
            keys never leave your device.
          </p>
        </div>
        <div class="flex gap-2">
          <KeyRound class="size-4 shrink-0 text-indigo-400 mt-0.5" />
          <p>
            <strong class="text-slate-200">Age Encryption:</strong> Employs the `age`
            format (via scrypt and x25519) to guard data. Compatible with the command-line
            `rage` utility.
          </p>
        </div>
        <div class="flex gap-2">
          <Boxes class="size-4 shrink-0 text-indigo-400 mt-0.5" />
          <p>
            <strong class="text-slate-200">IndexedDB:</strong> Stored locally using
            the Rust-Wasm futures wrapper crate `rexie` for safe storage inside the
            browser.
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
          <span class="text-white font-medium capitalize">{storageMode}</span>
        </div>
        {#if storageMode === 'github' && githubRepo}
          <div class="flex items-center justify-between text-sm">
            <span class="text-slate-400">Repo:</span>
            <span class="text-white font-mono text-xs">{githubRepo}</span>
          </div>
        {/if}
        <div class="flex items-center justify-between text-sm">
          <span class="text-slate-400">Total Secrets:</span>
          <span class="text-indigo-400 font-bold">{secretsCount}</span>
        </div>
      </CardContent>
    </Card>
  </div>
</div>
