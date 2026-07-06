<script lang="ts">
  import {
    Check,
    ChevronDown,
    FolderKey,
    SlidersHorizontal,
  } from '@lucide/svelte'
  import type { NookLocalVaultEntry } from '$lib/nook-wasm/nook_wasm'
  import { vaultDisplayLabel } from '$lib/vault-display'
  import type { VaultState } from '$lib/vault.svelte'

  let { vault }: { vault: VaultState } = $props()

  let open = $state(false)
  let root = $state<HTMLDivElement | null>(null)
  let switchingTo = $state<string | null>(null)

  const activeStoreId = $derived(vault.activeVaultStoreId?.trim() ?? '')
  const vaults = $derived(vault.localVaults)
  const activeVault = $derived(
    vaults.find((entry) => entry.storeId === activeStoreId) ??
      vaults[0] ??
      null,
  )
  const activeLabel = $derived(
    activeVault
      ? vaultDisplayLabel(activeVault, vault.t)
      : vault.t('nav.vault'),
  )
  const vaultCount = $derived(vaults.length)
  const isBusy = $derived(
    vault.isVerifying || vault.isInitializing || switchingTo !== null,
  )

  const triggerClass =
    'inline-flex h-10 min-w-0 max-w-full items-center gap-2 rounded-lg border border-border/40 bg-background/60 px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:bg-background/70'

  function handleDocumentClick(event: MouseEvent) {
    if (!open || !root) return
    if (!root.contains(event.target as Node)) open = false
  }

  function handleDocumentKeydown(event: KeyboardEvent) {
    if (open && event.key === 'Escape') open = false
  }

  $effect(() => {
    if (!vault.isAuthenticated || vault.isVerifying) {
      open = false
      return
    }
    if (!open) return
    document.addEventListener('click', handleDocumentClick)
    document.addEventListener('keydown', handleDocumentKeydown)
    return () => {
      document.removeEventListener('click', handleDocumentClick)
      document.removeEventListener('keydown', handleDocumentKeydown)
    }
  })

  async function toggleOpen() {
    if (open) {
      open = false
      return
    }
    try {
      await vault.refreshLocalVaultCatalog()
      open = true
    } catch {
      open = false
    }
  }

  async function switchTo(entry: NookLocalVaultEntry) {
    if (entry.storeId === activeStoreId || isBusy) return
    open = false
    switchingTo = entry.storeId
    try {
      await vault.switchToVault(entry.storeId)
    } finally {
      switchingTo = null
    }
  }

  function openAdmin() {
    open = false
    vault.openAdmin()
  }
</script>

{#if vaultCount > 0}
  <div bind:this={root} class="relative min-w-0 max-w-[min(100%,14rem)]">
    <button
      type="button"
      class="{triggerClass} text-left"
      aria-haspopup="menu"
      aria-expanded={open}
      data-testid="vault-switcher-trigger"
      disabled={isBusy}
      onclick={() => void toggleOpen()}
    >
      <FolderKey class="size-4 shrink-0 text-primary" />
      <span class="min-w-0 truncate text-foreground">{activeLabel}</span>
      <ChevronDown
        class="size-4 shrink-0 transition-transform {open ? 'rotate-180' : ''}"
      />
    </button>

    {#if open}
      <div
        role="menu"
        tabindex="-1"
        aria-label={vault.t('vault.switcher_choose')}
        class="absolute left-0 top-full z-50 mt-1.5 w-[min(100vw-2rem,20rem)] overflow-hidden rounded-lg border border-border/60 bg-popover p-2 shadow-lg"
        data-testid="vault-switcher-menu"
      >
        <p
          class="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {vault.t('vault.switcher_your_vaults')}
        </p>
        <p
          class="px-2 pb-2 text-xs text-muted-foreground"
          data-testid="vault-switcher-count"
        >
          {vaultCount === 1
            ? vault.t('vault.switcher_one_on_device')
            : vault.t('vault.switcher_count_on_device', {
                count: String(vaultCount),
              })}
        </p>
        <ul class="max-h-64 space-y-0.5 overflow-y-auto">
          {#each vaults as entry (entry.storeId)}
            {@const isActive = entry.storeId === activeStoreId}
            <li role="presentation">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors {isActive
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
                  <span class="block truncate font-medium">
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
        <div class="mt-1.5 border-t border-border/50 pt-1.5">
          <button
            type="button"
            role="menuitem"
            class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium text-primary transition-colors hover:bg-accent/60"
            data-testid="vault-switcher-admin-btn"
            disabled={isBusy}
            onclick={(event) => {
              event.stopPropagation()
              openAdmin()
            }}
          >
            <SlidersHorizontal class="size-4" />
            {vault.t('vault.switcher_admin')}
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}
