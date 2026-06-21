<script lang="ts">
  import { onMount } from 'svelte'
  import { Lock, ShieldCheck, TriangleAlert, Settings } from '@lucide/svelte'
  import { VaultState } from '$lib/vault.svelte'
  import AuthStorage from '$lib/components/AuthStorage.svelte'
  import SecretVault from '$lib/components/SecretVault.svelte'
  import { Button } from '$lib/components/ui/button'

  const vault = new VaultState()

  onMount(async () => {
    await vault.init()
  })

  async function handleConnect() {
    await vault.loadDb()
    if (vault.isAuthenticated) {
      vault.closeSettings()
    }
  }

  const shellWidth = $derived(
    vault.isAuthenticated ? 'max-w-6xl' : 'max-w-xl',
  )
</script>

<main class="dark min-h-svh bg-background text-foreground pb-16">
  <header
    class="border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-40"
  >
    <div
      class="mx-auto flex items-center justify-between gap-4 px-4 py-3 sm:px-6 {shellWidth}"
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

      <div class="flex items-center gap-2">
        {#if vault.isAuthenticated}
          <button
            type="button"
            onclick={() => vault.openSettings()}
            class="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            data-testid="storage-status-chip"
          >
            {vault.storageMode === 'github' ? 'GitHub sync' : 'Local storage'}
          </button>
          <Button
            variant="outline"
            size="icon"
            class="shrink-0 border-border"
            aria-label="Storage settings"
            data-testid="storage-settings-btn"
            onclick={() => vault.openSettings()}
          >
            <Settings class="size-4" />
          </Button>
        {:else}
          <span
            class="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground"
            data-testid="welcome-header-hint"
          >
            <ShieldCheck class="size-3 shrink-0" />
            <span class="hidden sm:inline">Encrypted in your browser</span>
            <span class="sm:hidden">Encrypted locally</span>
          </span>
        {/if}
      </div>
    </div>
  </header>

  <div
    class="mx-auto px-4 sm:px-6 {shellWidth} {vault.isAuthenticated
      ? 'py-8'
      : 'py-5 sm:py-6'}"
  >
    {#if vault.errorMsg && vault.isAuthenticated}
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

    {#if vault.successMsg && vault.isAuthenticated}
      <div
        class="mb-6 flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/10 p-4 text-sm text-primary animate-in fade-in slide-in-from-top-2"
        role="status"
        data-testid="app-success"
      >
        <ShieldCheck class="size-5 shrink-0 text-primary mt-0.5" />
        <div class="flex-1">
          <p class="font-semibold">Success</p>
          <p class="mt-1 text-primary/90">{vault.successMsg}</p>
        </div>
      </div>
    {/if}

    {#if vault.isAuthenticated}
      <SecretVault
        isSaving={vault.isSaving}
        secretsCount={vault.secrets.length}
        storageMode={vault.storageMode}
        onAddSecret={(key, value) => vault.handleAddSecret(key, value)}
        onDeleteSecret={(key) => vault.handleDeleteSecret(key)}
        onOpenSettings={() => vault.openSettings()}
        onFilterSecrets={(query) => vault.filterSecrets(query)}
        onGeneratePassword={(length, lowercase, uppercase, numbers, symbols) =>
          vault.generatePassword(
            length,
            lowercase,
            uppercase,
            numbers,
            symbols,
          )}
      />
    {:else}
      <div data-testid="vault-welcome" class="w-full">
        <AuthStorage
          bind:storageMode={vault.storageMode}
          bind:githubPat={vault.githubPat}
          variant="welcome"
          isAuthenticated={vault.isAuthenticated}
          isVerifying={vault.isVerifying}
          isSaving={vault.isSaving}
          isInitializing={vault.isInitializing}
          errorMsg={vault.errorMsg}
          successMsg={vault.successMsg}
          secretsCount={vault.secrets.length}
          onConnect={handleConnect}
          onInitializeEmpty={() => vault.handleInitializeEmpty()}
        />
      </div>
    {/if}
  </div>

  {#if vault.settingsOpen}
    <div class="fixed inset-0 z-50">
      <button
        type="button"
        class="absolute inset-0 bg-black/60 backdrop-blur-[1px]"
        aria-label="Close storage settings"
        data-testid="storage-settings-backdrop"
        onclick={() => vault.closeSettings()}
      ></button>
      <aside
        class="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-border bg-card shadow-2xl animate-in slide-in-from-right duration-200"
        role="dialog"
        aria-modal="true"
        aria-label="Storage settings"
        data-testid="storage-settings-panel"
      >
        <div class="overflow-y-auto p-4 sm:p-6">
          <AuthStorage
            bind:storageMode={vault.storageMode}
            bind:githubPat={vault.githubPat}
            variant="panel"
            isAuthenticated={vault.isAuthenticated}
            isVerifying={vault.isVerifying}
            isSaving={vault.isSaving}
            isInitializing={vault.isInitializing}
            errorMsg={vault.errorMsg}
            successMsg={vault.successMsg}
            secretsCount={vault.secrets.length}
            onConnect={handleConnect}
            onInitializeEmpty={() => vault.handleInitializeEmpty()}
            onClose={() => vault.closeSettings()}
          />
        </div>
      </aside>
    </div>
  {/if}
</main>
