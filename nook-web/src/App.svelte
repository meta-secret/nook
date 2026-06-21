<script lang="ts">
  import { onMount } from 'svelte'
  import { Lock, ShieldCheck, TriangleAlert } from '@lucide/svelte'
  import { VaultState } from '$lib/vault.svelte'

  // Subcomponents
  import AuthStorage from '$lib/components/AuthStorage.svelte'
  import SecretVault from '$lib/components/SecretVault.svelte'

  const vault = new VaultState()

  onMount(async () => {
    await vault.init()
  })
</script>

<main class="dark min-h-svh bg-background text-foreground pb-16">
  <!-- Nav Header -->
  <header
    class="border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-50"
  >
    <div
      class="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8"
    >
      <div class="flex items-center gap-3">
        <div
          class="p-2 bg-accent text-accent-foreground rounded-lg border border-border"
        >
          <Lock class="size-6" />
        </div>
        <div>
          <div class="flex items-center gap-2">
            <span class="text-xl font-bold tracking-tight text-foreground"
              >nook</span
            >
            <span
              class="text-xs font-medium text-muted-foreground border border-border px-1.5 py-0.5 rounded-sm"
              >v0.1.0</span
            >
            {#if vault.currentStatus}
              <span
                class="text-[10px] uppercase font-mono tracking-wider bg-accent text-accent-foreground border border-border px-1.5 py-0.5 rounded animate-pulse"
              >
                {vault.currentStatus}
              </span>
            {/if}
          </div>
        </div>
      </div>

      <!-- Tab Buttons -->
      <nav
        class="flex p-1 bg-muted border border-border rounded-lg"
        aria-label="Main Navigation"
      >
        <button
          class="px-4 py-1.5 text-sm font-medium rounded-md transition-all duration-200 {vault.activeTab ===
          'auth'
            ? 'bg-card text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'}"
          onclick={() => (vault.activeTab = 'auth')}
        >
          Auth & Storage
        </button>
        <button
          class="px-4 py-1.5 text-sm font-medium rounded-md transition-all duration-200 {vault.activeTab ===
          'secrets'
            ? 'bg-card text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'}"
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
        class="mb-6 flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive animate-in fade-in slide-in-from-top-2"
        role="alert"
      >
        <TriangleAlert class="size-5 shrink-0 text-destructive mt-0.5" />
        <div class="flex-1">
          <p class="font-semibold">Action Failed</p>
          <p class="mt-1 text-destructive/90">{vault.errorMsg}</p>
        </div>
      </div>
    {/if}

    {#if vault.successMsg}
      <div
        class="mb-6 flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/10 p-4 text-sm text-primary animate-in fade-in slide-in-from-top-2"
        role="alert"
      >
        <ShieldCheck class="size-5 shrink-0 text-primary mt-0.5" />
        <div class="flex-1">
          <p class="font-semibold">Success</p>
          <p class="mt-1 text-primary/90">{vault.successMsg}</p>
        </div>
      </div>
    {/if}

    <!-- Tab Panels -->
    {#if vault.activeTab === 'auth'}
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
