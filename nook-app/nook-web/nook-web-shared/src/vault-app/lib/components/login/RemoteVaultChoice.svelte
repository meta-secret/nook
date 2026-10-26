<!--
A recovery provider that holds several vaults: the user picks the one to
recover here from what the provider tells about each, then the import
continues with it.
-->
<script lang="ts">
  import { ArrowRight } from '@lucide/svelte'
  import { I18N_KEYS } from '../../../../generated/i18n-keys'
  import type { ProviderVaultSummary } from '$app-wasm'
  import { Button } from '$lib/components/ui/button'
  import ProviderVaultList from '$lib/components/provider-vaults/ProviderVaultList.svelte'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    busy,
    onChoose,
  }: {
    vault: VaultState
    busy: boolean
    onChoose: (storeId: string) => void | Promise<void>
  } = $props()
</script>

<section class="grid gap-3" data-testid="remote-vault-choice">
  <div class="space-y-1">
    <p class="text-sm font-medium text-foreground">
      {vault.t(I18N_KEYS.FirstRunRestoreChooseVault)}
    </p>
    <p class="text-sm text-pretty text-muted-foreground">
      {vault.t(I18N_KEYS.FirstRunRestoreChooseVaultBody)}
    </p>
  </div>
  <ProviderVaultList {vault} vaults={vault.remoteVaultChoices}>
    {#snippet action(summary: ProviderVaultSummary)}
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-testid="remote-vault-choice-item"
        disabled={busy}
        onclick={() => void onChoose(summary.storeId)}
      >
        {vault.t(I18N_KEYS.ProviderVaultsRecover)}
        <ArrowRight class="size-4" aria-hidden="true" />
      </Button>
    {/snippet}
  </ProviderVaultList>
</section>
