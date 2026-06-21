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
      class="mx-auto flex max-w-xl items-center justify-between gap-4 px-4 py-3"
    >
      <div class="flex min-w-0 items-center gap-2.5">
        <div
          class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-accent text-accent-foreground"
        >
          <Lock class="size-4" />
        </div>
        <div class="flex min-w-0 items-center gap-2">
          <span class="text-base font-semibold tracking-tight text-foreground"
            >nook</span
          >
          <span
            class="shrink-0 text-[10px] font-medium text-muted-foreground border border-border px-1 py-0.5 rounded-sm"
            >v0.1.0</span
          >
        </div>
      </div>

      <nav
        class="flex shrink-0 rounded-lg border border-border bg-muted p-0.5"
        aria-label="Main Navigation"
      >
        <button
          class="rounded-md px-3 py-1 text-xs font-medium transition-all duration-200 sm:px-3.5 sm:text-sm {vault.activeTab ===
          'auth'
            ? 'bg-card text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'}"
          onclick={() => (vault.activeTab = 'auth')}
        >
          Setup
        </button>
        <button
          class="rounded-md px-3 py-1 text-xs font-medium transition-all duration-200 sm:px-3.5 sm:text-sm {vault.activeTab ===
          'secrets'
            ? 'bg-card text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'}"
          onclick={() => (vault.activeTab = 'secrets')}
        >
          Vault
        </button>
      </nav>
    </div>
  </header>

  <div
    class="mx-auto px-4 {vault.activeTab === 'secrets'
      ? 'max-w-6xl py-8 sm:px-6 lg:px-8'
      : 'max-w-xl pt-4 pb-8'}"
  >
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
        isAuthenticated={vault.isAuthenticated}
        isVerifying={vault.isVerifying}
        isSaving={vault.isSaving}
        isInitializing={vault.isInitializing}
        errorMsg={vault.errorMsg}
        successMsg={vault.successMsg}
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
