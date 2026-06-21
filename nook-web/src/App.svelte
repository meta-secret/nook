<script lang="ts">
  import { onMount } from 'svelte'
  import { Lock, ShieldCheck, TriangleAlert } from '@lucide/svelte'
  import { VaultState } from '$lib/vault.svelte'

  // Subcomponents
  import Dashboard from '$lib/components/Dashboard.svelte'
  import AuthStorage from '$lib/components/AuthStorage.svelte'
  import SecretVault from '$lib/components/SecretVault.svelte'

  const vault = new VaultState()

  onMount(async () => {
    await vault.init()
  })
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
          class="px-4 py-1.5 text-sm font-medium rounded-md transition-all duration-200 {vault.activeTab ===
          'dashboard'
            ? 'bg-slate-800 text-white shadow-sm'
            : 'text-slate-400 hover:text-slate-200'}"
          onclick={() => (vault.activeTab = 'dashboard')}
        >
          Dashboard
        </button>
        <button
          class="px-4 py-1.5 text-sm font-medium rounded-md transition-all duration-200 {vault.activeTab ===
          'auth'
            ? 'bg-slate-800 text-white shadow-sm'
            : 'text-slate-400 hover:text-slate-200'}"
          onclick={() => (vault.activeTab = 'auth')}
        >
          Auth & Storage
        </button>
        <button
          class="px-4 py-1.5 text-sm font-medium rounded-md transition-all duration-200 {vault.activeTab ===
          'secrets'
            ? 'bg-slate-800 text-white shadow-sm'
            : 'text-slate-400 hover:text-slate-200'}"
          onclick={() => (vault.activeTab = 'secrets')}
        >
          Secret Vault
        </button>
      </nav>
    </div>
  </header>

  <div class="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
    <!-- Notifications -->
    {#if vault.errorMsg}
      <div
        class="mb-6 flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-950/40 p-4 text-sm text-red-300 animate-in fade-in slide-in-from-top-2"
        role="alert"
      >
        <TriangleAlert class="size-5 shrink-0 text-red-400 mt-0.5" />
        <div class="flex-1">
          <p class="font-semibold">Action Failed</p>
          <p class="mt-1 text-red-400/90">{vault.errorMsg}</p>
        </div>
      </div>
    {/if}

    {#if vault.successMsg}
      <div
        class="mb-6 flex items-start gap-3 rounded-lg border border-emerald-500/20 bg-emerald-950/40 p-4 text-sm text-emerald-300 animate-in fade-in slide-in-from-top-2"
        role="alert"
      >
        <ShieldCheck class="size-5 shrink-0 text-emerald-400 mt-0.5" />
        <div class="flex-1">
          <p class="font-semibold">Success</p>
          <p class="mt-1 text-emerald-400/90">{vault.successMsg}</p>
        </div>
      </div>
    {/if}

    <!-- Tab Panels -->
    {#if vault.activeTab === 'dashboard'}
      <Dashboard snapshot={vault.snapshot} loadError={vault.loadError} />
    {:else if vault.activeTab === 'auth'}
      <AuthStorage
        bind:storageMode={vault.storageMode}
        bind:githubPat={vault.githubPat}
        bind:githubRepo={vault.githubRepo}
        bind:githubPath={vault.githubPath}
        bind:passphrase={vault.passphrase}
        isAuthenticated={vault.isAuthenticated}
        isVerifying={vault.isVerifying}
        isSaving={vault.isSaving}
        secretsCount={vault.secrets.length}
        onConnect={() => vault.loadDb()}
        onInitializeEmpty={() => vault.handleInitializeEmpty()}
      />
    {:else if vault.activeTab === 'secrets'}
      <SecretVault
        secrets={vault.secrets}
        isAuthenticated={vault.isAuthenticated}
        isSaving={vault.isSaving}
        onAddSecret={(key, value) => vault.handleAddSecret(key, value)}
        onDeleteSecret={(key) => vault.handleDeleteSecret(key)}
        onGoToAuth={() => (vault.activeTab = 'auth')}
      />
    {/if}
  </div>
</main>
