<script lang="ts">
  import SiteFooter from '$lib/components/SiteFooter.svelte'
  import VaultDialogs from '$lib/components/app/VaultDialogs.svelte'
  import type { VaultState } from '$lib/vault.svelte'

  let {
    vault,
    showFooter,
  }: {
    vault: VaultState
    showFooter: boolean
  } = $props()
</script>

{#if showFooter}
  <SiteFooter />
{/if}

<VaultDialogs {vault} />
