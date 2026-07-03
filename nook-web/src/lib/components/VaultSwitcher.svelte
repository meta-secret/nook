<script lang="ts">
  import { Check, ChevronDown, FolderKey, Plus } from '@lucide/svelte'
  import LoginVaultCard from '$lib/components/login/LoginVaultCard.svelte'
  import type { LocalVaultEntry } from '$lib/local-vault'
  import { vaultDisplayLabel } from '$lib/vault-display'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    variant = 'header',
  }: {
    vault: VaultState
    variant?: 'header' | 'panel'
  } = $props()

  let open = $state(false)
  let root = $state<HTMLDivElement | null>(null)
  let switchingTo = $state<string | null>(null)

  const activeStoreId = $derived(vault.activeVaultStoreId?.trim() ?? '')
  const vaults = $derived(vault.localVaults)
  const activeVault = $derived(
    vaults.find((entry) => entry.storeId === activeStoreId) ?? vaults[0] ?? null,
  )
  const activeLabel = $derived(
    activeVault ? vaultDisplayLabel(activeVault, vault.t) : vault.t('nav.vault'),
  )
  const vaultCount = $derived(vaults.length)
  const isBusy = $derived(
    vault.isVerifying || vault.isInitializing || switchingTo !== null,
  )

  function handleDocumentClick(event: MouseEvent) {
    if (!open || !root) return
    if (!root.contains(event.target as Node)) open = false
  }

  function handleDocumentKeydown(event: KeyboardEvent) {
    if (open && event.key === 'Escape') open = false
  }

  $effect(() => {
    if (!open) return
    document.addEventListener('click', handleDocumentClick)
    document.addEventListener('keydown', handleDocumentKeydown)
    return () => {
      document.removeEventListener('click', handleDocumentClick)
      document.removeEventListener('keydown', handleDocumentKeydown)
    }
  })

  async function toggleOpen() {
    if (variant !== 'header') return
    const next = !open
    open = next
    if (next) {
      await vault.refreshLocalVaultCatalog()
    }
  }

  async function switchTo(entry: LocalVaultEntry) {
    if (entry.storeId === activeStoreId || isBusy) return
    open = false
    switchingTo = entry.storeId
    try {
      await vault.switchToVault(entry.storeId)
    } finally {
      switchingTo = null
    }
  }

  function createAnotherVault() {
    open = false
    vault.lockVault()
  }
</script>

{#if variant === 'panel'}
  <section
    class="space-y-2.5 rounded-lg border border-border/50 bg-muted/15 px-3 py-3 sm:border-border/60"
    data-testid="vault-switcher-panel"
  >
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="space-y-0.5">
        <p
          class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {vault.t('vault.switcher_your_vaults')}
        </p>
        <p class="text-xs text-muted-foreground text-pretty">
          {vaultCount === 1
            ? vault.t('vault.switcher_one_on_device')
            : vault.t('vault.switcher_count_on_device', {
                count: String(vaultCount),
              })}
        </p>
      </div>
      {#if vaultCount > 1}
        <span
          class="rounded-full border border-border/60 bg-background/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
          data-testid="vault-switcher-count"
        >
          {vault.t('vault.switcher_open_badge')}
        </span>
      {/if}
    </div>

    <ul class="space-y-2" data-testid="vault-switcher-list">
      {#each vaults as entry (entry.storeId)}
        {@const isActive = entry.storeId === activeStoreId}
        <li>
          <button
            type="button"
            class="block w-full text-left disabled:opacity-60"
            data-testid="vault-switcher-option"
            data-store-id={entry.storeId}
            data-active={isActive ? 'true' : 'false'}
            disabled={isBusy || isActive}
            onclick={() => void switchTo(entry)}
          >
            <LoginVaultCard
              {vault}
              {entry}
              active={isActive}
              interactive={!isActive}
            />
          </button>
        </li>
      {/each}
    </ul>

    <button
      type="button"
      class="inline-flex items-center gap-1.5 text-xs font-medium text-primary transition-colors hover:text-primary/80"
      data-testid="vault-switcher-create-btn"
      disabled={isBusy}
      onclick={createAnotherVault}
    >
      <Plus class="size-3.5" />
      {vault.t('vault.switcher_create_new')}
    </button>
  </section>
{:else if vaultCount > 0}
  <div bind:this={root} class="relative min-w-0 max-w-[min(100%,14rem)]">
    {#if vaultCount > 1}
      <button
        type="button"
        class="flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-border/40 bg-background/60 px-2.5 py-1.5 text-left transition-colors hover:bg-accent/60 sm:bg-background/70"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid="vault-switcher-trigger"
        disabled={isBusy}
        onclick={() => void toggleOpen()}
      >
        <FolderKey class="size-4 shrink-0 text-primary" />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-semibold text-foreground">
            {activeLabel}
          </span>
          <span class="block truncate text-[11px] text-muted-foreground">
            {vault.t('vault.switcher_count_on_device', {
              count: String(vaultCount),
            })}
          </span>
        </span>
        <ChevronDown
          class="size-4 shrink-0 text-muted-foreground transition-transform {open
            ? 'rotate-180'
            : ''}"
        />
      </button>
    {:else}
      <div
        class="flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-border/40 bg-background/60 px-2.5 py-1.5 sm:bg-background/70"
        data-testid="vault-switcher-current"
      >
        <FolderKey class="size-4 shrink-0 text-primary" />
        <span class="min-w-0 truncate text-sm font-semibold text-foreground">
          {activeLabel}
        </span>
      </div>
    {/if}

    {#if open && vaultCount > 1}
      <div
        role="listbox"
        aria-label={vault.t('vault.switcher_choose')}
        class="absolute left-0 top-full z-50 mt-1.5 w-[min(100vw-2rem,20rem)] overflow-hidden rounded-lg border border-border/60 bg-popover p-2 shadow-lg"
        data-testid="vault-switcher-menu"
      >
        <p
          class="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {vault.t('vault.switcher_your_vaults')}
        </p>
        <ul class="max-h-64 space-y-1 overflow-y-auto">
          {#each vaults as entry (entry.storeId)}
            {@const isActive = entry.storeId === activeStoreId}
            <li role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={isActive}
                class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors {isActive
                  ? 'bg-primary/10 text-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'}"
                data-testid="vault-switcher-option"
                data-store-id={entry.storeId}
                disabled={isBusy || isActive}
                onclick={() => void switchTo(entry)}
              >
                <FolderKey
                  class="size-4 shrink-0 {isActive
                    ? 'text-primary'
                    : 'text-muted-foreground'}"
                />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium">
                    {vaultDisplayLabel(entry, vault.t)}
                  </span>
                  <span class="block truncate font-mono text-[10px] opacity-70">
                    {entry.storeId}
                  </span>
                </span>
                {#if isActive}
                  <Check class="size-4 shrink-0 text-primary" />
                {/if}
              </button>
            </li>
          {/each}
        </ul>
        <div class="mt-2 border-t border-border/50 pt-2">
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium text-primary transition-colors hover:bg-accent/60"
            data-testid="vault-switcher-create-btn"
            disabled={isBusy}
            onclick={createAnotherVault}
          >
            <Plus class="size-4" />
            {vault.t('vault.switcher_create_new')}
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}
