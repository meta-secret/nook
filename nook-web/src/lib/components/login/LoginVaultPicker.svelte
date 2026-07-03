<script lang="ts">
  import { FolderKey, Plus, RefreshCw, ShieldCheck } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import type { VaultState } from '$lib/vault.svelte'
  import type { LocalVaultEntry } from '$lib/local-vault'

  let {
    vault,
    vaults,
    isVerifying,
    isInitializing,
    onChooseVault,
    onCreateVault,
    onConnectStorage,
  }: {
    vault: VaultState
    vaults: LocalVaultEntry[]
    isVerifying: boolean
    isInitializing: boolean
    onChooseVault: (storeId: string) => void | Promise<void>
    onCreateVault: () => void | Promise<void>
    onConnectStorage: () => void
  } = $props()

  const isBusy = $derived(isVerifying || isInitializing)

  function vaultLabel(entry: LocalVaultEntry): string {
    if (entry.label?.trim()) {
      return entry.label.trim()
    }
    return vault.t('login.vault_picker_unnamed', { store: entry.storeId })
  }
</script>

<div class="space-y-3" data-testid="login-vault-picker">
  <p class="text-sm text-muted-foreground">
    {vault.t('login.vault_picker_hint')}
  </p>

  <ul class="space-y-2">
    {#each vaults as entry (entry.storeId)}
      <li>
        <button
          type="button"
          class="flex w-full items-start gap-3 rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/40"
          data-testid="login-vault-option"
          data-store-id={entry.storeId}
          disabled={isBusy}
          onclick={() => onChooseVault(entry.storeId)}
        >
          <FolderKey class="mt-0.5 size-5 shrink-0 text-primary" />
          <span class="min-w-0 space-y-0.5">
            <span class="block text-sm font-semibold text-foreground">
              {vaultLabel(entry)}
            </span>
            <span class="block truncate text-xs text-muted-foreground">
              {entry.storeId}
            </span>
          </span>
        </button>
      </li>
    {/each}
  </ul>

  <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
    <Button
      type="button"
      variant="outline"
      class="sm:min-w-[180px]"
      data-testid="login-create-additional-vault-btn"
      disabled={isBusy}
      onclick={() => onCreateVault()}
    >
      {#if isVerifying}
        <RefreshCw class="size-4 animate-spin" />
        {vault.t('login.creating_vault')}
      {:else}
        <Plus class="size-4" />
        {vault.t('login.vault_picker_create_new')}
      {/if}
    </Button>
    <Button
      type="button"
      variant="outline"
      class="sm:min-w-[180px]"
      data-testid="login-import-vault-btn"
      disabled={isBusy}
      onclick={onConnectStorage}
    >
      <ShieldCheck class="size-4" />
      {vault.t('login.vault_picker_import')}
    </Button>
  </div>
</div>
