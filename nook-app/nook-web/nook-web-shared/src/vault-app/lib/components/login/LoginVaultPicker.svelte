<!--
Fallback list of the vaults on this browser, used only when no identity card
lists them (for example while the identity directory cannot be read).
-->
<script lang="ts">
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import { ChevronRight } from '@lucide/svelte'
  import LoginVaultCard from '$lib/components/login/LoginVaultCard.svelte'
  import type { VaultState } from '$lib/vault.svelte'
  import type { NookLocalVaultEntry } from '$app-wasm'

  let {
    vault,
    vaults,
    isVerifying,
    isInitializing,
    onChooseVault,
  }: {
    vault: VaultState
    vaults: NookLocalVaultEntry[]
    isVerifying: boolean
    isInitializing: boolean
    onChooseVault: (storeId: string) => void | Promise<void>
  } = $props()

  const isBusy = $derived(isVerifying || isInitializing)
</script>

<section class="grid gap-3" data-testid="login-vault-picker">
  <h3 class="nk-label nk-lockup">{vault.t(I18N_KEYS.LoginVaultPickerOnDevice)}</h3>
  <ul class="nk-list">
    {#each vaults as entry (entry.storeId)}
      <li class="[&+&]:border-t [&+&]:border-border">
        <button
          type="button"
          class="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-accent/60 disabled:opacity-60"
          data-testid="login-vault-option"
          data-store-id={entry.storeId}
          disabled={isBusy}
          onclick={() => onChooseVault(entry.storeId)}
        >
          <span class="min-w-0 flex-1">
            <LoginVaultCard {vault} {entry} />
          </span>
          <ChevronRight
            class="size-4 flex-none text-muted-foreground"
            aria-hidden="true"
          />
        </button>
      </li>
    {/each}
  </ul>
</section>
